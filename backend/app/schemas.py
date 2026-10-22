"""Pydantic schemas for ShiftFlow Studio.

Cross-version compatible with Pydantic v1 & v2.
"""

from typing import Any, Dict, List, Literal, Optional
from pydantic import BaseModel as _PydanticBaseModel, Field, field_validator, model_validator

MAX_DEMAND_PER_INTERVAL = 500


class BaseModel(_PydanticBaseModel):
    """BaseModel shim supporting both Pydantic v1 (.dict(), .copy()) and v2 (.model_dump(), .model_copy())."""

    def dict(self, *args, **kwargs) -> Dict[str, Any]:
        if hasattr(super(), "model_dump"):
            return getattr(super(), "model_dump")(*args, **kwargs)
        return getattr(super(), "dict")(*args, **kwargs)

    def model_dump(self, *args, **kwargs) -> Dict[str, Any]:
        return self.dict(*args, **kwargs)

    def copy(self, *args, **kwargs) -> Any:
        if hasattr(super(), "model_copy"):
            return getattr(super(), "model_copy")(*args, **kwargs)
        return getattr(super(), "copy")(*args, **kwargs)

    def model_copy(self, *args, **kwargs) -> Any:
        return self.copy(*args, **kwargs)


TemplateCode = Literal["M", "D", "E", "N"]
AccommodationType = Literal["none", "religious", "medical", "academic"]
SeparationCategory = Literal["voluntary_resignation", "mutual_agreement", "involuntary_for_cause", "layoff_reduction"]


class ShiftTemplateSchema(BaseModel):
    """Shift template s in S defining admissible start/end windows and durations."""
    code: TemplateCode = Field(..., description="Template identifier: M (Morning), D (Day/Mid), E (Evening), N (Night)")
    name: str = Field(..., description="Human-readable label for the shift template")
    earliest_start: int = Field(..., ge=0, le=23, description="Earliest start hour (0-23)")
    latest_end: int = Field(..., ge=1, le=36, description="Latest end hour (can exceed 24 for overnight shifts)")
    min_duration: int = Field(default=7, ge=4, le=12, description="Minimum shift duration in hours")
    max_duration: int = Field(default=9, ge=4, le=12, description="Maximum shift duration in hours")
    preferred_start: int = Field(..., ge=0, le=23, description="Default canonical start hour")
    preferred_duration: int = Field(default=8, ge=4, le=12, description="Default canonical duration in hours")
    enabled: bool = Field(default=True, description="Whether this template is active in the current facility")

    @model_validator(mode="after")
    def _check_window_cross_fields(self):
        if self.min_duration > self.max_duration:
            raise ValueError("min_duration must not exceed max_duration")
        if not self.min_duration <= self.preferred_duration <= self.max_duration:
            raise ValueError("preferred_duration must lie between min_duration and max_duration")
        if not self.earliest_start <= self.preferred_start < self.latest_end:
            raise ValueError("preferred_start must lie inside the earliest_start to latest_end window")
        return self


class ErgonomicGuardrailsSchema(BaseModel):
    """Scheduling constraints and ergonomic policy toggles."""
    min_consecutive_work_days: int = Field(default=3, ge=2, le=5)
    max_consecutive_work_days: int = Field(default=5, ge=3, le=7)
    min_consecutive_rest_days: int = Field(default=2, ge=1, le=4)
    max_consecutive_rest_days: int = Field(default=3, ge=2, le=5)
    max_consecutive_nights: int = Field(default=2, ge=1, le=4)
    max_consecutive_evenings: int = Field(default=3, ge=1, le=5)
    enforce_forward_rotation: bool = Field(default=True, description="Ensure M -> D -> E -> N progression")
    min_rest_hours: int = Field(
        default=16,  # matches settings.min_rest_hours_between_shifts (config.py); not imported here to avoid a cycle
        ge=8,
        le=24,
        description=(
            "Minimum hours between the end of one shift and the start of the next. Used to generate "
            "the schedule when enforce_zero_clopening is on, and always used to flag short gaps in the audit."
        ),
    )
    enforce_zero_clopening: bool = Field(
        default=True,
        description=(
            "When on, the generator never places two shifts closer together than min_rest_hours. "
            "When off, short gaps are allowed but still flagged."
        ),
    )
    avoid_single_rest_days: bool = Field(default=True, description="Penalize isolated 1-day rest blocks")
    avoid_single_night_shifts: bool = Field(default=True, description="Penalize isolated 1-day night shifts")
    prioritize_free_weekends: bool = Field(default=True, description="Maximize consolidated Sat+Sun off")


