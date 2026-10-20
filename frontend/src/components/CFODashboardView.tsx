import React from 'react';
import { SolveResponse, RosterLine } from '../types';

interface CFODashboardViewProps {
  solution: SolveResponse;
}

type NumericLineKey = 'overtime_hours';

// Sums one numeric field across roster lines; returns null if any line lacks it
const sumLineField = (lines: RosterLine[], key: NumericLineKey): number | null => {
  let total = 0;
  for (const line of lines) {
    const value = line[key];
    if (typeof value !== 'number' || !Number.isFinite(value)) return null;
    total += value;
  }
  return total;
};

// Sums estimated_weekly_payroll over priced lines only and counts the unpriced ones
const sumPayrollPriced = (lines: RosterLine[]): { total: number; unpriced: number } => {
  let total = 0;
  let unpriced = 0;
  for (const line of lines) {
    const value = line.estimated_weekly_payroll;
    if (typeof value === 'number' && Number.isFinite(value)) {
      total += value;
    } else {
      unpriced += 1;
    }
  }
  return { total, unpriced };
};

interface Figure {
  label: string;
  value: string;
}

export const CFODashboardView: React.FC<CFODashboardViewProps> = ({ solution }) => {
  const rosterLines: RosterLine[] = solution?.roster_lines ?? [];
  const hasSchedule = (solution?.employee_count ?? 0) > 0;

  if (!hasSchedule) {
    return (
      <div className="space-y-6">
        <p className="text-sm font-semibold text-slate-600 text-center">Set up your schedule to see your numbers here.</p>
      </div>
    );
  }

  const figures: Figure[] = [];

  figures.push({ label: 'Staff count', value: solution.employee_count.toLocaleString() });

  const overtimeHours = sumLineField(rosterLines, 'overtime_hours');
  if (overtimeHours !== null) {
    figures.push({ label: 'Overtime hours planned each week', value: `${overtimeHours.toFixed(1)} hrs` });
  }

  if (rosterLines.length > 0) {
    const payroll = sumPayrollPriced(rosterLines);
    if (payroll.unpriced === 0) {
      figures.push({
        label: 'Estimated weekly payroll',
        value: `$${payroll.total.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`
      });
    }
  }

  const avgHourlyWage = solution.labor_analysis?.avg_hourly_wage;
  if (typeof avgHourlyWage === 'number' && Number.isFinite(avgHourlyWage)) {
    figures.push({ label: 'Average hourly wage', value: `$${avgHourlyWage.toFixed(2)}/hr` });
  }

  if (figures.length === 0) {
    return (
      <div className="space-y-6">
        <p className="text-sm font-semibold text-slate-600 text-center">Set up your schedule to see your numbers here.</p>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <h1 className="text-xl font-bold text-slate-900">Your Schedule Numbers</h1>
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        {figures.map((figure) => (
          <div key={figure.label} className="enterprise-card p-4">
            <span className="text-xs font-semibold uppercase tracking-wider text-slate-500">{figure.label}</span>
            <div className="text-2xl font-bold font-mono-tabular text-slate-900 mt-1">{figure.value}</div>
          </div>
        ))}
      </div>
    </div>
  );
};
