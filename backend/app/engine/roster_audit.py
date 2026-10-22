"""Rule-based audit of a repeating roster pattern.

Deterministic and stateless: it reads the pattern and thresholds it is given and reports
facts and flags. It does not optimize and it does not assess any statute. Every rule is
defined in docs/audit_rules.md.
"""

import math
from collections import defaultdict
from statistics import pstdev
from typing import Dict, List, Optional, Tuple

from app.audit_schemas import (
    AuditCoverage,
    AuditFinding,
    AuditLineMetrics,
    AuditRequest,
    AuditResponse,
    AuditShiftDef,
    AuditSummary,
    AuditWorstCell,
)

MINUTES_PER_DAY = 1440
KIND_RANK = {"day": 0, "evening": 1, "night": 2}
SATURDAY = 5


def _runs(flags: List[bool]) -> List[Tuple[int, int]]:
    """Cyclic runs of True as (start index, length); a fully True list is one run."""
    n = len(flags)
    if n == 0 or not any(flags):
        return []
    if all(flags):
        return [(0, n)]
    pivot = flags.index(False)
    runs: List[Tuple[int, int]] = []
    start, length = -1, 0
    for step in range(1, n + 1):
        index = (pivot + step) % n
        if flags[index]:
            if length == 0:
                start = index
            length += 1
        elif length:
            runs.append((start, length))
            length = 0
    if length:
        runs.append((start, length))
    return runs


def _longest(runs: List[Tuple[int, int]]) -> Tuple[Optional[int], int]:
    """Start and length of the longest run; the earliest start wins a tie."""
    if not runs:
        return None, 0
    best = max(runs, key=lambda r: (r[1], -r[0]))
    return best


def _finding(
    findings: List[AuditFinding],
    rule_id: str,
    severity: str,
    message: str,
    value: float,
    line_label: Optional[str] = None,
    day_index: Optional[int] = None,
    threshold: Optional[float] = None,
) -> None:
    findings.append(
        AuditFinding(
            rule_id=rule_id,
            severity=severity,
            line_label=line_label,
            day_index=day_index,
            value=round(float(value), 2),
            threshold=None if threshold is None else float(threshold),
            message=message,
        )
    )


def _weekday_of(start_weekday: int, day: int) -> int:
    return (start_weekday + day) % 7


