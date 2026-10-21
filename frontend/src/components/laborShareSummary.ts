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

  // Blended wage over priced (assigned, wage-known) hours only - matching the
  // "Blended Average Wage" tile on screen. labor.avg_hourly_wage is not used here:
  // the solver computes it as total regular payroll divided by total scheduled
  // regular hours across every shift pattern, including ones nobody is assigned
  // to yet (unpaid, $0 hours). Early on - most patterns still unassigned - that
  // drags the figure down to a fraction of any real employee's wage, which would
  // mislead an owner reading this summary.
  let wageHours = 0;
  let wageSum = 0;
  for (const l of solution.roster_lines) {
    if (typeof l.hourly_wage === 'number' && typeof l.weekly_hours === 'number') {
      wageHours += l.weekly_hours;
      wageSum += l.hourly_wage * l.weekly_hours;
    }
  }
  const blendedWage = wageHours > 0 ? wageSum / wageHours : null;

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

  if (blendedWage !== null) {
    lines.push(`Blended average wage: $${blendedWage.toFixed(2)}/hr`);
  }

  lines.push(`Staffing: ${solution.employee_count} shift patterns`);

  // Optimized-vs-baseline overtime/payroll comparison, when the solver provided it
  // (a real re-solve of the same demand at 0% leeway — the tightest, least
  // rest-optimized schedule it can build).
  if (typeof labor.overtime_cost_savings_vs_baseline === 'number') {
    const otSavings = labor.overtime_cost_savings_vs_baseline;
    const payrollSavings = labor.payroll_cost_savings_vs_baseline ?? 0;
    lines.push('');
    lines.push('Vs. an unoptimized (0%-leeway) schedule for the same demand:');
    if (otSavings > 0) {
      lines.push(`  Overtime savings: ${money(otSavings)}/week`);
    } else if (otSavings < 0) {
      lines.push(`  Overtime cost vs. baseline: +${money(Math.abs(otSavings))}/week (more OT there avoided here)`);
    } else {
      lines.push('  Overtime: no difference vs. baseline');
    }
    if (payrollSavings !== 0) {
      lines.push(
        `  Total payroll ${payrollSavings > 0 ? 'savings' : 'cost'}: ${money(Math.abs(payrollSavings))}/week`,
      );
    }
  }

  return lines.join('\n');
}
