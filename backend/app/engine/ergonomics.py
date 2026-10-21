"""Scores a schedule on 8 workload/fatigue criteria and checks rest-between-shifts rules.

Each criterion adds a weighted penalty for a specific pattern known to increase worker
fatigue (long shifts, early starts, long work stretches, back-to-back nights, isolated
shifts, weekend load, single days off). Also verifies every shift change leaves at
least the required rest hours and that rotations only ever advance forward in time.
"""

from typing import Dict, List, Optional, Tuple
from app.config import TEMPLATE_ORDER, settings
from app.schemas import (
    ErgonomicCriterionBreakdown,
    ErgonomicGuardrailsSchema,
    ErgonomicsAuditSchema,
    MultigraphArcSchema,
    RosterLineSchema,
    ShiftTypeResultSchema,
)


def evaluate_shift_type_penalties(
    template_code: str, start_hour: int, duration_hours: int
) -> Tuple[float, float]:
    """Scores a single shift type on duration and start time.

    1. Shift duration: ideal <= 9h.
    2. Early morning start: ideal >= 06:00.
    """
    w = settings.ergo_weights
    # Criterion 1: Shift duration > 9h
    if duration_hours <= 9:
        comp_sl = 0.0
    elif duration_hours == 10:
        comp_sl = 1.0
    elif duration_hours == 11:
        comp_sl = 2.0
    else:
        comp_sl = 3.0
    w_sl = w.w_shift_length * comp_sl

    # Criterion 2: Morning shift starting before 06:00
    comp_ms = 1.0 if (template_code == "M" and start_hour < 6) else 0.0
    w_ms = w.w_morning_start * comp_ms

    return w_sl, w_ms


def evaluate_work_sequence_penalty(
    start_day: int, shifts: List[str]
) -> Dict[str, float]:
    """Scores one continuous work stretch starting on the given day (0=Mon .. 6=Sun)
    for stretch length, consecutive nights/evenings, isolated night shifts, and weekend work.
    """
    w = settings.ergo_weights

    # A business-closed day forces "OFF" inside what would otherwise be a work sequence -
    # that's free rest the employee didn't choose, not a break in their own work stretch, so
    # it must not inflate the consecutive-work-days count. Use the longest actually-worked run.
    longest_work_run = 0
    current_run = 0
    for s in shifts:
        if s != "OFF":
            current_run += 1
            longest_work_run = max(longest_work_run, current_run)
        else:
            current_run = 0
    length = longest_work_run

    # Criterion 3: W^CD_b (Consecutive working days; ideal 3..5, base weight = 4, comp 0..3)
    if length == 0:
        comp_cd = 0.0
    elif 3 <= length <= 5:
        comp_cd = 0.0
    elif length == 2 or length == 6:
        comp_cd = 1.0
    elif length == 1 or length == 7:
        comp_cd = 2.0
    else:
        comp_cd = 3.0
    w_cd = w.w_consecutive_days * comp_cd

    # Criterion 4: W^CN_b (Consecutive night shifts; ideal <= 2, base weight = 3, comp 0..3)
    max_consec_n = 0
    curr_n = 0
    for s in shifts:
        if s == "N":
            curr_n += 1
            max_consec_n = max(max_consec_n, curr_n)
        else:
            curr_n = 0
    if max_consec_n <= 2:
        comp_cn = 0.0
    elif max_consec_n == 3:
        comp_cn = 1.0
    elif max_consec_n == 4:
        comp_cn = 2.0
    else:
        comp_cn = 3.0
    w_cn = w.w_consecutive_nights * comp_cn

    # Criterion 5: W^CE_b (Consecutive evening shifts; ideal <= 3, base weight = 1, comp 0..4)
    max_consec_e = 0
    curr_e = 0
    for s in shifts:
        if s == "E":
            curr_e += 1
            max_consec_e = max(max_consec_e, curr_e)
        else:
            curr_e = 0
    if max_consec_e <= 3:
        comp_ce = 0.0
    else:
        comp_ce = float(min(4, max_consec_e - 3))
    w_ce = w.w_consecutive_evenings * comp_ce

    # Criterion 6: W^SN_b (Single night shifts; avoid isolated 1-night run, base weight = 4, comp 0..1)
    single_n_runs = 0
    idx = 0
    while idx < length:
        if shifts[idx] == "N":
            run_len = 0
            while idx < length and shifts[idx] == "N":
                run_len += 1
                idx += 1
            if run_len == 1:
                single_n_runs += 1
        else:
            idx += 1
    w_sn = w.w_single_night * float(single_n_runs)

    # Criterion 7 (Work part): W^WW_{gb} (Weekend work duties; base weight = 4, comp 0..1)
    # Becker Table 1: Ergonomics penalty if work sequence (g, b) contains the first day of the weekend (Sat=5)
    # Only days actually worked count - a closed-day OFF on a Saturday is not weekend work.
    worked_days_covered = [
        (start_day + offset) % 7
        for offset in range(len(shifts))
        if shifts[offset] != "OFF"
    ]
    contains_saturday = 5 in worked_days_covered
    w_ww = w.w_weekend_work * (1.0 if contains_saturday else 0.0)

    total = w_cd + w_cn + w_ce + w_sn + w_ww
    return {
        "w_cd": w_cd,
        "w_cn": w_cn,
        "w_ce": w_ce,
        "w_sn": w_sn,
        "w_ww": w_ww,
        "total": total,
        "raw_cd": 1 if comp_cd > 0 else 0,
        "raw_cn": 1 if comp_cn > 0 else 0,
        "raw_ce": 1 if comp_ce > 0 else 0,
        "raw_sn": single_n_runs,
        "raw_ww": 1 if contains_saturday else 0,
    }


