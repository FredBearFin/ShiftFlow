/**
 * A valid SolveResponse for view tests, plus small helpers to vary it.
 *
 * Shared by the view test files so each one states only the data it actually cares about.
 * Built against src/types.ts, which these tests only read (it is frozen).
 *
 * Deliberately shaped like a real solve rather than filled with zeroes: 3 roster lines,
 * a full 168-cell coverage grid, understaffed AND overstaffed hours, one line with
 * overtime and one unassigned line with no wage. Several views only show their
 * interesting states when the numbers are non-trivial.
 */
import type {
  ErgonomicCriterionBreakdown,
  IntervalCoverageCell,
  MultigraphArc,
  MultigraphNode,
  RosterCell,
  RosterLine,
  ParetoPoint,
  ShiftOrOffCode,
  ShiftTypeResult,
  SolveResponse,
  EmployeeRecord,
} from '../../types';

const DAY_NAMES = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];

const WINDOWS: Record<string, { window: string; hours: number }> = {
  M: { window: '06:00–14:00', hours: 8 },
  D: { window: '10:00–18:00', hours: 8 },
  E: { window: '14:00–22:00', hours: 8 },
  N: { window: '22:00–06:00', hours: 8 },
};

function makeCells(codes: ShiftOrOffCode[]): RosterCell[] {
  return codes.map((code, dayIndex) => {
    const spec = WINDOWS[code];
    return {
      day_index: dayIndex,
      day_name: DAY_NAMES[dayIndex],
      is_weekend: dayIndex >= 5,
      shift_code: code,
      shift_type_id: spec ? `ST_${code}` : null,
      time_window: spec ? spec.window : 'Rest / Off',
      duration_hours: spec ? spec.hours : 0,
      rest_hours_before: 16,
      clopening_violation: false,
      backward_rotation_violation: false,
      availability_conflict: false,
      statutory_accommodation_conflict: false,
    };
  });
}

function makeLine(
  lineNumber: number,
  codes: ShiftOrOffCode[],
  overrides: Partial<RosterLine> = {}
): RosterLine {
  const days = makeCells(codes);
  const weeklyHours = days.reduce((sum, cell) => sum + cell.duration_hours, 0);
  const workDays = days.filter((cell) => cell.shift_code !== 'OFF').length;
  const wage = 17.5;
  const regular = Math.min(40, weeklyHours);
  const overtime = Math.max(0, weeklyHours - 40);
  return {
    line_number: lineNumber,
    cohort_id: `PATTERN-0${lineNumber}`,
    display_label: `Rotation Line ${lineNumber}`,
    assigned_person: null,
    assigned_employee_id: null,
    qualification_tier: 'Union Line Standard',
    hourly_wage: wage,
    current_cycle_week: lineNumber,
    next_week_line_number: lineNumber === 3 ? 1 : lineNumber + 1,
    days,
    weekly_hours: weeklyHours,
    regular_hours: regular,
    overtime_hours: overtime,
    estimated_weekly_payroll: Math.round((regular * wage + overtime * wage * 1.5) * 100) / 100,
    work_days_count: workDays,
    rest_days_count: 7 - workDays,
    full_weekend_off: codes[5] === 'OFF' && codes[6] === 'OFF',
    availability_conflicts_count: 0,
    line_ergo_penalty: 0,
    statutory_accommodation_violation: false,
    fair_workweek_predictability_warning: false,
    ...overrides,
  };
}

function makeCoverage(): IntervalCoverageCell[] {
  const cells: IntervalCoverageCell[] = [];
  for (let day = 0; day < 7; day += 1) {
    for (let hour = 0; hour < 24; hour += 1) {
      const open = hour >= 6 && hour < 22;
      const required = open ? 2 : 0;
      // One deliberately understaffed hour and one overstaffed hour per day, so views
      // that highlight gaps and surplus have something to highlight.
      let scheduled = required;
      if (open && hour === 9) scheduled = required - 1;
      if (open && hour === 15) scheduled = required + 1;
      cells.push({
        day_index: day,
        day_name: DAY_NAMES[day],
        hour,
        hour_label: `${String(hour).padStart(2, '0')}:00`,
        required_staff: required,
        scheduled_staff: scheduled,
        understaffing: Math.max(0, required - scheduled),
        overstaffing: Math.max(0, scheduled - required),
        shift_breakdown: scheduled > 0 ? { M: scheduled } : {},
      });
    }
  }
  return cells;
}

