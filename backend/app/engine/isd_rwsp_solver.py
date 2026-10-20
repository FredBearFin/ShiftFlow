"""Becker (2026) Integrated Shift Design & Rotating Workforce Scheduling (I-SD-RWSP) Solver.

Implements:
1. Shift Design Optimization (Constraints 3-4, Eq. 1):
   Maps 24-hour interval staffing requirements R_{gi} onto concrete shift types t in T
   derived from shift templates s in S (M, D, E, N), computing overstaffing omega_{gi}
   and understaffing tau_{gi}.
2. Directed Multigraph Representation G = (V, E) (Section 3.1, Theorem 1):
   Nodes V = {(g, n) | g in {0..6}, n in {'work', 'rest'}}.
   Work sequences b in B map to arcs ((g_1, 'work'), (g_2, 'rest')).
   Rest sequences h in H map to arcs ((g_2, 'rest'), (g_3, 'work')).
   Enforces flow conservation (Constraints 7-8) and single strongly connected component
   (Constraints 13-19) so that an Eulerian cycle exists by Theorem 1.
3. Hierholzer's Algorithm (1873) (Section 3.3):
   Constructs the complete Eulerian cycle C = (e_1, e_2, ..., e_m) in O(|E|) linear time,
   splicing subtours into the main alternating work/rest cycle and expanding the compact
   solution into an operational e x 7 rotating workforce schedule.
4. Comprehensive Labor Economics & Employee Availability Engine:
   Computes standard vs overtime hours (1.5x multiplier over 40h), estimated payroll costs,
   daily labor spend, and checks employee day-of-week availability constraints.
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
from app.engine.pareto import generate_pareto_frontier, interpolate_becker_table7
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


class SolverInfeasibleError(Exception):
    """Raised when the generator cannot satisfy a hard constraint, or the cycle is incomplete."""


class ISDRWSPSolver:
    """Integrated Shift Design and Rotating Workforce Scheduling Solver (Becker, EJOR 2026)."""

    def __init__(self, request: SolveRequestSchema):
        self.req = request
        self.demand = request.demand_matrix
        self.templates = [t for t in request.templates if t.enabled]
        if not self.templates:
            self.templates = request.templates[:1]
        self.guardrails = request.guardrails
        self.leeway_pct = request.pareto_leeway_pct
        self.employees = request.employees or []
        self.rotation_week_offset = request.rotation_week_offset

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

        target_ratio = 4.65 / 7.0
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
                    score += 12.0 * (min_w - w_len)
                elif w_len > max_w:
                    score += 12.0 * (w_len - max_w)
                if not (3 <= w_len <= 5):
                    score += 4.0 * abs(4 - w_len)
            for r_len in r_lens:
                if r_len == 1:
                    score += 15.0 if self.guardrails.avoid_single_rest_days else 3.0
                if r_len < min_r:
                    score += 8.0 * (min_r - r_len)
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

        raw_arcs: List[Dict] = []
        current_day = 0

        if self.guardrails.prioritize_free_weekends and pairs:
            first_w_len = pairs[0][0]
            current_day = (5 - first_w_len) % 7

        max_n = self.guardrails.max_consecutive_nights
        max_e = self.guardrails.max_consecutive_evenings

        arc_counter = 1
        for w_len, r_len in pairs:
            w_start = current_day
            w_end_next = (w_start + w_len) % 7

            seq_shifts: List[str] = []
            min_order_idx = 0

            for step in range(w_len):
                day_g = (w_start + step) % 7
                steps_remaining = w_len - step
                prev_code = seq_shifts[-1] if seq_shifts else "OFF"

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
                    seq_shifts.append("N")
                    rem_pool[(day_g, "N")] = rem_pool.get((day_g, "N"), 0) - 1
                    continue

                candidates = [
                    c
                    for c in ordered_codes
                    if TEMPLATE_ORDER.get(c, 0) >= min_order_idx
                ]
                if not candidates:
                    candidates = [ordered_codes[-1]]

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
                    raise SolverInfeasibleError(
                        "No template satisfies the rest and rotation rules for this demand. "
                        "Add templates or relax the guardrails."
                    )

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

                seq_shifts.append(best_code)
                rem_pool[(day_g, best_code)] = rem_pool.get((day_g, best_code), 0) - 1
                if self.guardrails.enforce_forward_rotation:
                    min_order_idx = TEMPLATE_ORDER.get(best_code, 0)

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
                wage = 16.50
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
                    cohort_id=f"LINE-{line_num:02d}",
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
                    estimated_weekly_payroll=line_total_pay,
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

        # Build LaborAnalysisSchema
        tot_sched_hours = total_reg_hours + total_ot_hours
        avg_wage = (
            round(total_reg_payroll / max(1, total_reg_hours), 2)
            if total_reg_hours > 0
            else 16.50
        )
        labor_eff = round(
            (total_weekly_req_hours / max(1, tot_sched_hours)) * 100.0, 1
        )
        labor_analysis = LaborAnalysisSchema(
            total_scheduled_hours=tot_sched_hours,
            total_regular_hours=total_reg_hours,
            total_overtime_hours=total_ot_hours,
            regular_payroll_cost=round(total_reg_payroll, 2),
            overtime_payroll_cost=round(total_ot_payroll, 2),
            total_payroll_cost=round(total_payroll, 2),
            avg_hourly_wage=avg_wage,
            hours_per_day=daily_hours_sum,
            cost_per_day=[round(c, 2) for c in daily_cost_sum],
            overtime_lines_count=overtime_lines_count,
            labor_efficiency_pct=min(100.0, labor_eff),
        )

        sw = settings.shift_weights
        obj_shift_min_bound = round(
            sw.w_employees * employee_count
            + sw.w_shift_types * active_shift_types_count
            + sw.w_understaffing * total_under
            + sw.w_overstaffing * total_over,
            2,
        )
        obj_shift = round(obj_shift_min_bound * (1.0 + self.leeway_pct / 100.0), 2)

        becker_gain_pct = interpolate_becker_table7(self.leeway_pct)
        ergonomics_audit = evaluate_ergonomics_audit(
            shift_types=shift_type_results,
            multigraph_arcs=multigraph_arcs,
            roster_lines=roster_lines,
            guardrails=self.guardrails,
            leeway_pct=self.leeway_pct,
            becker_gain_pct=becker_gain_pct,
        )

        pareto_frontier = generate_pareto_frontier(
            base_obj_shift=obj_shift_min_bound,
            ub_ergo_sequential=ergonomics_audit.sequential_baseline_ergo,
            base_employees=employee_count,
            base_active_shift_types=active_shift_types_count,
            base_understaffing=total_under,
            base_overstaffing=total_over,
            selected_leeway_pct=self.leeway_pct,
        )
        for p in pareto_frontier:
            p.estimated_weekly_payroll = round(p.employee_count * 40 * avg_wage, 2)

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
