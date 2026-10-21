import React, { useState } from 'react';
import { SolveResponse } from '../types';
import { DAYS_OF_WEEK } from '../services/api';
import { Term } from './ui/Term';

interface CoverageHeatmapViewProps {
  solution: SolveResponse;
}

/**
 * The 5-step diverging ramp the grid is painted with.
 *
 * Before this, every hour with `diff < 0` took one flat tint, so an hour short
 * by 1 and an hour short by 5 looked the same, and all four states sat within
 * a couple of points of 85% luminance. The ramp below is centred on "on
 * target" — the lightest step — and darkens towards both tails, so size reads
 * off the fill and direction off the hue.
 *
 * Deepening the fills moves the ground under the text, so each step names the
 * text token measured against it. `ratio` is the measured WCAG 2.1 contrast of
 * `ink` on `fill`; every step clears 4.5:1 and `coverageRamp.test.tsx`
 * recomputes all six from these hexes and re-checks them against index.css.
 * The hexes here are a mirror of the tokens; index.css is the source of truth.
 */
export interface CoverageRampStep {
  id: string;
  /** What the step means, as the legend prints it. */
  legend: string;
  /** Tailwind utilities: fill, text and border, all from design tokens. */
  classes: string;
  /** Measured, for the contrast gate. */
  fill: string;
  ink: string;
  ratio: number;
}

export const COVERAGE_RAMP: CoverageRampStep[] = [
  {
    id: 'short-strong',
    legend: 'Short by 2 or more',
    classes: 'bg-status-risk-strong text-card border-status-risk-strong font-bold',
    fill: '#9F3A32',
    ink: '#FFFFFF',
    ratio: 6.72,
  },
  {
    id: 'short-mid',
    legend: 'Short by 1',
    classes: 'bg-status-risk-mid text-status-risk-mid-ink border-status-risk font-bold',
    fill: '#EFBCB9',
    ink: '#862F28',
    ratio: 5.13,
  },
  {
    id: 'on-target',
    legend: 'On target',
    classes: 'bg-status-ok-soft text-status-ok-ink border-status-ok',
    fill: '#EAF0EC',
    ink: '#3E5C50',
    ratio: 6.37,
  },
  {
    id: 'over-mid',
    legend: 'Extra of 1',
    classes: 'bg-status-watch-mid text-status-watch-mid-ink border-status-watch',
    fill: '#EED7B8',
    ink: '#6B4A1C',
    ratio: 5.74,
  },
  {
    id: 'over-strong',
    legend: 'Extra of 2 or more',
    classes: 'bg-status-watch-strong text-card border-status-watch-strong',
    fill: '#805722',
    ink: '#FFFFFF',
    ratio: 6.36,
  },
];

/** Hours with no demand are outside the ramp: they are not a coverage result. */
export const COVERAGE_CLOSED_STEP: CoverageRampStep = {
  id: 'closed',
  legend: 'Closed — no staffing required',
  classes: 'bg-surface-subtle text-muted border-border-subtle',
  fill: '#F8FAFC',
  ink: '#5C6770',
  ratio: 5.53,
};

/** Magnitude at which a direction takes the ramp's deepest step. */
const DEEP_STEP_AT = 2;

