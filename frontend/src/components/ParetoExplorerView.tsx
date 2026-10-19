import React from 'react';
import { ParetoPoint, SolveResponse } from '../types';

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
      {/* Top Explanation & Becker Table 7 Law Card */}
      <div className="enterprise-card p-5">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div className="max-w-3xl">
            <span className="text-[11px] font-bold uppercase tracking-wider text-indigo-700">
              Schedule Flexibility vs. Overtime Optimization
            </span>
            <h2 className="text-base font-bold text-slate-900 mt-0.5">
              Pareto Trade-Off Between Shift Design Quality (obj^shift) & Schedule Ergonomics (obj^ergo)
            </h2>
            <p className="text-xs text-slate-600 mt-1 leading-relaxed">
              By constraining <span className="font-mono-tabular">obj^ergo ≤ ub^ergo − (ub^ergo − lb^ergo)·(i/n)</span>{' '}
              (Eq. 23), ShiftFlow Studio maps the exact Pareto-efficient frontier. Click any point on
              the curve or table below to immediately re-calibrate the active roster.
            </p>
          </div>
          <div className="px-4 py-2.5 rounded-xl bg-indigo-50 border border-indigo-200 text-xs">
            <span className="text-[10px] font-bold uppercase tracking-wider text-indigo-700 block">
              Active Calibration
            </span>
            <span className="text-sm font-bold font-mono-tabular text-indigo-950">
              +{selectedLeewayPct}% Shift Design Leeway
            </span>
          </div>
        </div>
      </div>

      {/* Interactive SVG Pareto Curve + Knee-Point Callout */}
      <div className="grid grid-cols-1 lg:grid-cols-12 gap-5">
        <div className="lg:col-span-8 enterprise-card-elevated p-5">
          <div className="flex items-center justify-between mb-3">
            <h3 className="text-xs font-bold uppercase tracking-wider text-slate-700">
              Interactive Pareto-Efficient Frontier (Click Any Point to Apply)
            </h3>
            <div className="flex items-center gap-3 text-[11px]">
              <span className="inline-flex items-center gap-1.5 text-slate-600">
                <span className="w-2.5 h-2.5 rounded-full bg-amber-500" />
                5% Knee Point (+27.34% Ergo)
              </span>
              <span className="inline-flex items-center gap-1.5 text-indigo-700 font-semibold">
                <span className="w-2.5 h-2.5 rounded-full bg-indigo-600" />
                Active Schedule
              </span>
            </div>
          </div>

          <div className="w-full overflow-x-auto">
            <svg
              viewBox={`0 0 ${svgW} ${svgH}`}
              className="w-full h-auto bg-slate-50/60 rounded-xl border border-slate-200"
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
                      className="text-[10px] fill-slate-500 font-mono-tabular"
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
                className="text-[11px] font-semibold fill-slate-700"
              >
                Shift Design Objective (obj^shift = W^E·e + W^NS·∑ϕ_t + ∑(W^O·ω_gi + W^U·τ_gi)) →
              </text>
              <text
                x={16}
                y={padT + plotH / 2}
                textAnchor="middle"
                transform={`rotate(-90, 16, ${padT + plotH / 2})`}
                className="text-[11px] font-semibold fill-slate-700"
              >
                Ergonomics Penalty (obj^ergo) ↓
              </text>

              {/* Pareto Curve Polyline */}
              <polyline
                fill="none"
                stroke="#4f46e5"
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
                        fill="rgba(79, 70, 229, 0.15)"
                        stroke="#4f46e5"
                        strokeWidth="1.5"
                      />
                    )}
                    <circle
                      cx={cx}
                      cy={cy}
                      r={pt.is_knee_point || isSel ? 6.5 : 5}
                      fill={
                        isSel
                          ? '#4f46e5'
                          : pt.is_knee_point
                          ? '#f59e0b'
                          : '#ffffff'
                      }
                      stroke={pt.is_knee_point ? '#b45309' : '#4f46e5'}
                      strokeWidth="2"
                    />
                    {(pt.is_knee_point || isSel || pt.leeway_pct === 0 || pt.leeway_pct === 10 || pt.leeway_pct === 50) && (
                      <text
                        x={cx + 8}
                        y={cy - 8}
                        className="text-[10px] font-mono-tabular font-bold fill-slate-800"
                      >
                        +{pt.leeway_pct}% (−{pt.ergo_improvement_pct}% Ergo)
                      </text>
                    )}
                  </g>
                );
              })}
            </svg>
          </div>
        </div>

        {/* Becker (2026) Table 7 Empirical Benchmark Reference */}
        <div className="lg:col-span-4 enterprise-card p-5 flex flex-col justify-between">
          <div>
            <span className="text-[11px] font-bold uppercase tracking-wider text-slate-500">
              Operational Rest & Efficiency Benchmark
            </span>
            <h3 className="text-sm font-bold text-slate-900 mt-1">
              Why the 5% Knee Point Matters
            </h3>
            <p className="text-xs text-slate-600 mt-1.5 leading-relaxed">
              Across 279 benchmark instances (620,730 MILP solves), the Pareto frontier descends
              steeply at first before flattening:
            </p>

            <div className="mt-3 space-y-2">
              {[
                { lw: 1, gain: '8.37%', desc: 'Micro shift boundary adjustment' },
                { lw: 5, gain: '27.34%', desc: 'Critical Knee Point (Best ROI)' },
                { lw: 10, gain: '39.46%', desc: 'Zero extra payroll headcount' },
                { lw: 20, gain: '54.64%', desc: 'Aggressive weekend recovery' },
                { lw: 50, gain: '79.06%', desc: 'Ergonomics-first regime' },
                { lw: 75, gain: '89.71%', desc: 'Near-zero ergonomic penalty' },
              ].map((row) => (
                <div
                  key={row.lw}
                  onClick={() => onSelectLeewayPct(row.lw)}
                  className={`p-2.5 rounded-lg border cursor-pointer transition-colors flex items-center justify-between text-xs ${
                    Math.abs(selectedLeewayPct - row.lw) < 0.1
                      ? 'bg-indigo-50 border-indigo-500 font-semibold'
                      : 'bg-slate-50 border-slate-200 hover:bg-white'
                  }`}
                >
                  <div>
                    <span className="font-mono-tabular font-bold text-slate-900">
                      +{row.lw}% SD Increase
                    </span>
                    <span className="block text-[11px] text-slate-500">{row.desc}</span>
                  </div>
                  <span className="font-mono-tabular font-bold text-emerald-700">
                    +{row.gain} Ergo
                  </span>
                </div>
              ))}
            </div>
          </div>
        </div>
      </div>

      {/* Pareto Frontier Enumeration Table */}
      <div className="enterprise-card overflow-hidden">
        <div className="p-4 sm:px-6 border-b border-slate-200 bg-slate-50">
          <h3 className="text-xs font-bold uppercase tracking-wider text-slate-700">
            Enumerated Pareto-Optimal Schedule Points
          </h3>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full text-left border-collapse text-xs">
            <thead>
              <tr className="border-b border-slate-200 text-[11px] font-bold uppercase tracking-wider text-slate-500 bg-white">
                <th className="py-3 px-4">Pareto Regime</th>
                <th className="py-3 px-3 text-right">SD Leeway</th>
                <th className="py-3 px-3 text-right">obj^shift</th>
                <th className="py-3 px-3 text-right">obj^ergo</th>
                <th className="py-3 px-3 text-right">Ergo Improvement</th>
                <th className="py-3 px-3 text-right">Cohorts (e)</th>
                <th className="py-3 px-3 text-right">Free Weekends</th>
                <th className="py-3 px-4 text-right">Action</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-200 font-mono-tabular">
              {points.map((pt: ParetoPoint) => {
                const isSel = Math.abs(pt.leeway_pct - selectedLeewayPct) < 0.1;
                return (
                  <tr
                    key={pt.point_index}
                    className={isSel ? 'bg-indigo-50/60' : 'hover:bg-slate-50'}
                  >
                    <td className="py-2.5 px-4 font-sans font-semibold text-slate-900">
                      {pt.label}
                      {pt.is_knee_point && (
                        <span className="ml-2 px-1.5 py-0.5 rounded text-[10px] bg-amber-100 text-amber-800 border border-amber-300">
                          Knee Point
                        </span>
                      )}
                    </td>
                    <td className="py-2.5 px-3 text-right">+{pt.leeway_pct}%</td>
                    <td className="py-2.5 px-3 text-right font-bold text-slate-900">
                      {pt.obj_shift.toFixed(1)}
                    </td>
                    <td className="py-2.5 px-3 text-right font-bold text-emerald-700">
                      {pt.obj_ergo.toFixed(1)}
                    </td>
                    <td className="py-2.5 px-3 text-right text-indigo-700 font-semibold">
                      +{pt.ergo_improvement_pct.toFixed(2)}%
                    </td>
                    <td className="py-2.5 px-3 text-right">{pt.employee_count}</td>
                    <td className="py-2.5 px-3 text-right">{pt.full_weekends_off_pct}%</td>
                    <td className="py-2.5 px-4 text-right font-sans">
                      <button
                        type="button"
                        onClick={() => onSelectLeewayPct(pt.leeway_pct)}
                        className={`px-2.5 py-1 rounded text-xs font-semibold ${
                          isSel
                            ? 'bg-indigo-600 text-white'
                            : 'bg-slate-100 hover:bg-slate-200 text-slate-700'
                        }`}
                      >
                        {isSel ? 'Active' : 'Apply'}
                      </button>
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
