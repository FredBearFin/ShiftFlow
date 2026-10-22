import React, { useEffect, useState } from 'react';
import { ParetoPoint, SolveResponse } from '../types';
import { Term } from './ui/Term';
import { Button } from './ui/Button';
import {
  ScenarioSnapshot,
  MAX_SAVED_SCENARIOS,
  buildScenarioSnapshot,
  buildRosterComplianceCsv,
  loadSavedScenarios,
  saveSavedScenarios,
} from './paretoScenarios';

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
  const [savedScenarios, setSavedScenarios] = useState<ScenarioSnapshot[]>(() => loadSavedScenarios());
  const [scenarioLabel, setScenarioLabel] = useState('');
  const [scenarioMsg, setScenarioMsg] = useState<string | null>(null);
  const [exportMsg, setExportMsg] = useState<string | null>(null);

  // Optional polish: scenarios survive a reload too. If the browser blocks storage
  // this quietly no-ops — the scenarios still work for the rest of the tab.
  useEffect(() => {
    saveSavedScenarios(savedScenarios);
  }, [savedScenarios]);

  const handleSaveScenario = () => {
    // buildScenarioSnapshot falls back to a "+N% leeway" label when this is blank.
    const snapshot = buildScenarioSnapshot(solution, scenarioLabel, selectedLeewayPct);
    setSavedScenarios((prev) => {
      const next = [...prev, snapshot];
      return next.length > MAX_SAVED_SCENARIOS ? next.slice(next.length - MAX_SAVED_SCENARIOS) : next;
    });
    setScenarioMsg(
      savedScenarios.length >= MAX_SAVED_SCENARIOS
        ? `Saved "${snapshot.label}" — oldest saved scenario was dropped to keep up to ${MAX_SAVED_SCENARIOS}.`
        : `Saved "${snapshot.label}" for comparison.`
    );
    setScenarioLabel('');
    setTimeout(() => setScenarioMsg(null), 3500);
  };

  const handleRemoveScenario = (id: string) => {
    setSavedScenarios((prev) => prev.filter((s) => s.id !== id));
  };

  const handleExportCsv = () => {
    const csvContent = buildRosterComplianceCsv(solution);
    const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.setAttribute('download', `roster_fairness_${solution.archetype_id}.csv`);
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    URL.revokeObjectURL(url);
    setExportMsg('Roster & fairness CSV downloaded.');
    setTimeout(() => setExportMsg(null), 3000);
  };

  const minShift = Math.min(...points.map((p) => p.obj_shift));
  const maxShift = Math.max(...points.map((p) => p.obj_shift), minShift + 10);
  const minErgo = 0;
  const maxErgo = Math.max(...points.map((p) => p.obj_ergo), 20);
  const knee = points.find((p) => p.is_knee_point);

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

  // Several leeway levels can land on the exact same plotted pixel - e.g. with no
  // staff priced yet, every leeway level costs the same $0/wk, so 0%/10%/the knee
  // point can all coincide. Track how many labels have already claimed a spot so
  // repeats stack underneath instead of drawing illegible overlapping text.
  const labelPositionCounts = new Map<string, number>();

  return (
    <div className="space-y-5">
      {/* Plain-language explanation */}
      <div className="card p-5">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div className="max-w-3xl">
            <span className="text-xs font-bold uppercase tracking-wider text-[#5C6770]">
              Pay a little more, get a better-rested schedule
            </span>
            <h2 className="text-base font-bold text-slate-900 mt-0.5">
              Every point below is a real, complete schedule — not a theory
            </h2>
            <p className="text-xs text-slate-600 mt-1 leading-relaxed">
              Use this when you want to see what it'd cost to give your team an easier schedule.
              Moving right costs more in payroll. Moving down means less of the stuff that burns
              people out — long stretches without a day off, back-to-back closing-then-opening
              shifts, lost weekends. Click any point on the curve or table below to switch your
              actual schedule to it; each one shows its real weekly payroll cost.
            </p>
          </div>
          <div className="card p-4 text-xs">
            <span className="text-xs font-bold uppercase tracking-wider text-[#5C6770] block">
              Currently applied
            </span>
            <span className="text-sm font-bold font-mono-tabular text-[#2B3A42]">
              +{selectedLeewayPct}% extra payroll allowed
            </span>
          </div>
        </div>
      </div>

      {/* Interactive SVG Pareto Curve + Knee-Point Callout */}
      <div className="grid grid-cols-1 lg:grid-cols-12 gap-5">
        <div className="lg:col-span-8 card p-5">
          <div className="flex items-center justify-between mb-3">
            <h3 className="text-xs font-bold uppercase tracking-wider text-slate-700">
              Cost vs. rest — click any point to apply it
            </h3>
            <div className="flex items-center gap-3 text-xs">
              {knee && (
                <span className="inline-flex items-center gap-1.5 text-slate-600">
                  <span className="w-2.5 h-2.5 rounded-full bg-amber-500" />
                  {knee.leeway_pct}% is the sweet spot (${Math.round(knee.estimated_weekly_payroll).toLocaleString()}/wk)
                </span>
              )}
              <span className="inline-flex items-center gap-1.5 text-indigo-700 font-semibold">
                <span className="w-2.5 h-2.5 rounded-full bg-indigo-600" />
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
                More scheduling cost →
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
                stroke="#4f46e5"
                strokeWidth="2.5"
                points={polylinePoints}
              />

              {/* Interactive Pareto Points */}
              {points.map((pt) => {
                const cx = toX(pt.obj_shift);
                const cy = toY(pt.obj_ergo);
                const isSel = Math.abs(pt.leeway_pct - selectedLeewayPct) < 0.1;
                const shouldLabel =
                  pt.is_knee_point || isSel || pt.leeway_pct === 0 || pt.leeway_pct === 10 || pt.leeway_pct === 50;
                let labelStackIndex = 0;
                if (shouldLabel) {
                  const posKey = `${Math.round(cx)},${Math.round(cy)}`;
                  labelStackIndex = labelPositionCounts.get(posKey) ?? 0;
                  labelPositionCounts.set(posKey, labelStackIndex + 1);
                }
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
                    {shouldLabel && (
                      <text
                        x={cx + 8}
                        y={cy - 8 - labelStackIndex * 13}
                        className="text-xs font-mono-tabular font-bold fill-slate-800"
                      >
                        +{pt.leeway_pct}% cost · ${Math.round(pt.estimated_weekly_payroll).toLocaleString()}/wk
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
              Where the money buys the most rest
            </span>
            <h3 className="text-sm font-bold text-slate-900 mt-1">
              {knee ? `Why ${knee.leeway_pct}% extra cost is the sweet spot` : 'Cost vs. rest, point by point'}
            </h3>
            <p className="text-xs text-slate-600 mt-1.5 leading-relaxed">
              The first bit of extra spending buys a lot of improvement; after a point, paying more
              barely helps. Pick any row — its real weekly payroll is shown next to it:
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
                        +{pt.leeway_pct}% cost
                      </span>
                      <span className="block text-xs text-slate-500">
                        {pt.label}
                        {pt.is_knee_point ? ' (sweet spot)' : ''}
                      </span>
                    </div>
                    <span className="font-mono-tabular font-bold text-[#2B3A42]">
                      ${Math.round(pt.estimated_weekly_payroll).toLocaleString()}/wk
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
          <h3 className="text-xs font-bold uppercase tracking-wider text-slate-700">
            Every option, side by side
          </h3>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full text-left border-collapse text-xs">
            <thead>
              <tr className="border-b border-slate-200 text-xs font-bold uppercase tracking-wider text-slate-500 bg-white">
                <th className="py-3 px-4">Option</th>
                <th className="py-3 px-3 text-right">Extra cost</th>
                <th className="py-3 px-3 text-right">Weekly payroll</th>
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
                    className={isSel ? 'bg-indigo-50/60' : 'hover:bg-slate-50'}
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
                      ${Math.round(pt.estimated_weekly_payroll).toLocaleString()}
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

      {/* Scenario save/compare + roster & fairness export */}
      <div className="card p-5">
        <div className="flex flex-wrap items-start justify-between gap-4 mb-4">
          <div className="max-w-2xl">
            <span className="text-xs font-bold uppercase tracking-wider text-[#5C6770]">
              Save a couple, compare side by side
            </span>
            <h3 className="text-sm font-bold text-slate-900 mt-0.5">
              Pin whatever's on screen now, then try another leeway and compare
            </h3>
            <p className="text-xs text-slate-600 mt-1 leading-relaxed">
              Save the schedule currently applied (+{selectedLeewayPct}% leeway) under a short
              label — before/after a wizard change, or a couple of leeway settings you're
              weighing. Keeps up to {MAX_SAVED_SCENARIOS} at a time.
            </p>
          </div>
          <div className="flex flex-col items-end gap-2">
            <div className="flex items-center gap-2">
              <input
                type="text"
                value={scenarioLabel}
                onChange={(e) => setScenarioLabel(e.target.value)}
                placeholder={`e.g. "+${selectedLeewayPct}% leeway" or "Before wizard change"`}
                aria-label="Scenario label"
                className="text-xs border border-[#7F8A92] rounded-md px-3 py-1.5 w-56 bg-white"
              />
              <Button size="sm" variant="primary" onClick={handleSaveScenario}>
                Save this scenario
              </Button>
            </div>
            <Button size="sm" variant="secondary" onClick={handleExportCsv}>
              ↓ Export roster & fairness CSV
            </Button>
            {(scenarioMsg || exportMsg) && (
              <span className="text-xs font-semibold text-emerald-700 bg-emerald-50 border border-emerald-200 px-3 py-1.5 rounded-lg">
                ✓ {scenarioMsg || exportMsg}
              </span>
            )}
          </div>
        </div>

        {savedScenarios.length === 0 ? (
          <p className="text-xs text-slate-500 italic">
            No scenarios saved yet. Save this one, change the leeway above, then save again to compare.
          </p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-left border-collapse text-xs">
              <thead>
                <tr className="border-b border-slate-200 text-xs font-bold uppercase tracking-wider text-slate-500 bg-slate-50">
                  <th className="py-2.5 px-3">Scenario</th>
                  <th className="py-2.5 px-3 text-right">Leeway</th>
                  <th className="py-2.5 px-3 text-right">Weekly payroll</th>
                  <th className="py-2.5 px-3 text-right">Overtime hrs</th>
                  <th className="py-2.5 px-3 text-right">
                    <Term explanation="The same scheduling-strain score shown elsewhere in this view — long stretches without a day off, back-to-back closing-then-opening shifts, and similar. Lower is better.">Staff strain</Term>
                  </th>
                  <th className="py-2.5 px-3 text-right">Health index</th>
                  <th className="py-2.5 px-3 text-right">Full weekends off</th>
                  <th className="py-2.5 px-3 text-right">Clopenings</th>
                  <th className="py-2.5 px-3 text-right">Remove</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-200 font-mono-tabular">
                {savedScenarios.map((s) => (
                  <tr key={s.id} className="hover:bg-slate-50">
                    <td className="py-2.5 px-3 font-sans font-semibold text-slate-900">
                      {s.label}
                      <span className="block text-xs font-sans font-normal text-slate-500">
                        {s.employeeCount} shift patterns
                      </span>
                    </td>
                    <td className="py-2.5 px-3 text-right">+{s.selectedLeewayPct}%</td>
                    <td className="py-2.5 px-3 text-right font-bold text-slate-900">
                      ${Math.round(s.totalPayrollCost).toLocaleString()}
                    </td>
                    <td className="py-2.5 px-3 text-right">{s.totalOvertimeHours}h</td>
                    <td className="py-2.5 px-3 text-right">{s.ergoObjective.toFixed(1)}</td>
                    <td className="py-2.5 px-3 text-right">{s.healthIndexScore.toFixed(1)}</td>
                    <td className="py-2.5 px-3 text-right">{s.fullWeekendsOffPct}%</td>
                    <td className="py-2.5 px-3 text-right">{s.clopeningViolations}</td>
                    <td className="py-2.5 px-3 text-right font-sans">
                      <Button size="sm" variant="ghost" onClick={() => handleRemoveScenario(s.id)}>
                        Remove
                      </Button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
};