def audit_roster(request: AuditRequest) -> AuditResponse:
    cycle = request.cycle_days
    th = request.thresholds
    shifts: Dict[str, AuditShiftDef] = {s.code.upper(): s for s in request.shifts}
    findings: List[AuditFinding] = []
    metrics: List[AuditLineMetrics] = []
    super_period = cycle * 7 // math.gcd(cycle, 7)
    cycle_minutes = cycle * MINUTES_PER_DAY
    used_codes = set()

    for line in request.lines:
        label = line.label
        cells = [c.strip().upper() for c in line.cells]
        worked = [c != "OFF" for c in cells]
        defs = [shifts[c] if c != "OFF" else None for c in cells]
        used_codes.update(c for c in cells if c != "OFF")
        shift_count = sum(worked)
        total_hours = sum(d.duration_minutes for d in defs if d) / 60.0
        avg_weekly = total_hours / cycle * 7

        # Rest between consecutive worked shifts, cyclic.
        min_rest: Optional[float] = None
        min_rest_day: Optional[int] = None
        if shift_count == 0:
            _finding(
                findings, "EMPTY_LINE", "info",
                f'Line "{label}" has no shifts in the cycle, so no rest or streak rules were applied to it.',
                0, line_label=label,
            )
        else:
            worked_days = [i for i in range(cycle) if worked[i]]
            for pos, day in enumerate(worked_days):
                nxt = worked_days[(pos + 1) % len(worked_days)]
                this_end = day * MINUTES_PER_DAY + defs[day].start_minute + defs[day].duration_minutes
                next_start = nxt * MINUTES_PER_DAY + defs[nxt].start_minute
                if nxt <= day:
                    next_start += cycle_minutes
                gap_hours = (next_start - this_end) / 60.0
                if min_rest is None or gap_hours < min_rest:
                    min_rest, min_rest_day = gap_hours, day
            if min_rest is not None and min_rest < th.min_rest_hours:
                _finding(
                    findings, "SHORT_REST", "flag",
                    f'Line "{label}" has only {min_rest:g} hours between the shift on day {min_rest_day + 1} '
                    f"and the next one, under the {th.min_rest_hours:g}-hour minimum you set.",
                    min_rest, label, min_rest_day, th.min_rest_hours,
                )

        work_start, work_run = _longest(_runs(worked))
        if work_run > th.max_consecutive_work_days:
            _finding(
                findings, "LONG_WORK_STREAK", "flag",
                f'Line "{label}" works {work_run} days in a row starting on day {work_start + 1}, '
                f"over the {th.max_consecutive_work_days}-day limit you set.",
                work_run, label, work_start, th.max_consecutive_work_days,
            )

        is_night = [bool(d and d.kind == "night") for d in defs]
        night_runs = _runs(is_night)
        night_start, night_run = _longest(night_runs)
        if night_run > th.max_consecutive_nights:
            _finding(
                findings, "NIGHT_STREAK", "flag",
                f'Line "{label}" works {night_run} night shifts in a row starting on day {night_start + 1}, '
                f"over the {th.max_consecutive_nights}-night limit you set.",
                night_run, label, night_start, th.max_consecutive_nights,
            )

        is_long = [bool(d and d.duration_minutes >= th.long_shift_hours * 60) for d in defs]
        long_start, long_run = _longest(_runs(is_long))
        if long_run > th.max_consecutive_long_shifts:
            _finding(
                findings, "LONG_SHIFT_STREAK", "flag",
                f'Line "{label}" works {long_run} long shifts ({th.long_shift_hours:g} hours or more) in a row '
                f"starting on day {long_start + 1}, over the {th.max_consecutive_long_shifts}-shift limit you set.",
                long_run, label, long_start, th.max_consecutive_long_shifts,
            )

        # Hours in any 7 consecutive days, counting each shift on the day it starts.
        day_hours = [(d.duration_minutes / 60.0 if d else 0.0) for d in defs]
        max_week, max_week_day = 0.0, 0
        for start in range(cycle):
            total = sum(day_hours[(start + k) % cycle] for k in range(7)) if cycle > 7 else sum(day_hours)
            if total > max_week:
                max_week, max_week_day = total, start
        if max_week > th.max_hours_any_7_days:
            _finding(
                findings, "WEEK_HOURS_HIGH", "flag",
                f'Line "{label}" works {max_week:g} hours in the 7 days starting on day {max_week_day + 1}, '
                f"over the {th.max_hours_any_7_days:g}-hour limit you set.",
                max_week, label, max_week_day, th.max_hours_any_7_days,
            )

        if avg_weekly > th.reference_avg_weekly_hours:
            _finding(
                findings, "AVG_WEEKLY_HOURS", "info",
                f'Line "{label}" averages {avg_weekly:g} hours a week over the cycle, above the '
                f"{th.reference_avg_weekly_hours:g}-hour reference you set.",
                avg_weekly, label, None, th.reference_avg_weekly_hours,
            )

        isolated_nights = sum(1 for _, length in night_runs if length == 1)
        if isolated_nights:
            first = next(start for start, length in night_runs if length == 1)
            _finding(
                findings, "ISOLATED_NIGHT", "info",
                f'Line "{label}" has {isolated_nights} night shift(s) on their own, with no night before or after.',
                isolated_nights, label, first,
            )
        rest_runs = _runs([not w for w in worked])
        isolated_rest = sum(1 for _, length in rest_runs if length == 1) if shift_count else 0
        if isolated_rest:
            first = next(start for start, length in rest_runs if length == 1)
            _finding(
                findings, "ISOLATED_REST_DAY", "info",
                f'Line "{label}" has {isolated_rest} single day(s) off between work days.',
                isolated_rest, label, first,
            )

        backward = 0
        first_backward: Optional[int] = None
        for i in range(cycle):
            j = (i + 1) % cycle
            if worked[i] and worked[j]:
                a, b = KIND_RANK.get(defs[i].kind), KIND_RANK.get(defs[j].kind)
                if a is not None and b is not None and b < a:
                    backward += 1
                    if first_backward is None:
                        first_backward = i
        if backward:
            _finding(
                findings, "BACKWARD_ROTATION", "info",
                f'Line "{label}" moves back to an earlier kind of shift (for example night then day) '
                f"{backward} time(s) in the cycle.",
                backward, label, first_backward,
            )

        # Weekend exposure over the super-period; a shift counts on the day it starts.
        weekends = super_period // 7
        fully_off = 0
        weekend_shift_days = 0
        for d in range(super_period):
            wd = _weekday_of(request.start_weekday, d)
            if worked[d % cycle] and wd >= SATURDAY:
                weekend_shift_days += 1
            if wd == SATURDAY and not worked[d % cycle] and not worked[(d + 1) % cycle]:
                fully_off += 1
        weekends_off_pct = fully_off / weekends * 100.0
        weekend_per_cycle = weekend_shift_days * cycle / super_period
        if shift_count and fully_off == 0:
            _finding(
                findings, "WEEKEND_EXPOSURE", "info",
                f'Line "{label}" never has a full Saturday and Sunday off in {weekends} week(s) of the pattern.',
                0, label,
            )

        metrics.append(
            AuditLineMetrics(
                label=label,
                shifts_per_cycle=shift_count,
                avg_weekly_hours=round(avg_weekly, 2),
                min_rest_hours=None if min_rest is None else round(min_rest, 2),
                longest_work_run_days=work_run,
                longest_night_run=night_run,
                longest_long_shift_run=long_run,
                max_hours_in_7_days=round(max_week, 2),
                isolated_single_nights=isolated_nights,
                isolated_single_rest_days=isolated_rest,
                backward_rotation_events=backward,
                weekends_fully_off_pct=round(weekends_off_pct, 2),
                nights_per_cycle=sum(is_night),
                weekend_shifts_per_cycle=round(weekend_per_cycle, 2),
            )
        )

    for code in sorted(used_codes):
        d = shifts[code]
        if d.kind == "night" and d.duration_minutes >= 720:
            _finding(
                findings, "LONG_NIGHT_SHIFT", "info",
                f"Shift {d.code} is a night shift of {d.duration_minutes / 60:g} hours.",
                d.duration_minutes / 60.0,
            )

    nights = [m.nights_per_cycle for m in metrics]
    weekends_pc = [m.weekend_shifts_per_cycle for m in metrics]
    nights_stdev = pstdev(nights) if len(nights) > 1 else 0.0
    weekend_stdev = pstdev(weekends_pc) if len(weekends_pc) > 1 else 0.0
    spread_nights = max(nights) - min(nights)
    spread_weekends = max(weekends_pc) - min(weekends_pc)
    if spread_nights > 2 or spread_weekends > 2:
        parts = []
        if spread_nights > 2:
            parts.append(f"nights per cycle range from {min(nights)} to {max(nights)}")
        if spread_weekends > 2:
            parts.append(f"weekend shifts per cycle range from {min(weekends_pc):g} to {max(weekends_pc):g}")
        _finding(
            findings, "FAIRNESS_SPREAD", "info",
            "Load differs between lines: " + " and ".join(parts) + ".",
            max(spread_nights, spread_weekends),
        )

    coverage = _coverage(request, shifts, super_period) if request.demand_matrix else None

    findings.sort(
        key=lambda f: (
            0 if f.severity == "flag" else 1,
            f.rule_id,
            f.line_label or "",
            -1 if f.day_index is None else f.day_index,
        )
    )
    flags: Dict[str, int] = defaultdict(int)
    infos: Dict[str, int] = defaultdict(int)
    for f in findings:
        (flags if f.severity == "flag" else infos)[f.rule_id] += 1
    rests = [m.min_rest_hours for m in metrics if m.min_rest_hours is not None]
    summary = AuditSummary(
        flag_count=sum(flags.values()),
        info_count=sum(infos.values()),
        flags_by_rule=dict(flags),
        info_by_rule=dict(infos),
        overall_min_rest_hours=min(rests) if rests else None,
        overall_longest_work_run_days=max(m.longest_work_run_days for m in metrics),
        overall_max_hours_in_7_days=max(m.max_hours_in_7_days for m in metrics),
        nights_stdev=round(nights_stdev, 2),
        weekend_shifts_stdev=round(weekend_stdev, 2),
    )
    return AuditResponse(
        findings=findings,
        lines=metrics,
        coverage=coverage,
        summary=summary,
        thresholds_used=th,
    )


