/**
 * TypeScript interfaces for ShiftFlow Studio, mirroring the backend's Pydantic schemas,
 * with Title VII / ADA accommodation and Fair Workweek statutory compliance.
 */

export type TemplateCode = 'M' | 'D' | 'E' | 'N';
export type ShiftOrOffCode = TemplateCode | 'OFF';
export type AccommodationType = 'none' | 'religious' | 'medical' | 'academic';
export type SeparationCategory = 'voluntary_resignation' | 'mutual_agreement' | 'involuntary_for_cause' | 'layoff_reduction';

export interface ShiftTemplate {
  code: TemplateCode;
  name: string;
  earliest_start: number;
  latest_end: number;
  min_duration: number;
  max_duration: number;
  preferred_start: number;
  preferred_duration: number;
  enabled: boolean;
}

export interface ErgonomicGuardrails {
  min_consecutive_work_days: number;
  max_consecutive_work_days: number;
  min_consecutive_rest_days: number;
  max_consecutive_rest_days: number;
  max_consecutive_nights: number;
  max_consecutive_evenings: number;
  enforce_forward_rotation: boolean;
  enforce_zero_clopening: boolean;
  avoid_single_rest_days: boolean;
  avoid_single_night_shifts: boolean;
  prioritize_free_weekends: boolean;
}

export interface EmployeeRecord {
  employee_id: string;
  name: string;
  role: string;
  hourly_wage: number;
  max_weekly_hours: number;
  is_active: boolean;
  available_days: number[]; // 0=Mon .. 6=Sun
  preferred_shifts: string[];
  assigned_line_id?: number | null;
  accommodation_type?: AccommodationType;
  statutory_notes?: string | null;
  separation_category?: SeparationCategory | null;
  separation_reason?: string | null;
  separation_timestamp?: string | null;
  recorded_by?: string | null;
}

/** Payload for adding a staff member from either the roster modal or the directory. */
export interface NewEmployeeInput {
  name: string;
  role: string;
  wage: number;
  days: number[];
  accommodation_type?: AccommodationType;
  statutory_notes?: string;
}

export interface StaffMemberAssignment {
  line_id: number;
  cohort_label: string;
  assigned_staff_name: string | null;
  qualification_tier: string;
  hourly_wage: number;
  employee_id?: string | null;
}

export interface ShiftTypeResult {
  type_id: string;
  template_code: TemplateCode;
  template_name: string;
  start_hour: number;
  end_hour: number;
  duration_hours: number;
  formatted_window: string;
  active: boolean;
  daily_counts: number[];
  early_morning_penalty: number;
  duration_penalty: number;
}

export interface MultigraphArc {
  arc_id: string;
  arc_type: 'work' | 'rest';
  start_day: number;
  end_day: number;
  duration_days: number;
  from_node: string;
  to_node: string;
  shifts: string[];
  sequence_penalty: number;
  traversal_order: number;
}

export interface MultigraphNode {
  node_id: string;
  day_index: number;
  day_name: string;
  node_type: 'work' | 'rest';
  in_degree: number;
  out_degree: number;
  is_balanced: boolean;
}

export interface RosterCell {
  day_index: number;
  day_name: string;
  is_weekend: boolean;
  shift_code: ShiftOrOffCode;
  shift_type_id: string | null;
  time_window: string;
  duration_hours: number;
  rest_hours_before: number;
  clopening_violation: boolean;
  backward_rotation_violation: boolean;
  availability_conflict: boolean;
  statutory_accommodation_conflict?: boolean;
}

export interface RosterLine {
  line_number: number;
  cohort_id: string;
  display_label: string;
  assigned_person: string | null;
  assigned_employee_id: string | null;
  qualification_tier: string;
  hourly_wage: number | null;
  current_cycle_week: number;
  next_week_line_number: number;
  days: RosterCell[];
  weekly_hours: number;
  regular_hours: number;
  overtime_hours: number;
  estimated_weekly_payroll: number | null;
  work_days_count: number;
  rest_days_count: number;
  full_weekend_off: boolean;
  availability_conflicts_count: number;
  line_ergo_penalty: number;
  statutory_accommodation_violation?: boolean;
  fair_workweek_predictability_warning?: boolean;
}

