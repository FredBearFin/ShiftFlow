import React, { useState } from 'react';
import { SolveResponse } from '../types';
import { DAYS_OF_WEEK } from '../services/api';

interface LaborAnalysisViewProps {
  solution: SolveResponse;
}

export const LaborAnalysisView: React.FC<LaborAnalysisViewProps> = ({
  solution,
}) => {
  const labor = solution.labor_analysis;
  const maxDayCost = Math.max(...labor.cost_per_day, 100);
  const [downloadMsg, setDownloadMsg] = useState<string | null>(null);

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
    const rows = solution.roster_lines.map((l) => [
      l.assigned_employee_id || '',
      l.assigned_person ? `"${l.assigned_person}"` : '',
      l.qualification_tier ? `"${l.qualification_tier}"` : '',
      l.regular_hours.toFixed(2),
      l.overtime_hours.toFixed(2),
      l.hourly_wage.toFixed(2),
      l.estimated_weekly_payroll.toFixed(2),
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
      l.assigned_person ? `"${l.assigned_person}"` : '',
      l.regular_hours.toFixed(2),
      l.overtime_hours.toFixed(2),
      l.hourly_wage.toFixed(2),
      '',
      l.estimated_weekly_payroll.toFixed(2),
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

  return (
    <div className="space-y-5">
      {/* Action Header with Export Buttons */}
      <div className="enterprise-card p-5 bg-white flex flex-wrap items-center justify-between gap-4">
        <div>
          <span className="text-[11px] font-bold uppercase tracking-wider text-indigo-700 block">
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
          <button type="button"
            onClick={handleDownloadGusto}
            className="px-3.5 py-2 bg-emerald-600 hover:bg-emerald-700 text-white rounded-lg text-xs font-bold shadow-xs flex items-center gap-1.5"
          >
            <span>↓ Gusto CSV</span>
          </button>
          <button type="button"
            onClick={handleDownloadAdp}
            className="px-3.5 py-2 bg-slate-900 hover:bg-slate-800 text-white rounded-lg text-xs font-bold shadow-xs flex items-center gap-1.5"
          >
            <span>↓ ADP CSV</span>
          </button>
          <button type="button"
            onClick={() => window.print()}
            className="px-3 py-2 border border-slate-300 bg-white text-slate-700 hover:bg-slate-50 rounded-lg text-xs font-semibold"
          >
            Print Audit
          </button>
        </div>
      </div>

      {/* Top Payroll & Hours Economics KPI Banner */}
      <div className="grid grid-cols-2 lg:grid-cols-5 gap-3.5">
        <div className="enterprise-card p-4">
          <span className="text-[11px] font-semibold uppercase tracking-wider text-slate-500 block">
            Total Weekly Payroll
          </span>
          <div className="flex items-baseline justify-between mt-1">
            <span className="text-2xl font-bold font-mono-tabular text-slate-900">
              ${labor.total_payroll_cost.toLocaleString('en-US', { minimumFractionDigits: 2 })}
            </span>
          </div>
          <p className="text-[11px] text-slate-500 mt-1">
            Base: ${labor.regular_payroll_cost.toFixed(2)}
          </p>
        </div>

        <div className="enterprise-card p-4">
          <span className="text-[11px] font-semibold uppercase tracking-wider text-slate-500 block">
            Scheduled Labor Hours
          </span>
          <div className="flex items-baseline justify-between mt-1">
            <span className="text-2xl font-bold font-mono-tabular text-slate-900">
              {labor.total_scheduled_hours} hrs
            </span>
            <span className="text-xs font-mono-tabular text-slate-500">
              {solution.employee_count} Lines
            </span>
          </div>
          <p className="text-[11px] text-slate-500 mt-1">
            Reg: {labor.total_regular_hours}h • OT: {labor.total_overtime_hours}h
          </p>
        </div>

        <div className="enterprise-card p-4">
          <span className="text-[11px] font-semibold uppercase tracking-wider text-slate-500 block">
            Overtime Exposure
          </span>
          <div className="flex items-baseline justify-between mt-1">
            <span className={`text-2xl font-bold font-mono-tabular ${labor.total_overtime_hours > 0 ? 'text-amber-700' : 'text-emerald-700'}`}>
              ${labor.overtime_payroll_cost.toFixed(2)}
            </span>
            <span className={`px-2 py-0.5 rounded text-[10px] font-semibold ${labor.overtime_lines_count > 0 ? 'bg-amber-50 text-amber-800 border border-amber-200' : 'bg-emerald-50 text-emerald-700 border border-emerald-200'}`}>
              {labor.overtime_lines_count > 0 ? `${labor.overtime_lines_count} OT Lines` : '0 OT Risk'}
            </span>
          </div>
          <p className="text-[11px] text-slate-500 mt-1">
            1.5× rate applied over 40h/line
          </p>
        </div>

        <div className="enterprise-card p-4">
          <span className="text-[11px] font-semibold uppercase tracking-wider text-slate-500 block">
            Blended Average Wage
          </span>
          <div className="flex items-baseline justify-between mt-1">
            <span className="text-2xl font-bold font-mono-tabular text-slate-900">
              ${labor.avg_hourly_wage.toFixed(2)}/hr
            </span>
          </div>
          <p className="text-[11px] text-slate-500 mt-1">
            Across active personnel
          </p>
        </div>

        <div className="enterprise-card p-4 col-span-2 lg:col-span-1">
          <span className="text-[11px] font-semibold uppercase tracking-wider text-slate-500 block">
            Labor Efficiency Ratio
          </span>
          <div className="flex items-baseline justify-between mt-1">
            <span className="text-2xl font-bold font-mono-tabular text-indigo-700">
              {labor.labor_efficiency_pct}%
            </span>
            <span className="text-xs text-slate-500">Coverage</span>
          </div>
          <p className="text-[11px] text-slate-500 mt-1">
            Floor requirements vs hours paid
          </p>
        </div>
      </div>

      {/* Daily Labor Cost & Hours Distribution */}
      <div className="enterprise-card p-5">
        <div className="flex items-center justify-between mb-4">
          <div>
            <h3 className="text-xs font-bold uppercase tracking-wider text-slate-700">
              Daily Payroll Spend & Scheduled Hours (Monday – Sunday)
            </h3>
            <p className="text-xs text-slate-500 mt-0.5">
              Tracks daily labor expenditure matching store demand and customer rush patterns.
            </p>
          </div>
          <span className="text-xs font-mono-tabular text-slate-600 bg-slate-100 px-3 py-1 rounded-md">
            Weekly Spend: ${labor.total_payroll_cost.toFixed(2)}
          </span>
        </div>

        <div className="grid grid-cols-7 gap-3">
          {DAYS_OF_WEEK.map((dayName, idx) => {
            const cost = labor.cost_per_day[idx] || 0;
            const hours = labor.hours_per_day[idx] || 0;
            const barPct = Math.min(100, Math.max(15, (cost / maxDayCost) * 100));
            const isWeekend = idx >= 5;
            return (
              <div
                key={dayName}
                className={`p-3 rounded-xl border flex flex-col justify-between ${
                  isWeekend
                    ? 'bg-slate-100/70 border-slate-300'
                    : 'bg-slate-50 border-slate-200'
                }`}
              >
                <div>
                  <div className="flex items-center justify-between">
                    <span className="text-xs font-bold text-slate-900">{dayName}</span>
                    <span className="text-[10px] font-mono-tabular text-slate-500">
                      {hours} hrs
                    </span>
                  </div>
                  <div className="text-base font-bold font-mono-tabular text-slate-900 mt-1">
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
                  <span className="text-[10px] text-slate-400 mt-1 block text-right font-mono-tabular">
                    {hours > 0 ? `$${(cost / hours).toFixed(2)}/hr` : '—'}
                  </span>
                </div>
              </div>
            );
          })}
        </div>
      </div>

      {/* Rotation Line Payroll Table */}
      <div className="enterprise-card overflow-hidden">
        <div className="p-4 sm:px-6 border-b border-slate-200 bg-white">
          <h3 className="text-xs font-bold uppercase tracking-wider text-slate-700">
            Rotation Line Payroll & Overtime Breakdown
          </h3>
          <p className="text-xs text-slate-500 mt-0.5">
            Individual line hours, wage rates, and estimated weekly earnings across all cohorts.
          </p>
        </div>

        <div className="overflow-x-auto">
          <table className="w-full text-left border-collapse text-xs">
            <thead>
              <tr className="bg-slate-50 border-b border-slate-200 text-[11px] font-bold uppercase tracking-wider text-slate-500">
                <th className="py-3 px-4">Line</th>
                <th className="py-3 px-4">Assigned Personnel</th>
                <th className="py-3 px-3">Role / Tier</th>
                <th className="py-3 px-3 text-right">Wage Rate</th>
                <th className="py-3 px-3 text-right">Scheduled</th>
                <th className="py-3 px-3 text-right">Regular</th>
                <th className="py-3 px-3 text-right">Overtime</th>
                <th className="py-3 px-4 text-right">Weekly Payroll</th>
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
                      <span className="text-slate-400 italic font-normal">
                        Pure Rotation Line (Unassigned)
                      </span>
                    )}
                  </td>
                  <td className="py-3 px-3 font-sans text-slate-600">
                    {line.qualification_tier}
                  </td>
                  <td className="py-3 px-3 text-right text-slate-700">
                    ${line.hourly_wage.toFixed(2)}/hr
                  </td>
                  <td className="py-3 px-3 text-right font-bold text-slate-900">
                    {line.weekly_hours}h
                  </td>
                  <td className="py-3 px-3 text-right text-slate-600">
                    {line.regular_hours}h
                  </td>
                  <td className="py-3 px-3 text-right">
                    {line.overtime_hours > 0 ? (
                      <span className="px-1.5 py-0.5 rounded text-[11px] font-bold bg-amber-50 text-amber-800 border border-amber-200">
                        +{line.overtime_hours}h OT
                      </span>
                    ) : (
                      <span className="text-slate-400">0h</span>
                    )}
                  </td>
                  <td className="py-3 px-4 text-right font-bold text-slate-900">
                    ${line.estimated_weekly_payroll.toFixed(2)}
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