def evaluate_rest_sequence_penalty(start_day: int, duration_days: int) -> Dict[str, float]:
    """Scores one rest stretch of the given length starting on the given day (0=Mon .. 6=Sun)
    for whether it covers a full weekend and whether it's just a single isolated day off.
    """
    w = settings.ergo_weights
    # Criterion 7 (Rest part): W^WR_{gh} (Penalty if rest sequence (g,h) ends on the first day
    # of the weekend [Saturday=5], meaning work starts on Sunday=6 so weekend is worked)
    end_day = (start_day + duration_days - 1) % 7
    ends_on_saturday = end_day == 5
    w_wr = w.w_weekend_work * (1.0 if ends_on_saturday else 0.0)

    # Criterion 8: W^SR_h (Single-day rest periods; avoid |h| == 1, base weight = 1, comp 0..1)
    is_single_rest = duration_days == 1
    w_sr = w.w_single_rest * (1.0 if is_single_rest else 0.0)

    return {
        "w_wr": w_wr,
        "w_sr": w_sr,
        "total": w_wr + w_sr,
        "raw_wr": 1 if ends_on_saturday else 0,
        "raw_sr": 1 if is_single_rest else 0,
    }


def compute_rest_hours_between(
    prev_code: str,
    prev_start: int,
    prev_duration: int,
    curr_code: str,
    curr_start: int,
) -> float:
    """Calculate exact elapsed rest hours between a shift on day d and a shift on day d+1."""
    if prev_code == "OFF" or curr_code == "OFF":
        return 24.0
    prev_end_relative_to_day_d = prev_start + prev_duration
    curr_start_relative_to_day_d = 24 + curr_start
    rest_hours = float(curr_start_relative_to_day_d - prev_end_relative_to_day_d)
    return max(0.0, rest_hours)


def is_backward_rotation(prev_code: str, curr_code: str) -> bool:
    """Return True if consecutive work shifts violate forward circadian rotation (M -> D -> E -> N)."""
    if prev_code == "OFF" or curr_code == "OFF":
        return False
    return TEMPLATE_ORDER.get(curr_code, 0) < TEMPLATE_ORDER.get(prev_code, 0)


# -----------------------------------------------------------------------------
# Shift swap validation
#
# The entry point the emergency swap route calls. It reads only the per-line shift,
# rest and hours data a solved roster already carries: there is no stored per-employee
# punch data, and inventing one would make the verdict a guess.
#
# The adjacency used throughout is the real one. A roster is ONE continuous cycle of
# line_count * 7 day slots in line order, so the day after a line's Sunday is the NEXT
# line's Monday, not that line's own Monday. A swap is therefore checked across line
# boundaries as well as within a week, and the cycle wraps: the last line's Sunday is
# followed by the first line's Monday. The zero-clopening guardrail in
# isd_rwsp_solver.py uses the same adjacency, and used to compare a line's Sunday
# against its own Monday - six days and a rest block apart - which is the bug this must
# not reproduce.
# -----------------------------------------------------------------------------

OVERTIME_THRESHOLD_HOURS = 40.0

# A supervisor reads a refusal under pressure, so the days are spelled out. The
# abbreviated DAYS_OF_WEEK stays the wire format for roster cells.
DAY_FULL_NAMES = [
    "Monday",
    "Tuesday",
    "Wednesday",
    "Thursday",
    "Friday",
    "Saturday",
    "Sunday",
]


class SwapRefused(ValueError):
    """A swap that cannot be validated at all, as distinct from one that is refused on a rule."""


def _slot_index(line_index: int, day_index: int) -> int:
    return line_index * 7 + day_index


def _format_hours(hours: float) -> str:
    return str(int(hours)) if float(hours).is_integer() else f"{hours:.1f}"


def _rest_between_slots(prev: Dict, curr: Dict) -> float:
    return compute_rest_hours_between(
        prev["shift_code"],
        prev["start_hour"],
        prev["duration_hours"],
        curr["shift_code"],
        curr["start_hour"],
    )