export interface ErgonomicCriterionBreakdown {
  criterion_id: string;
  symbol: string;
  name: string;
  ideal_range: string;
  base_weight: number;
  component_weight_range: string;
  raw_violations_count: number;
  weighted_penalty: number;
  sequential_baseline_penalty: number;
  improvement_pct: number;
  status: 'optimal' | 'acceptable' | 'warning';
  explanation: string;
}

export interface ErgonomicsAudit {
  total_ergo_objective: number;
  sequential_baseline_ergo: number;
  ergo_improvement_pct: number;
  health_index_score: number;
  clopening_violations: number;
  backward_rotation_violations: number;
  min_rest_hours_observed: number;
  full_weekends_off_count: number;
  full_weekends_off_pct: number;
  consolidated_rest_blocks_pct: number;
  criteria_breakdown: ErgonomicCriterionBreakdown[];
  statutory_accommodation_violations_count?: number;
  fair_workweek_compliant?: boolean;
  mandatory_rest_violations?: number;
  // Population standard deviation, across employees, of each employee's combined
  // night-shift + weekend-shift count. 0 = perfectly even; higher = more concentrated
  // on fewer people. Computed directly from the solved roster, not estimated.
  night_weekend_fairness_stdev?: number;
}

export interface IntervalCoverageCell {
  day_index: number;
  day_name: string;
  hour: number;
  hour_label: string;
  required_staff: number;
  scheduled_staff: number;
  understaffing: number;
  overstaffing: number;
  shift_breakdown: Record<string, number>;
}

export interface LaborAnalysis {
  total_scheduled_hours: number;
  total_regular_hours: number;
  total_overtime_hours: number;
  regular_payroll_cost: number;
  overtime_payroll_cost: number;
  total_payroll_cost: number;
  avg_hourly_wage: number | null;
  hours_per_day: number[];
  cost_per_day: number[];
  overtime_lines_count: number;
  labor_efficiency_pct: number;
  // Real re-solve of the same demand at 0% pareto leeway (the tightest, least
  // rest-optimized schedule the engine can build), plus the savings deltas vs it.
  // Equal to this schedule's own figures (0 delta) when this request already IS
  // the 0%-leeway case.
  baseline_total_payroll_cost?: number;
  baseline_overtime_hours?: number;
  baseline_overtime_payroll_cost?: number;
  payroll_cost_savings_vs_baseline?: number;
  overtime_hours_saved_vs_baseline?: number;
  overtime_cost_savings_vs_baseline?: number;
}

export interface ParetoPoint {
  point_index: number;
  leeway_pct: number;
  obj_shift: number;
  obj_ergo: number;
  ergo_improvement_pct: number;
  employee_count: number;
  active_shift_types_count: number;
  total_understaffing_hours: number;
  total_overstaffing_hours: number;
  full_weekends_off_pct: number;
  estimated_weekly_payroll: number;
  is_knee_point: boolean;
  is_selected: boolean;
  label: string;
}

export interface SolveRequest {
  archetype_id: string;
  facility_name: string;
  demand_matrix: number[][];
  templates: ShiftTemplate[];
  guardrails: ErgonomicGuardrails;
  pareto_leeway_pct: number;
  rotation_week_offset: number;
  staff_assignments?: StaffMemberAssignment[];
  employees?: EmployeeRecord[];
}

/**
 * The part of a solve request a manager enters by hand, as it is saved between
 * sessions. Staff records live on the server; everything here - above all the 7x24
 * staffing table, which is the longest manual task in the product - used to live only
 * in React state and was replaced with defaults on every reload.
 */
export interface PersistedSolveConfig {
  archetype_id: string;
  facility_name: string;
  demand_matrix: number[][];
  templates: ShiftTemplate[];
  guardrails: ErgonomicGuardrails;
  pareto_leeway_pct: number;
  rotation_week_offset: number;
}