function makeCriteria(): ErgonomicCriterionBreakdown[] {
  const names: [string, string, string][] = [
    ['C1', 'W^SL', 'Shift length'],
    ['C2', 'W^MS', 'Early morning starts'],
    ['C3', 'W^CD', 'Consecutive work days'],
    ['C4', 'W^CN', 'Consecutive nights'],
    ['C5', 'W^CE', 'Consecutive evenings'],
    ['C6', 'W^SN', 'Isolated single nights'],
    ['C7', 'W^WW', 'Weekend work'],
    ['C8', 'W^SR', 'Isolated single rest days'],
  ];
  return names.map(([id, symbol, name], index) => ({
    criterion_id: id,
    symbol,
    name,
    ideal_range: '0',
    base_weight: 1,
    component_weight_range: '[0..3]',
    raw_violations_count: index,
    weighted_penalty: index * 2,
    sequential_baseline_penalty: index * 3,
    improvement_pct: index === 0 ? 0 : 25,
    status: index < 3 ? 'optimal' : index < 6 ? 'acceptable' : 'warning',
    explanation: `${name} explanation.`,
  }));
}

function makeFrontier(): ParetoPoint[] {
  const rows: [number, number, number, number, boolean, boolean, string][] = [
    [0, 459, 43, 11, false, false, 'No extra cost'],
    [1, 459, 43, 11, false, false, '+1% cost'],
    [5, 380, 36, 12, true, true, 'Best value'],
    [10, 380, 36, 12, false, false, '+10% cost'],
    [20, 380, 36, 12, false, false, '+20% cost'],
  ];
  return rows.map(
    ([leeway, objShift, objErgo, count, knee, selected, label], index) => ({
      point_index: index,
      leeway_pct: leeway,
      obj_shift: objShift,
      obj_ergo: objErgo,
      ergo_improvement_pct: leeway === 0 ? 0 : 16.3,
      becker_theoretical_improvement_pct: leeway === 0 ? 0 : 16.3,
      employee_count: count,
      active_shift_types_count: 3,
      total_understaffing_hours: 102,
      total_overstaffing_hours: 122,
      full_weekends_off_pct: 33.3,
      estimated_weekly_payroll: 6000 + leeway * 10,
      is_knee_point: knee,
      is_selected: selected,
      label,
    })
  );
}

function makeShiftTypes(): ShiftTypeResult[] {
  return (['M', 'D', 'E'] as const).map((code) => ({
    type_id: `ST_${code}`,
    template_code: code,
    template_name: `${code} shift`,
    start_hour: WINDOWS[code] ? Number(WINDOWS[code].window.slice(0, 2)) : 6,
    end_hour: 14,
    duration_hours: 8,
    formatted_window: WINDOWS[code].window,
    active: true,
    daily_counts: [1, 1, 1, 1, 1, 1, 1],
    early_morning_penalty: 0,
    duration_penalty: 0,
  }));
}

function makeNodes(): MultigraphNode[] {
  const nodes: MultigraphNode[] = [];
  for (let day = 0; day < 7; day += 1) {
    (['work', 'rest'] as const).forEach((type) => {
      nodes.push({
        node_id: `d${day}_${type}`,
        day_index: day,
        day_name: DAY_NAMES[day],
        node_type: type,
        in_degree: 1,
        out_degree: 1,
        is_balanced: true,
      });
    });
  }
  return nodes;
}