class EmployeeRecord(BaseModel):
    """Workforce personnel record with availability constraints, statutory accommodation status, wage rates, and active/fired status."""
    employee_id: str = Field(..., max_length=64, description="Unique employee identifier")
    name: str = Field(..., max_length=200, description="Employee full name")
    role: str = Field(default="Frontline Associate", max_length=200, description="Operational role / title")
    hourly_wage: float = Field(..., ge=7.25, le=150.0, description="Base hourly wage rate ($/hr)")
    max_weekly_hours: int = Field(default=40, ge=10, le=60, description="Target max weekly hours before overtime")
    is_active: bool = Field(default=True, description="Active status; False if fired / deactivated")
    available_days: List[int] = Field(
        default_factory=lambda: [0, 1, 2, 3, 4, 5, 6],
        description="Available day indices: 0=Mon, 1=Tue, 2=Wed, 3=Thu, 4=Fri, 5=Sat, 6=Sun",
    )
    preferred_shifts: List[str] = Field(
        default_factory=lambda: ["M", "D", "E"],
        description="Preferred template shift codes (e.g. ['M', 'D'])",
    )
    assigned_line_id: Optional[int] = Field(default=None, description="Mapped Rotation Line ID (1-indexed)")
    accommodation_type: AccommodationType = Field(
        default="none",
        description="Statutory accommodation protection: none, religious (Title VII), medical (ADA), academic",
    )
    statutory_notes: Optional[str] = Field(
        default=None, max_length=5000, description="Legal accommodation documentation notes"
    )
    separation_category: Optional[SeparationCategory] = Field(default=None, description="Termination classification")
    separation_reason: Optional[str] = Field(
        default=None, max_length=5000, description="Contemporaneous termination justification"
    )
    separation_timestamp: Optional[str] = Field(default=None, description="ISO timestamp of separation")
    recorded_by: Optional[str] = Field(
        default=None, max_length=200, description="Manager or administrator who recorded action"
    )


class StaffMemberAssignment(BaseModel):
    """Optional mapping of a staff member to a shift pattern."""
    line_id: int = Field(..., ge=1, description="1-indexed shift pattern ID")
    cohort_label: str = Field(..., max_length=200, description="Standardized shift pattern label (e.g., Pattern 1)")
    assigned_staff_name: Optional[str] = Field(
        default=None, max_length=200, description="Optional mapped employee name"
    )
    qualification_tier: str = Field(default="Frontline Associate", max_length=200, description="Employee operational role")
    hourly_wage: float = Field(..., description="Hourly wage rate for labor economics ($)")
    employee_id: Optional[str] = Field(
        default=None, max_length=64, description="Unique foreign key linking to EmployeeRecord"
    )


class ShiftTypeResultSchema(BaseModel):
    """Instantiated shift type t in T with concrete start hour and duration."""
    type_id: str
    template_code: TemplateCode
    template_name: str
    start_hour: int
    end_hour: int
    duration_hours: int
    formatted_window: str
    active: bool
    daily_counts: List[int]
    early_morning_penalty: float
    duration_penalty: float


class MultigraphArcSchema(BaseModel):
    """A work or rest block connecting two points in the weekly rotation."""
    arc_id: str
    arc_type: Literal["work", "rest"]
    start_day: int
    end_day: int
    duration_days: int
    from_node: str
    to_node: str
    shifts: List[str]
    sequence_penalty: float
    traversal_order: int


