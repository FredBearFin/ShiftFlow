/**
 * Builds a complete SolveResponse for tests, so a test only has to state the
 * fields it actually cares about.
 */
import type {
  ErgonomicCriterionBreakdown,
  IntervalCoverageCell,
  ParetoPoint,
  MultigraphNode,
  RosterCell,
  RosterLine,
  ShiftOrOffCode,
  SolveResponse,
} from '../types';

const DAY_NAMES = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];

function makeDays(codes: ShiftOrOffCode[]): RosterCell[] {
  return codes.map((code, dayIndex) => ({
    day_index: dayIndex,
    day_name: DAY_NAMES[dayIndex],
    is_weekend: dayIndex >= 5,
    shift_code: code,
    shift_type_id: code === 'OFF' ? null : `ST-${code}`,
    time_window: code === 'OFF' ? 'Rest / Off' : '06:00 – 14:00',
    duration_hours: code === 'OFF' ? 0 : 8,
    rest_hours_before: 16,
    clopening_violation: false,
    backward_rotation_violation: false,
    availability_conflict: false,
    statutory_accommodation_conflict: false,
  }));
}

export function makeRosterLine(lineNumber: number, overrides: Partial<RosterLine> = {}): RosterLine {
  const codes: ShiftOrOffCode[] = ['M', 'M', 'M', 'M', 'M', 'OFF', 'OFF'];
  return {
    line_number: lineNumber,
    cohort_id: `PATTERN-${String(lineNumber).padStart(2, '0')}`,
    display_label: `Rotation Line ${lineNumber}`,
    assigned_person: null,
    assigned_employee_id: null,
    qualification_tier: 'Union Line Standard',
    hourly_wage: null,
    current_cycle_week: lineNumber,
    next_week_line_number: lineNumber,
    days: makeDays(codes),
    weekly_hours: 40,
    regular_hours: 40,
    overtime_hours: 0,
    estimated_weekly_payroll: null,
    work_days_count: 5,
    rest_days_count: 2,
    full_weekend_off: true,
    availability_conflicts_count: 0,
    line_ergo_penalty: 0,
    statutory_accommodation_violation: false,
    fair_workweek_predictability_warning: false,
    ...overrides,
  };
}

function makeCriterion(id: string): ErgonomicCriterionBreakdown {
  return {
    criterion_id: id,
    symbol: id,
    name: id,
    ideal_range: '0',
    base_weight: 1,
    component_weight_range: '0–1',
    raw_violations_count: 0,
    weighted_penalty: 1,
    sequential_baseline_penalty: 2,
    improvement_pct: 50,
    status: 'optimal',
    explanation: 'Test criterion',
  };
}

function makeCoverage(understaffPerCell: number): IntervalCoverageCell[] {
  const cells: IntervalCoverageCell[] = [];
  for (let day = 0; day < 7; day++) {
    for (let hour = 0; hour < 24; hour++) {
      cells.push({
        day_index: day,
        day_name: DAY_NAMES[day],
        hour,
        hour_label: `${hour}:00`,
        required_staff: 2,
        scheduled_staff: 2 - understaffPerCell,
        understaffing: understaffPerCell,
        overstaffing: 0,
        shift_breakdown: {},
      });
    }
  }
  return cells;
}

function makeNodes(): MultigraphNode[] {
  const nodes: MultigraphNode[] = [];
  for (let day = 0; day < 7; day++) {
    for (const nodeType of ['work', 'rest'] as const) {
      nodes.push({
        node_id: `${nodeType}-${day}`,
        day_index: day,
        day_name: DAY_NAMES[day],
        node_type: nodeType,
        in_degree: 1,
        out_degree: 1,
        is_balanced: true,
      });
    }
  }
  return nodes;
}

export interface FixtureOptions {
  lineCount?: number;
  pricedLineCount?: number;
  wage?: number;
  understaffPerCell?: number;
  solution?: Partial<SolveResponse>;
}