function makeArcs(): MultigraphArc[] {
  return [
    {
      arc_id: 'e_b1',
      arc_type: 'work',
      start_day: 0,
      end_day: 4,
      duration_days: 5,
      from_node: 'd0_work',
      to_node: 'd5_rest',
      shifts: ['M', 'M', 'D', 'E', 'E'],
      sequence_penalty: 0,
      traversal_order: 1,
    },
    {
      arc_id: 'e_h1',
      arc_type: 'rest',
      start_day: 5,
      end_day: 6,
      duration_days: 2,
      from_node: 'd5_rest',
      to_node: 'd0_work',
      shifts: ['OFF', 'OFF'],
      sequence_penalty: 0,
      traversal_order: 2,
    },
  ];
}

export function makeEmployee(overrides: Partial<EmployeeRecord> = {}): EmployeeRecord {
  return {
    employee_id: 'EMP-001',
    name: 'Marcus Vance',
    role: 'Shift Lead',
    hourly_wage: 18.5,
    max_weekly_hours: 40,
    is_active: true,
    available_days: [0, 1, 2, 3, 4, 5, 6],
    preferred_shifts: ['M', 'D'],
    assigned_line_id: null,
    accommodation_type: 'none',
    ...overrides,
  };
}

/** A complete, valid SolveResponse. Pass overrides to vary one field at a time. */
export function makeSolveResponse(overrides: Partial<SolveResponse> = {}): SolveResponse {
  const coverage = makeCoverage();
  return {
    instance_name: 'Downtown Grocery Store',
    archetype_id: 'downtown_foodmart_omaha',
    instance_size_category: 'Small',
    constrainedness_category: 'Medium',
    total_weekly_staffing_hours: 224,
    feasible_work_sequences_count: 30,
    employee_count: 3,
    active_shift_types_count: 3,
    obj_shift: 380,
    obj_shift_min_bound: 380,
    obj_ergo: 36,
    obj_ergo_sequential_fixed_sd: 43,
    integrated_ergo_gain_pct: 16.3,
    solve_time_ms: 12.5,
    eulerian_valid: true,
    eulerian_cycle_summary: '(Mon, MMDEE) → (Sat, OFF×2)',
    shift_types: makeShiftTypes(),
    multigraph_nodes: makeNodes(),
    multigraph_arcs: makeArcs(),
    roster_lines: [
      makeLine(1, ['M', 'M', 'D', 'E', 'E', 'OFF', 'OFF']),
      // Six work days, so this line carries overtime.
      makeLine(2, ['M', 'M', 'M', 'D', 'D', 'E', 'OFF']),
      // Unassigned: no wage, no payroll. Several views have a branch for this.
      makeLine(3, ['OFF', 'OFF', 'M', 'M', 'D', 'E', 'E'], {
        hourly_wage: null,
        estimated_weekly_payroll: null,
      }),
    ],
    interval_coverage: coverage,
    ergonomics_audit: {
      total_ergo_objective: 36,
      sequential_baseline_ergo: 43,
      ergo_improvement_pct: 16.3,
      health_index_score: 72,
      clopening_violations: 0,
      backward_rotation_violations: 0,
      min_rest_hours_observed: 16,
      full_weekends_off_count: 1,
      full_weekends_off_pct: 33.3,
      consolidated_rest_blocks_pct: 66.7,
      criteria_breakdown: makeCriteria(),
      statutory_accommodation_violations_count: 0,
      fair_workweek_compliant: true,
      mandatory_rest_violations: 0,
    },
    pareto_frontier: makeFrontier(),
    labor_analysis: {
      total_scheduled_hours: 128,
      total_regular_hours: 120,
      total_overtime_hours: 8,
      regular_payroll_cost: 2100,
      overtime_payroll_cost: 210,
      total_payroll_cost: 2310,
      avg_hourly_wage: 17.5,
      hours_per_day: [24, 24, 24, 16, 16, 16, 8],
      cost_per_day: [420, 420, 420, 280, 280, 280, 140],
      overtime_lines_count: 1,
      labor_efficiency_pct: 87.5,
    },
    employees: [],
    ...overrides,
  };
}

export { makeLine, makeCells };
