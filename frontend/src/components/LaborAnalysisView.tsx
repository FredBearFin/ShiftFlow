import React, { useState } from 'react';
import { SolveResponse, RosterLine } from '../types';
import { DAYS_OF_WEEK } from '../services/api';
import { formatCurrency, formatHourlyRate } from '../utils/format';
import { Button } from './ui/Button';
import { Term } from './ui/Term';
import { POSIntegrationView } from './POSIntegrationView';

interface LaborAnalysisViewProps {
  solution: SolveResponse;
  facilityId?: string;
  onDemandUpdated?: (newDemand: number[][]) => void;
}

const isNum = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v);

/** RFC-4180 cell. The old builders wrapped names in bare quotes, which corrupted any name containing one. */
const csvCell = (v: string | null | undefined): string => {
  const s = v ?? '';
  return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
};

/** A rotation line is staffed only when a real person is on it. */
const isStaffed = (l: RosterLine): boolean => Boolean(l.assigned_person && l.assigned_person.trim() !== '');

/** One payable person, with the hours of every line they hold folded together. */
export interface PayrollPerson {
  employeeId: string;
  name: string;
  role: string;
  regularHours: number;
  overtimeHours: number;
  hourlyWage: number | null;
  estimatedPayroll: number | null;
  note: string;
  lineNumbers: number[];
}

/**
 * Collapses the roster into one row per assigned employee.
 *
 * Unstaffed lines are dropped rather than exported with a blank employee ID,
 * and a person holding more than one line is summed into a single row instead
 * of appearing twice, which a payroll system would read as two paychecks.
 */
export function buildPayrollPeople(lines: RosterLine[]): PayrollPerson[] {
  const byPerson = new Map<string, PayrollPerson>();
  for (const l of lines) {
    if (!isStaffed(l)) continue;
    const name = (l.assigned_person as string).trim();
    const key = l.assigned_employee_id || `name:${name}`;
    const existing = byPerson.get(key);
    const regular = isNum(l.regular_hours) ? l.regular_hours : 0;
    const overtime = isNum(l.overtime_hours) ? l.overtime_hours : 0;
    const payroll = isNum(l.estimated_weekly_payroll) ? l.estimated_weekly_payroll : null;
    const wage = isNum(l.hourly_wage) ? l.hourly_wage : null;
    if (!existing) {
      byPerson.set(key, {
        employeeId: l.assigned_employee_id || '',
        name,
        role: l.qualification_tier || '',
        regularHours: regular,
        overtimeHours: overtime,
        hourlyWage: wage,
        estimatedPayroll: payroll,
        note: '',
        lineNumbers: [l.line_number],
      });
      continue;
    }
    existing.regularHours += regular;
    existing.overtimeHours += overtime;
    existing.estimatedPayroll =
      payroll === null && existing.estimatedPayroll === null
        ? null
        : (existing.estimatedPayroll ?? 0) + (payroll ?? 0);
    // Two lines at different rates have no single hourly rate. Leave it empty
    // rather than publishing one of the two as if it covered both.
    if (existing.hourlyWage !== wage) existing.hourlyWage = null;
    existing.lineNumbers.push(l.line_number);
    existing.note = `Hours combined from rotation lines ${existing.lineNumbers.join(' + ')}`;
  }
  return [...byPerson.values()];
}

