"""Well known 12-hour crew rotations, each checked for exact coverage by verify_coverage.

A pattern string has one character per day of the cycle: a shift code, or "-" for a day off.
A crew's pattern is rotated left by its offset to give that crew's line. Only patterns that
pass verify_coverage belong here; add a new one only with an owner-supplied source for its name.
"""

from dataclasses import dataclass
from typing import Dict, List, Optional, Tuple

from app.audit_schemas import AuditLine, AuditRequest, AuditShiftDef, AuditThresholds

TWELVE_HOUR_SHIFTS: Tuple[AuditShiftDef, ...] = (
    AuditShiftDef(code="D", name="Day 07:00 to 19:00", start_minute=7 * 60, duration_minutes=720, kind="day"),
    AuditShiftDef(code="N", name="Night 19:00 to 07:00", start_minute=19 * 60, duration_minutes=720, kind="night"),
)


@dataclass(frozen=True)
class RotationPattern:
    pattern_id: str
    name: str
    description: str
    cycle_days: int
    shifts: Tuple[AuditShiftDef, ...]
    crews: Tuple[Tuple[str, str, int], ...]  # (label, pattern string, offset in days)
    coverage: Dict[str, int]  # shift code -> crews on duty every day


def _night(pattern: str) -> str:
    return pattern.replace("D", "N")


_PITMAN = "DD--DDD--DD---"
_FOUR_ON_FOUR_OFF_DAY = "DDDD----"
_FOUR_ON_FOUR_OFF_NIGHT = "NNNN----"
_DUPONT = "NNNN---DDD-NNN---DDDD-------"

PATTERNS: Dict[str, RotationPattern] = {
    "pitman_2_2_3_12h": RotationPattern(
        pattern_id="pitman_2_2_3_12h",
        name="2-2-3 (Pitman), 12-hour shifts",
        description="Four crews, 12-hour day and night shifts, 14-day cycle. Average 42 hours per week per crew.",
        cycle_days=14,
        shifts=TWELVE_HOUR_SHIFTS,
        crews=(
            ("Day crew A", _PITMAN, 0),
            ("Day crew B", _PITMAN, 7),
            ("Night crew A", _night(_PITMAN), 0),
            ("Night crew B", _night(_PITMAN), 7),
        ),
        coverage={"D": 1, "N": 1},
    ),
    "four_on_four_off_12h": RotationPattern(
        pattern_id="four_on_four_off_12h",
        name="4 on, 4 off, 12-hour shifts",
        description="Four crews, 12-hour day and night shifts, 8-day cycle. Average 42 hours per week per crew.",
        cycle_days=8,
        shifts=TWELVE_HOUR_SHIFTS,
        crews=(
            ("Day crew A", _FOUR_ON_FOUR_OFF_DAY, 0),
            ("Day crew B", _FOUR_ON_FOUR_OFF_DAY, 4),
            ("Night crew A", _FOUR_ON_FOUR_OFF_NIGHT, 0),
            ("Night crew B", _FOUR_ON_FOUR_OFF_NIGHT, 4),
        ),
        coverage={"D": 1, "N": 1},
    ),
    "dupont_28_12h": RotationPattern(
        pattern_id="dupont_28_12h",
        name="28-day DuPont-style, 12-hour shifts",
        description=(
            "Four crews, 12-hour day and night shifts, 28-day cycle. Average 42 hours per week per crew; "
            "one week in the cycle has 72 hours."
        ),
        cycle_days=28,
        shifts=TWELVE_HOUR_SHIFTS,
        crews=(
            ("Crew A", _DUPONT, 0),
            ("Crew B", _DUPONT, 7),
            ("Crew C", _DUPONT, 14),
            ("Crew D", _DUPONT, 21),
        ),
        coverage={"D": 1, "N": 1},
    ),
}


def _rotated(pattern: str, offset: int) -> str:
    k = offset % len(pattern)
    return pattern[k:] + pattern[:k]


def verify_coverage(pattern: RotationPattern) -> List[str]:
    """Problems found, empty when every day has exactly the stated crews on each shift code."""
    problems: List[str] = []
    codes = {s.code for s in pattern.shifts}
    for label, text, _ in pattern.crews:
        if len(text) != pattern.cycle_days:
            problems.append(f"{label}: pattern has {len(text)} days, cycle is {pattern.cycle_days}")
        stray = set(text) - codes - {"-"}
        if stray:
            problems.append(f"{label}: unknown shift code(s) {sorted(stray)}")
    if problems:
        return problems
    for day in range(pattern.cycle_days):
        counts: Dict[str, int] = {code: 0 for code in codes}
        for _, text, offset in pattern.crews:
            ch = text[(day + offset) % pattern.cycle_days]
            if ch != "-":
                counts[ch] += 1
        for code in sorted(codes):
            want = pattern.coverage.get(code, 0)
            if counts[code] != want:
                problems.append(f"day {day + 1}: {counts[code]} crew(s) on {code}, expected {want}")
    return problems


def get_pattern(pattern_id: str) -> Optional[RotationPattern]:
    return PATTERNS.get(pattern_id)


def pattern_to_audit_request(
    pattern_id: str,
    start_weekday: int = 0,
    thresholds: Optional[AuditThresholds] = None,
) -> AuditRequest:
    """Expands a library pattern into a request ready to audit."""
    pattern = PATTERNS[pattern_id]
    lines = [
        AuditLine(
            label=label,
            cells=["OFF" if ch == "-" else ch for ch in _rotated(text, offset)],
        )
        for label, text, offset in pattern.crews
    ]
    return AuditRequest(
        cycle_days=pattern.cycle_days,
        start_weekday=start_weekday,
        shifts=list(pattern.shifts),
        lines=lines,
        thresholds=thresholds or AuditThresholds(),
    )