class MultigraphNodeSchema(BaseModel):
    """A day-of-week transition point in the weekly rotation."""
    node_id: str
    day_index: int
    day_name: str
    node_type: Literal["work", "rest"]
    in_degree: int
    out_degree: int
    is_balanced: bool


class RosterCellSchema(BaseModel):
    """Individual cell in the weekly schedule grid."""
    day_index: int
    day_name: str
    is_weekend: bool
    shift_code: Literal["M", "D", "E", "N", "OFF"]
    shift_type_id: Optional[str] = None
    time_window: str
    duration_hours: int
    rest_hours_before: float
    clopening_violation: bool
    backward_rotation_violation: bool
    availability_conflict: bool
    statutory_accommodation_conflict: bool = False


class RosterLineSchema(BaseModel):
    """A single row (one shift pattern) in the weekly schedule."""
    line_number: int
    cohort_id: str
    display_label: str
    assigned_person: Optional[str] = None
    assigned_employee_id: Optional[str] = None
    qualification_tier: str = "Standard Rate"
    hourly_wage: Optional[float] = None
    current_cycle_week: int
    next_week_line_number: int
    days: List[RosterCellSchema]
    weekly_hours: int
    regular_hours: int
    overtime_hours: int
    estimated_weekly_payroll: Optional[float] = None
    work_days_count: int
    rest_days_count: int
    full_weekend_off: bool
    availability_conflicts_count: int
    line_ergo_penalty: float
    statutory_accommodation_violation: bool = False
    fair_workweek_predictability_warning: bool = False


class ErgonomicCriterionBreakdown(BaseModel):
    """Individual breakdown for each of the 8 workload/fatigue criteria."""
    criterion_id: str
    symbol: str
    name: str
    ideal_range: str
    base_weight: float
    component_weight_range: str
    raw_violations_count: int
    weighted_penalty: float
    sequential_baseline_penalty: float
    improvement_pct: float
    status: Literal["optimal", "acceptable", "warning"]
    explanation: str


class ErgonomicsAuditSchema(BaseModel):
    """Full 8-criteria ergonomics health audit + hard constraint compliance."""
    total_ergo_objective: float
    sequential_baseline_ergo: float
    ergo_improvement_pct: float
    health_index_score: float = Field(..., description="0-100 normalized schedule health score")
    clopening_violations: int
    backward_rotation_violations: int
    min_rest_hours_observed: float
    min_rest_hours_required: int = 16
    full_weekends_off_count: int
    full_weekends_off_pct: float
    consolidated_rest_blocks_pct: float
    criteria_breakdown: List[ErgonomicCriterionBreakdown]
    statutory_accommodation_violations_count: int = 0
    fair_workweek_compliant: Optional[bool] = None
    mandatory_rest_violations: int = 0
    night_weekend_fairness_stdev: float = Field(
        0.0,
        description=(
            "Population standard deviation, across employees, of each employee's combined "
            "count of night shifts plus weekend shifts worked in the solved schedule. 0 means "
            "every employee carries the exact same night/weekend load; higher values mean the "
            "undesirable shifts are concentrated on fewer people. Computed directly from the "
            "solved roster lines, not estimated."
        ),
    )


class IntervalCoverageCell(BaseModel):
    """Coverage verification at day g, hour i."""
    day_index: int
    day_name: str
    hour: int
    hour_label: str
    required_staff: int
    scheduled_staff: int
    understaffing: int
    overstaffing: int
    shift_breakdown: Dict[str, int]


