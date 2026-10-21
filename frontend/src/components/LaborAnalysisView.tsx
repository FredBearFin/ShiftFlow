import React, { useState } from 'react';
import { SolveResponse } from '../types';
import { DAYS_OF_WEEK } from '../services/api';
import { Button } from './ui/Button';
import { Term } from './ui/Term';
import { POSIntegrationView } from './POSIntegrationView';
import { buildOwnerShareSummary } from './laborShareSummary';
import { csvSafeCell } from '../csvSafety';

// POS integration is a module from an earlier, broader "enterprise workforce OS" phase -
// kept working (and its backend route still exists behind its own default-off flag), but
// outside the V1 happy path for independent retail/food-service managers. Flip this back on
// once that funnel is actually being sold. Keeping the entry point wired, just not rendered,
// means this is a one-line change rather than re-plumbing it later.
const POS_INTEGRATION_ENABLED_IN_UI = false;

interface LaborAnalysisViewProps {
  solution: SolveResponse;
  facilityId?: string;
  onDemandUpdated?: (newDemand: number[][]) => void;
}

const isNum = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v);

export const LaborAnalysisView: React.FC<LaborAnalysisViewProps> = ({
  solution,
  facilityId,
  onDemandUpdated,
}) => {
  const labor = solution.labor_analysis;
  const maxDayCost = Math.max(...labor.cost_per_day, 100);

  // Real re-solve comparison vs. the 0%-leeway (tightest, least rest-optimized) version of
  // this same schedule. Older cached solutions may not carry these fields yet (additive/optional).
  const hasBaselineCompare = typeof labor.overtime_cost_savings_vs_baseline === 'number';
  const otCostSavings = labor.overtime_cost_savings_vs_baseline ?? 0;
  const payrollCostSavings = labor.payroll_cost_savings_vs_baseline ?? 0;
  const baselineTotalPayroll = labor.baseline_total_payroll_cost ?? labor.total_payroll_cost;
  const [downloadMsg, setDownloadMsg] = useState<string | null>(null);
  const [showPosUpload, setShowPosUpload] = useState(false);
  const [shareMsg, setShareMsg] = useState<string | null>(null);

  // A line is priced when it carries a numeric estimated payroll and a numeric hours value.
  const pricedLines = solution.roster_lines.filter(
    (l) => isNum(l.estimated_weekly_payroll) && isNum(l.weekly_hours),
  );
  const unpricedCount = solution.roster_lines.length - pricedLines.length;

  // Blended wage: hours-weighted base wage over priced hours only.
  let wageHours = 0;
  let wageSum = 0;
  for (const l of pricedLines) {
    if (isNum(l.hourly_wage)) {
      wageHours += l.weekly_hours;
      wageSum += l.hourly_wage * l.weekly_hours;
    }
  }
  const avgWage = wageHours > 0 ? wageSum / wageHours : null;

  // Overtime premium: the extra 0.5x above base, only where OT hours and wage are both present.
  const overtimePremiumByLine = new Map<string, number>();
  let overtimePremiumTotal = 0;
  for (const l of solution.roster_lines) {
    if (isNum(l.overtime_hours) && l.overtime_hours > 0 && isNum(l.hourly_wage)) {
      const premium = 0.5 * l.overtime_hours * l.hourly_wage;
      overtimePremiumByLine.set(l.cohort_id, premium);
      overtimePremiumTotal += premium;
    }
  }

  const unpricedBadge = unpricedCount > 0 ? (
    <span className="text-xs font-semibold text-[#2B3A42] bg-[#E4E9EC] border border-[#7F8A92] px-2 py-0.5 rounded before:content-[''] before:inline-block before:w-2 before:h-2 before:rounded-full before:bg-[#C28B47] before:mr-1.5 before:align-middle">
      {unpricedCount} {unpricedCount === 1 ? 'line' : 'lines'} unpriced
    </span>
  ) : null;

  const handleDownloadGusto = () => {
    // Generate RFC-4180 Gusto CSV client-side for immediate download
    const headers = [
      'Employee ID',
      'Employee Name',
      'Role',
      'Regular Hours',
      'Overtime Hours',
      'Hourly Wage',
      'Estimated payroll ($)',
      'Notes',
    ];
    // Ruling 24: no invented value. A field the solution does not carry is left empty.
    // assigned_person/qualification_tier are free text an employee or manager chose, so
    // they go through csvSafeCell (not a bare quote-wrap, which left an embedded quote
    // or comma able to break out of the cell): it both escapes RFC-4180-style and
    // neutralizes a leading '=' / '+' / '-' / '@' so it can't be read as a formula.
    const rows = solution.roster_lines.map((l) => [
      l.assigned_employee_id || '',
      csvSafeCell(l.assigned_person || ''),
      csvSafeCell(l.qualification_tier || ''),
      l.regular_hours.toFixed(2),
      l.overtime_hours.toFixed(2),
      l.hourly_wage === null ? '' : l.hourly_wage.toFixed(2),
      l.estimated_weekly_payroll === null ? '' : l.estimated_weekly_payroll.toFixed(2),
      '',
    ]);

    const csvContent = [headers.join(','), ...rows.map((r) => r.join(','))].join('\n');
    const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.setAttribute('download', `gusto_payroll_${solution.archetype_id}_wk.csv`);
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    setDownloadMsg('Gusto Payroll CSV downloaded successfully!');
    setTimeout(() => setDownloadMsg(null), 3000);
  };

  const handleDownloadAdp = () => {
    // Ruling 24: the solution carries no company code, batch ID or pay code.
    // Those columns keep their place with empty cells, and no literal is written.
    const headers = [
      'Co Code',
      'Batch ID',
      'File #',
      'Employee Name',
      'Reg Hours',
      'O/T Hours',
      'Hourly Rate',
      'Shift Pay Code',
      'Gross Amount',
    ];
    const rows = solution.roster_lines.map((l) => [
      '',
      '',
      l.assigned_employee_id || '',
      csvSafeCell(l.assigned_person || ''),
      l.regular_hours.toFixed(2),
      l.overtime_hours.toFixed(2),
      l.hourly_wage === null ? '' : l.hourly_wage.toFixed(2),
      '',
      l.estimated_weekly_payroll === null ? '' : l.estimated_weekly_payroll.toFixed(2),
    ]);

    const csvContent = [headers.join(','), ...rows.map((r) => r.join(','))].join('\n');
    const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.setAttribute('download', `adp_payroll_${solution.archetype_id}_batch.csv`);
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    setDownloadMsg('ADP Workforce Now CSV downloaded successfully!');
    setTimeout(() => setDownloadMsg(null), 3000);
  };

  // "Share with owner": copy the key numbers already on screen as plain text, so a
  // manager can hand them to the business owner (email, text, Slack, whatever they use).
  // Pure client-side formatting over existing props — nothing new is fetched or stored.
  const handleCopyOwnerSummary = async () => {
    const summary = buildOwnerShareSummary(solution);
    try {
      await navigator.clipboard.writeText(summary);
      setShareMsg('Summary copied — paste it to your owner.');
    } catch {
      setShareMsg('Could not copy automatically. Try "Print Audit" instead.');
    }
    setTimeout(() => setShareMsg(null), 3000);
  };

  // The solver echoes back the staffing table it was given as interval_coverage's
  // required_staff, so the POS view can show what an import would replace.
  const currentDemandMatrix = React.useMemo(() => {
    const matrix: number[][] = Array.from({ length: 7 }, () => Array(24).fill(0));
    for (const cell of solution.interval_coverage) {
      if (cell.day_index >= 0 && cell.day_index < 7 && cell.hour >= 0 && cell.hour < 24) {
        matrix[cell.day_index][cell.hour] = cell.required_staff;
      }
    }
    return matrix;
  }, [solution.interval_coverage]);

  return (
    <div className="space-y-5">
      {/* Action Header with Export Buttons */}
      <div className="card p-5 bg-white flex flex-wrap items-center justify-between gap-4">
        <div>
          <span className="text-xs font-bold uppercase tracking-wider text-[#5C6770] block">
            Payroll & Cost Analytics
          </span>
          <h2 className="text-base font-bold text-slate-900 mt-0.5">
            Store Labor Spend & 1-Click Payroll Integration
          </h2>
          <p className="text-xs text-slate-500 mt-0.5">
            Real-time calculation distinguishing regular base wages from 1.5× overtime exposure with 1-click Gusto/ADP export.
          </p>
        </div>

        <div className="flex items-center gap-2">
          {downloadMsg && (
            <span className="text-xs font-semibold text-emerald-700 bg-emerald-50 border border-emerald-200 px-3 py-1.5 rounded-lg">
              ✓ {downloadMsg}
            </span>
          )}
          {shareMsg && (
            <span className="text-xs font-semibold text-emerald-700 bg-emerald-50 border border-emerald-200 px-3 py-1.5 rounded-lg">
              ✓ {shareMsg}
            </span>
          )}
          <Button
            variant="primary"
            onClick={handleDownloadGusto}
            className="font-bold"
          >
            <span>↓ Gusto CSV</span>
          </Button>
          <Button
            variant="primary"
            onClick={handleDownloadAdp}
            className="font-bold"
          >
            <span>↓ ADP CSV</span>
          </Button>
          <Button
            variant="secondary"
            onClick={handleCopyOwnerSummary}
          >
            Copy summary for owner
          </Button>
          <Button
            variant="secondary"
            onClick={() => window.print()}
          >
            Print Audit
          </Button>
          {facilityId && POS_INTEGRATION_ENABLED_IN_UI && (
            <Button variant="secondary" onClick={() => setShowPosUpload((v) => !v)}>
              {showPosUpload ? 'Hide POS upload' : 'Update demand from POS data'}
            </Button>
          )}
        </div>
      </div>

      {facilityId && POS_INTEGRATION_ENABLED_IN_UI && showPosUpload && (
        <POSIntegrationView
          facilityId={facilityId}
          currentDemandMatrix={currentDemandMatrix}
          onDemandUpdated={onDemandUpdated}
        />
      )}

      {/* Optimized-vs-baseline overtime savings callout */}
      {hasBaselineCompare && (
        <div
          className={`card p-5 border-2 ${
            otCostSavings > 0
              ? 'border-emerald-300 bg-emerald-50/60'
              : otCostSavings < 0
              ? 'border-amber-300 bg-amber-50/50'
              : 'border-slate-200 bg-slate-50'
          }`}
        >
          <span className="text-xs font-bold uppercase tracking-wider text-slate-500 block">
            Optimized vs. unoptimized schedule
          </span>
          {otCostSavings > 0 ? (
            <p className="text-sm text-slate-800 mt-1">
              You're saving approximately{' '}
              <strong className="text-emerald-700 font-mono-tabular">${otCostSavings.toFixed(2)}/week</strong>{' '}
              in overtime pay compared with the tightest, least rest-optimized schedule this tool
              can build for the same demand ({labor.baseline_overtime_hours ?? 0}h of OT there vs.{' '}
              {labor.total_overtime_hours}h here).
            </p>
          ) : otCostSavings < 0 ? (
            <p className="text-sm text-slate-800 mt-1">
              This rest-optimized schedule costs about{' '}
              <strong className="text-amber-800 font-mono-tabular">${Math.abs(otCostSavings).toFixed(2)}/week</strong>{' '}
              more in overtime than the tightest, least rest-optimized version of this same demand —
              the extra staff used to protect rest and spread the workload shows up here as more
              overtime, not less.
            </p>
          ) : (
            <p className="text-sm text-slate-800 mt-1">
              No overtime difference to report: this schedule's overtime already matches the
              tightest, least rest-optimized version this tool can build for the same demand.
            </p>
          )}
          <p className="text-xs text-slate-500 mt-1.5">
            Total estimated weekly payroll vs. that same baseline: ${labor.total_payroll_cost.toFixed(2)} here vs. $
            {baselineTotalPayroll.toFixed(2)} baseline
            {payrollCostSavings !== 0 && (
              <>
                {' '}({payrollCostSavings > 0 ? 'saving' : 'costing'} $
                {Math.abs(payrollCostSavings).toFixed(2)}/week)
              </>
            )}
            . Both numbers come from real, independently solved schedules — not an estimate.
          </p>
        </div>
      )}

      {/* Top Payroll & Hours Economics KPI Banner */}
      <div className="grid grid-cols-2 lg:grid-cols-5 gap-3.5">
        <div className="card p-4">
          <span className="text-xs font-semibold uppercase tracking-wider text-slate-500 block">
            Est. Weekly Payroll
          </span>
          <div className="flex items-baseline justify-between mt-1">
            <span className="text-2xl font-bold font-mono-tabular text-slate-900">
              ${labor.total_payroll_cost.toLocaleString('en-US', { minimumFractionDigits: 2 })}
            </span>
          </div>
          <p className="text-xs text-slate-500 mt-1">
            Est. base: ${labor.regular_payroll_cost.toFixed(2)}
          </p>
          {unpricedBadge && <div className="mt-1.5">{unpricedBadge}</div>}
        </div>

        <div className="card p-4">
          <span className="text-xs font-semibold uppercase tracking-wider text-slate-500 block">
            Scheduled Labor Hours
          </span>
          <div className="flex items-baseline justify-between mt-1">
            <span className="text-2xl font-bold font-mono-tabular text-slate-900">
              {labor.total_scheduled_hours} hrs
            </span>
            <span className="text-xs font-mono-tabular text-slate-500">
              {solution.employee_count} Shift Patterns
            </span>
          </div>
          <p className="text-xs text-slate-500 mt-1">
            Reg: {labor.total_regular_hours}h • OT: {labor.total_overtime_hours}h
          </p>
        </div>

        <div className="card p-4">
          <span className="text-xs font-semibold uppercase tracking-wider text-slate-500 block">
            Overtime Exposure
          </span>
          <div className="flex items-baseline justify-between mt-1">
            <span className={`text-2xl font-bold font-mono-tabular ${labor.total_overtime_hours > 0 ? 'text-amber-700' : 'text-emerald-700'}`}>
              ${labor.overtime_payroll_cost.toFixed(2)}
            </span>
            <span className={`px-2 py-0.5 rounded text-xs font-semibold ${labor.overtime_lines_count > 0 ? 'bg-amber-50 text-amber-800 border border-amber-200' : 'bg-emerald-50 text-emerald-700 border border-emerald-200'}`}>
              {labor.overtime_lines_count > 0 ? `${labor.overtime_lines_count} OT Lines` : '0 OT Risk'}
            </span>
          </div>
          <p className="text-xs text-slate-500 mt-1">
            1.5× rate applied over 40h/line
          </p>
          {overtimePremiumByLine.size > 0 && (
            <p className="text-xs text-slate-500 mt-0.5">
              Overtime premium (extra 0.5x): ${overtimePremiumTotal.toFixed(2)}
            </p>
          )}
        </div>

        <div className="card p-4">
          <span className="text-xs font-semibold uppercase tracking-wider text-slate-500 block">
            Blended Average Wage
          </span>
          <div className="flex items-baseline justify-between mt-1">
            <span
              className={
                avgWage === null
                  ? 'text-sm italic text-slate-500'
                  : 'text-2xl font-bold font-mono-tabular text-slate-900'
              }
            >
              {avgWage === null ? 'No staff priced yet' : `$${avgWage.toFixed(2)}/hr`}
            </span>
          </div>
          <p className="text-xs text-slate-500 mt-1">
            Across priced personnel hours
          </p>
        </div>

        <div className="card p-4 col-span-2 lg:col-span-1">
          <span className="text-xs font-semibold uppercase tracking-wider text-slate-500 block">
            Required ÷ scheduled hours
          </span>
          <div className="flex items-baseline justify-between mt-1">
            <span className="text-2xl font-bold font-mono-tabular text-indigo-700">
              {labor.labor_efficiency_pct}%
            </span>
            <span className="text-xs text-slate-500">Coverage</span>
          </div>
          <p className="text-xs text-slate-500 mt-1">Above 100% means scheduled hours fall short of required hours{" "}
            Floor requirements vs hours paid
          </p>
        </div>
      </div>

      {/* Daily Labor Cost & Hours Distribution */}
      <div className="card p-5">
        <div className="flex items-center justify-between mb-4">
          <div>
            <h3 className="text-xs font-bold uppercase tracking-wider text-slate-700">
              Daily Payroll Spend & Scheduled Hours (Monday – Sunday)
            </h3>
            <p className="text-xs text-slate-500 mt-0.5">
              Tracks daily labor expenditure matching store demand and customer rush patterns.
            </p>
            <p className="text-xs text-slate-500 mt-0.5">
              Allocated pro rata from each line's estimated payroll.
            </p>
          </div>
          <div className="flex items-center gap-2">
            {unpricedBadge}
            <span className="text-xs font-mono-tabular text-slate-600 bg-slate-100 px-3 py-1 rounded-md">
              Est. Weekly Spend: ${labor.total_payroll_cost.toFixed(2)}
            </span>
          </div>
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-7 gap-3">
          {DAYS_OF_WEEK.map((dayName, idx) => {
            const cost = labor.cost_per_day[idx] || 0;
            const hours = labor.hours_per_day[idx] || 0;
            const barPct = Math.min(100, Math.max(15, (cost / maxDayCost) * 100));
            const isWeekend = idx >= 5;
            return (
              <div
                key={dayName}
                className={`p-3 rounded-lg border flex flex-col justify-between ${
                  isWeekend
                    ? 'bg-slate-100/70 border-[#7F8A92]'
                    : 'bg-slate-50 border-[#7F8A92]'
                }`}
              >
                <div>
                  <div className="flex items-center justify-between">
                    <span className="text-xs font-bold text-slate-900">{dayName}</span>
                    <span className="text-xs font-mono-tabular text-slate-500">
                      {hours} hrs
                    </span>
                  </div>
                  <span className="text-xs text-slate-500 block mt-1">Allocated daily spend</span>
                  <div className="text-base font-bold font-mono-tabular text-slate-900">
                    ${cost.toFixed(2)}
                  </div>
                </div>

                <div className="mt-3">
                  <div className="w-full bg-slate-200 rounded-full h-2 overflow-hidden">
                    <div
                      className={`h-2 rounded-full ${
                        isWeekend ? 'bg-indigo-600' : 'bg-slate-700'
                      }`}
                      style={{ width: `${barPct}%` }}
                    />
                  </div>
                  <span className="text-xs text-slate-500 mt-1 block text-right font-mono-tabular">
                    {hours > 0 ? `$${(cost / hours).toFixed(2)}/hr` : '—'}
                  </span>
                </div>
              </div>
            );
          })}
        </div>
      </div>

      {/* Shift Pattern Payroll Table */}
      <div className="card overflow-hidden">
        <div className="p-4 sm:px-6 border-b border-slate-200 bg-white">
          <h3 className="text-xs font-bold uppercase tracking-wider text-slate-700">
            Payroll & Overtime Breakdown
          </h3>
          <p className="text-xs text-slate-500 mt-0.5">
            Hours, wage rates, and estimated weekly earnings for each shift pattern.
          </p>
        </div>

        <div className="overflow-x-auto">
          <table className="w-full text-left border-collapse text-xs">
            <thead>
              <tr className="bg-slate-50 border-b border-slate-200 text-xs font-bold uppercase tracking-wider text-slate-500">
                <th className="py-3 px-4">Pattern</th>
                <th className="py-3 px-4">Assigned Personnel</th>
                <th className="py-3 px-3">
                  <Term explanation="The pay and skill band this shift pattern is costed at. It is also what appears as the Role in the payroll file you export, so &quot;Standard Rate&quot; means the ordinary rate for the job, with nothing added for extra skills or seniority.">
                    Role / Tier
                  </Term>
                </th>
                <th className="py-3 px-3 text-right">Wage Rate</th>
                <th className="py-3 px-3 text-right">Scheduled</th>
                <th className="py-3 px-3 text-right">Regular</th>
                <th className="py-3 px-3 text-right">Overtime</th>
                <th className="py-3 px-4 text-right">Est. Weekly Payroll</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-200 font-mono-tabular">
              {solution.roster_lines.map((line) => (
                <tr key={line.cohort_id} className="hover:bg-slate-50/80">
                  <td className="py-3 px-4 font-bold text-slate-900">
                    {line.cohort_id}
                  </td>
                  <td className="py-3 px-4 font-sans font-semibold text-slate-900">
                    {line.assigned_person || (
                      <span className="text-slate-500 italic font-normal">
                        Unassigned shift pattern
                      </span>
                    )}
                  </td>
                  <td className="py-3 px-3 font-sans text-slate-600">
                    {line.qualification_tier}
                  </td>
                  <td className="py-3 px-3 text-right text-slate-700">
                    {line.hourly_wage === null ? '' : `$${line.hourly_wage.toFixed(2)}/hr`}
                  </td>
                  <td className="py-3 px-3 text-right font-bold text-slate-900">
                    {line.weekly_hours}h
                  </td>
                  <td className="py-3 px-3 text-right text-slate-600">
                    {line.regular_hours}h
                  </td>
                  <td className="py-3 px-3 text-right">
                    {line.overtime_hours > 0 ? (
                      <>
                        <span className="px-1.5 py-0.5 rounded text-xs font-bold bg-amber-50 text-amber-800 border border-amber-200">
                          +{line.overtime_hours}h OT
                        </span>
                        {overtimePremiumByLine.has(line.cohort_id) && (
                          <span className="block text-xs text-amber-800 mt-0.5">
                            premium +${overtimePremiumByLine.get(line.cohort_id)!.toFixed(2)}
                          </span>
                        )}
                      </>
                    ) : (
                      <span className="text-slate-500">0h</span>
                    )}
                  </td>
                  <td className="py-3 px-4 text-right font-bold text-slate-900">
                    {line.estimated_weekly_payroll === null ? '' : `$${line.estimated_weekly_payroll.toFixed(2)}`}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
};