export function coverageRampStep(diff: number, isClosed: boolean): CoverageRampStep {
  if (isClosed) return COVERAGE_CLOSED_STEP;
  if (diff <= -DEEP_STEP_AT) return COVERAGE_RAMP[0];
  if (diff < 0) return COVERAGE_RAMP[1];
  if (diff === 0) return COVERAGE_RAMP[2];
  if (diff < DEEP_STEP_AT) return COVERAGE_RAMP[3];
  return COVERAGE_RAMP[4];
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
          <span className="text-xs font-bold uppercase tracking-wider text-muted">
            24-Hour Coverage
          </span>
          <h2 className="type-section-title text-ink mt-0.5">
            Scheduled vs. <Term explanation="How many people you need in each hour.">required</Term> staff, hour by hour across the week
          </h2>
          <p className="type-prose text-ink-soft mt-0.5">
            Check scheduled staff each hour against the need: short or extra.
          </p>
          <p className="text-xs text-muted mt-1.5 max-w-2xl">
            "Scheduled" counts rotation <Term explanation="A repeating work/rest pattern over the cycle — not necessarily one specific named person, especially before real staff are assigned.">lines</Term> on duty that hour, not individual people — in planning
            mode (no real staff added yet) this can look uneven day to day even though the underlying
            demand is smooth, simply because a small number of rotating lines happen to line up
            differently on different days. That evens out once real staff are assigned across lines.
          </p>
        </div>

        {/* Without flex-wrap this row sat 534px wide and forced the whole page
            to scroll sideways at 375px (scrollWidth 571 vs clientWidth 375). */}
        <div className="flex flex-wrap items-center gap-3">
          <div className="px-3.5 py-2 rounded-lg bg-surface-subtle border border-border-subtle text-xs font-mono-tabular">
            <span className="text-muted block text-xs">Scheduled Hrs</span>
            <strong className="text-ink text-sm">{totalScheduled}h</strong>
          </div>
          <div className="px-3.5 py-2 rounded-lg bg-surface-sunken text-ink border border-border-control text-xs font-mono-tabular">
            <span className="text-ink block text-xs before:content-[''] before:inline-block before:w-2 before:h-2 before:rounded-full before:bg-warning before:mr-1.5 before:align-middle">Understaffed hours</span>
            <strong className="text-ink text-sm">{totalUnder}h</strong>
          </div>
          <div className="px-3.5 py-2 rounded-lg bg-surface-sunken text-ink border border-border-control text-xs font-mono-tabular">
            <span className="text-ink block text-xs">Overstaffed hours</span>
            <strong className="text-ink text-sm">{totalOver}h</strong>
          </div>

          <div className="inline-flex rounded-md border border-border-control p-0.5 bg-surface">
            <button
              type="button"
              aria-pressed={displayMode === 'scheduled'}
              onClick={() => setDisplayMode('scheduled')}
              className={`px-3 py-1.5 rounded-md text-xs font-semibold ${
                displayMode === 'scheduled'
                  ? 'bg-white text-ink shadow-[0_1px_2px_rgba(43,58,66,0.08)]'
                  : 'text-ink-soft'
              }`}
            >
              Scheduled / Required staff
            </button>
            <button
              type="button"
              aria-pressed={displayMode === 'deviation'}
              onClick={() => setDisplayMode('deviation')}
              className={`px-3 py-1.5 rounded-md text-xs font-semibold ${
                displayMode === 'deviation'
                  ? 'bg-white text-ink shadow-[0_1px_2px_rgba(43,58,66,0.08)]'
                  : 'text-ink-soft'
              }`}
            >
              Net Difference (over minus under)
            </button>
          </div>
        </div>
      </div>

      {/* 7 x 24 Interval Heatmap Matrix */}
      <div className="card p-5 overflow-x-auto">
        <h3 className="type-subsection-title text-ink-soft">
          24-Hour × 7-Day Interval Staffing Heatmap
        </h3>

        {/* Legend. The grid had none, so a reader had to infer four colours
            from the numbers inside them. Each swatch is painted with the same
            class string the cells use, so the two cannot drift apart. */}
        <div className="mt-2 mb-3.5">
          <p className="text-xs text-muted mb-1.5">
            Darker means further from the staffing you asked for. Every cell also prints its own
            figures, so the colour is a shortcut, not the only reading.
          </p>
          <ul className="flex flex-wrap items-center gap-1.5">
            {[...COVERAGE_RAMP, COVERAGE_CLOSED_STEP].map((step) => (
              <li key={step.id}>
                <span
                  className={`inline-block rounded border px-2 py-1 text-xs font-semibold ${step.classes}`}
                >
                  {step.legend}
                </span>
              </li>
            ))}
          </ul>
        </div>

        <table className="w-full border-collapse text-center text-xs font-mono-tabular">
          <thead>
            <tr className="border-b border-border-subtle text-muted">
              <th className="py-2 px-3 text-left font-sans font-bold text-ink-soft">
                Day \ Hour
              </th>
              {Array.from({ length: 24 }, (_, hr) => (
                <th key={hr} className="py-2 px-1 font-semibold">
                  {String(hr).padStart(2, '0')}
                </th>
              ))}
            </tr>
          </thead>
          <tbody className="divide-y divide-border-subtle">
            {DAYS_OF_WEEK.map((dayName, g) => {
              const cells = byDay[g] || [];
              return (
                <tr key={dayName}>
                  <th scope="row" className="py-2.5 px-3 text-left font-sans font-bold text-ink bg-slate-50/80 whitespace-nowrap">
                    {dayName}
                  </th>
                  {cells.map((c) => {
                    const diff = c.scheduled_staff - c.required_staff;
                    // 5-step diverging ramp: size reads off the fill, direction
                    // off the hue, and the text token flips at the midpoint so
                    // every step still clears 4.5:1 (see COVERAGE_RAMP above).
                    // Every cell also carries stateLabel with the exact figure,
                    // so colour is never the only encoding.
                    const cellStyle = coverageRampStep(
                      diff,
                      c.required_staff === 0 && c.scheduled_staff === 0
                    ).classes;
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
        <h3 className="type-subsection-title text-ink-soft mb-3">
          Shift Types: Active and Staff per Day
        </h3>
        <div className="overflow-x-auto">
          <table className="w-full text-left border-collapse text-xs">
            <thead>
              <tr className="bg-surface-subtle border-b border-border-subtle text-xs font-bold uppercase tracking-wider text-muted">
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
            <tbody className="divide-y divide-border-subtle font-mono-tabular">
              {solution.shift_types.map((st) => {
                const total = st.daily_counts.reduce((a, b) => a + b, 0);
                return (
                  <tr key={st.type_id}>
                    <td className="py-2.5 px-3 font-bold text-ink">
                      {st.type_id}
                    </td>
                    <td className="py-2.5 px-3 font-sans">
                      <span
                        className={`shift-pill-${st.template_code} px-2 py-0.5 rounded text-xs font-semibold`}
                      >
                        {st.template_name}
                      </span>
                    </td>
                    <td className="py-2.5 px-3 text-ink-soft">
                      {st.formatted_window} ({st.duration_hours}h)
                    </td>
                    <td className="py-2.5 px-3 text-center">
                      <span
                        className={`px-2 py-0.5 rounded text-xs font-bold ${
                          st.active
                            ? 'bg-emerald-50 text-emerald-700 border border-emerald-200'
                            : 'bg-surface text-muted'
                        }`}
                      >
                        {st.active ? 'Active' : 'Off'}
                      </span>
                    </td>
                    {st.daily_counts.map((cnt, idx) => (
                      <td key={idx} className="py-2.5 px-2 text-center text-ink">
                        {cnt}
                      </td>
                    ))}
                    <td className="py-2.5 px-3 text-right font-bold text-ink">
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