class LaborAnalysisSchema(BaseModel):
    """Labor economics and payroll cost evaluation."""
    total_scheduled_hours: int
    total_regular_hours: int
    total_overtime_hours: int
    regular_payroll_cost: float
    overtime_payroll_cost: float
    total_payroll_cost: float
    avg_hourly_wage: Optional[float] = None
    hours_per_day: List[int]
    cost_per_day: List[float]
    overtime_lines_count: int
    labor_efficiency_pct: float
    baseline_total_payroll_cost: float = Field(
        0.0,
        description=(
            "Total weekly payroll cost of the same demand solved at 0% pareto leeway (the "
            "tightest, least rest-optimized schedule the engine can build for this request), "
            "from a real re-solve. If this request already IS the 0% leeway case, it equals "
            "total_payroll_cost and the savings fields below are 0."
        ),
    )
    baseline_overtime_hours: int = Field(
        0,
        description="Total weekly overtime hours in that same 0%-leeway baseline re-solve.",
    )
    baseline_overtime_payroll_cost: float = Field(
        0.0,
        description="Overtime payroll cost (at 1.5x) in that same 0%-leeway baseline re-solve.",
    )
    payroll_cost_savings_vs_baseline: float = Field(
        0.0,
        description=(
            "baseline_total_payroll_cost minus total_payroll_cost. Positive means the solved "
            "schedule costs less per week than the 0%-leeway baseline; can be negative when the "
            "extra rest-optimization heads cost more than they save."
        ),
    )
    overtime_hours_saved_vs_baseline: float = Field(
        0.0,
        description=(
            "baseline_overtime_hours minus total_overtime_hours. Positive means the solved "
            "schedule generates fewer weekly overtime hours than the 0%-leeway baseline."
        ),
    )
    overtime_cost_savings_vs_baseline: float = Field(
        0.0,
        description=(
            "baseline_overtime_payroll_cost minus overtime_payroll_cost. The actual dollar "
            "amount saved (or lost) per week on overtime premium pay versus the 0%-leeway "
            "baseline."
        ),
    )


class ParetoPointSchema(BaseModel):
    """Individual point on the cost-vs-rest frontier."""
    point_index: int
    leeway_pct: float
    obj_shift: float
    obj_ergo: float
    ergo_improvement_pct: float
    employee_count: int
    active_shift_types_count: int
    total_understaffing_hours: int
    total_overstaffing_hours: int
    full_weekends_off_pct: float
    estimated_weekly_payroll: float = 0.0
    is_knee_point: bool
    is_selected: bool
    label: str


class SolveRequestSchema(BaseModel):
    """Full input specification for solving a weekly schedule."""
    archetype_id: str = Field(default="downtown_foodmart_omaha")
    facility_name: str = Field(default="Downtown Foodmart — 16th & Farnam (Omaha, NE)", max_length=200)
    demand_matrix: List[List[int]] = Field(
        ...,
        description="7x24 matrix of staff needed per hour: row = day (0=Mon..6=Sun), column = hour (0..23)",
    )
    templates: List[ShiftTemplateSchema]
    guardrails: ErgonomicGuardrailsSchema = Field(default_factory=ErgonomicGuardrailsSchema)
    pareto_leeway_pct: float = Field(
        default=10.0,
        ge=0.0,
        le=75.0,
        description="How much extra payroll cost you're willing to accept in exchange for a less demanding schedule",
    )
    rotation_week_offset: int = Field(default=0, ge=0, description="Which week of the rotation to display")
    staff_assignments: Optional[List[StaffMemberAssignment]] = None
    employees: Optional[List[EmployeeRecord]] = None

    @field_validator("demand_matrix")
    @classmethod
    def _check_demand_matrix(cls, matrix: List[List[int]]) -> List[List[int]]:
        if len(matrix) != 7 or any(len(row) != 24 for row in matrix):
            raise ValueError("demand_matrix must be 7 rows of 24 hourly values")
        for row in matrix:
            for value in row:
                if not 0 <= value <= MAX_DEMAND_PER_INTERVAL:
                    raise ValueError(
                        f"demand values must be between 0 and {MAX_DEMAND_PER_INTERVAL} people per hour"
                    )
        return matrix


