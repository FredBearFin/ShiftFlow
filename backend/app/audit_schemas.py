"""Schemas for the cyclic roster audit.

The audit works on any repeating pattern from 7 to 56 days, so it does not reuse the
7-day roster line of the schedule builder. Everything here is plain data: the audit is
rule-based and states the thresholds it used.
"""

import re
from typing import Dict, List, Literal, Optional

from pydantic import BaseModel, Field, field_validator, model_validator

MAX_AUDIT_LINES = 200
MAX_AUDIT_CELLS = 11200
AUDIT_ENGINE_VERSION = "audit-1"
AUDIT_DISCLAIMER = (
    "Rule-based check of the pattern you entered. Not legal advice. "
    "Thresholds are the values shown, not statutory limits."
)

ShiftKind = Literal["day", "evening", "night", "other"]
Severity = Literal["flag", "info"]


class AuditShiftDef(BaseModel):
    """One shift code the roster grid may use."""

    code: str = Field(..., description="1 to 4 letters or digits; not OFF")
    name: str = Field(default="", max_length=60)
    start_minute: int = Field(..., ge=0, le=1439, description="Minutes after midnight")
    duration_minutes: int = Field(..., ge=60, le=1200)
    kind: ShiftKind = "other"

    @field_validator("code")
    @classmethod
    def _check_code(cls, value: str) -> str:
        if not re.fullmatch(r"[A-Za-z0-9]{1,4}", value):
            raise ValueError("shift code must be 1 to 4 letters or digits")
        if value.upper() == "OFF":
            raise ValueError("OFF is reserved for days off")
        return value


class AuditLine(BaseModel):
    """One person's or crew's repeating pattern: a shift code or OFF for each day of the cycle."""

    label: str = Field(..., min_length=1, max_length=80)
    cells: List[str]


class AuditThresholds(BaseModel):
    """Limits the rules compare against. Defaults are house settings, not statutory limits."""

    min_rest_hours: float = Field(default=11.0, ge=4, le=24)
    max_consecutive_work_days: int = Field(default=6, ge=2, le=14)
    max_consecutive_nights: int = Field(default=4, ge=1, le=14)
    long_shift_hours: float = Field(default=10.0, ge=4, le=20)
    max_consecutive_long_shifts: int = Field(default=4, ge=1, le=14)
    max_hours_any_7_days: float = Field(default=60.0, ge=20, le=120)
    reference_avg_weekly_hours: float = Field(default=48.0, ge=20, le=120)


class AuditRequest(BaseModel):
    cycle_days: int = Field(..., ge=7, le=56)
    start_weekday: int = Field(default=0, ge=0, le=6, description="Weekday of day index 0; 0 is Monday")
    shifts: List[AuditShiftDef] = Field(..., min_length=1, max_length=12)
    lines: List[AuditLine] = Field(..., min_length=1, max_length=MAX_AUDIT_LINES)
    thresholds: AuditThresholds = Field(default_factory=AuditThresholds)
    demand_matrix: Optional[List[List[int]]] = Field(
        default=None, description="Optional 7 by 24 staff needed per hour; row 0 is Monday"
    )

    @field_validator("demand_matrix")
    @classmethod
    def _check_demand(cls, value: Optional[List[List[int]]]) -> Optional[List[List[int]]]:
        if value is None:
            return value
        if len(value) != 7 or any(len(row) != 24 for row in value):
            raise ValueError("demand_matrix must be 7 rows (Monday first) of 24 hourly values")
        if any(cell < 0 or cell > 500 for row in value for cell in row):
            raise ValueError("demand_matrix values must be between 0 and 500")
        return value

    @model_validator(mode="after")
    def _check_grid(self) -> "AuditRequest":
        codes = [s.code.upper() for s in self.shifts]
        if len(set(codes)) != len(codes):
            raise ValueError("shift codes must be unique (upper and lower case count as the same)")
        labels = [line.label for line in self.lines]
        if len(set(labels)) != len(labels):
            raise ValueError("line labels must be unique")
        if len(self.lines) * self.cycle_days > MAX_AUDIT_CELLS:
            raise ValueError(f"the roster grid is limited to {MAX_AUDIT_CELLS} cells")
        known = set(codes) | {"OFF"}
        for line in self.lines:
            if len(line.cells) != self.cycle_days:
                raise ValueError(
                    f'Line "{line.label}" has {len(line.cells)} days but the cycle is {self.cycle_days} days'
                )
            for index, cell in enumerate(line.cells):
                if cell.strip().upper() not in known:
                    raise ValueError(
                        f'Line "{line.label}", day {index + 1}: "{cell}" is not a shift you defined'
                    )
        return self


class AuditFinding(BaseModel):
    rule_id: str
    severity: Severity
    line_label: Optional[str] = None
    day_index: Optional[int] = None
    value: float
    threshold: Optional[float] = None
    message: str


class AuditLineMetrics(BaseModel):
    label: str
    shifts_per_cycle: int
    avg_weekly_hours: float
    min_rest_hours: Optional[float] = None
    longest_work_run_days: int
    longest_night_run: int
    longest_long_shift_run: int
    max_hours_in_7_days: float
    isolated_single_nights: int
    isolated_single_rest_days: int
    backward_rotation_events: int
    weekends_fully_off_pct: float
    nights_per_cycle: int
    weekend_shifts_per_cycle: float


class AuditWorstCell(BaseModel):
    day_index: int
    weekday: int
    hour: int
    required: int
    scheduled: int


class AuditCoverage(BaseModel):
    super_period_days: int
    understaffed_hours_per_week: float
    overstaffed_hours_per_week: float
    worst_cells: List[AuditWorstCell]


class AuditSummary(BaseModel):
    flag_count: int
    info_count: int
    flags_by_rule: Dict[str, int]
    info_by_rule: Dict[str, int]
    overall_min_rest_hours: Optional[float] = None
    overall_longest_work_run_days: int
    overall_max_hours_in_7_days: float
    nights_stdev: float
    weekend_shifts_stdev: float


class AuditResponse(BaseModel):
    findings: List[AuditFinding]
    lines: List[AuditLineMetrics]
    coverage: Optional[AuditCoverage] = None
    summary: AuditSummary
    thresholds_used: AuditThresholds
    engine_version: str = AUDIT_ENGINE_VERSION
    disclaimer: str = AUDIT_DISCLAIMER