/**
 * The server-side mirror of PersistedSolveConfig (see backend/app/api/
 * facility_config_routes.py), keyed to the facility so a manager and any linked owner
 * (app/api/owner_routes.py) see the same saved setup regardless of whose browser last
 * configured it. The browser's own localStorage copy (see PersistedSolveConfig above)
 * stays as the fast local cache / offline fallback; this is the shared source of truth.
 */
export interface FacilitySolveConfigRecord {
  facility_id: string;
  config: PersistedSolveConfig;
  updated_at: string;
}

export interface SolveResponse {
  instance_name: string;
  archetype_id: string;
  instance_size_category: 'Small' | 'Medium' | 'Large';
  constrainedness_category: 'High' | 'Medium' | 'Low';
  total_weekly_staffing_hours: number;
  feasible_work_sequences_count: number;
  employee_count: number;
  active_shift_types_count: number;
  obj_shift: number;
  obj_shift_min_bound: number;
  obj_ergo: number;
  obj_ergo_sequential_fixed_sd: number;
  integrated_ergo_gain_pct: number;
  solve_time_ms: number;
  eulerian_valid: boolean;
  eulerian_cycle_summary: string;
  shift_types: ShiftTypeResult[];
  multigraph_nodes: MultigraphNode[];
  multigraph_arcs: MultigraphArc[];
  roster_lines: RosterLine[];
  interval_coverage: IntervalCoverageCell[];
  ergonomics_audit: ErgonomicsAudit;
  pareto_frontier: ParetoPoint[];
  labor_analysis: LaborAnalysis;
  employees: EmployeeRecord[];
}

export interface ArchetypePreset {
  id: string;
  name: string;
  sector: string;
  tagline: string;
  description: string;
  operating_hours_label: string;
  typical_crew_size: string;
  default_leeway_pct: number;
  demand_matrix: number[][];
  templates: ShiftTemplate[];
  guardrails: ErgonomicGuardrails;
}


export type ActiveTabId = 'roster' | 'staff' | 'labor' | 'coverage' | 'pareto' | 'ergonomics' | 'compliance';


export interface CalloutCandidate {
  employee_id: string;
  employee_name: string;
  role: string;
  hourly_wage: number;
  is_off_duty_target_day: boolean;
  prior_rest_hours: number;
  next_rest_hours: number;
  current_scheduled_hours: number;
  hours_with_shift: number;
  overtime_risk: boolean;
  clopening_risk: boolean;
  estimated_added_payroll: number;
  is_recommended: boolean;
  status_label: string;
  audit_notes: string[];
}

export interface EmergencyCalloutResponse {
  target_day_name: string;
  target_shift_window: string;
  target_shift_code: string;
  missing_employee_name: string;
  candidates_count: number;
  recommended_candidate_id?: string;
  candidates: CalloutCandidate[];
  operational_guidance: string;
}

export interface ShiftSwapValidationResponse {
  is_approved: boolean;
  associate_a_name: string;
  associate_b_name: string;
  swap_summary: string;
  clopening_violation_a: boolean;
  clopening_violation_b: boolean;
  overtime_hours_a: number;
  overtime_hours_b: number;
  payroll_cost_delta: number;
  validation_messages: string[];
  next_monday_rotation_impact: string;
}

/**
 * Pricing / checkout (see PricingView.tsx and gtm/commercial_pricing.md for the tiers
 * these ids name). Additive to the plain email/password signup in types above - a billing
 * plan is layered on top of the same account, not a separate account system.
 */
export type BillingPlanId = 'personal' | 'business';

export interface BillingSignupInput {
  email: string;
  password: string;
  plan: BillingPlanId;
  /** Only meaningful for the 'business' plan; optional for 'personal'. */
  businessName?: string;
}

/** What /api/billing/signup returns on success. billing_status is a stub until real
 *  Stripe billing exists - see backend/app/api/billing_routes.py. */
export interface BillingSignupResult {
  status: string;
  email: string;
  plan: BillingPlanId;
  billing_status: string;
}
