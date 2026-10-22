import { SolveResponse } from '../types';
import { neutralizeCsvFormula } from '../csvSafety';

/**
 * Lets a manager pin a handful of solved schedules (e.g. different leeway
 * settings tried in the Pareto explorer, or before/after a wizard change) and
 * compare their key numbers side by side, plus export the currently-displayed
 * roster + fairness summary as a CSV.
 *
 * Pure client-side capture over data `ParetoExplorerView` already receives as
 * props (`SolveResponse`) — no new backend endpoint, no new fields invented.
 * Persistence to localStorage follows the same try/catch-wrapped pattern used
 * for `shiftflow.solveConfig` in services/api.ts; it is optional polish, so a
 * blocked or unavailable browser store just means scenarios live for the tab.
 */

/** A snapshot of the key numbers from one solved schedule, kept for comparison. */
export interface ScenarioSnapshot {
  id: string;
  label: string;
  savedAt: number;
  instanceName: string;
  selectedLeewayPct: number;
  employeeCount: number;
  totalPayrollCost: number;
  overtimePayrollCost: number;
  totalOvertimeHours: number;
  laborEfficiencyPct: number;
  ergoObjective: number;
  healthIndexScore: number;
  fullWeekendsOffPct: number;
  clopeningViolations: number;
}

/** Keep comparisons readable — a handful of scenarios, not a growing list. */
export const MAX_SAVED_SCENARIOS = 4;

const STORAGE_KEY = 'shiftflow.paretoScenarios';
const STORAGE_VERSION = 1;

let nextIdSuffix = 0;

/** Builds a snapshot from the solve result + leeway this component already has as props. */
export function buildScenarioSnapshot(
  solution: SolveResponse,
  label: string,
  selectedLeewayPct: number
): ScenarioSnapshot {
  const labor = solution.labor_analysis;
  const ergo = solution.ergonomics_audit;
  nextIdSuffix += 1;
  return {
    id: `${Date.now()}-${nextIdSuffix}`,
    label: label.trim() || `+${selectedLeewayPct}% leeway`,
    savedAt: Date.now(),
    instanceName: solution.instance_name,
    selectedLeewayPct,
    employeeCount: solution.employee_count,
    totalPayrollCost: labor.total_payroll_cost,
    overtimePayrollCost: labor.overtime_payroll_cost,
    totalOvertimeHours: labor.total_overtime_hours,
    laborEfficiencyPct: labor.labor_efficiency_pct,
    ergoObjective: solution.obj_ergo,
    healthIndexScore: ergo.health_index_score,
    fullWeekendsOffPct: ergo.full_weekends_off_pct,
    clopeningViolations: ergo.clopening_violations,
  };
}

function isScenarioSnapshot(v: unknown): v is ScenarioSnapshot {
  if (!v || typeof v !== 'object') return false;
  const s = v as Record<string, unknown>;
  return typeof s.id === 'string' && typeof s.label === 'string' && typeof s.totalPayrollCost === 'number';
}

/** Restores saved scenarios from localStorage. Returns [] on any failure — this is polish, not core state. */
export function loadSavedScenarios(): ScenarioSnapshot[] {
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    if (!parsed || typeof parsed !== 'object' || !Array.isArray(parsed.scenarios)) return [];
    return parsed.scenarios.filter(isScenarioSnapshot).slice(0, MAX_SAVED_SCENARIOS);
  } catch {
    return [];
  }
}

/** Persists saved scenarios to localStorage. Returns false when the browser refuses to store it. */
export function saveSavedScenarios(scenarios: ScenarioSnapshot[]): boolean {
  try {
    window.localStorage.setItem(
      STORAGE_KEY,
      JSON.stringify({ version: STORAGE_VERSION, scenarios })
    );
    return true;
  } catch {
    return false;
  }
}

const csvCell = (v: string | number) => {
  if (typeof v === 'number') return String(v);
  // Ruling 24 (as applied in LaborAnalysisView): quote text fields, don't invent values.
  // Text fields include free text someone chose (assigned_person, qualification_tier,
  // instance_name), so a leading '=' / '+' / '-' / '@' is neutralized before quoting -
  // otherwise it would be read as a live formula by whatever opens this CSV.
  return `"${neutralizeCsvFormula(v).replace(/"/g, '""')}"`;
};

/**
 * Builds a CSV of the currently-displayed roster plus a fairness summary,
 * for a manager to download or hand off. Follows the same client-side CSV pattern as
 * LaborAnalysisView's Gusto/ADP export — two tables in one file, separated by a blank
 * line, since both are small and read fine stacked in a spreadsheet.
 */
export function buildRosterComplianceCsv(solution: SolveResponse): string {
  const rosterHeaders = [
    'Pattern',
    'Assigned Person',
    'Role / Tier',
    'Scheduled Hours',
    'Regular Hours',
    'Overtime Hours',
    'Full Weekend Off',
    'Availability Conflicts',
    'Statutory Accommodation Violation',
    'Fair Workweek Predictability Warning',
  ];
  const rosterRows = solution.roster_lines.map((l) => [
    csvCell(l.display_label || l.cohort_id),
    csvCell(l.assigned_person || ''),
    csvCell(l.qualification_tier),
    csvCell(l.weekly_hours),
    csvCell(l.regular_hours),
    csvCell(l.overtime_hours),
    csvCell(l.full_weekend_off ? 'Yes' : 'No'),
    csvCell(l.availability_conflicts_count),
    csvCell(l.statutory_accommodation_violation ? 'Yes' : 'No'),
    csvCell(l.fair_workweek_predictability_warning ? 'Yes' : 'No'),
  ]);

  const ergo = solution.ergonomics_audit;
  const labor = solution.labor_analysis;
  const complianceHeaders = ['Metric', 'Value'];
  const complianceRows: Array<[string, string | number]> = [
    ['Instance', solution.instance_name],
    ['Shift patterns', solution.employee_count],
    ['Est. weekly payroll ($)', labor.total_payroll_cost.toFixed(2)],
    ['Overtime hours', labor.total_overtime_hours],
    ['Overtime shift patterns', labor.overtime_lines_count],
    ['Coverage (required / scheduled hours, %)', labor.labor_efficiency_pct],
    ['Health index score', ergo.health_index_score],
    ['Full weekends off (%)', ergo.full_weekends_off_pct],
    ['Clopening violations', ergo.clopening_violations],
    ['Backward rotation violations', ergo.backward_rotation_violations],
    ['Min rest hours observed', ergo.min_rest_hours_observed],
  ];
  if (typeof ergo.statutory_accommodation_violations_count === 'number') {
    complianceRows.push(['Statutory accommodation violations', ergo.statutory_accommodation_violations_count]);
  }
  if (typeof ergo.mandatory_rest_violations === 'number') {
    complianceRows.push(['Mandatory rest violations', ergo.mandatory_rest_violations]);
  }
  if (typeof ergo.fair_workweek_compliant === 'boolean') {
    complianceRows.push(['Fair Workweek check', ergo.fair_workweek_compliant ? 'Yes' : 'No']);
  }

  const rosterCsv = [rosterHeaders.map(csvCell).join(','), ...rosterRows.map((r) => r.join(','))].join('\n');
  const complianceCsv = [
    complianceHeaders.map(csvCell).join(','),
    ...complianceRows.map(([k, v]) => [csvCell(k), csvCell(v)].join(',')),
  ].join('\n');

  return `${rosterCsv}\n\n${complianceCsv}\n`;
}
