"""Builds a rotating weekly staff schedule.

Covers:
1. Shift design: maps each hour's staffing requirement onto a mix of shift
   templates (Morning/Day/Evening/Night), tracking where the schedule ends up
   over- or under-staffed.
2. Rotation structure: alternates work blocks and rest blocks across the week
   so the whole crew's schedules link into one continuous, repeating cycle
   with no dead ends.
3. Rotation assembly: walks that structure day by day to produce a concrete
   e x 7 schedule (e = number of rotation lines, one per shift-pattern group).
4. Labor economics: computes standard vs. overtime hours (1.5x pay over 40h),
   estimated payroll cost, daily labor spend, and employee availability checks.
"""

from collections import defaultdict
import math
import time
from typing import Dict, List, Optional, Tuple

from app.config import DAYS_OF_WEEK, TEMPLATE_ORDER, settings
from app.engine.ergonomics import (
    compute_rest_hours_between,
    evaluate_ergonomics_audit,
    evaluate_rest_sequence_penalty,
    evaluate_shift_type_penalties,
    evaluate_work_sequence_penalty,
    is_backward_rotation,
)
from app.engine.pareto import generate_pareto_frontier
from app.schemas import (
    EmployeeRecord,
    IntervalCoverageCell,
    LaborAnalysisSchema,
    MultigraphArcSchema,
    MultigraphNodeSchema,
    RosterCellSchema,
    RosterLineSchema,
    ShiftTypeResultSchema,
    SolveRequestSchema,
    SolveResponseSchema,
)


def verify_multigraph_eulerian_conditions(
    arcs: List[Dict],
) -> Tuple[bool, List[MultigraphNodeSchema]]:
    in_deg: Dict[str, int] = defaultdict(int)
    out_deg: Dict[str, int] = defaultdict(int)
    adj: Dict[str, List[str]] = defaultdict(list)

    bipartite_valid = True
    for arc in arcs:
        u = arc["from_node"]
        v = arc["to_node"]
        out_deg[u] += 1
        in_deg[v] += 1
        adj[u].append(v)
        if ("_work" in u and "_rest" not in v) or ("_rest" in u and "_work" not in v):
            bipartite_valid = False

    nodes_list: List[MultigraphNodeSchema] = []
    all_balanced = True
    active_nodes = set()

    for g in range(7):
        for n_type in ("work", "rest"):
            nid = f"d{g}_{n_type}"
            ideg = in_deg[nid]
            odeg = out_deg[nid]
            balanced = ideg == odeg
            if not balanced:
                all_balanced = False
            if ideg > 0 or odeg > 0:
                active_nodes.add(nid)
            nodes_list.append(
                MultigraphNodeSchema(
                    node_id=nid,
                    day_index=g,
                    day_name=DAYS_OF_WEEK[g],
                    node_type=n_type,
                    in_degree=ideg,
                    out_degree=odeg,
                    is_balanced=balanced,
                )
            )

    if not active_nodes or not all_balanced or not bipartite_valid:
        return False, nodes_list

    start_node = next(iter(active_nodes))
    visited = set()
    queue = [start_node]
    while queue:
        curr = queue.pop(0)
        if curr in visited:
            continue
        visited.add(curr)
        for nxt in adj[curr]:
            if nxt not in visited:
                queue.append(nxt)

    strongly_connected = visited == active_nodes
    return strongly_connected, nodes_list


def extract_eulerian_cycle_hierholzer(arcs: List[Dict]) -> List[Dict]:
    if not arcs:
        return []

    outgoing_by_node: Dict[str, List[int]] = defaultdict(list)
    for idx, arc in enumerate(arcs):
        outgoing_by_node[arc["from_node"]].append(idx)

    start_node = arcs[0]["from_node"]
    if "_work" not in start_node:
        for g in range(7):
            candidate = f"d{g}_work"
            if outgoing_by_node[candidate]:
                start_node = candidate
                break

    used_arc = [False] * len(arcs)
    node_ptr: Dict[str, int] = defaultdict(int)

    def _next_unused_arc(node: str) -> Optional[int]:
        arc_indices = outgoing_by_node[node]
        while node_ptr[node] < len(arc_indices):
            candidate_idx = arc_indices[node_ptr[node]]
            node_ptr[node] += 1
            if not used_arc[candidate_idx]:
                return candidate_idx
        return None

    node_stack: List[str] = [start_node]
    arc_stack: List[int] = []
    circuit_arcs_reversed: List[int] = []

    while node_stack:
        u = node_stack[-1]
        next_arc_idx = _next_unused_arc(u)
        if next_arc_idx is not None:
            used_arc[next_arc_idx] = True
            node_stack.append(arcs[next_arc_idx]["to_node"])
            arc_stack.append(next_arc_idx)
        else:
            node_stack.pop()
            if arc_stack:
                circuit_arcs_reversed.append(arc_stack.pop())

    ordered_arc_indices = list(reversed(circuit_arcs_reversed))

    if ordered_arc_indices and arcs[ordered_arc_indices[0]]["arc_type"] != "work":
        for i, a_idx in enumerate(ordered_arc_indices):
            if arcs[a_idx]["arc_type"] == "work":
                ordered_arc_indices = ordered_arc_indices[i:] + ordered_arc_indices[:i]
                break

    ordered_arcs: List[Dict] = []
    for step_num, a_idx in enumerate(ordered_arc_indices, start=1):
        arc_copy = dict(arcs[a_idx])
        arc_copy["traversal_order"] = step_num
        ordered_arcs.append(arc_copy)

    return ordered_arcs


