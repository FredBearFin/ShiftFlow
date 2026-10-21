import { SolveResponse } from '../types';

/**
 * Builds a short, plain-text labor-cost summary from data the Labor Analysis
 * view already has on screen, for a manager to hand to the business owner.
 *
 * Pure client-side formatting only — no new fields, no network calls. Every
 * number here comes straight off `solution.labor_analysis` / `solution`, the
 * same props LaborAnalysisView already renders.
 */
export function buildOwnerShareSummary(solution: SolveResponse): string {
  const labor = solution.labor_analysis;
  const money = (n: number) =>
    `$${n.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

  const lines: string[] = [
    `Labor cost summary — ${solution.instance_name}`,
    '',
    `Estimated weekly payroll: ${money(labor.total_payroll_cost)}`,
    `  Regular: ${money(labor.regular_payroll_cost)}`,
    `  Overtime: ${money(labor.overtime_payroll_cost)}`,
    `Scheduled hours: ${labor.total_scheduled_hours}h (Regular ${labor.total_regular_hours}h / OT ${labor.total_overtime_hours}h)`,
    `Overtime shift patterns: ${labor.overtime_lines_count}`,
    `Coverage (required ÷ scheduled hours): ${labor.labor_efficiency_pct}%`,
  ];

  if (labor.avg_hourly_wage !== null) {
    lines.push(`Blended average wage: $${labor.avg_hourly_wage.toFixed(2)}/hr`);
  }

  lines.push(`Staffing: ${solution.employee_count} shift patterns`);

  return lines.join('\n');
}