def validate_shift_swap(
    lines: List[Dict],
    associate_a_id: str,
    day_a_index: int,
    associate_b_id: str,
    day_b_index: int,
) -> Dict:
    """Decide whether two assigned shifts may be traded, and say exactly why not.

    `lines` is the whole solved cycle in line order. Each entry is a mapping with
    `line_number`, `assigned_employee_id`, `assigned_person`, `hourly_wage` and `days`
    (seven mappings of `day_index`, `shift_code`, `start_hour`, `duration_hours`).

    A swap is refused when, after the trade, any adjacency either shift now sits in
    leaves less than the required rest, creates a closing-then-opening pair, or when
    either week crosses the overtime boundary it was not already over. Each refusal
    names the rule, the days and the figures it found.

    Raises SwapRefused when the request cannot be validated: an associate who holds no
    line, a day with no shift on it, or the same shift traded with itself.
    """
    min_rest = float(settings.min_rest_hours_between_shifts)
    line_count = len(lines)
    if line_count == 0:
        raise SwapRefused("The roster has no lines, so there is nothing to swap.")

    index_by_employee: Dict[str, int] = {}
    for idx, line in enumerate(lines):
        emp_id = line.get("assigned_employee_id")
        if emp_id:
            index_by_employee.setdefault(emp_id, idx)

    def resolve(associate_id: str, label: str) -> int:
        if associate_id not in index_by_employee:
            raise SwapRefused(
                f"{label} ({associate_id}) does not hold a line on this roster, "
                "so there is no shift of theirs to trade."
            )
        return index_by_employee[associate_id]

    idx_a = resolve(associate_a_id, "Associate A")
    idx_b = resolve(associate_b_id, "Associate B")

    line_a, line_b = lines[idx_a], lines[idx_b]
    name_a = line_a.get("assigned_person") or f"Line {line_a['line_number']}"
    name_b = line_b.get("assigned_person") or f"Line {line_b['line_number']}"

    if idx_a == idx_b and day_a_index == day_b_index:
        raise SwapRefused("A shift cannot be traded with itself.")

    # The flat cycle, so slot i+1 is always the day after slot i.
    slots: List[Dict] = []
    for line in lines:
        by_day = {int(c["day_index"]): c for c in line["days"]}
        for d in range(7):
            cell = by_day.get(d)
            if cell is None:
                raise SwapRefused(
                    f"Line {line['line_number']} is missing day {d}, so its week cannot be checked."
                )
            code = cell["shift_code"]
            slots.append(
                {
                    "line_number": line["line_number"],
                    "day_index": d,
                    "shift_code": code,
                    "start_hour": 0.0 if code == "OFF" else float(cell["start_hour"]),
                    "duration_hours": 0.0 if code == "OFF" else float(cell["duration_hours"]),
                }
            )

    slot_a = _slot_index(idx_a, day_a_index)
    slot_b = _slot_index(idx_b, day_b_index)

    for slot_idx, who, day_idx in ((slot_a, name_a, day_a_index), (slot_b, name_b, day_b_index)):
        if slots[slot_idx]["shift_code"] == "OFF":
            raise SwapRefused(
                f"{who} is off on {DAY_FULL_NAMES[day_idx]}, so there is no assigned shift to trade. "
                "Use a single-cell change to put somebody on a day they are off."
            )

    hours_before_a = sum(s["duration_hours"] for s in slots[idx_a * 7 : idx_a * 7 + 7])
    hours_before_b = sum(s["duration_hours"] for s in slots[idx_b * 7 : idx_b * 7 + 7])

    # Trade the two slots. Only the shift moves; the day and the line it lands on stay.
    traded = [dict(s) for s in slots]
    for target, source in ((slot_a, slots[slot_b]), (slot_b, slots[slot_a])):
        traded[target]["shift_code"] = source["shift_code"]
        traded[target]["start_hour"] = source["start_hour"]
        traded[target]["duration_hours"] = source["duration_hours"]

    total_slots = len(traded)
    messages: List[str] = []
    clopening_a = False
    clopening_b = False

    # Every adjacency either swapped slot now sits in: the pair before it and the pair
    # after it, wrapping round the cycle. Checked once each, in cycle order.
    touched = sorted({(slot - 1) % total_slots for slot in (slot_a, slot_b)} | {slot_a % total_slots, slot_b % total_slots})
    for from_idx in touched:
        to_idx = (from_idx + 1) % total_slots
        prev, curr = traded[from_idx], traded[to_idx]
        if prev["shift_code"] == "OFF" or curr["shift_code"] == "OFF":
            continue

        crosses_lines = prev["line_number"] != curr["line_number"]
        where = (
            f"{DAY_FULL_NAMES[prev['day_index']]} on line {prev['line_number']} into "
            f"{DAY_FULL_NAMES[curr['day_index']]} on line {curr['line_number']}"
            if crosses_lines
            else f"{DAY_FULL_NAMES[prev['day_index']]} into {DAY_FULL_NAMES[curr['day_index']]} "
            f"on line {prev['line_number']}"
        )

        if prev["shift_code"] == "E" and curr["shift_code"] == "M":
            messages.append(
                f"Refused - clopening: the swap puts a closing evening shift straight into an "
                f"opening morning shift, {where}."
                + (
                    " In a rotating roster one line's Sunday is followed by the next line's "
                    "Monday, so this pair is a real back-to-back close and open."
                    if crosses_lines
                    else ""
                )
            )
            # The pair sits on one or two lines. Each swapping party is flagged when
            # their own line is one of them, so a clopening across a line boundary is
            # reported against both weeks it actually falls on.
            pair_lines = {prev["line_number"], curr["line_number"]}
            if line_a["line_number"] in pair_lines:
                clopening_a = True
            if line_b["line_number"] in pair_lines:
                clopening_b = True

        rest = _rest_between_slots(prev, curr)
        if rest < min_rest:
            messages.append(
                f"Refused - rest: the swap leaves {_format_hours(rest)} hours between the "
                f"{prev['shift_code']} shift and the {curr['shift_code']} shift, {where}. "
                f"The rule is {_format_hours(min_rest)} hours."
            )

    hours_after_a = sum(s["duration_hours"] for s in traded[idx_a * 7 : idx_a * 7 + 7])
    hours_after_b = sum(s["duration_hours"] for s in traded[idx_b * 7 : idx_b * 7 + 7])

    def overtime(hours: float) -> float:
        return max(0.0, hours - OVERTIME_THRESHOLD_HOURS)

    ot_a, ot_b = overtime(hours_after_a), overtime(hours_after_b)

    # Overtime the swap itself creates or deepens. A line already over the boundary
    # before the swap is not refused for staying where it was.
    for who, before, after in ((name_a, hours_before_a, hours_after_a), (name_b, hours_before_b, hours_after_b)):
        if overtime(after) > overtime(before):
            messages.append(
                f"Refused - overtime: the swap takes {who} from {_format_hours(before)} to "
                f"{_format_hours(after)} hours, {_format_hours(overtime(after))} hours past the "
                f"{_format_hours(OVERTIME_THRESHOLD_HOURS)}-hour boundary."
            )

    def weekly_cost(hours: float, wage: Optional[float]) -> float:
        if wage is None:
            return 0.0
        regular = min(OVERTIME_THRESHOLD_HOURS, hours)
        return regular * wage + overtime(hours) * wage * 1.5

    cost_before = weekly_cost(hours_before_a, line_a.get("hourly_wage")) + weekly_cost(
        hours_before_b, line_b.get("hourly_wage")
    )
    cost_after = weekly_cost(hours_after_a, line_a.get("hourly_wage")) + weekly_cost(
        hours_after_b, line_b.get("hourly_wage")
    )

    is_approved = len(messages) == 0
    if is_approved:
        messages.append(
            f"Approved: both weeks keep at least {_format_hours(min_rest)} hours between shifts, "
            "neither creates a closing-then-opening pair, and neither crosses the "
            f"{_format_hours(OVERTIME_THRESHOLD_HOURS)}-hour boundary."
        )

    code_a = slots[slot_a]["shift_code"]
    code_b = slots[slot_b]["shift_code"]
    swap_summary = (
        f"{name_a}'s {DAY_FULL_NAMES[day_a_index]} {code_a} shift for "
        f"{name_b}'s {DAY_FULL_NAMES[day_b_index]} {code_b} shift."
    )

    # What the next Monday does to the swap, stated from the rotation the roster
    # already reports rather than guessed: every line advances one row, so the two
    # edited lines move on and the trade travels with the pattern, not the person.
    rotation_impact = (
        f"Next Monday every line advances one row, so line {line_a['line_number']} becomes line "
        f"{(line_a['line_number'] % line_count) + 1} and line {line_b['line_number']} becomes line "
        f"{(line_b['line_number'] % line_count) + 1}. The traded shifts stay with the patterns, "
        "so this swap applies to whoever holds those patterns in a later week too."
    )

    return {
        "is_approved": is_approved,
        "associate_a_name": name_a,
        "associate_b_name": name_b,
        "swap_summary": swap_summary,
        "clopening_violation_a": clopening_a,
        "clopening_violation_b": clopening_b,
        "overtime_hours_a": round(ot_a, 2),
        "overtime_hours_b": round(ot_b, 2),
        "payroll_cost_delta": round(cost_after - cost_before, 2),
        "validation_messages": messages,
        "next_monday_rotation_impact": rotation_impact,
    }