export function makeSolution(opts: FixtureOptions = {}): SolveResponse {
  const lineCount = opts.lineCount ?? 2;
  const pricedLineCount = opts.pricedLineCount ?? lineCount;
  const wage = opts.wage ?? 18;

  const roster_lines = Array.from({ length: lineCount }, (_, idx) => {
    const priced = idx < pricedLineCount;
    return makeRosterLine(idx + 1, {
      assigned_person: priced ? `Staff ${idx + 1}` : null,
      assigned_employee_id: priced ? `EMP-${idx + 1}` : null,
      hourly_wage: priced ? wage : null,
      estimated_weekly_payroll: priced ? 40 * wage : null,
      next_week_line_number: ((idx + 1) % lineCount) + 1,
    });
  });

  const totalPayroll = pricedLineCount * 40 * wage;

  return {
    instance_name: 'Test Facility',
    archetype_id: 'test_archetype',
    instance_size_category: 'Small',
    constrainedness_category: 'Medium',
    total_weekly_staffing_hours: lineCount * 40,
    feasible_work_sequences_count: 10,
    employee_count: lineCount,
    active_shift_types_count: 1,
    obj_shift: 10,
    obj_shift_min_bound: 10,
    obj_ergo: 12.5,
    obj_ergo_sequential_fixed_sd: 25,
    integrated_ergo_gain_pct: 50,
    solve_time_ms: 42,
    eulerian_valid: true,
    eulerian_cycle_summary: 'Valid',
    shift_types: [],
    multigraph_nodes: makeNodes(),
    multigraph_arcs: [],
    roster_lines,
    interval_coverage: makeCoverage(opts.understaffPerCell ?? 0),
    ergonomics_audit: {
      total_ergo_objective: 12.5,
      sequential_baseline_ergo: 25,
      ergo_improvement_pct: 50,
      health_index_score: 90.9,
      clopening_violations: 0,
      backward_rotation_violations: 0,
      min_rest_hours_observed: 16,
      full_weekends_off_count: lineCount,
      full_weekends_off_pct: 100,
      consolidated_rest_blocks_pct: 100,
      criteria_breakdown: ['weekend_work', 'shift_duration'].map(makeCriterion),
      statutory_accommodation_violations_count: 0,
      fair_workweek_compliant: undefined,
      mandatory_rest_violations: 0,
    },
    pareto_frontier: [],
    labor_analysis: {
      total_scheduled_hours: lineCount * 40,
      total_regular_hours: lineCount * 40,
      total_overtime_hours: 0,
      regular_payroll_cost: totalPayroll,
      overtime_payroll_cost: 0,
      total_payroll_cost: totalPayroll,
      avg_hourly_wage: pricedLineCount > 0 ? wage : null,
      hours_per_day: [8, 8, 8, 8, 8, 0, 0].map((h) => h * pricedLineCount),
      cost_per_day: [8, 8, 8, 8, 8, 0, 0].map((h) => h * pricedLineCount * wage),
      overtime_lines_count: 0,
      labor_efficiency_pct: 95.3,
    },
    employees: [],
    ...opts.solution,
  };
}

/**
 * A ready-made solution for tests that need a realistic response and do not care
 * about its particulars. Tests that need to vary the shape call makeSolution().
 *
 * It deliberately carries the three things the accessibility tests need a view to
 * actually render: some understaffed hours (so the coverage summary has something
 * to announce), a couple of closed hours (so the heatmap paints its closed-cell
 * style), and a two-point Pareto frontier (so the explorer renders its Apply
 * controls). makeSolution()'s bare defaults have none of those.
 */
function paretoPoint(index: number, leeway: number, selected: boolean): ParetoPoint {
  return {
    point_index: index,
    leeway_pct: leeway,
    obj_shift: 100 + index,
    obj_ergo: 180 - index * 60,
    ergo_improvement_pct: index * 25,
    becker_theoretical_improvement_pct: index * 25,
    employee_count: 12 + index,
    active_shift_types_count: 3,
    total_understaffing_hours: index === 0 ? 102 : 60,
    total_overstaffing_hours: 0,
    full_weekends_off_pct: 25 + index * 40,
    estimated_weekly_payroll: 720,
    is_knee_point: index === 1,
    is_selected: selected,
    label: index === 0 ? 'No extra flexibility' : `+${leeway}% flexibility`,
  };
}

export const solutionFixture: SolveResponse = makeSolution({
  understaffPerCell: 1,
  solution: {
    pareto_frontier: [paretoPoint(0, 0, true), paretoPoint(1, 10, false)],
  },
});

// Two closed hours (nothing required, nobody scheduled) so the heatmap has
// closed cells to style; makeCoverage gives every hour a requirement of 2.
for (const hour of [0, 1]) {
  const cell = solutionFixture.interval_coverage[hour];
  cell.required_staff = 0;
  cell.scheduled_staff = 0;
  cell.understaffing = 0;
}