export const LaborAnalysisView: React.FC<LaborAnalysisViewProps> = ({
  solution,
  facilityId,
  onDemandUpdated,
}) => {
  const labor = solution.labor_analysis;
  const maxDayCost = Math.max(...labor.cost_per_day, 100);

  // labor_efficiency_pct is a ratio of hour totals and is blind to *when* the hours
  // fall, so it cannot stand in for coverage. The hour-by-hour shortfall can.
  const uncoveredHours = solution.interval_coverage.reduce((a, c) => a + c.understaffing, 0);
  const [downloadMsg, setDownloadMsg] = useState<string | null>(null);
  const [exportError, setExportError] = useState<string | null>(null);
  const [showPosUpload, setShowPosUpload] = useState(false);

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
    <span className="text-xs font-semibold text-ink bg-surface-sunken border border-border-control px-2 py-0.5 rounded before:content-[''] before:inline-block before:w-2 before:h-2 before:rounded-full before:bg-warning before:mr-1.5 before:align-middle">
      {unpricedCount} {unpricedCount === 1 ? 'line' : 'lines'} unpriced
    </span>
  ) : null;

  // One entry per real person, not per rotation line. The old export wrote a
  // row for every line, so seven unstaffed lines became seven rows of 30 hours
  // against a blank employee ID — hours a payroll system would happily price.
  const payrollPeople = React.useMemo(() => buildPayrollPeople(solution.roster_lines), [solution.roster_lines]);
  const unassignedLineNumbers = React.useMemo(
    () => solution.roster_lines.filter((l) => !isStaffed(l)).map((l) => l.line_number),
    [solution.roster_lines],
  );

  /**
   * Refuses the export, with the reason, when the roster is not payroll-ready.
   * Returns true when the caller should stop. A CSV of hours is money: a line
   * nobody is working means the file is either short of a person or carrying
   * hours for one, and the supervisor has to decide which before it leaves here.
   */
  const blockExport = (): boolean => {
    if (unassignedLineNumbers.length > 0) {
      const lines = unassignedLineNumbers.join(', ');
      setDownloadMsg(null);
      setExportError(
        `No payroll file was created. ${unassignedLineNumbers.length} of ${solution.roster_lines.length} ` +
          `rotation ${unassignedLineNumbers.length === 1 ? 'line has' : 'lines have'} nobody assigned ` +
          `(${unassignedLineNumbers.length === 1 ? 'line' : 'lines'} ${lines}). ` +
          'Assign a staff member to each line on the Staff tab, or remove the line, then export again.',
      );
      return true;
    }
    if (payrollPeople.length === 0) {
      setDownloadMsg(null);
      setExportError('No payroll file was created. This schedule has no assigned staff to pay.');
      return true;
    }
    setExportError(null);
    return false;
  };

  const download = (csvContent: string, filename: string, label: string) => {
    const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.setAttribute('download', filename);
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    URL.revokeObjectURL(url);
    setDownloadMsg(
      `${label}: ${payrollPeople.length} ${payrollPeople.length === 1 ? 'employee' : 'employees'} written. ` +
        'Estimated from the schedule, not from hours worked — check it before you run payroll.',
    );
  };

  const handleDownloadGusto = () => {
    if (blockExport()) return;
    // Ruling 24: no invented value. A field the solution does not carry is left empty.
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
    const rows = payrollPeople.map((p) => [
      csvCell(p.employeeId),
      csvCell(p.name),
      csvCell(p.role),
      p.regularHours.toFixed(2),
      p.overtimeHours.toFixed(2),
      p.hourlyWage === null ? '' : p.hourlyWage.toFixed(2),
      p.estimatedPayroll === null ? '' : p.estimatedPayroll.toFixed(2),
      csvCell(p.note),
    ]);
    download(
      [headers.join(','), ...rows.map((r) => r.join(','))].join('\n'),
      `gusto_payroll_${solution.archetype_id}_wk.csv`,
      'Gusto CSV',
    );
  };

  const handleDownloadAdp = () => {
    if (blockExport()) return;
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
    const rows = payrollPeople.map((p) => [
      '',
      '',
      csvCell(p.employeeId),
      csvCell(p.name),
      p.regularHours.toFixed(2),
      p.overtimeHours.toFixed(2),
      p.hourlyWage === null ? '' : p.hourlyWage.toFixed(2),
      '',
      p.estimatedPayroll === null ? '' : p.estimatedPayroll.toFixed(2),
    ]);
    download(
      [headers.join(','), ...rows.map((r) => r.join(','))].join('\n'),
      `adp_payroll_${solution.archetype_id}_batch.csv`,
      'ADP CSV',
    );
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
          <span className="text-xs font-bold uppercase tracking-wider text-muted block">
            Payroll & Cost Analytics
          </span>
          <h2 className="type-section-title text-ink mt-0.5">
            Store Labor Spend & Payroll CSV Export
          </h2>
          <p className="type-prose text-muted mt-0.5">
            Separates regular base wages from 1.5× overtime exposure. Exports a CSV laid out for Gusto or
            ADP that you upload yourself — nothing is sent to either system from here.
          </p>
        </div>

        <div className="flex items-center gap-2">
          {/* Stays until dismissed: a 3s auto-dismiss gave no time to read or re-read it. */}
          <div role="alert" aria-live="assertive">
            {exportError && (
              <span className="inline-flex items-start gap-2 max-w-md text-xs font-semibold text-status-risk-ink bg-status-risk-soft border border-status-risk px-3 py-1.5 rounded-lg">
                <span>{exportError}</span>
                <button
                  type="button"
                  onClick={() => setExportError(null)}
                  aria-label="Dismiss export error"
                  className="rounded px-1 font-bold text-status-risk-ink hover:bg-status-risk-soft"
                >
                  ✕
                </button>
              </span>
            )}
          </div>
          <div role="status" aria-live="polite">
            {downloadMsg && (
              <span className="inline-flex items-center gap-2 text-xs font-semibold text-emerald-800 bg-emerald-50 border border-emerald-200 px-3 py-1.5 rounded-lg">
                ✓ {downloadMsg}
                <button
                  type="button"
                  onClick={() => setDownloadMsg(null)}
                  aria-label="Dismiss download confirmation"
                  className="rounded px-1 font-bold text-emerald-900 hover:bg-emerald-100"
                >
                  ✕
                </button>
              </span>
            )}
          </div>
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
            onClick={() => window.print()}
          >
            Print Audit
          </Button>
          {facilityId && (
            <Button variant="secondary" onClick={() => setShowPosUpload((v) => !v)}>
              {showPosUpload ? 'Hide POS upload' : 'Update demand from POS data'}
            </Button>
          )}
        </div>
      </div>

      {facilityId && showPosUpload && (
        <POSIntegrationView
          facilityId={facilityId}
          currentDemandMatrix={currentDemandMatrix}
          onDemandUpdated={onDemandUpdated}
        />
      )}

      {/* Top Payroll & Hours Economics KPI Banner */}
      <div className="grid grid-cols-2 lg:grid-cols-5 gap-3.5">
        <div className="card p-4">
          <span className="text-xs font-semibold uppercase tracking-wider text-muted block">
            Est. Weekly Payroll
          </span>
          <div className="flex items-baseline justify-between mt-1">
            <span className="text-2xl font-bold font-mono-tabular text-ink">
              {formatCurrency(labor.total_payroll_cost)}
            </span>
          </div>
          <p className="text-xs text-muted mt-1">
            Est. base: {formatCurrency(labor.regular_payroll_cost)}
          </p>
          {unpricedBadge && <div className="mt-1.5">{unpricedBadge}</div>}
        </div>

        <div className="card p-4">
          <span className="text-xs font-semibold uppercase tracking-wider text-muted block">
            Scheduled Labor Hours
          </span>
          <div className="flex items-baseline justify-between mt-1">
            <span className="text-2xl font-bold font-mono-tabular text-ink">
              {labor.total_scheduled_hours} hrs
            </span>
            <span className="text-xs font-mono-tabular text-muted">
              {solution.employee_count} Shift Patterns
            </span>
          </div>
          <p className="text-xs text-muted mt-1">
            Reg: {labor.total_regular_hours}h • OT: {labor.total_overtime_hours}h
          </p>
        </div>

        <div className="card p-4">
          <span className="text-xs font-semibold uppercase tracking-wider text-muted block">
            Overtime Exposure
          </span>
          <div className="flex items-baseline justify-between mt-1">
            <span className="text-2xl font-bold font-mono-tabular text-ink">
              {formatCurrency(labor.overtime_payroll_cost)}
            </span>
            <span className={`px-2 py-0.5 rounded text-xs font-semibold ${labor.overtime_lines_count > 0 ? 'bg-status-watch-soft text-status-watch-ink border border-status-watch' : 'bg-status-ok-soft text-status-ok-ink border border-status-ok'}`}>
              {labor.overtime_lines_count > 0 ? `${labor.overtime_lines_count} OT Lines` : '0 OT Risk'}
            </span>
          </div>
          <p className="text-xs text-muted mt-1">
            1.5× rate applied over 40h/line
          </p>
          {overtimePremiumByLine.size > 0 && (
            <p className="text-xs text-muted mt-0.5">
              Overtime premium (extra 0.5x): {formatCurrency(overtimePremiumTotal)}
            </p>
          )}
        </div>

        <div className="card p-4">
          <span className="text-xs font-semibold uppercase tracking-wider text-muted block">
            Blended Average Wage
          </span>
          <div className="flex items-baseline justify-between mt-1">
            <span className="text-2xl font-bold font-mono-tabular text-ink">
              {formatHourlyRate(avgWage)}
            </span>
          </div>
          <p className="text-xs text-muted mt-1">
            Across priced personnel hours
          </p>
        </div>

        <div className="card p-4 col-span-2 lg:col-span-1">
          <span className="text-xs font-semibold uppercase tracking-wider text-muted block">
            Uncovered Hours This Week
          </span>
          <div className="flex items-baseline justify-between mt-1">
            <span
              className={`text-2xl font-bold font-mono-tabular ${
                uncoveredHours > 0 ? 'text-status-risk-ink' : 'text-status-ok-ink'
              }`}
            >
              {uncoveredHours}h
            </span>
            <span
              className={`px-2 py-0.5 rounded text-xs font-semibold ${
                uncoveredHours > 0
                  ? 'bg-status-risk-soft text-status-risk-ink border border-status-risk'
                  : 'bg-status-ok-soft text-status-ok-ink border border-status-ok'
              }`}
            >
              {uncoveredHours > 0 ? 'Short' : 'Fully covered'}
            </span>
          </div>
          <p className="text-xs text-muted mt-1">
            Hours where fewer people are scheduled than you asked for, added up across all 168
            hours of the week.
          </p>
          <p className="text-xs text-muted mt-1">
            Separately, paid hours come to {labor.labor_efficiency_pct}% of required hours. That is
            a total-against-total ratio and takes no account of which hours they are, so it can sit
            near 100% while the shortfall above is real.
          </p>
        </div>
      </div>

      {/* Daily Labor Cost & Hours Distribution */}
      <div className="card p-5">
        <div className="flex items-center justify-between mb-4">
          <div>
            <h3 className="type-subsection-title text-ink-soft">
              Daily Payroll Spend & Scheduled Hours (Monday – Sunday)
            </h3>
            <p className="type-prose text-muted mt-0.5">
              Tracks daily labor expenditure matching store demand and customer rush patterns.
            </p>
            <p className="text-xs text-muted mt-0.5">
              Allocated pro rata from each line's estimated payroll.
            </p>
          </div>
          <div className="flex items-center gap-2">
            {unpricedBadge}
            <span className="text-xs font-mono-tabular text-ink-soft bg-surface px-3 py-1 rounded-md">
              Est. Weekly Spend: {formatCurrency(labor.total_payroll_cost)}
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
                    ? 'bg-slate-100/70 border-border-control'
                    : 'bg-surface-subtle border-border-control'
                }`}
              >
                <div>
                  <div className="flex items-center justify-between">
                    <span className="text-xs font-bold text-ink">{dayName}</span>
                    <span className="text-xs font-mono-tabular text-muted">
                      {hours} hrs
                    </span>
                  </div>
                  <span className="text-xs text-muted block mt-1">Allocated daily spend</span>
                  <div className="text-base font-bold font-mono-tabular text-ink">
                    {formatCurrency(cost)}
                  </div>
                </div>

                <div className="mt-3">
                  <div className="w-full bg-surface-sunken rounded-full h-2 overflow-hidden">
                    <div
                      className={`h-2 rounded-full ${
                        isWeekend ? 'bg-ink' : 'bg-ink-soft'
                      }`}
                      style={{ width: `${barPct}%` }}
                    />
                  </div>
                  <span className="text-xs text-muted mt-1 block text-right font-mono-tabular">
                    {hours > 0 ? formatHourlyRate(cost / hours) : '—'}
                  </span>
                </div>
              </div>
            );
          })}
        </div>
      </div>

      {/* Shift Pattern Payroll Table */}
      <div className="card overflow-hidden">
        <div className="p-4 sm:px-6 border-b border-border-subtle bg-white">
          <h3 className="type-subsection-title text-ink-soft">
            Payroll & Overtime Breakdown
          </h3>
          <p className="type-prose text-muted mt-0.5">
            Hours, wage rates, and estimated weekly earnings for each shift pattern.
          </p>
        </div>

        <div className="overflow-x-auto">
          <table className="w-full text-left border-collapse text-xs">
            <thead>
              <tr className="bg-surface-subtle border-b border-border-subtle text-xs font-bold uppercase tracking-wider text-muted">
                <th className="py-3 px-4">Pattern</th>
                <th className="py-3 px-4">Assigned Personnel</th>
                <th className="py-3 px-3">
                  <Term explanation="The pay and skill band this shift pattern is costed at. It is also what appears as the Role in the payroll file you export, so &quot;Union Line Standard&quot; means the ordinary rate for the job, with nothing added for extra skills or seniority.">
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
            <tbody className="divide-y divide-border-subtle font-mono-tabular">
              {solution.roster_lines.map((line) => (
                <tr key={line.cohort_id} className="hover:bg-slate-50/80">
                  <td className="py-3 px-4 font-bold text-ink">
                    {line.cohort_id}
                  </td>
                  <td className="py-3 px-4 font-sans font-semibold text-ink">
                    {line.assigned_person || (
                      <span className="text-muted italic font-normal">
                        Unassigned shift pattern
                      </span>
                    )}
                  </td>
                  <td className="py-3 px-3 font-sans text-ink-soft">
                    {line.qualification_tier}
                  </td>
                  <td className="py-3 px-3 text-right text-ink-soft">
                    {formatHourlyRate(line.hourly_wage)}
                  </td>
                  <td className="py-3 px-3 text-right font-bold text-ink">
                    {line.weekly_hours}h
                  </td>
                  <td className="py-3 px-3 text-right text-ink-soft">
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
                            premium +{formatCurrency(overtimePremiumByLine.get(line.cohort_id))}
                          </span>
                        )}
                      </>
                    ) : (
                      <span className="text-muted">0h</span>
                    )}
                  </td>
                  <td className="py-3 px-4 text-right font-bold text-ink">
                    {formatCurrency(line.estimated_weekly_payroll)}
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
