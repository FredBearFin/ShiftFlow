import React, { useState } from 'react';
import { SolveResponse } from '../types';
import { DAYS_OF_WEEK } from '../services/api';
import { Term } from './ui/Term';

interface CoverageHeatmapViewProps {
  solution: SolveResponse;
}

export const CoverageHeatmapView: React.FC<CoverageHeatmapViewProps> = ({
  solution,
}) => {
  const [displayMode, setDisplayMode] = useState<'scheduled' | 'deviation'>('scheduled');

  // Group 168 interval cells into 7 days x 24 hours
  const byDay: Record<number, typeof solution.interval_coverage> = {};
  solution.interval_coverage.forEach((cell) => {
    if (!byDay[cell.day_index]) byDay[cell.day_index] = [];
    byDay[cell.day_index].push(cell);
  });

  const totalUnder = solution.interval_coverage.reduce((a, c) => a + c.understaffing, 0);
  const totalOver = solution.interval_coverage.reduce((a, c) => a + c.overstaffing, 0);
  const totalScheduled = solution.interval_coverage.reduce(
    (a, c) => a + c.scheduled_staff,
    0
  );

  return (
    <div className="space-y-5">
      {/* Coverage Equation Banner */}
      <div className="card p-5 flex flex-wrap items-center justify-between gap-4">
        <div>
          <span className="text-xs font-bold uppercase tracking-wider text-[#5C6770]">
            24-Hour Coverage
          </span>
          <h2 className="text-base font-bold text-slate-900 mt-0.5">
            Scheduled vs. <Term explanation="How many people you need in each hour.">required</Term> staff, hour by hour across the week
          </h2>
          <p className="text-xs text-slate-600 mt-0.5">
            Check scheduled staff each hour against the need: short or extra.
          </p>
          <p className="text-xs text-slate-500 mt-1.5 max-w-2xl">
            "Scheduled" counts rotation <Term explanation="A repeating work/rest pattern over the cycle — not necessarily one specific named person, especially before real staff are assigned.">lines</Term> on duty that hour, not individual people — in planning
            mode (no real staff added yet) this can look uneven day to day even though the underlying
            demand is smooth, simply because a small number of rotating lines happen to line up
            differently on different days. That evens out once real staff are assigned across lines.
          </p>
        </div>

        <div className="flex items-center gap-3">
          <div className="px-3.5 py-2 rounded-lg bg-slate-50 border border-slate-200 text-xs font-mono-tabular">
            <span className="text-slate-500 block text-xs">Scheduled Hrs</span>
            <strong className="text-slate-900 text-sm">{totalScheduled}h</strong>
          </div>
          <div className="px-3.5 py-2 rounded-lg bg-[#E4E9EC] text-[#2B3A42] border border-[#7F8A92] text-xs font-mono-tabular">
            <span className="text-[#2B3A42] block text-xs before:content-[''] before:inline-block before:w-2 before:h-2 before:rounded-full before:bg-[#C28B47] before:mr-1.5 before:align-middle">Understaffed hours</span>
            <strong className="text-[#2B3A42] text-sm">{totalUnder}h</strong>
          </div>
          <div className="px-3.5 py-2 rounded-lg bg-[#E4E9EC] text-[#2B3A42] border border-[#7F8A92] text-xs font-mono-tabular">
            <span className="text-[#2B3A42] block text-xs">Overstaffed hours</span>
            <strong className="text-[#2B3A42] text-sm">{totalOver}h</strong>
          </div>

          <div className="inline-flex rounded-md border border-[#7F8A92] p-0.5 bg-slate-100">
            <button
              type="button"
              onClick={() => setDisplayMode('scheduled')}
              className={`px-3 py-1.5 rounded-md text-xs font-semibold ${
                displayMode === 'scheduled'
                  ? 'bg-white text-slate-900 shadow-[0_1px_2px_rgba(43,58,66,0.08)]'
                  : 'text-slate-600'
              }`}
            >
              Scheduled / Required staff
            </button>
            <button
              type="button"
              onClick={() => setDisplayMode('deviation')}
              className={`px-3 py-1.5 rounded-md text-xs font-semibold ${
                displayMode === 'deviation'
                  ? 'bg-white text-slate-900 shadow-[0_1px_2px_rgba(43,58,66,0.08)]'
                  : 'text-slate-600'
              }`}
            >
              Net Difference (over minus under)
            </button>
          </div>
        </div>
      </div>

      {/* 7 x 24 Interval Heatmap Matrix */}
      <div className="card p-5 overflow-x-auto">
        <h3 className="text-xs font-bold uppercase tracking-wider text-slate-700 mb-3">
          24-Hour × 7-Day Interval Staffing Heatmap
        </h3>
        <table className="w-full border-collapse text-center text-xs font-mono-tabular">
          <thead>
            <tr className="border-b border-slate-200 text-slate-500">
              <th className="py-2 px-3 text-left font-sans font-bold text-slate-700">
                Day \ Hour
              </th>
              {Array.from({ length: 24 }, (_, hr) => (
                <th key={hr} className="py-2 px-1 font-semibold">
                  {String(hr).padStart(2, '0')}
                </th>
              ))}
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100">
            {DAYS_OF_WEEK.map((dayName, g) => {
              const cells = byDay[g] || [];
              return (
                <tr key={dayName}>
                  <th scope="row" className="py-2.5 px-3 text-left font-sans font-bold text-slate-900 bg-slate-50/80 whitespace-nowrap">
                    {dayName}
                  </th>
                  {cells.map((c) => {
                    const diff = c.scheduled_staff - c.required_staff;
                    let cellStyle = 'bg-emerald-50 text-emerald-900 border-emerald-200';
                    if (c.required_staff === 0 && c.scheduled_staff === 0) {
                      cellStyle = 'bg-slate-50 text-slate-400 border-slate-100';
                    } else if (diff < 0) {
                      cellStyle = 'bg-amber-50 text-amber-900 border-amber-300 font-bold';
                    } else if (diff > 0) {
                      cellStyle = 'bg-indigo-50 text-indigo-900 border-indigo-200';
                    }
                    const stateLabel =
                      c.required_staff === 0 && c.scheduled_staff === 0
                        ? 'no staffing required'
                        : diff < 0
                        ? `understaffed by ${-diff}`
                        : diff > 0
                        ? `overstaffed by ${diff}`
                        : 'on target';
                    const cellLabel = `${dayName} ${String(c.hour).padStart(2, '0')}:00, ${stateLabel}`;
                    return (
                      <td key={c.hour} className="p-0.5" aria-label={cellLabel}>
                        <div
                          className={`rounded border py-1.5 px-0.5 ${cellStyle}`}
                          title={`${dayName} ${c.hour_label}: Scheduled=${c.scheduled_staff}, Required=${c.required_staff} (understaffed=${c.understaffing}, overstaffed=${c.overstaffing})`}
                        >
                          {displayMode === 'scheduled'
                            ? `${c.scheduled_staff}/${c.required_staff}`
                            : diff === 0
                            ? '0'
                            : diff > 0
                            ? `+${diff}`
                            : `${diff}`}
                        </div>
                      </td>
                    );
                  })}
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      {/* Shift Design Utilization Table (xi_{gt} & phi_t) */}
      <div className="card p-5">
        <h3 className="text-xs font-bold uppercase tracking-wider text-slate-700 mb-3">
          Shift Types: Active and Staff per Day
        </h3>
        <div className="overflow-x-auto">
          <table className="w-full text-left border-collapse text-xs">
            <thead>
              <tr className="bg-slate-50 border-b border-slate-200 text-xs font-bold uppercase tracking-wider text-slate-500">
                <th className="py-2.5 px-3">Shift Type ID</th>
                <th className="py-2.5 px-3">Template</th>
                <th className="py-2.5 px-3">Time Window</th>
                <th className="py-2.5 px-3 text-center">Active</th>
                {DAYS_OF_WEEK.map((d) => (
                  <th key={d} className="py-2.5 px-2 text-center">
                    {d} staff
                  </th>
                ))}
                <th className="py-2.5 px-3 text-right">Weekly Shifts</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-200 font-mono-tabular">
              {solution.shift_types.map((st) => {
                const total = st.daily_counts.reduce((a, b) => a + b, 0);
                return (
                  <tr key={st.type_id}>
                    <td className="py-2.5 px-3 font-bold text-slate-900">
                      {st.type_id}
                    </td>
                    <td className="py-2.5 px-3 font-sans">
                      <span
                        className={`shift-pill-${st.template_code} px-2 py-0.5 rounded text-xs font-semibold`}
                      >
                        {st.template_name}
                      </span>
                    </td>
                    <td className="py-2.5 px-3 text-slate-700">
                      {st.formatted_window} ({st.duration_hours}h)
                    </td>
                    <td className="py-2.5 px-3 text-center">
                      <span
                        className={`px-2 py-0.5 rounded text-xs font-bold ${
                          st.active
                            ? 'bg-emerald-50 text-emerald-700 border border-emerald-200'
                            : 'bg-slate-100 text-slate-500'
                        }`}
                      >
                        {st.active ? 'Active' : 'Off'}
                      </span>
                    </td>
                    {st.daily_counts.map((cnt, idx) => (
                      <td key={idx} className="py-2.5 px-2 text-center text-slate-800">
                        {cnt}
                      </td>
                    ))}
                    <td className="py-2.5 px-3 text-right font-bold text-slate-900">
                      {total}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
};
