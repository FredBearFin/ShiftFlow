import React from 'react';
import { ParetoPoint, SolveResponse } from '../types';
import { Term } from './ui/Term';
import { Button } from './ui/Button';
import { formatCurrency } from '../utils/format';

interface ParetoExplorerViewProps {
  solution: SolveResponse;
  selectedLeewayPct: number;
  onSelectLeewayPct: (leeway: number) => void;
}

export const ParetoExplorerView: React.FC<ParetoExplorerViewProps> = ({
  solution,
  selectedLeewayPct,
  onSelectLeewayPct,
}) => {
  const points = solution.pareto_frontier;
  const minShift = Math.min(...points.map((p) => p.obj_shift));
  const maxShift = Math.max(...points.map((p) => p.obj_shift), minShift + 10);
  const minErgo = 0;
  const maxErgo = Math.max(...points.map((p) => p.obj_ergo), 20);
  const knee = points.find((p) => p.is_knee_point);

  // Every payroll figure on this page prices only the lines that carry a wage.
  const lineCount = solution.roster_lines.length;
  const pricedLineCount = solution.roster_lines.filter((l) => l.estimated_weekly_payroll !== null).length;

  // Coverage does not track the flexibility column, so the worst-coverage option is
  // named rather than left for the reader to spot.
  const worstUncovered = points.length > 0 ? Math.max(...points.map((p) => p.total_understaffing_hours)) : 0;

  // SVG Coordinate projection
  const svgW = 720;
  const svgH = 320;
  const padL = 64;
  const padR = 36;
  const padT = 28;
  const padB = 48;
  const plotW = svgW - padL - padR;
  const plotH = svgH - padT - padB;

  const toX = (sVal: number) =>
    padL + ((sVal - minShift) / Math.max(1, maxShift - minShift)) * plotW;
  const toY = (eVal: number) =>
    padT + plotH - ((eVal - minErgo) / Math.max(1, maxErgo - minErgo)) * plotH;

  const polylinePoints = points
    .map((pt) => `${toX(pt.obj_shift).toFixed(1)},${toY(pt.obj_ergo).toFixed(1)}`)
    .join(' ');

  return (
    <div className="space-y-5">
      {/* Plain-language explanation */}
      <div className="card p-5">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div className="max-w-3xl">
            <span className="text-xs font-bold uppercase tracking-wider text-[#5C6770]">
              Give the solver more room, get a better-rested schedule
            </span>
            <h2 className="type-section-title text-slate-900 mt-0.5">
              Every point below is a real, complete schedule — not a theory
            </h2>
            <p className="type-prose text-slate-600 mt-1 leading-relaxed">
              Staffing flexibility is how far above the leanest possible shift count the solver may
              go. Moving right means more shifts in the schedule. Moving down means less of the
              stuff that burns people out — long stretches without a day off, back-to-back
              closing-then-opening shifts, lost weekends. More flexibility is not the same as more
              money and not the same as better coverage: each option below shows its own weekly
              payroll and its own uncovered hours, and both can move either way.
            </p>
            <p className="type-prose text-slate-600 mt-1 leading-relaxed">
              Every payroll figure below prices {pricedLineCount} of {lineCount} shift patterns —
              the ones that have somebody assigned. Patterns with nobody on them cost nothing here
              and would cost more once staffed.
            </p>
          </div>
          <div className="card p-4 text-xs">
            <span className="text-xs font-bold uppercase tracking-wider text-[#5C6770] block">
              Currently applied
            </span>
            <span className="text-sm font-bold font-mono-tabular text-[#2B3A42]">
              +{selectedLeewayPct}% staffing flexibility allowed
            </span>
          </div>
        </div>
      </div>

      {/* Interactive SVG Pareto Curve + Knee-Point Callout */}
      <div className="grid grid-cols-1 lg:grid-cols-12 gap-5">
        <div className="lg:col-span-8 card p-5">
          <div className="flex items-center justify-between mb-3">
            <h3 className="type-subsection-title text-slate-700">
              Flexibility vs. rest — click any point to apply it
            </h3>
            <div className="flex items-center gap-3 text-xs">
              {knee && (
                <span className="inline-flex items-center gap-1.5 text-slate-600">
                  <span className="w-2.5 h-2.5 rounded-full bg-warning" />
                  {knee.leeway_pct}% flexibility is the sweet spot for rest
                  ({formatCurrency(knee.estimated_weekly_payroll)}/wk,{' '}
                  {knee.total_understaffing_hours}h uncovered)
                </span>
              )}
              <span className="inline-flex items-center gap-1.5 text-accent font-semibold">
                <span className="w-2.5 h-2.5 rounded-full bg-accent" />
                Currently applied
              </span>
            </div>
          </div>

          <div className="w-full overflow-x-auto">
            <svg
              viewBox={`0 0 ${svgW} ${svgH}`}
              className="w-full h-auto bg-slate-50/60 rounded-lg border border-[#7F8A92]"
            >
              {/* Horizontal Grid Lines */}
              {[0, 0.25, 0.5, 0.75, 1].map((frac, idx) => {
                const y = padT + plotH * frac;
                const val = Math.round(maxErgo * (1 - frac));
                return (
                  <g key={idx}>
                    <line
                      x1={padL}
                      y1={y}
                      x2={svgW - padR}
                      y2={y}
                      stroke="#e2e8f0"
                      strokeDasharray="4 4"
                    />
                    <text
                      x={padL - 8}
                      y={y + 4}
                      textAnchor="end"
                      className="text-xs fill-slate-500 font-mono-tabular"
                    >
                      {val}
                    </text>
                  </g>
                );
              })}

              {/* Axes Labels */}
              <text
                x={padL + plotW / 2}
                y={svgH - 10}
                textAnchor="middle"
                className="text-xs font-semibold fill-slate-700"
              >
                More shifts scheduled →
              </text>
              <text
                x={16}
                y={padT + plotH / 2}
                textAnchor="middle"
                transform={`rotate(-90, 16, ${padT + plotH / 2})`}
                className="text-xs font-semibold fill-slate-700"
              >
                Less staff strain ↓
              </text>

              {/* Pareto Curve Polyline */}
              <polyline
                fill="none"
                className="stroke-accent"
                strokeWidth="2.5"
                points={polylinePoints}
              />

              {/* Interactive Pareto Points */}
              {points.map((pt) => {
                const cx = toX(pt.obj_shift);
                const cy = toY(pt.obj_ergo);
                const isSel = Math.abs(pt.leeway_pct - selectedLeewayPct) < 0.1;
                return (
                  <g
                    key={pt.point_index}
                    onClick={() => onSelectLeewayPct(pt.leeway_pct)}
                    className="cursor-pointer"
                  >
                    {isSel && (
                      <circle
                        cx={cx}
                        cy={cy}
                        r={11}
                        className="stroke-accent"
                        style={{ fill: 'var(--accent)', fillOpacity: 0.15 }}
                        strokeWidth="1.5"
                      />
                    )}
                    <circle
                      cx={cx}
                      cy={cy}
                      r={pt.is_knee_point || isSel ? 6.5 : 5}
                      className={
                        isSel
                          ? 'fill-accent stroke-accent'
                          : pt.is_knee_point
                          ? 'fill-warning stroke-warning-ink'
                          : 'fill-card stroke-accent'
                      }
                      strokeWidth="2"
                    />
                    {(pt.is_knee_point || isSel || pt.leeway_pct === 0 || pt.leeway_pct === 10 || pt.leeway_pct === 50) && (
                      <text
                        x={cx + 8}
                        y={cy - 8}
                        className="text-xs font-mono-tabular font-bold fill-slate-800"
                      >
                        +{pt.leeway_pct}% flex · {formatCurrency(pt.estimated_weekly_payroll)}/wk · {pt.total_understaffing_hours}h uncovered
                      </text>
                    )}
                  </g>
                );
              })}
            </svg>
          </div>
        </div>

        {/* Cost-vs-rest frontier, point by point */}
        <div className="lg:col-span-4 card p-5 flex flex-col justify-between">
          <div>
            <span className="text-xs font-bold uppercase tracking-wider text-[#5C6770]">
              Where the flexibility buys the most rest
            </span>
            <h3 className="type-subsection-title text-slate-900 mt-1">
              {knee
                ? `Why ${knee.leeway_pct}% staffing flexibility is the sweet spot`
                : 'Flexibility vs. rest, point by point'}
            </h3>
            <p className="type-prose text-slate-600 mt-1.5 leading-relaxed">
              The first bit of extra flexibility buys a lot of improvement; after a point, allowing
              more barely helps. Pick any row — its own weekly payroll and uncovered hours are
              shown next to it:
            </p>

            <div className="mt-3 space-y-2 max-h-80 overflow-y-auto">
              {points.map((pt) => {
                const isSel = Math.abs(pt.leeway_pct - selectedLeewayPct) < 0.1;
                return (
                  <div
                    key={pt.point_index}
                    onClick={() => onSelectLeewayPct(pt.leeway_pct)}
                    role="button"
                    tabIndex={0}
                    aria-pressed={isSel}
                    onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); onSelectLeewayPct(pt.leeway_pct); } }}
                    className={`p-2.5 rounded-lg border cursor-pointer transition-colors flex items-center justify-between text-xs ${
                      isSel
                        ? 'bg-white border-[#7F8A92] border-l-4 border-l-[#2B3A42] font-semibold'
                        : 'bg-slate-50 border-[#7F8A92] hover:bg-white'
                    }`}
                  >
                    <div>
                      <span className="font-mono-tabular font-bold text-slate-900">
                        +{pt.leeway_pct}% flexibility
                      </span>
                      <span className="block text-xs text-slate-500">
                        {pt.label}
                        {pt.is_knee_point ? ' (sweet spot for rest)' : ''}
                      </span>
                    </div>
                    <span className="font-mono-tabular font-bold text-ink text-right">
                      {formatCurrency(pt.estimated_weekly_payroll)}/wk
                      <span className="block font-normal text-slate-500">
                        {pt.total_understaffing_hours}h uncovered
                      </span>
                    </span>
                  </div>
                );
              })}
            </div>
          </div>
        </div>
      </div>

      {/* Pareto Frontier Enumeration Table */}
      <div className="card overflow-hidden">
        <div className="p-4 sm:px-6 border-b border-slate-200 bg-slate-50">
          <h3 className="type-subsection-title text-slate-700">
            Every option, side by side
          </h3>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full text-left border-collapse text-xs">
            <thead>
              <tr className="border-b border-slate-200 text-xs font-bold uppercase tracking-wider text-slate-500 bg-white">
                <th className="py-3 px-4">Option</th>
                <th className="py-3 px-3 text-right">
                  <Term explanation="How far above the leanest possible shift count this option lets the solver go. It is not a payroll budget: payroll and coverage are shown in their own columns and can move either way as this rises.">Staffing flexibility</Term>
                </th>
                <th className="py-3 px-3 text-right">Weekly payroll</th>
                <th className="py-3 px-3 text-right">
                  <Term explanation="Hours this week where fewer people are scheduled than you asked for, summed across all 168 hours. Higher is worse, and it does not track the flexibility column.">Uncovered hours</Term>
                </th>
                <th className="py-3 px-3 text-right">
                  <Term explanation="A rough score of how much scheduling strain is in this version — long stretches without a day off, back-to-back closing-then-opening shifts, and similar. Lower is better.">Staff strain</Term>
                </th>
                <th className="py-3 px-3 text-right">
                  <Term explanation="Number of shift patterns this option builds. These are schedule slots, not a requirement to hire that many people — real staff get assigned to them afterward.">Headcount</Term>
                </th>
                <th className="py-3 px-3 text-right">
                  <Term explanation="Share of shift patterns that get both Saturday and Sunday off together in a given week.">Full weekends off</Term>
                </th>
                <th className="py-3 px-4 text-right">Action</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-200 font-mono-tabular">
              {points.map((pt: ParetoPoint) => {
                const isSel = Math.abs(pt.leeway_pct - selectedLeewayPct) < 0.1;
                return (
                  <tr
                    key={pt.point_index}
                    className={isSel ? 'bg-accent-soft' : 'hover:bg-slate-50'}
                  >
                    <td className="py-2.5 px-4 font-sans font-semibold text-slate-900">
                      {pt.label}
                      {pt.is_knee_point && (
                        <span className="ml-2 px-1.5 py-0.5 rounded text-xs bg-[#E4E9EC] text-[#2B3A42] border border-[#7F8A92] before:content-[''] before:inline-block before:w-2 before:h-2 before:rounded-full before:bg-[#C28B47] before:mr-1.5 before:align-middle">
                          Sweet spot
                        </span>
                      )}
                    </td>
                    <td className="py-2.5 px-3 text-right">+{pt.leeway_pct}%</td>
                    <td className="py-2.5 px-3 text-right font-bold text-slate-900">
                      {formatCurrency(pt.estimated_weekly_payroll)}
                    </td>
                    <td
                      className={`py-2.5 px-3 text-right font-bold ${
                        pt.total_understaffing_hours > 0 ? 'text-amber-800' : 'text-emerald-700'
                      }`}
                    >
                      {pt.total_understaffing_hours}h
                      {pt.total_understaffing_hours === worstUncovered && worstUncovered > 0 && (
                        <span className="block text-xs font-sans font-semibold text-amber-800">
                          worst coverage here
                        </span>
                      )}
                    </td>
                    <td className="py-2.5 px-3 text-right font-bold text-[#2B3A42]">
                      {pt.obj_ergo.toFixed(1)}
                    </td>
                    <td className="py-2.5 px-3 text-right">{pt.employee_count}</td>
                    <td className="py-2.5 px-3 text-right">{pt.full_weekends_off_pct}%</td>
                    <td className="py-2.5 px-4 text-right font-sans">
                      <Button
                        size="sm"
                        variant={isSel ? 'accent' : 'secondary'}
                        onClick={() => onSelectLeewayPct(pt.leeway_pct)}
                      >
                        {isSel ? 'Active' : 'Apply'}
                      </Button>
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