class SolveResponseSchema(BaseModel):
    """Complete solution response containing shift design, rotation structure, roster, and audits."""
    instance_name: str
    archetype_id: str
    instance_size_category: Literal["Small", "Medium", "Large"]
    constrainedness_category: Literal["High", "Medium", "Low"]
    total_weekly_staffing_hours: int
    feasible_work_sequences_count: int
    employee_count: int
    active_shift_types_count: int
    obj_shift: float
    obj_shift_min_bound: float
    obj_ergo: float
    obj_ergo_sequential_fixed_sd: float
    integrated_ergo_gain_pct: float
    solve_time_ms: float
    eulerian_valid: bool
    eulerian_cycle_summary: str
    shift_types: List[ShiftTypeResultSchema]
    multigraph_nodes: List[MultigraphNodeSchema]
    multigraph_arcs: List[MultigraphArcSchema]
    roster_lines: List[RosterLineSchema]
    interval_coverage: List[IntervalCoverageCell]
    ergonomics_audit: ErgonomicsAuditSchema
    pareto_frontier: List[ParetoPointSchema]
    labor_analysis: LaborAnalysisSchema
    employees: List[EmployeeRecord]


class ArchetypePresetSchema(BaseModel):
    """Industry benchmark archetype preset for instant facility onboarding."""
    id: str
    name: str
    sector: str
    tagline: str
    description: str
    operating_hours_label: str
    typical_crew_size: str
    default_leeway_pct: float
    demand_matrix: List[List[int]]
    templates: List[ShiftTemplateSchema]
    guardrails: ErgonomicGuardrailsSchema


class CalloutCandidateSchema(BaseModel):
    """Candidate evaluation for frontline emergency callout replacement."""
    employee_id: str
    employee_name: str
    role: str
    hourly_wage: float
    is_off_duty_target_day: bool
    prior_rest_hours: float
    next_rest_hours: float
    current_scheduled_hours: int
    hours_with_shift: int
    overtime_risk: bool
    clopening_risk: bool
    estimated_added_payroll: float
    is_recommended: bool
    status_label: str
    audit_notes: List[str] = Field(default_factory=list)


class EmergencyCalloutRequestSchema(BaseModel):
    """Request to find compliant replacements for sudden frontline absence."""
    facility_id: Optional[str] = None
    target_day_index: int = Field(default=5, ge=0, le=6, description="Day index: 5=Saturday")
    target_shift_code: str = Field(default="E", description="M=Morning, D=Mid, E=Evening, N=Night")
    missing_employee_id: Optional[str] = None
    line_number: Optional[int] = Field(default=6)


class EmergencyCalloutResponseSchema(BaseModel):
    """Ranked callout replacement queue with rest and overtime audits."""
    target_day_name: str
    target_shift_window: str
    target_shift_code: str
    missing_employee_name: str
    candidates_count: int
    recommended_candidate_id: Optional[str] = None
    candidates: List[CalloutCandidateSchema]
    operational_guidance: str


class ShiftSwapRequestSchema(BaseModel):
    """Peer-to-peer shift trade proposal validation."""
    associate_a_id: str = Field(..., description="First associate requesting swap")
    associate_b_id: str = Field(..., description="Second associate agreeing to swap")
    day_a_index: int = Field(default=2, ge=0, le=6, description="Shift day of Associate A (e.g., 2=Wednesday)")
    day_b_index: int = Field(default=3, ge=0, le=6, description="Shift day of Associate B (e.g., 3=Thursday)")


class ShiftSwapValidationResponseSchema(BaseModel):
    """Bilateral swap validation ensuring zero clopening and zero unbudgeted overtime."""
    is_approved: bool
    associate_a_name: str
    associate_b_name: str
    swap_summary: str
    clopening_violation_a: bool
    clopening_violation_b: bool
    overtime_hours_a: float
    overtime_hours_b: float
    payroll_cost_delta: float
    validation_messages: List[str]
    next_monday_rotation_impact: str
