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
  const knee = points.find((p) => p.is_knee_point);

  // The y gridlines were computed as maxErgo * (1 - frac), which forces the
  // scale to zero. Staff strain across a frontier typically spans a narrow
  // band well above zero, so roughly 60% of a 450px card was empty and the
  // curve read as far flatter than the numbers are. The axis is domained to
  // the data with a margin instead, and the chart says so underneath rather
  // than letting a truncated axis pass for a full one.
  const ergoValues = points.map((p) => p.obj_ergo);
  const ergoLow = ergoValues.length > 0 ? Math.min(...ergoValues) : 0;
  const ergoHigh = ergoValues.length > 0 ? Math.max(...ergoValues) : 1;
  const ergoPad = Math.max((ergoHigh - ergoLow) * 0.12, 0.5);
  const minErgo = ergoLow - ergoPad;
  const maxErgo = ergoHigh + ergoPad;
  const axisStartsAtZero = minErgo <= 0;

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

  // The x axis carried no ticks and no values at all, only a centred caption.
  // Its positions come from the solver's shift total, which several options
  // can share, so a tick is placed at each distinct position and named for the
  // staffing flexibility that lands there — the thing the reader is choosing
  // between. Never for a cost: flexibility is not payroll, and each option's
  // payroll is its own column in the table below.
  const xTicks = Array.from(
    points
      .reduce((acc, pt) => {
        const key = Math.round(toX(pt.obj_shift));
        const at = acc.get(key);
        if (at) at.push(pt.leeway_pct);
        else acc.set(key, [pt.leeway_pct]);
        return acc;
      }, new Map<number, number[]>())
      .entries()
  )
    .sort((a, b) => a[0] - b[0])
    .map(([x, leeways], idx, all) => {
      const low = Math.min(...leeways);
      const high = Math.max(...leeways);
      // A centred label on the first or last tick hangs off the plot, so the
      // outermost two are anchored inwards instead.
      const anchor: 'start' | 'middle' | 'end' =
        idx === 0 && x - padL < 24 ? 'start' : idx === all.length - 1 && svgW - padR - x < 24 ? 'end' : 'middle';
      return { x, anchor, label: low === high ? `+${low}%` : `+${low}–${high}%` };
    });

  // Five y gridlines across the domained range.
  const yTicks = [0, 0.25, 0.5, 0.75, 1].map((frac) => {
    const value = minErgo + (maxErgo - minErgo) * (1 - frac);
    return {
      y: padT + plotH * frac,
      // One decimal only when the band is too narrow for whole numbers to differ.
      label: maxErgo - minErgo < 8 ? value.toFixed(1) : String(Math.round(value)),
    };
  });

  /**
   * Keeps a point's label inside the plot.
   *
   * Labels were drawn at a fixed (cx + 8, cy - 8), so the leftmost point —
   * which sits at the top of the curve — pushed its label over the top edge of
   * the chart, and coincident points stacked their labels on top of each
   * other. Only four points are worth naming, and each one is nudged back
   * inside the plot rather than being allowed to overrun it.
   */
  const LABEL_CH = 7.2; // approx. advance width of the mono digits at this size
  function labelPlacement(cx: number, cy: number, text: string) {
    const width = text.length * LABEL_CH;
    // 14 clears the selected point's 11px halo rather than running into it.
    const overflowsRight = cx + 14 + width > svgW - padR;
    return {
      x: overflowsRight ? Math.max(padL + 2, cx - 14) : Math.min(cx + 14, svgW - padR - width),
      // 14 clears the ascender of the text at its own baseline.
      y: Math.min(Math.max(cy - 10, padT + 14), padT + plotH - 4),
      anchor: overflowsRight ? ('end' as const) : ('start' as const),
    };
  }

  // Naming every point made them collide, and options that share a shift
  // total sit on exactly the same coordinates, so their labels used to print
  // on top of one another. Four points carry the story, taken in priority
  // order, and one is dropped if its box would overlap a label already
  // placed. The frontier list beside the chart names every option in full.
  const labelPlacements = (() => {
    const selected = points.find((p) => Math.abs(p.leeway_pct - selectedLeewayPct) < 0.1);
    const candidates = [selected, knee, points[0], points[points.length - 1]].filter(
      (p): p is ParetoPoint => p !== undefined
    );
    const placed: { x: number; y: number; w: number }[] = [];
    const out = new Map<number, { x: number; y: number; anchor: 'start' | 'end'; text: string }>();
    for (const pt of candidates) {
      if (out.has(pt.point_index)) continue;
      const text = `+${pt.leeway_pct}% flex`;
      const at = labelPlacement(toX(pt.obj_shift), toY(pt.obj_ergo), text);
      const w = text.length * LABEL_CH;
      const left = at.anchor === 'end' ? at.x - w : at.x;
      const collides = placed.some(
        (b) => Math.abs(b.y - at.y) < 14 && left < b.x + b.w + 6 && b.x < left + w + 6
      );
      if (collides) continue;
      placed.push({ x: left, y: at.y, w });
      out.set(pt.point_index, { ...at, text });
    }
    return out;
  })();

  return (
    <div className="space-y-5">
      {/* Plain-language explanation */}
      <div className="card p-5">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div className="max-w-3xl">
            <span className="text-xs font-bold uppercase tracking-wider text-muted">
              Give the solver more room, get a better-rested schedule
            </span>
            <h2 className="type-section-title text-ink mt-0.5">
              Every point below is a real, complete schedule — not a theory
            </h2>
            <p className="type-prose text-ink-soft mt-1 leading-relaxed">
              Staffing flexibility is how far above the leanest possible shift count the solver may
              go. Moving right means more shifts in the schedule. Moving down means less of the
              stuff that burns people out — long stretches without a day off, back-to-back
              closing-then-opening shifts, lost weekends. More flexibility is not the same as more
              money and not the same as better coverage: each option below shows its own weekly
              payroll and its own uncovered hours, and both can move either way.
            </p>
            <p className="type-prose text-ink-soft mt-1 leading-relaxed">
              Every payroll figure below prices {pricedLineCount} of {lineCount} shift patterns —
              the ones that have somebody assigned. Patterns with nobody on them cost nothing here
              and would cost more once staffed.
            </p>
          </div>
          <div className="card p-4 text-xs">
            <span className="text-xs font-bold uppercase tracking-wider text-muted block">
              Currently applied
            </span>
            <span className="text-sm font-bold font-mono-tabular text-ink">
              +{selectedLeewayPct}% staffing flexibility allowed
            </span>
          </div>
        </div>
      </div>

      {/* Interactive SVG Pareto Curve + Knee-Point Callout */}
      <div className="grid grid-cols-1 lg:grid-cols-12 gap-5">
        <div className="lg:col-span-8 card p-5">
          <div className="flex items-center justify-between mb-3">
            <h3 className="type-subsection-title text-ink-soft">
              Flexibility vs. rest — click any point to apply it
            </h3>
            <div className="flex items-center gap-3 text-xs">
              {knee && (
                <span className="inline-flex items-center gap-1.5 text-ink-soft">
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
            {/* Decorative: a screen reader read the axis and point labels as
                loose unstructured text. The frontier list beside it and the
                table below are the keyboard- and reader-accessible versions. */}
            <svg
              aria-hidden="true"
              viewBox={`0 0 ${svgW} ${svgH}`}
              className="w-full h-auto bg-slate-50/60 rounded-lg border border-border-control"
            >
              {/* Horizontal grid lines, over the data's own range */}
              {yTicks.map((tick, idx) => (
                <g key={`y${idx}`}>
                  <line
                    x1={padL}
                    y1={tick.y}
                    x2={svgW - padR}
                    y2={tick.y}
                    className="stroke-border-subtle"
                    strokeDasharray="4 4"
                  />
                  <text
                    x={padL - 8}
                    y={tick.y + 4}
                    textAnchor="end"
                    className="text-xs fill-muted font-mono-tabular"
                  >
                    {tick.label}
                  </text>
                </g>
              ))}

              {/* X axis: a rule, a tick per distinct position, and its value */}
              <line
                x1={padL}
                y1={padT + plotH}
                x2={svgW - padR}
                y2={padT + plotH}
                className="stroke-border-control"
              />
              {xTicks.map((tick) => (
                <g key={`x${tick.x}`}>
                  <line
                    x1={tick.x}
                    y1={padT + plotH}
                    x2={tick.x}
                    y2={padT + plotH + 5}
                    className="stroke-border-control"
                  />
                  <text
                    x={tick.x}
                    y={padT + plotH + 18}
                    textAnchor={tick.anchor}
                    className="text-xs fill-muted font-mono-tabular"
                  >
                    {tick.label}
                  </text>
                </g>
              ))}

              {/* Axes Labels */}
              <text
                x={padL + plotW / 2}
                y={svgH - 8}
                textAnchor="middle"
                className="text-xs font-semibold fill-ink-soft"
              >
                Staffing flexibility allowed · more shifts scheduled →
              </text>
              <text
                x={16}
                y={padT + plotH / 2}
                textAnchor="middle"
                transform={`rotate(-90, 16, ${padT + plotH / 2})`}
                className="text-xs font-semibold fill-ink-soft"
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
                    {(() => {
                      const at = labelPlacements.get(pt.point_index);
                      if (!at) return null;
                      return (
                        <text
                          x={at.x}
                          y={at.y}
                          textAnchor={at.anchor}
                          className="text-xs font-mono-tabular font-bold fill-ink"
                        >
                          {at.text}
                        </text>
                      );
                    })()}
                  </g>
                );
              })}
            </svg>
            {!axisStartsAtZero && (
              <p className="mt-1.5 text-xs text-muted">
                The strain scale covers {ergoLow.toFixed(1)}–{ergoHigh.toFixed(1)}, the range
                these options actually span. It does not start at zero, so the slope shows how
                much the options differ from each other, not how large they are.
              </p>
            )}
          </div>
        </div>

        {/* Cost-vs-rest frontier, point by point */}
        <div className="lg:col-span-4 card p-5 flex flex-col justify-between">
          <div>
            <span className="text-xs font-bold uppercase tracking-wider text-muted">
              Where the flexibility buys the most rest
            </span>
            <h3 className="type-subsection-title text-ink mt-1">
              {knee
                ? `Why ${knee.leeway_pct}% staffing flexibility is the sweet spot`
                : 'Flexibility vs. rest, point by point'}
            </h3>
            <p className="type-prose text-ink-soft mt-1.5 leading-relaxed">
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
                        ? 'bg-white border-border-control border-l-4 border-l-ink font-semibold'
                        : 'bg-surface-subtle border-border-control hover:bg-white'
                    }`}
                  >
                    <div>
                      <span className="font-mono-tabular font-bold text-ink">
                        +{pt.leeway_pct}% flexibility
                      </span>
                      <span className="block text-xs text-muted">
                        {pt.label}
                        {pt.is_knee_point ? ' (sweet spot for rest)' : ''}
                      </span>
                    </div>
                    <span className="font-mono-tabular font-bold text-ink text-right">
                      {formatCurrency(pt.estimated_weekly_payroll)}/wk
                      <span className="block font-normal text-muted">
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
        <div className="p-4 sm:px-6 border-b border-border-subtle bg-surface-subtle">
          <h3 className="type-subsection-title text-ink-soft">
            Every option, side by side
          </h3>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full text-left border-collapse text-xs">
            <thead>
              <tr className="border-b border-border-subtle text-xs font-bold uppercase tracking-wider text-muted bg-white">
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
            <tbody className="divide-y divide-border-subtle font-mono-tabular">
              {points.map((pt: ParetoPoint) => {
                const isSel = Math.abs(pt.leeway_pct - selectedLeewayPct) < 0.1;
                return (
                  <tr
                    key={pt.point_index}
                    className={isSel ? 'bg-accent-soft' : 'hover:bg-surface-subtle'}
                  >
                    <td className="py-2.5 px-4 font-sans font-semibold text-ink">
                      {pt.label}
                      {pt.is_knee_point && (
                        <span className="ml-2 px-1.5 py-0.5 rounded text-xs bg-surface-sunken text-ink border border-border-control before:content-[''] before:inline-block before:w-2 before:h-2 before:rounded-full before:bg-warning before:mr-1.5 before:align-middle">
                          Sweet spot
                        </span>
                      )}
                    </td>
                    <td className="py-2.5 px-3 text-right">+{pt.leeway_pct}%</td>
                    <td className="py-2.5 px-3 text-right font-bold text-ink">
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
                    <td className="py-2.5 px-3 text-right font-bold text-ink">
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