def _coverage(request: AuditRequest, shifts: Dict[str, AuditShiftDef], super_period: int) -> AuditCoverage:
    """Staff on shift in each hour of the super-period against the demand matrix.

    A shift counts toward an hour when it covers at least half of that hour. Shifts that run
    past midnight count toward the next day, and the pattern repeats, so the last day wraps
    into the first.
    """
    cycle = request.cycle_days
    slots = super_period * 24
    scheduled = [0] * slots
    for line in request.lines:
        for t in range(super_period):
            code = line.cells[t % cycle].strip().upper()
            if code == "OFF":
                continue
            d = shifts[code]
            start = t * MINUTES_PER_DAY + d.start_minute
            end = start + d.duration_minutes
            for k in range(start // 60, (end - 1) // 60 + 1):
                overlap = min(end, (k + 1) * 60) - max(start, k * 60)
                if overlap * 2 >= 60:
                    scheduled[k % slots] += 1
    demand = request.demand_matrix
    under = over = 0
    cells = []
    for slot in range(slots):
        t, hour = divmod(slot, 24)
        weekday = _weekday_of(request.start_weekday, t)
        required = demand[weekday][hour]
        diff = scheduled[slot] - required
        if diff < 0:
            under += -diff
        elif diff > 0:
            over += diff
        if diff:
            cells.append((abs(diff), weekday, hour, t, required, scheduled[slot]))
    cells.sort(key=lambda c: (-c[0], c[1], c[2], c[3]))
    weeks = super_period / 7.0
    return AuditCoverage(
        super_period_days=super_period,
        understaffed_hours_per_week=round(under / weeks, 2),
        overstaffed_hours_per_week=round(over / weeks, 2),
        worst_cells=[
            AuditWorstCell(day_index=c[3], weekday=c[1], hour=c[2], required=c[4], scheduled=c[5])
            for c in cells[:10]
        ],
    )