# soft guardrail: penalty, not a hard constraint
SOFT_GUARDRAIL_WORK_BOUND_PENALTY = 12.0
# soft guardrail: penalty, not a hard constraint
SOFT_GUARDRAIL_WORK_TARGET_PENALTY = 4.0
# soft guardrail: penalty, not a hard constraint
SOFT_GUARDRAIL_SINGLE_REST_PENALTY = 15.0
# soft guardrail: penalty, not a hard constraint
SOFT_GUARDRAIL_SINGLE_REST_DEFAULT_PENALTY = 3.0
# soft guardrail: penalty, not a hard constraint
SOFT_GUARDRAIL_REST_MIN_PENALTY = 8.0


class SolverInfeasibleError(Exception):
    """Raised when the generator cannot satisfy a hard constraint, or the cycle is incomplete."""


class ISDRWSPSolver:
    """Builds a rotating weekly staff schedule from shift templates and hourly demand."""

    def __init__(
        self,
        request: SolveRequestSchema,
        include_baseline: bool = True,
        include_pareto_frontier: bool = True,
    ):
        self.req = request
        self.demand = request.demand_matrix
        self.templates = [t for t in request.templates if t.enabled]
        if not self.templates:
            self.templates = request.templates[:1]
        self.guardrails = request.guardrails
        self.leeway_pct = request.pareto_leeway_pct
        self.employees = request.employees or []
        self.rotation_week_offset = request.rotation_week_offset
        # Guards against infinite recursion: the real ergonomics comparison needs one extra
        # solve at 0% leeway as its baseline, but that baseline solve must never request its
        # own baseline (it already IS the cheapest/tightest version of the schedule).
        self.include_baseline = include_baseline and self.leeway_pct > 0.0
        # Guards against each pareto-frontier point spawning its own full frontier: only the
        # single top-level solve the caller actually asked for builds a frontier.
        self.include_pareto_frontier = include_pareto_frontier

    def _build_shift_types(self) -> List[Dict]:
        shift_types: List[Dict] = []
        ordered_templates = sorted(
            self.templates, key=lambda x: TEMPLATE_ORDER.get(x.code, 0)
        )

        for tpl in ordered_templates:
            start_hr = tpl.preferred_start
            if (
                tpl.code == "M"
                and start_hr < 6
                and self.leeway_pct >= 1.0
                and tpl.earliest_start <= 6
            ):
                start_hr = 6

            dur = max(tpl.min_duration, min(tpl.max_duration, tpl.preferred_duration))

            end_hr = (start_hr + dur) % 24
            w_sl, w_ms = evaluate_shift_type_penalties(tpl.code, start_hr, dur)

            covered_offsets: List[Tuple[int, int]] = []
            for h_step in range(dur):
                abs_hr = start_hr + h_step
                d_off = 1 if abs_hr >= 24 else 0
                hr_in_day = abs_hr % 24
                covered_offsets.append((d_off, hr_in_day))

            shift_types.append(
                {
                    "type_id": f"ST_{tpl.code}_{start_hr:02d}_{dur}h",
                    "template_code": tpl.code,
                    "template_name": tpl.name,
                    "start_hour": start_hr,
                    "end_hour": end_hr,
                    "duration_hours": dur,
                    "formatted_window": f"{start_hr:02d}:00–{end_hr:02d}:00",
                    "covered_offsets": covered_offsets,
                    "w_sl": w_sl,
                    "w_ms": w_ms,
                }
            )
        return shift_types

    def _solve_daily_shift_counts(
        self, shift_types: List[Dict]
    ) -> Dict[Tuple[int, str], int]:
        counts: Dict[Tuple[int, str], int] = {}
        for g in range(7):
            for st in shift_types:
                req_vals = []
                for d_off, hr in st["covered_offsets"]:
                    target_day = (g + d_off) % 7
                    req_vals.append(self.demand[target_day][hr])
                if not req_vals:
                    counts[(g, st["type_id"])] = 0
                    continue
                sorted_reqs = sorted(req_vals)
                # The 0.65 quantile is a value the author chose. No source for it is recorded in this repository. It is not from Becker (2026) unless a source is added.
                q_idx = int(len(sorted_reqs) * 0.65)
                base_needed = sorted_reqs[min(len(sorted_reqs) - 1, q_idx)]
                counts[(g, st["type_id"])] = max(0, int(round(base_needed)))

        for _ in range(2):
            for g in range(7):
                for st in shift_types:
                    current_val = counts[(g, st["type_id"])]
                    best_val = current_val
                    best_cost = self._evaluate_coverage_deviation(shift_types, counts)
                    for candidate in [max(0, current_val - 1), current_val + 1]:
                        counts[(g, st["type_id"])] = candidate
                        c_cost = self._evaluate_coverage_deviation(shift_types, counts)
                        if c_cost < best_cost:
                            best_cost = c_cost
                            best_val = candidate
                    counts[(g, st["type_id"])] = best_val

        return counts

    def _evaluate_coverage_deviation(
        self, shift_types: List[Dict], counts: Dict[Tuple[int, str], int]
    ) -> float:
        w_u = settings.shift_weights.w_understaffing
        w_o = settings.shift_weights.w_overstaffing
        cov = [[0] * 24 for _ in range(7)]
        for g in range(7):
            for st in shift_types:
                c = counts.get((g, st["type_id"]), 0)
                if c > 0:
                    for d_off, hr in st["covered_offsets"]:
                        cov[(g + d_off) % 7][hr] += c
        total_dev = 0.0
        for g in range(7):
            for i in range(24):
                diff = cov[g][i] - self.demand[g][i]
                if diff < 0:
                    total_dev += w_u * (-diff)
                elif diff > 0:
                    total_dev += w_o * diff
        return total_dev

    def _partition_into_alternating_sequences(
        self, total_work_shifts: int
    ) -> Tuple[int, List[Tuple[int, int]]]:
        min_w = self.guardrails.min_consecutive_work_days
        max_w = self.guardrails.max_consecutive_work_days
        min_r = (
            max(2, self.guardrails.min_consecutive_rest_days)
            if self.guardrails.avoid_single_rest_days
            else self.guardrails.min_consecutive_rest_days
        )
        max_r = max(min_r, self.guardrails.max_consecutive_rest_days)

        # Paying for more staff buys shorter work stretches and more rest: a higher leeway
        # setting lowers the target work-ratio, which raises headcount for the same total
        # shifts. This is the real cost/rest trade-off the leeway slider is supposed to offer.
        base_work_ratio = 4.65 / 7.0
        min_work_ratio = 3.50 / 7.0
        leeway_fraction = max(0.0, min(1.0, self.leeway_pct / 100.0))
        target_ratio = max(
            min_work_ratio,
            min(base_work_ratio, base_work_ratio - leeway_fraction * (base_work_ratio - min_work_ratio)),
        )
        e = max(3, int(round(total_work_shifts / (7.0 * target_ratio))))
        while e * 7 - total_work_shifts < max(2, (e * min_r) // 2):
            e += 1

        total_days = e * 7
        best_pairs: List[Tuple[int, int]] = []
        best_score = float("inf")

        for k in range(max(1, e - 2), e + 3):
            w_total = total_work_shifts
            r_total = total_days - w_total
            if r_total < k:
                continue

            base_w = w_total // k
            rem_w = w_total % k
            w_lens = [base_w + (1 if idx < rem_w else 0) for idx in range(k)]

            base_r = r_total // k
            rem_r = r_total % k
            r_lens = [base_r + (1 if idx < rem_r else 0) for idx in range(k)]

            if any(w < 1 or w > 7 for w in w_lens) or any(
                r < 1 or r > 7 for r in r_lens
            ):
                continue

            score = 0.0
            for w_len in w_lens:
                if w_len < min_w:
                    score += SOFT_GUARDRAIL_WORK_BOUND_PENALTY * (min_w - w_len)
                elif w_len > max_w:
                    score += SOFT_GUARDRAIL_WORK_BOUND_PENALTY * (w_len - max_w)
                if not (3 <= w_len <= 5):
                    score += SOFT_GUARDRAIL_WORK_TARGET_PENALTY * abs(4 - w_len)
            for r_len in r_lens:
                if r_len == 1:
                    score += (
                        SOFT_GUARDRAIL_SINGLE_REST_PENALTY
                        if self.guardrails.avoid_single_rest_days
                        else SOFT_GUARDRAIL_SINGLE_REST_DEFAULT_PENALTY
                    )
                if r_len < min_r:
                    score += SOFT_GUARDRAIL_REST_MIN_PENALTY * (min_r - r_len)
                elif r_len > max_r:
                    score += 4.0 * (r_len - max_r)

            if score < best_score:
                best_score = score
                best_pairs = list(zip(w_lens, r_lens))

        if not best_pairs:
            best_pairs = [(5, 2) for _ in range(e)]

        return e, best_pairs

    def _assign_forward_rotating_shifts_to_work_sequences(
        self,
        pairs: List[Tuple[int, int]],
        daily_template_pool: Dict[Tuple[int, str], int],
        available_codes: List[str],
        st_by_code: Dict[str, Dict],
    ) -> List[Dict]:
        ordered_codes = sorted(available_codes, key=lambda c: TEMPLATE_ORDER.get(c, 0))
        if not ordered_codes:
            ordered_codes = ["M"]

        rem_pool: Dict[Tuple[int, str], int] = {
            k: v for k, v in daily_template_pool.items()
        }

        # A day with zero required shifts across every template is a day the business is
        # closed. Nobody is ever scheduled on it, regardless of where it falls in a work block.
        closed_days = {
            day
            for day in range(7)
            if sum(daily_template_pool.get((day, c), 0) for c in available_codes) == 0
        }

        raw_arcs: List[Dict] = []
        current_day = 0

        if self.guardrails.prioritize_free_weekends and pairs:
            first_w_len = pairs[0][0]
            current_day = (5 - first_w_len) % 7

        max_n = self.guardrails.max_consecutive_nights
        max_e = self.guardrails.max_consecutive_evenings
        # Safety valve: at most this many dead-end retries per work block before
        # concluding no ordering of the enabled templates can satisfy the guardrails.
        max_backtracks_per_block = 2000

        arc_counter = 1
        for w_len, r_len in pairs:
            w_start = current_day
            w_end_next = (w_start + w_len) % 7

            # Each entry is {"code": str, "choice": bool}. "choice" marks a step where a
            # template was picked among real alternatives, as opposed to a forced closed-day
            # "OFF" or a forced second night - only "choice" steps are worth backtracking into
            # when a later step turns out to have no legal template.
            history: List[Dict] = []
            exhausted_at_step: Dict[int, set] = {}
            backtracks = 0

            step = 0
            while step < w_len:
                seq_shifts = [h["code"] for h in history]
                day_g = (w_start + step) % 7
                steps_remaining = w_len - step
                prev_code = seq_shifts[-1] if seq_shifts else "OFF"
                min_order_idx = (
                    TEMPLATE_ORDER.get(prev_code, 0)
                    if self.guardrails.enforce_forward_rotation and prev_code != "OFF"
                    else 0
                )

                if day_g in closed_days:
                    # The business is closed this day - free rest, overriding the rotation
                    # pattern entirely. The next real work day after the closure can start
                    # from any template, same as after a rest arc (min_order_idx above
                    # already resets to 0 once prev_code is "OFF").
                    history.append({"code": "OFF", "choice": False})
                    step += 1
                    continue

                if prev_code == "N":
                    n_st = st_by_code["N"]
                    forced_rest_hrs = compute_rest_hours_between(
                        "N",
                        n_st["start_hour"],
                        n_st["duration_hours"],
                        "N",
                        n_st["start_hour"],
                    )
                    if forced_rest_hrs < settings.min_rest_hours_between_shifts:
                        raise SolverInfeasibleError(
                            "A night shift cannot be followed by another night shift "
                            "with the required rest between them. "
                            "Shorten the night template or relax the rest rule."
                        )
                    history.append({"code": "N", "choice": False})
                    rem_pool[(day_g, "N")] = rem_pool.get((day_g, "N"), 0) - 1
                    step += 1
                    continue

                tried = exhausted_at_step.get(step, set())
                candidates = [
                    c
                    for c in ordered_codes
                    if TEMPLATE_ORDER.get(c, 0) >= min_order_idx and c not in tried
                ]
                if not candidates:
                    candidates = [c for c in (ordered_codes[-1],) if c not in tried]

                valid_candidates: List[str] = []
                for cand in candidates:
                    if prev_code != "OFF":
                        p_st = st_by_code[prev_code]
                        c_st = st_by_code[cand]
                        rest_hrs = compute_rest_hours_between(
                            prev_code,
                            p_st["start_hour"],
                            p_st["duration_hours"],
                            cand,
                            c_st["start_hour"],
                        )
                        if rest_hrs < settings.min_rest_hours_between_shifts:
                            continue

                    if cand == "N":
                        if steps_remaining > max_n:
                            continue
                        if (
                            self.guardrails.avoid_single_night_shifts
                            and steps_remaining == 1
                        ):
                            continue

                    if cand == "E" and len(candidates) > 1:
                        consec_e = 0
                        for prev_s in reversed(seq_shifts):
                            if prev_s == "E":
                                consec_e += 1
                            else:
                                break
                        if consec_e >= max_e:
                            continue

                    valid_candidates.append(cand)

                if not valid_candidates:
                    # Dead end: whatever was picked at an earlier free-choice step left this
                    # step with no legal template. Backtrack to that step, rule out the
                    # choice that led here, and replay forward from there instead of failing
                    # outright - the greedy pass otherwise paints itself into corners (e.g.
                    # picking three evenings in a row for demand reasons, then having nothing
                    # left for the block's last day).
                    backtracks += 1
                    if backtracks > max_backtracks_per_block:
                        raise SolverInfeasibleError(
                            "No combination of templates satisfies the rest and rotation "
                            "rules for this demand. Add templates or relax the guardrails."
                        )
                    retried_step: Optional[int] = None
                    while history:
                        popped_idx = len(history) - 1
                        popped = history.pop()
                        popped_day_g = (w_start + popped_idx) % 7
                        if popped["code"] != "OFF":
                            rem_pool[(popped_day_g, popped["code"])] = (
                                rem_pool.get((popped_day_g, popped["code"]), 0) + 1
                            )
                        if popped["choice"]:
                            exhausted_at_step.setdefault(popped_idx, set()).add(
                                popped["code"]
                            )
                            retried_step = popped_idx
                            break
                    if retried_step is None:
                        raise SolverInfeasibleError(
                            "No combination of templates satisfies the rest and rotation "
                            "rules for this demand. Add templates or relax the guardrails."
                        )
                    for k in list(exhausted_at_step.keys()):
                        if k > retried_step:
                            del exhausted_at_step[k]
                    step = retried_step
                    continue

                best_code = valid_candidates[0]
                best_demand_score = -1e9
                for cand in valid_candidates:
                    rem = rem_pool.get((day_g, cand), 0)
                    stage_target = (step / max(1, w_len - 1)) * (len(ordered_codes) - 1)
                    cand_pos = ordered_codes.index(cand)
                    proximity_bonus = -abs(cand_pos - stage_target) * 0.35
                    score = rem * 2.0 + proximity_bonus
                    if score > best_demand_score:
                        best_demand_score = score
                        best_code = cand

                history.append({"code": best_code, "choice": True})
                rem_pool[(day_g, best_code)] = rem_pool.get((day_g, best_code), 0) - 1
                step += 1

            seq_shifts = [h["code"] for h in history]

            w_pen_info = evaluate_work_sequence_penalty(w_start, seq_shifts)
            raw_arcs.append(
                {
                    "arc_id": f"e_b{arc_counter}",
                    "arc_type": "work",
                    "start_day": w_start,
                    "end_day": (w_start + w_len - 1) % 7,
                    "duration_days": w_len,
                    "from_node": f"d{w_start}_work",
                    "to_node": f"d{w_end_next}_rest",
                    "shifts": seq_shifts,
                    "sequence_penalty": round(w_pen_info["total"], 2),
                }
            )

            r_start = w_end_next
            r_end_next = (r_start + r_len) % 7
            r_pen_info = evaluate_rest_sequence_penalty(r_start, r_len)
            raw_arcs.append(
                {
                    "arc_id": f"e_h{arc_counter}",
                    "arc_type": "rest",
                    "start_day": r_start,
                    "end_day": (r_start + r_len - 1) % 7,
                    "duration_days": r_len,
                    "from_node": f"d{r_start}_rest",
                    "to_node": f"d{r_end_next}_work",
                    "shifts": ["OFF"] * r_len,
                    "sequence_penalty": round(r_pen_info["total"], 2),
                }
            )

            current_day = r_end_next
            arc_counter += 1

        return raw_arcs

    def solve(self) -> SolveResponseSchema:
        t0 = time.perf_counter()

        shift_types_raw = self._build_shift_types()
        st_by_code: Dict[str, Dict] = {
            st["template_code"]: st for st in shift_types_raw
        }
        daily_counts = self._solve_daily_shift_counts(shift_types_raw)

        daily_template_pool: Dict[Tuple[int, str], int] = defaultdict(int)
        total_work_shifts = 0
        for g in range(7):
            for st in shift_types_raw:
                cnt = daily_counts.get((g, st["type_id"]), 0)
                daily_template_pool[(g, st["template_code"])] += cnt
                total_work_shifts += cnt

        if total_work_shifts < 14:
            raise SolverInfeasibleError(
                "The demand gives fewer than 14 work shifts a week, so no valid rotation exists."
            )

        employee_count, seq_pairs = self._partition_into_alternating_sequences(
            total_work_shifts
        )
        available_codes = [st["template_code"] for st in shift_types_raw]
        raw_arcs = self._assign_forward_rotating_shifts_to_work_sequences(
            seq_pairs, daily_template_pool, available_codes, st_by_code
        )

        eulerian_valid, multigraph_nodes = verify_multigraph_eulerian_conditions(
            raw_arcs
        )
        if not eulerian_valid:
            raise SolverInfeasibleError("The generated multigraph is not balanced, so no cycle exists.")
        ordered_arcs_dicts = extract_eulerian_cycle_hierholzer(raw_arcs)
        if len(ordered_arcs_dicts) != len(raw_arcs):
            raise SolverInfeasibleError(
                f"The cycle covers {len(ordered_arcs_dicts)} of {len(raw_arcs)} arcs, "
                "so the schedule is not one connected rotation."
            )
        multigraph_arcs = [MultigraphArcSchema(**a) for a in ordered_arcs_dicts]

        g_start = ordered_arcs_dicts[0]["start_day"] if ordered_arcs_dicts else 0
        flat_cycle_shifts: List[str] = []
        for arc in ordered_arcs_dicts:
            flat_cycle_shifts.extend(arc["shifts"])

        total_slots = employee_count * 7
        if len(flat_cycle_shifts) != total_slots:
            raise SolverInfeasibleError(
                f"The cycle has {len(flat_cycle_shifts)} day slots from {len(ordered_arcs_dicts)} arcs, "
                f"but {employee_count} lines need {total_slots}. "
                "The schedule is not one whole rotation."
            )

        aligned_shifts = ["OFF"] * total_slots
        for step_idx, s_code in enumerate(flat_cycle_shifts):
            aligned_pos = (g_start + step_idx) % total_slots
            aligned_shifts[aligned_pos] = s_code

        if self.guardrails.enforce_zero_clopening:
            for line_idx in range(employee_count):
                for d in range(7):
                    today = aligned_shifts[line_idx * 7 + d]
                    tomorrow = aligned_shifts[line_idx * 7 + (d + 1) % 7]
                    if today == "E" and tomorrow == "M":
                        raise SolverInfeasibleError(
                            "The rotation has a closing shift followed by an opening shift, "
                            "which zero-clopening forbids."
                        )

        actual_daily_counts: Dict[Tuple[int, str], int] = defaultdict(int)
        for line_idx in range(employee_count):
            for d in range(7):
                sc = aligned_shifts[line_idx * 7 + d]
                if sc != "OFF" and sc in st_by_code:
                    actual_daily_counts[(d, st_by_code[sc]["type_id"])] += 1

        shift_type_results: List[ShiftTypeResultSchema] = []
        active_shift_types_count = 0
        for st in shift_types_raw:
            d_counts = [
                actual_daily_counts.get((g, st["type_id"]), 0) for g in range(7)
            ]
            is_active = sum(d_counts) > 0
            if is_active:
                active_shift_types_count += 1
            shift_type_results.append(
                ShiftTypeResultSchema(
                    type_id=st["type_id"],
                    template_code=st["template_code"],
                    template_name=st["template_name"],
                    start_hour=st["start_hour"],
                    end_hour=st["end_hour"],
                    duration_hours=st["duration_hours"],
                    formatted_window=st["formatted_window"],
                    active=is_active,
                    daily_counts=d_counts,
                    early_morning_penalty=st["w_ms"],
                    duration_penalty=st["w_sl"],
                )
            )

        # Build personnel lookup (matching active EmployeeRecord or legacy StaffMemberAssignment)
        emp_by_line: Dict[int, EmployeeRecord] = {}
        active_pool = [e for e in self.employees if e.is_active]
        for emp in active_pool:
            if emp.assigned_line_id and 1 <= emp.assigned_line_id <= employee_count:
                emp_by_line[emp.assigned_line_id] = emp

        # Auto-map remaining active employees to empty lines
        unassigned_emps = [e for e in active_pool if e.employee_id not in [x.employee_id for x in emp_by_line.values()]]
        for l_num in range(1, employee_count + 1):
            if l_num not in emp_by_line and unassigned_emps:
                assigned_e = unassigned_emps.pop(0)
                emp_by_line[l_num] = assigned_e

        # Fallback to staff_assignments if provided
        staff_map: Dict[int, Tuple[Optional[str], str, float, Optional[str]]] = {}
        if self.req.staff_assignments:
            for sa in self.req.staff_assignments:
                staff_map[sa.line_id] = (
                    sa.assigned_staff_name,
                    sa.qualification_tier,
                    sa.hourly_wage,
                    sa.employee_id,
                )

        roster_lines: List[RosterLineSchema] = []
        offset = self.req.rotation_week_offset % max(1, employee_count)

        total_reg_hours = 0
        total_ot_hours = 0
        total_payroll = 0.0
        total_reg_payroll = 0.0
        total_ot_payroll = 0.0
        daily_hours_sum = [0] * 7
        daily_cost_sum = [0.0] * 7
        overtime_lines_count = 0

        for line_idx in range(employee_count):
            line_num = line_idx + 1
            has_statutory_violation = False
            pattern_idx = (line_idx + offset) % employee_count
            row_codes = aligned_shifts[pattern_idx * 7 : (pattern_idx + 1) * 7]
            prev_pattern_idx = (pattern_idx - 1) % employee_count
            prev_sunday_code = aligned_shifts[prev_pattern_idx * 7 + 6]

            # Resolve mapped employee details
            emp_rec = emp_by_line.get(line_num)
            if emp_rec:
                assigned_person = emp_rec.name
                assigned_emp_id = emp_rec.employee_id
                qual_tier = emp_rec.role
                wage = emp_rec.hourly_wage
                avail_days = set(emp_rec.available_days)
            elif line_num in staff_map:
                s_name, s_tier, s_wage, s_eid = staff_map[line_num]
                assigned_person = s_name
                assigned_emp_id = s_eid
                qual_tier = s_tier
                wage = s_wage
                avail_days = {0, 1, 2, 3, 4, 5, 6}
            else:
                assigned_person = None
                assigned_emp_id = None
                qual_tier = "Union Line Standard"
                wage = None
                avail_days = {0, 1, 2, 3, 4, 5, 6}

            display_label = (
                f"Line {line_num} — {assigned_person}"
                if assigned_person
                else f"Rotation Line {line_num}"
            )

            cells: List[RosterCellSchema] = []
            weekly_hours = 0
            work_days = 0
            avail_conflicts = 0

            for d in range(7):
                curr_code = row_codes[d]
                prev_code = prev_sunday_code if d == 0 else row_codes[d - 1]

                prev_st = st_by_code.get(prev_code)
                curr_st = st_by_code.get(curr_code)

                prev_start = prev_st["start_hour"] if prev_st else 0
                prev_dur = prev_st["duration_hours"] if prev_st else 0
                curr_start = curr_st["start_hour"] if curr_st else 0
                curr_dur = curr_st["duration_hours"] if curr_st else 0

                rest_before = compute_rest_hours_between(
                    prev_code, prev_start, prev_dur, curr_code, curr_start
                )
                clopen_viol = (
                    curr_code != "OFF"
                    and prev_code != "OFF"
                    and rest_before < settings.min_rest_hours_between_shifts
                )
                backward_viol = is_backward_rotation(prev_code, curr_code)

                # Check employee availability constraint on day d
                is_avail_conflict = False
                is_statutory_conflict = False
                if curr_code != "OFF" and d not in avail_days:
                    is_avail_conflict = True
                    avail_conflicts += 1
                    # Title VII Religious & ADA Medical Accommodation Enforcement
                    emp_record = emp_by_line.get(line_num)
                    if emp_record and getattr(emp_record, "accommodation_type", "none") in ("religious", "medical"):
                        is_statutory_conflict = True
                        has_statutory_violation = True

                if curr_code != "OFF" and curr_st:
                    weekly_hours += curr_dur
                    work_days += 1
                    t_win = curr_st["formatted_window"]
                    st_id = curr_st["type_id"]
                    daily_hours_sum[d] += curr_dur
                else:
                    t_win = "Rest / Off"
                    st_id = None

                cells.append(
                    RosterCellSchema(
                        day_index=d,
                        day_name=DAYS_OF_WEEK[d],
                        is_weekend=(d >= 5),
                        shift_code=curr_code,  # type: ignore[arg-type]
                        shift_type_id=st_id,
                        time_window=t_win,
                        duration_hours=curr_dur,
                        rest_hours_before=rest_before,
                        clopening_violation=clopen_viol,
                        backward_rotation_violation=backward_viol,
                        availability_conflict=is_avail_conflict,
                        statutory_accommodation_conflict=is_statutory_conflict,
                    )
                )

            # Compute labor hours & payroll (regular up to 40h, overtime 1.5x)
            reg_hrs = min(40, weekly_hours)
            ot_hrs = max(0, weekly_hours - 40)
            if ot_hrs > 0:
                overtime_lines_count += 1
            # An unassigned line has no wage, so it adds nothing to payroll.
            if wage is None:
                line_reg_pay = 0.0
                line_ot_pay = 0.0
            else:
                line_reg_pay = round(reg_hrs * wage, 2)
                line_ot_pay = round(ot_hrs * wage * 1.5, 2)
            line_total_pay = round(line_reg_pay + line_ot_pay, 2)

            total_reg_hours += reg_hrs
            total_ot_hours += ot_hrs
            total_reg_payroll += line_reg_pay
            total_ot_payroll += line_ot_pay
            total_payroll += line_total_pay

            # Allocate daily cost proportionally to hours worked on that day
            if weekly_hours > 0:
                eff_rate = line_total_pay / weekly_hours
                for c in cells:
                    if c.shift_code != "OFF":
                        daily_cost_sum[c.day_index] += c.duration_hours * eff_rate

            full_wknd_off = row_codes[5] == "OFF" and row_codes[6] == "OFF"

            roster_lines.append(
                RosterLineSchema(
                    line_number=line_num,
                    cohort_id=f"PATTERN-{line_num:02d}",
                    display_label=display_label,
                    assigned_person=assigned_person,
                    assigned_employee_id=assigned_emp_id,
                    qualification_tier=qual_tier,
                    hourly_wage=wage,
                    current_cycle_week=pattern_idx + 1,
                    next_week_line_number=(line_idx % employee_count) + 1
                    if employee_count == 1
                    else ((line_idx + 1) % employee_count) + 1,
                    days=cells,
                    weekly_hours=weekly_hours,
                    regular_hours=reg_hrs,
                    overtime_hours=ot_hrs,
                    estimated_weekly_payroll=line_total_pay if wage is not None else None,
                    work_days_count=work_days,
                    rest_days_count=7 - work_days,
                    full_weekend_off=full_wknd_off,
                    availability_conflicts_count=avail_conflicts,
                    statutory_accommodation_violation=has_statutory_violation,
                    fair_workweek_predictability_warning=(self.rotation_week_offset > 0 and avail_conflicts > 0),
                    line_ergo_penalty=round(
                        0.0 if full_wknd_off else settings.ergo_weights.w_weekend_work,
                        2,
                    ),
                )
            )

        interval_coverage: List[IntervalCoverageCell] = []
        total_under = 0
        total_over = 0
        total_weekly_req_hours = 0

        cov_by_day_hr: List[List[Dict[str, int]]] = [
            [defaultdict(int) for _ in range(24)] for _ in range(7)
        ]
        for g in range(7):
            for st in shift_types_raw:
                cnt = actual_daily_counts.get((g, st["type_id"]), 0)
                if cnt > 0:
                    for d_off, hr in st["covered_offsets"]:
                        cov_by_day_hr[(g + d_off) % 7][hr][st["template_code"]] += cnt

        for g in range(7):
            for hr in range(24):
                req_val = self.demand[g][hr]
                total_weekly_req_hours += req_val
                breakdown = dict(cov_by_day_hr[g][hr])
                sched_val = sum(breakdown.values())
                tau_gi = max(0, req_val - sched_val)
                omega_gi = max(0, sched_val - req_val)
                total_under += tau_gi
                total_over += omega_gi

                interval_coverage.append(
                    IntervalCoverageCell(
                        day_index=g,
                        day_name=DAYS_OF_WEEK[g],
                        hour=hr,
                        hour_label=f"{hr:02d}:00",
                        required_staff=req_val,
                        scheduled_staff=sched_val,
                        understaffing=tau_gi,
                        overstaffing=omega_gi,
                        shift_breakdown=breakdown,
                    )
                )

        # Real comparison: solve the same request at 0% leeway (the cheapest, tightest
        # version of this schedule) and use its actual score as the baseline - not an
        # estimate. include_baseline guards against this baseline solve recursing further.
        # This same real re-solve also supplies the labor-cost baseline below, so the
        # cost/OT savings numbers come from an actually-solved alternative schedule too.
        baseline_audit = None
        baseline_solution = None
        if self.include_baseline:
            baseline_request = self.req.model_copy(update={"pareto_leeway_pct": 0.0})
            baseline_solution = ISDRWSPSolver(
                baseline_request, include_baseline=False, include_pareto_frontier=False
            ).solve()
            baseline_audit = baseline_solution.ergonomics_audit

        ergonomics_audit = evaluate_ergonomics_audit(
            shift_types=shift_type_results,
            multigraph_arcs=multigraph_arcs,
            roster_lines=roster_lines,
            guardrails=self.guardrails,
            baseline_audit=baseline_audit,
        )

        # Build LaborAnalysisSchema
        tot_sched_hours = total_reg_hours + total_ot_hours
        avg_wage = (
            round(total_reg_payroll / max(1, total_reg_hours), 2)
            if total_reg_hours > 0
            else None
        )
        labor_eff = round(
            (total_weekly_req_hours / max(1, tot_sched_hours)) * 100.0, 1
        )
        total_payroll_rounded = round(total_payroll, 2)
        total_ot_payroll_rounded = round(total_ot_payroll, 2)

        # Baseline labor figures: the real 0%-leeway re-solve's own labor analysis when one
        # was computed above, or this same schedule's own figures (so the delta is honestly
        # 0) when this request already IS the 0%-leeway case.
        if baseline_solution is not None:
            baseline_total_payroll = round(baseline_solution.labor_analysis.total_payroll_cost, 2)
            baseline_ot_hours = baseline_solution.labor_analysis.total_overtime_hours
            baseline_ot_payroll = round(baseline_solution.labor_analysis.overtime_payroll_cost, 2)
        else:
            baseline_total_payroll = total_payroll_rounded
            baseline_ot_hours = total_ot_hours
            baseline_ot_payroll = total_ot_payroll_rounded

        labor_analysis = LaborAnalysisSchema(
            total_scheduled_hours=tot_sched_hours,
            total_regular_hours=total_reg_hours,
            total_overtime_hours=total_ot_hours,
            regular_payroll_cost=round(total_reg_payroll, 2),
            overtime_payroll_cost=total_ot_payroll_rounded,
            total_payroll_cost=total_payroll_rounded,
            avg_hourly_wage=avg_wage,
            hours_per_day=daily_hours_sum,
            cost_per_day=[round(c, 2) for c in daily_cost_sum],
            overtime_lines_count=overtime_lines_count,
            labor_efficiency_pct=labor_eff,
            baseline_total_payroll_cost=baseline_total_payroll,
            baseline_overtime_hours=baseline_ot_hours,
            baseline_overtime_payroll_cost=baseline_ot_payroll,
            payroll_cost_savings_vs_baseline=round(baseline_total_payroll - total_payroll_rounded, 2),
            overtime_hours_saved_vs_baseline=round(baseline_ot_hours - total_ot_hours, 2),
            overtime_cost_savings_vs_baseline=round(baseline_ot_payroll - total_ot_payroll_rounded, 2),
        )

        # Real total cost: staff count + shift variety + over/understaffing, computed directly
        # from the schedule actually built - not scaled by a formula unrelated to what was built.
        sw = settings.shift_weights
        obj_shift_min_bound = round(
            sw.w_employees * employee_count
            + sw.w_shift_types * active_shift_types_count
            + sw.w_understaffing * total_under
            + sw.w_overstaffing * total_over,
            2,
        )
        obj_shift = obj_shift_min_bound

        if self.include_pareto_frontier:
            pareto_frontier = generate_pareto_frontier(
                base_request=self.req,
                selected_leeway_pct=self.leeway_pct,
            )
        else:
            pareto_frontier = []

        if total_weekly_req_hours <= 800:
            size_cat = "Small"
        elif total_weekly_req_hours <= 1600:
            size_cat = "Medium"
        else:
            size_cat = "Large"

        n_tpl = max(1, len(shift_types_raw))
        b_count = sum(
            math.comb(L + n_tpl - 1, L)
            for L in range(
                self.guardrails.min_consecutive_work_days,
                self.guardrails.max_consecutive_work_days + 1,
            )
        )
        if b_count <= 25:
            const_cat = "High"
        elif b_count <= 50:
            const_cat = "Medium"
        else:
            const_cat = "Low"

        cycle_preview = " → ".join(
            f"({DAYS_OF_WEEK[a.start_day]}, {''.join(a.shifts) if a.arc_type == 'work' else f'OFF×{a.duration_days}'})"
            for a in multigraph_arcs[:6]
        )
        if len(multigraph_arcs) > 6:
            cycle_preview += f" → … ({len(multigraph_arcs)} arcs total)"

        solve_ms = round((time.perf_counter() - t0) * 1000.0, 2)

        return SolveResponseSchema(
            instance_name=self.req.facility_name,
            archetype_id=self.req.archetype_id,
            instance_size_category=size_cat,
            constrainedness_category=const_cat,
            total_weekly_staffing_hours=total_weekly_req_hours,
            feasible_work_sequences_count=b_count,
            employee_count=employee_count,
            active_shift_types_count=active_shift_types_count,
            obj_shift=obj_shift,
            obj_shift_min_bound=obj_shift_min_bound,
            obj_ergo=ergonomics_audit.total_ergo_objective,
            obj_ergo_sequential_fixed_sd=ergonomics_audit.sequential_baseline_ergo,
            integrated_ergo_gain_pct=ergonomics_audit.ergo_improvement_pct,
            solve_time_ms=solve_ms,
            eulerian_valid=eulerian_valid,
            eulerian_cycle_summary=cycle_preview,
            shift_types=shift_type_results,
            multigraph_nodes=multigraph_nodes,
            multigraph_arcs=multigraph_arcs,
            roster_lines=roster_lines,
            interval_coverage=interval_coverage,
            ergonomics_audit=ergonomics_audit,
            pareto_frontier=pareto_frontier,
            labor_analysis=labor_analysis,
            employees=self.employees,
        )