# -----------------------------------------------------------------------------
# Callout cover
#
# Ranks who could pick up a shift somebody has called out of, from the STORED per-
# assignment shift times and rest intervals. Same flat-cycle adjacency as the swap
# validator: a candidate covering their own line's day d takes its rest from day d-1 of
# their line, or from the PREVIOUS line's Sunday when d is Monday, and hands off to day
# d+1, or to the NEXT line's Monday when d is Sunday.
# -----------------------------------------------------------------------------


class CalloutUnanswerable(ValueError):
    """The callout cannot be assessed at all, as distinct from having no eligible cover."""


def rank_callout_candidates(
    stored_shifts: List[Dict],
    employees: List[Dict],
    target_day_index: int,
    target_shift_code: str,
    missing_line_number: Optional[int] = None,
    missing_employee_id: Optional[str] = None,
) -> Dict:
    """Rank who can cover a called-out shift, by rest compliance then overtime headroom.

    `stored_shifts` is the facility's stored roster: one mapping per line/day slot with
    `line_number`, `cycle_week`, `day_index`, `shift_code`, `start_hour`,
    `duration_hours` and `employee_id`. `employees` are the facility's staff records
    (`id`, `name`, `role`, `wage`, `active`, `available_days`, `assigned_line`).

    Every candidate is reported with the figures behind it. Nobody already working that
    day is recommended, and nobody whose cover would break the rest rule, create a
    closing-then-opening pair or cross the overtime boundary is recommended either - each
    is listed with the reason instead, so the manager can see what the trade-off is
    rather than being handed a shortlist with the reasoning hidden.

    Raises CalloutUnanswerable when there is no stored roster, or when the target shift
    code has no clock times anywhere in it.
    """
    min_rest = float(settings.min_rest_hours_between_shifts)
    if not stored_shifts:
        raise CalloutUnanswerable(
            "No roster is stored for this facility, so there are no shift times or rest "
            "intervals to assess a replacement against. Store the current roster first."
        )
    if not 0 <= target_day_index <= 6:
        raise CalloutUnanswerable(f"{target_day_index} is not a day of the week.")

    by_slot: Dict[Tuple[int, int], Dict] = {}
    line_numbers = set()
    for shift in stored_shifts:
        line_number = int(shift["line_number"])
        day_index = int(shift["day_index"])
        line_numbers.add(line_number)
        by_slot[(line_number, day_index)] = shift

    ordered_lines = sorted(line_numbers)
    line_count = len(ordered_lines)
    position = {line_number: idx for idx, line_number in enumerate(ordered_lines)}

    for line_number in ordered_lines:
        for day_index in range(7):
            if (line_number, day_index) not in by_slot:
                raise CalloutUnanswerable(
                    f"The stored roster is missing line {line_number} day {day_index}, "
                    "so no week on it can be checked."
                )

    # The target shift's clock times, read from the stored roster rather than assumed.
    target_clock: Optional[Dict] = None
    if target_shift_code != "OFF":
        for shift in stored_shifts:
            if shift["shift_code"] == target_shift_code:
                target_clock = shift
                break
    if target_clock is None:
        raise CalloutUnanswerable(
            f"The stored roster has no {target_shift_code} shift in it, so that shift's "
            "times and the rest around it are unknown."
        )

    target_start = float(target_clock["start_hour"])
    target_duration = float(target_clock["duration_hours"])
    target_window = _format_window(target_start, target_duration)

    employees_by_id = {str(emp["id"]): emp for emp in employees}
    missing_name = "Unnamed"
    if missing_employee_id and missing_employee_id in employees_by_id:
        missing_name = employees_by_id[missing_employee_id]["name"]
    elif missing_line_number is not None:
        slot_holder = by_slot.get((missing_line_number, target_day_index), {}).get("employee_id")
        if slot_holder and str(slot_holder) in employees_by_id:
            missing_name = employees_by_id[str(slot_holder)]["name"]
        else:
            missing_name = f"Line {missing_line_number}"

    def neighbour(line_number: int, day_index: int, step: int) -> Dict:
        """The slot `step` days away in the real cycle, crossing line boundaries."""
        idx = position[line_number]
        raw = idx * 7 + day_index + step
        total = line_count * 7
        raw %= total
        return by_slot[(ordered_lines[raw // 7], raw % 7)]

    candidates: List[Dict] = []
    for emp in employees:
        emp_id = str(emp["id"])
        if not emp.get("active", True):
            continue
        if missing_employee_id and emp_id == missing_employee_id:
            continue
        line_number = emp.get("assigned_line")
        if line_number is None or int(line_number) not in position:
            continue
        line_number = int(line_number)
        if missing_line_number is not None and line_number == missing_line_number:
            continue

        own_slot = by_slot[(line_number, target_day_index)]
        is_off_duty = own_slot["shift_code"] == "OFF"

        week = [by_slot[(line_number, d)] for d in range(7)]
        current_hours = sum(
            0.0 if s["shift_code"] == "OFF" else float(s["duration_hours"]) for s in week
        )
        # Covering replaces whatever they had that day, so their own shift's hours come
        # off before the cover's go on.
        own_hours = 0.0 if is_off_duty else float(own_slot["duration_hours"])
        hours_with_shift = current_hours - own_hours + target_duration

        prev_slot = neighbour(line_number, target_day_index, -1)
        next_slot = neighbour(line_number, target_day_index, 1)

        prior_rest = compute_rest_hours_between(
            prev_slot["shift_code"],
            float(prev_slot["start_hour"]),
            float(prev_slot["duration_hours"]),
            target_shift_code,
            target_start,
        )
        next_rest = compute_rest_hours_between(
            target_shift_code,
            target_start,
            target_duration,
            next_slot["shift_code"],
            float(next_slot["start_hour"]),
        )

        clopening = (prev_slot["shift_code"] == "E" and target_shift_code == "M") or (
            target_shift_code == "E" and next_slot["shift_code"] == "M"
        )
        rest_short = prior_rest < min_rest or next_rest < min_rest
        overtime_hours = max(0.0, hours_with_shift - OVERTIME_THRESHOLD_HOURS)
        overtime_risk = overtime_hours > 0

        available_days = emp.get("available_days") or list(range(7))
        day_available = target_day_index in available_days

        wage = emp.get("wage")
        if wage is None:
            added_payroll = 0.0
        else:
            before = _weekly_cost(current_hours, float(wage))
            after = _weekly_cost(hours_with_shift, float(wage))
            added_payroll = after - before

        notes: List[str] = []
        if not is_off_duty:
            notes.append(
                f"Already working a {own_slot['shift_code']} shift on "
                f"{DAY_FULL_NAMES[target_day_index]}; covering would mean dropping it."
            )
        if not day_available:
            notes.append(f"Has {DAY_FULL_NAMES[target_day_index]} marked unavailable.")
        if clopening:
            notes.append(
                "Would be a closing shift straight into an opening shift, which "
                "zero-clopening forbids."
            )
        if rest_short:
            notes.append(
                f"Leaves {_format_hours(min(prior_rest, next_rest))}h rest, under the "
                f"{_format_hours(min_rest)}h rule."
            )
        if overtime_risk:
            notes.append(
                f"Takes the week to {_format_hours(hours_with_shift)}h, "
                f"{_format_hours(overtime_hours)}h past the "
                f"{_format_hours(OVERTIME_THRESHOLD_HOURS)}h boundary."
            )

        is_recommended = (
            is_off_duty and day_available and not clopening and not rest_short and not overtime_risk
        )
        if is_recommended:
            headroom = OVERTIME_THRESHOLD_HOURS - hours_with_shift
            status_label = (
                f"Clear - {_format_hours(min(prior_rest, next_rest))}h rest either side, "
                f"{_format_hours(headroom)}h before overtime"
            )
            notes.append(status_label)
        elif not is_off_duty:
            status_label = "Already working that day"
        elif clopening:
            status_label = "Clopening"
        elif rest_short:
            status_label = "Under the rest rule"
        elif overtime_risk:
            status_label = "Into overtime"
        else:
            status_label = "Marked unavailable"

        candidates.append(
            {
                "employee_id": emp_id,
                "employee_name": emp["name"],
                "role": emp.get("role") or "",
                "hourly_wage": float(wage) if wage is not None else 0.0,
                "is_off_duty_target_day": is_off_duty,
                "prior_rest_hours": round(prior_rest, 2),
                "next_rest_hours": round(next_rest, 2),
                "current_scheduled_hours": int(round(current_hours)),
                "hours_with_shift": int(round(hours_with_shift)),
                "overtime_risk": overtime_risk,
                "clopening_risk": clopening or rest_short,
                "estimated_added_payroll": round(added_payroll, 2),
                "is_recommended": is_recommended,
                "status_label": status_label,
                "audit_notes": notes,
                # Sort keys only; not part of the response schema.
                "_min_rest": min(prior_rest, next_rest),
                "_headroom": OVERTIME_THRESHOLD_HOURS - hours_with_shift,
            }
        )

    # Rest compliance first, then overtime headroom - the order the ranking is specified
    # in. Within that, the cheaper cover comes first.
    candidates.sort(
        key=lambda c: (
            not c["is_recommended"],
            not c["is_off_duty_target_day"],
            c["clopening_risk"],
            c["overtime_risk"],
            -c["_min_rest"],
            -c["_headroom"],
            c["estimated_added_payroll"],
            c["employee_name"],
        )
    )
    for candidate in candidates:
        candidate.pop("_min_rest", None)
        candidate.pop("_headroom", None)

    recommended = next((c for c in candidates if c["is_recommended"]), None)
    if recommended is not None:
        guidance = (
            f"{recommended['employee_name']} is the clear cover: off duty on "
            f"{DAY_FULL_NAMES[target_day_index]}, {_format_hours(recommended['prior_rest_hours'])}h "
            f"rest before the shift and {_format_hours(recommended['next_rest_hours'])}h after, and "
            f"{_format_hours(OVERTIME_THRESHOLD_HOURS - recommended['hours_with_shift'])}h still "
            f"before overtime. Adds {recommended['estimated_added_payroll']:.2f} to the week."
        )
    elif candidates:
        guidance = (
            f"Nobody can cover this shift without breaking a rule. All {len(candidates)} "
            "staff checked are listed with what each one would cost in rest, clopening or "
            "overtime, so the choice is a judgement call rather than a compliant one."
        )
    else:
        guidance = (
            "No other staff member holds a line on this roster, so there is nobody to "
            "rank. Assign staff to the remaining lines first."
        )

    return {
        "target_day_name": DAY_FULL_NAMES[target_day_index],
        "target_shift_window": target_window,
        "target_shift_code": target_shift_code,
        "missing_employee_name": missing_name,
        "candidates_count": len(candidates),
        "recommended_candidate_id": recommended["employee_id"] if recommended else None,
        "candidates": candidates,
        "operational_guidance": guidance,
    }


def _weekly_cost(hours: float, wage: float) -> float:
    regular = min(OVERTIME_THRESHOLD_HOURS, hours)
    overtime_hours = max(0.0, hours - OVERTIME_THRESHOLD_HOURS)
    return regular * wage + overtime_hours * wage * 1.5


def _format_window(start_hour: float, duration_hours: float) -> str:
    """The same shape the solver's formatted_window uses, so the UI reads one convention.

    End times wrap at midnight exactly as the solver's `(start + duration) % 24` does, so
    a closing shift reads 16:00-00:00 here and on the roster grid.
    """

    def clock(value: float) -> str:
        total_minutes = int(round(value * 60)) % (24 * 60)
        return f"{total_minutes // 60:02d}:{total_minutes % 60:02d}"

    if duration_hours <= 0:
        return "Rest / Off"
    return f"{clock(start_hour)}–{clock(start_hour + duration_hours)}"


def evaluate_ergonomics_audit(
    shift_types: List[ShiftTypeResultSchema],
    multigraph_arcs: List[MultigraphArcSchema],
    roster_lines: List[RosterLineSchema],
    guardrails: ErgonomicGuardrailsSchema,
    baseline_audit: Optional[ErgonomicsAuditSchema] = None,
) -> ErgonomicsAuditSchema:
    """Score a schedule against 8 workload/fatigue checks.

    When baseline_audit is given (the real result of solving the same request at 0%
    leeway), the comparison is against that actual cheaper schedule's real score - not an
    estimate. When omitted, this call IS the zero-leeway baseline, so it is compared to
    itself (no improvement to report).
    """
    w = settings.ergo_weights

    # 1 & 2: Shift Duration (W^SL_t) and Early Morning (W^MS_t) from shift design variables xi_{gt}
    raw_sl = 0
    pen_sl = 0.0
    raw_ms = 0
    pen_ms = 0.0
    for st in shift_types:
        if not st.active:
            continue
        total_uses = sum(st.daily_counts)
        if st.duration_penalty > 0:
            raw_sl += total_uses
            pen_sl += st.duration_penalty * total_uses
        if st.early_morning_penalty > 0:
            raw_ms += total_uses
            pen_ms += st.early_morning_penalty * total_uses

    # 3..8: Sequence penalties from work arcs x^work_{gb} and rest arcs x^rest_{gh}
    raw_cd = raw_cn = raw_ce = raw_sn = raw_ww = raw_sr = 0
    pen_cd = pen_cn = pen_ce = pen_sn = pen_ww = pen_sr = 0.0

    rest_arcs_total = 0
    consolidated_rest_arcs = 0

    for arc in multigraph_arcs:
        if arc.arc_type == "work":
            res = evaluate_work_sequence_penalty(arc.start_day, arc.shifts)
            raw_cd += int(res["raw_cd"])
            raw_cn += int(res["raw_cn"])
            raw_ce += int(res["raw_ce"])
            raw_sn += int(res["raw_sn"])
            raw_ww += int(res["raw_ww"])
            pen_cd += res["w_cd"]
            pen_cn += res["w_cn"]
            pen_ce += res["w_ce"]
            pen_sn += res["w_sn"]
            pen_ww += res["w_ww"]
        else:
            rest_arcs_total += 1
            if arc.duration_days >= 2:
                consolidated_rest_arcs += 1
            res = evaluate_rest_sequence_penalty(arc.start_day, arc.duration_days)
            raw_ww += int(res["raw_wr"])
            raw_sr += int(res["raw_sr"])
            pen_ww += res["w_wr"]
            pen_sr += res["w_sr"]

    total_ergo = round(
        pen_sl + pen_ms + pen_cd + pen_cn + pen_ce + pen_sn + pen_ww + pen_sr, 2
    )

    # Compare against the real cheapest-version-of-this-schedule baseline, not an estimate.
    if baseline_audit is None:
        sequential_baseline = total_ergo
        actual_improvement_pct = 0.0
    else:
        sequential_baseline = baseline_audit.total_ergo_objective
        actual_improvement_pct = (
            round(max(0.0, ((sequential_baseline - total_ergo) / sequential_baseline) * 100.0), 2)
            if sequential_baseline > 0
            else 0.0
        )

    # Inspect cells for Clopening (< 16h rest) and Backward Rotation
    clopening_violations = 0
    backward_violations = 0
    min_rest_observed = 24.0
    full_weekends_off_count = 0

    for line in roster_lines:
        if line.full_weekend_off:
            full_weekends_off_count += 1
        for cell in line.days:
            if cell.shift_code != "OFF":
                min_rest_observed = min(min_rest_observed, cell.rest_hours_before)
            if cell.clopening_violation:
                clopening_violations += 1
            if cell.backward_rotation_violation:
                backward_violations += 1

    emp_count = max(1, len(roster_lines))
    full_weekends_off_pct = round((full_weekends_off_count / emp_count) * 100.0, 1)
    consolidated_rest_pct = round(
        (consolidated_rest_arcs / max(1, rest_arcs_total)) * 100.0, 1
    )

    baseline_by_id = {
        c.criterion_id: c for c in baseline_audit.criteria_breakdown
    } if baseline_audit is not None else {}

    def _make_criterion(
        cid: str,
        symbol: str,
        name: str,
        ideal: str,
        b_weight: float,
        c_range: str,
        raw_cnt: int,
        w_pen: float,
        expl: str,
    ) -> ErgonomicCriterionBreakdown:
        baseline_c = baseline_by_id.get(cid)
        seq_pen = baseline_c.weighted_penalty if baseline_c is not None else w_pen
        imp = (
            round(max(0.0, ((seq_pen - w_pen) / seq_pen) * 100.0), 1)
            if seq_pen > 0
            else 0.0
        )
        status = "optimal" if w_pen == 0 else ("acceptable" if raw_cnt <= 2 else "warning")
        return ErgonomicCriterionBreakdown(
            criterion_id=cid,
            symbol=symbol,
            name=name,
            ideal_range=ideal,
            base_weight=b_weight,
            component_weight_range=c_range,
            raw_violations_count=raw_cnt,
            weighted_penalty=round(w_pen, 2),
            sequential_baseline_penalty=seq_pen,
            improvement_pct=max(0.0, imp),
            status=status,
            explanation=expl,
        )

    criteria_breakdown = [
        _make_criterion(
            "shift_duration",
            "W^SL_t",
            "Shift Duration Ceiling",
            "<= 9 hours",
            w.w_shift_length,
            "0 to 3",
            raw_sl,
            pen_sl,
            "Penalizes extended shifts exceeding 9 hours that elevate acute occupational fatigue.",
        ),
        _make_criterion(
            "early_morning",
            "W^MS_t",
            "Early Morning Start (< 06:00)",
            "Avoid (< 06:00)",
            w.w_morning_start,
            "0 to 1",
            raw_ms,
            pen_ms,
            "Penalizes morning shifts starting before 06:00 AM that truncate REM sleep cycles.",
        ),
        _make_criterion(
            "consecutive_work_days",
            "W^CD_b",
            "Consecutive Working Days Stretch",
            "3–5 days",
            w.w_consecutive_days,
            "0 to 3",
            raw_cd,
            pen_cd,
            "Enforces 3 to 5 consecutive work days per arc e_b; avoids fragmented (<3) or exhausting (>5) stretches.",
        ),
        _make_criterion(
            "consecutive_nights",
            "W^CN_b",
            "Consecutive Night Shifts",
            "<= 2 nights",
            w.w_consecutive_nights,
            "0 to 3",
            raw_cn,
            pen_cn,
            "Limits consecutive night shifts to at most 2 to prevent cumulative circadian phase-shift debt.",
        ),
        _make_criterion(
            "consecutive_evenings",
            "W^CE_b",
            "Consecutive Evening Shifts",
            "<= 3 evenings",
            w.w_consecutive_evenings,
            "0 to 4",
            raw_ce,
            pen_ce,
            "Caps consecutive evening duties at 3 to preserve social recovery windows.",
        ),
        _make_criterion(
            "single_night",
            "W^SN_b",
            "Isolated Single Night Shifts",
            "Avoid (0 isolated)",
            w.w_single_night,
            "0 to 1",
            raw_sn,
            pen_sn,
            "Strictly penalizes isolated 1-night assignments that disrupt circadian rhythm without adaptation.",
        ),
        _make_criterion(
            "weekend_work",
            "W^WW_gb, W^WR_gh",
            "Weekend Work Duties",
            "Maximize Free Sat+Sun",
            w.w_weekend_work,
            "0 to 1",
            raw_ww,
            pen_ww,
            "Penalizes work arcs touching Saturday/Sunday or rest arcs ending on Saturday to maximize full weekends off.",
        ),
        _make_criterion(
            "single_day_rest",
            "W^SR_h",
            "Single-Day Split Rest Periods",
            "Avoid (>= 2 days off)",
            w.w_single_rest,
            "0 to 1",
            raw_sr,
            pen_sr,
            "Eliminates solitary 1-day rest periods; groups recovery arcs e_h into 2–3 consecutive days off.",
        ),
    ]

    # Normalized 0..100 health index score
    max_expected_pen = max(25.0, emp_count * 8.0)
    raw_score = 100.0 - (total_ergo / max_expected_pen) * 35.0
    if clopening_violations == 0 and backward_violations == 0:
        raw_score += 4.0
    health_index_score = round(max(55.0, min(99.5, raw_score)), 1)

    return ErgonomicsAuditSchema(
        total_ergo_objective=total_ergo,
        sequential_baseline_ergo=sequential_baseline,
        ergo_improvement_pct=actual_improvement_pct,
        health_index_score=health_index_score,
        clopening_violations=clopening_violations,
        backward_rotation_violations=backward_violations,
        min_rest_hours_observed=round(min_rest_observed, 1),
        full_weekends_off_count=full_weekends_off_count,
        full_weekends_off_pct=full_weekends_off_pct,
        consolidated_rest_blocks_pct=consolidated_rest_pct,
        criteria_breakdown=criteria_breakdown,
        statutory_accommodation_violations_count=sum(1 for line in roster_lines if line.statutory_accommodation_violation),
        # Fair Workweek is NOT assessed. Nothing in this engine measures advance notice,
        # good-faith estimates, predictability pay or right-to-rest declines, so None is the
        # only honest value. Do not set this True because the other checks pass: the
        # compliance view renders None as "not assessed" and a boolean as a verdict.
        fair_workweek_compliant=None,
        mandatory_rest_violations=clopening_violations,
    )
