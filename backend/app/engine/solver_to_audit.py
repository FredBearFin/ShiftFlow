"""Turns a solved schedule into an audit request, so the generator's output can be audited
by the same rules as a roster the user already runs.

What the solver does at the start of a line (isd_rwsp_solver.py lines 782 to 784 and 821):
the rest before day 0 of a line is measured from day 6 of the PREVIOUS pattern, not from day 6
of the same line. A person moves from one line to the next each week
(RosterLineSchema.next_week_line_number), so one person's real sequence is the lines laid end
to end in that order. This adapter follows the same pairing: it walks next_week_line_number,
joins the 7-day rows into one repeating sequence of 7 x (lines in the orbit) days, and gives
every person the same sequence starting a week apart.

That sequence is longer than the 56-day limit the audit route puts on pasted rosters (a
schedule with 12 lines repeats every 84 days). The request is therefore built without that
limit, and a note says so.
"""

from typing import Dict, List, Optional, Tuple

from app.audit_schemas import (
    AuditLine,
    AuditRequest,
    AuditShiftDef,
    AuditThresholds,
)
from app.schemas import SolveResponseSchema

KIND_BY_CODE = {"M": "day", "D": "day", "E": "evening", "N": "night"}
PASTE_LIMIT_DAYS = 56


def _orbits(solution: SolveResponseSchema) -> List[List[int]]:
    """Groups of line numbers that follow one another week to week, in order."""
    nxt = {line.line_number: line.next_week_line_number for line in solution.roster_lines}
    seen = set()
    orbits: List[List[int]] = []
    for start in sorted(nxt):
        if start in seen:
            continue
        orbit = []
        cur = start
        while cur not in seen and cur in nxt:
            seen.add(cur)
            orbit.append(cur)
            cur = nxt[cur]
        orbits.append(orbit)
    return orbits


def solution_to_audit_request(
    solution: SolveResponseSchema,
    start_weekday: int = 0,
    thresholds: Optional[AuditThresholds] = None,
    demand_matrix: Optional[List[List[int]]] = None,
) -> Tuple[AuditRequest, List[str]]:
    """The audit request for a solved schedule, plus plain-language notes about how it was built.

    Day 0 of a solved schedule is Monday, so start_weekday defaults to 0.
    """
    notes: List[str] = []
    shifts = [
        AuditShiftDef(
            code=st.template_code,
            name=st.formatted_window,
            start_minute=st.start_hour * 60,
            duration_minutes=st.duration_hours * 60,
            kind=KIND_BY_CODE.get(st.template_code, "other"),
        )
        for st in solution.shift_types
        if st.active
    ]
    rows: Dict[int, List[str]] = {
        line.line_number: [cell.shift_code for cell in line.days] for line in solution.roster_lines
    }
    orbits = _orbits(solution)
    if len(orbits) != 1:
        notes.append(
            f"The schedule's lines form {len(orbits)} separate rotations; only the first is audited."
        )
    orbit = orbits[0]
    cycle_days = 7 * len(orbit)
    sequence = [code for number in orbit for code in rows[number]]
    lines = []
    for k in range(len(orbit)):
        shift = 7 * k
        cells = sequence[shift:] + sequence[:shift]
        lines.append(AuditLine(label=f"Starts on line {orbit[k]}", cells=cells))
    notes.append(
        f"Each person rotates through {len(orbit)} weekly lines, so the schedule repeats every "
        f"{cycle_days} days."
    )
    if cycle_days > PASTE_LIMIT_DAYS:
        notes.append(
            f"That is longer than the {PASTE_LIMIT_DAYS}-day limit for pasted rosters; the limit is "
            "not applied to a schedule built here."
        )
    payload = dict(
        cycle_days=cycle_days,
        start_weekday=start_weekday,
        shifts=shifts,
        lines=lines,
        thresholds=thresholds or AuditThresholds(),
        demand_matrix=demand_matrix,
    )
    try:
        request = AuditRequest(**payload)
    except ValueError:
        # Beyond the limits for pasted input; the sequence itself was produced by the solver.
        request = AuditRequest.model_construct(**payload)
    return request, notes
