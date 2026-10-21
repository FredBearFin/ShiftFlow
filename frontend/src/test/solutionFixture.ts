/**
 * A small, fully typed SolveResponse for component tests.
 *
 * Two roster lines, a 7x24 coverage grid with one understaffed hour, and a
 * two-point Pareto frontier: enough for the views to render their real markup
 * without reaching the network.
 */
import type {
  IntervalCoverageCell,
  RosterCell,
  RosterLine,
  SolveResponse,
} from '../types';

const DAY_NAMES = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];

function days(): RosterCell[] {
  return DAY_NAMES.map((dayName, idx) => ({
    day_index: idx,
    day_name: dayName,
    is_weekend: idx >= 5,
    shift_code: idx < 5 ? 'M' : 'OFF',
    shift_type_id: idx < 5 ? 'ST-M-01' : null,
    time_window: idx < 5 ? '08:00-14:00' : '',
    duration_hours: idx < 5 ? 6 : 0,
    rest_hours_before: 18,
    clopening_violation: false,
    backward_rotation_violation: false,
    availability_conflict: false,
  }));
}

function line(n: number, person: string | null): RosterLine {
  return {
    line_number: n,
    cohort_id: `LINE-0${n}`,
    display_label: `Line ${n}`,
    assigned_person: person,
    assigned_employee_id: person ? `EMP-00${n}` : null,
    qualification_tier: 'Frontline Associate',
    hourly_wage: 22.72,
    current_cycle_week: n,
    next_week_line_number: n + 1,
    days: days(),
    weekly_hours: 30,
    regular_hours: 30,
    overtime_hours: 0,
    estimated_weekly_payroll: 681.6,
    work_days_count: 5,
    rest_days_count: 2,
    full_weekend_off: true,
    availability_conflicts_count: 0,
    line_ergo_penalty: 1.5,
  };
}

function coverage(): IntervalCoverageCell[] {
  const cells: IntervalCoverageCell[] = [];
  for (let d = 0; d < 7; d += 1) {
    for (let h = 0; h < 24; h += 1) {
      const required = h >= 8 && h < 14 ? 2 : 0;
      const scheduled = h >= 8 && h < 14 ? (d === 0 && h === 8 ? 1 : 2) : 0;
      cells.push({
        day_index: d,
        day_name: DAY_NAMES[d],
        hour: h,
        hour_label: `${String(h).padStart(2, '0')}:00`,
        required_staff: required,
        scheduled_staff: scheduled,
        understaffing: Math.max(0, required - scheduled),
        overstaffing: Math.max(0, scheduled - required),
        shift_breakdown: {},
      });
    }
  }
  return cells;
}

export const solutionFixture: SolveResponse = {
  instance_name: 'Test Facility',
  archetype_id: 'retail-basic',
  instance_size_category: 'Small',
  constrainedness_category: 'Low',
  total_weekly_staffing_hours: 60,
  feasible_work_sequences_count: 12,
  employee_count: 2,
  active_shift_types_count: 1,
  obj_shift: 120,
  obj_shift_min_bound: 100,
  obj_ergo: 3,
  obj_ergo_sequential_fixed_sd: 5,
  integrated_ergo_gain_pct: 40,
  solve_time_ms: 12,
  eulerian_valid: true,
  eulerian_cycle_summary: 'Balanced',
  shift_types: [
    {
      type_id: 'ST-M-01',
      template_code: 'M',
      template_name: 'Morning',
      start_hour: 8,
      end_hour: 14,
      duration_hours: 6,
      formatted_window: '08:00-14:00',
      active: true,
      daily_counts: [2, 2, 2, 2, 2, 0, 0],
      early_morning_penalty: 0,
      duration_penalty: 0,
    },
  ],
  multigraph_nodes: [],
  multigraph_arcs: [],
  roster_lines: [line(1, 'Alex Morgan'), line(2, null)],
  interval_coverage: coverage(),
  ergonomics_audit: {
    total_ergo_objective: 3,
    sequential_baseline_ergo: 5,
    ergo_improvement_pct: 40,
    health_index_score: 88,
    clopening_violations: 0,
    backward_rotation_violations: 0,
    min_rest_hours_observed: 18,
    full_weekends_off_count: 2,
    full_weekends_off_pct: 100,
    consolidated_rest_blocks_pct: 100,
    criteria_breakdown: [
      {
        criterion_id: 'weekend_work',
        symbol: 'W',
        name: 'Weekend work',
        ideal_range: '0',
        base_weight: 4,
        component_weight_range: '0-4',
        raw_violations_count: 0,
        weighted_penalty: 1.5,
        sequential_baseline_penalty: 3,
        improvement_pct: 50,
        status: 'optimal',
        explanation: 'No weekend work is scheduled.',
      },
    ],
  },
  pareto_frontier: [
    {
      point_index: 0,
      leeway_pct: 0,
      obj_shift: 120,
      obj_ergo: 5,
      ergo_improvement_pct: 0,
      becker_theoretical_improvement_pct: 0,
      employee_count: 2,
      active_shift_types_count: 1,
      total_understaffing_hours: 1,
      total_overstaffing_hours: 0,
      full_weekends_off_pct: 100,
      estimated_weekly_payroll: 1363.2,
      is_knee_point: false,
      is_selected: false,
      label: 'No extra cost',
    },
    {
      point_index: 1,
      leeway_pct: 10,
      obj_shift: 132,
      obj_ergo: 3,
      ergo_improvement_pct: 40,
      becker_theoretical_improvement_pct: 45,
      employee_count: 2,
      active_shift_types_count: 1,
      total_understaffing_hours: 0,
      total_overstaffing_hours: 2,
      full_weekends_off_pct: 100,
      estimated_weekly_payroll: 1499.5,
      is_knee_point: true,
      is_selected: true,
      label: '10% more payroll',
    },
  ],
  labor_analysis: {
    total_scheduled_hours: 60,
    total_regular_hours: 60,
    total_overtime_hours: 0,
    regular_payroll_cost: 1363.2,
    overtime_payroll_cost: 0,
    total_payroll_cost: 1363.2,
    avg_hourly_wage: 22.72,
    hours_per_day: [12, 12, 12, 12, 12, 0, 0],
    cost_per_day: [272.64, 272.64, 272.64, 272.64, 272.64, 0, 0],
    overtime_lines_count: 0,
    labor_efficiency_pct: 98,
  },
  employees: [],
};
