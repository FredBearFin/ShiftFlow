import React from 'react';
import { SolveResponse } from '../types';
import { criterionLabelFor, criterionExplanationFor } from './criteriaLabels';
import { Term } from './ui/Term';

interface ErgonomicsAuditViewProps {
  solution: SolveResponse;
}

export const ErgonomicsAuditView: React.FC<ErgonomicsAuditViewProps> = ({
  solution,
}) => {
  const audit = solution.ergonomics_audit;
  const criteria = audit.criteria_breakdown;
  const maxPenalty = Math.max(...criteria.map((c) => c.weighted_penalty), 1);

  // Both of these were hardcoded ("/14", "6-week") and did not match a live solve.
  const handoffCount = solution.multigraph_nodes.length;
  const balancedHandoffs = solution.multigraph_nodes.filter((n) => n.is_balanced).length;
  const rotationWeeks = solution.employee_count;

  // Simple horizontal bar chart: one row per criterion, length proportional to its penalty.
  const chartW = 640;
  const rowH = 32;
  const chartH = criteria.length * rowH;
  const labelW = 190;
  const barAreaW = chartW - labelW - 60;

  // Ordered 3-step status ramp, ok -> watch -> risk (see index.css).
  // Applied as a class, not a fill="…" attribute: CSS custom properties do
  // not resolve inside SVG presentation attributes.
  const statusFillClass = (status: string) =>
    status === 'optimal'
      ? 'fill-status-ok'
      : status === 'acceptable'
      ? 'fill-status-watch'
      : 'fill-status-risk';

  return (
    <div className="space-y-5">
      {/* Plain-language summary */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        <div className="card p-5">
          <span className="text-xs font-bold uppercase tracking-wider text-slate-500">
            Ergonomics Health Index
          </span>
          <div className="flex items-baseline gap-3 mt-1">
            <span className="text-3xl font-bold font-mono-tabular text-ink">
              {audit.health_index_score}/100
            </span>
          </div>
          <p className="text-xs text-slate-600 mt-1.5">
            Higher is better. It is a score out of 100, not a percentage, and this tool only ever
            reports it between 55 and 99.5 — so a schedule never reads 0 and never reads 100.
          </p>
          <p className="type-prose text-slate-600 mt-1.5 pt-1.5 border-t border-slate-100">
            Separately, the fatigue penalty behind it: {audit.total_ergo_objective.toFixed(1)}{' '}
            penalty points across the {criteria.length} checks below, where lower is better, versus{' '}
            {audit.sequential_baseline_ergo.toFixed(1)} for a schedule built without any of them in
            mind. That's a{' '}
            <strong className="text-ink">{audit.ergo_improvement_pct}%</strong> reduction in
            the things that burn people out.
          </p>
        </div>

        <div className="card p-5">
          <span className="text-xs font-bold uppercase tracking-wider text-slate-500">
            Rest Between Shifts
          </span>
          <div className="flex items-baseline gap-3 mt-1">
            <span className="text-3xl font-bold font-mono-tabular text-ink">
              {audit.min_rest_hours_observed}h
            </span>
            {audit.clopening_violations > 0 && (
              <span className="px-2 py-0.5 rounded text-xs font-semibold bg-amber-50 text-amber-800 border border-amber-200">
                {audit.clopening_violations} too-short
              </span>
            )}
          </div>
          <p className="text-xs text-slate-600 mt-1.5">
            Shortest gap between the end of one shift and the start of the next, anywhere in the
            schedule.{' '}
            {audit.clopening_violations > 0
              ? `This tool aims for 16 hours between shifts but does not guarantee it: ${audit.clopening_violations} gap${
                  audit.clopening_violations === 1 ? '' : 's'
                } in this schedule fall short.`
              : 'This tool aims for 16 hours between shifts; no gap in this schedule falls short of it.'}
          </p>
        </div>

        <div className="card p-5">
          <span className="text-xs font-bold uppercase tracking-wider text-slate-500">
            <Term explanation="How many of the week's work and rest hand-offs line up. A hand-off is the point where one person's run of work days ends and their days off begin, so someone else has to pick the work up. When all 14 match, the rotation repeats week after week without gaps.">
              Rotation Balance
            </Term>
          </span>
          <div className="flex items-baseline gap-3 mt-1">
            <span className="text-3xl font-bold font-mono-tabular text-ink">
              {balancedHandoffs}/{handoffCount}
            </span>
          </div>
          <p className="text-xs text-slate-600 mt-1.5">
            How many of the {handoffCount} weekly work/rest hand-offs (one pair per day) line up
            cleanly, so the {rotationWeeks}-week rotation repeats without gaps or overlaps.
          </p>
        </div>
      </div>

      {/* Visual breakdown of the 8 checks */}
      <div className="card p-5">
        <h2 className="type-section-title text-slate-900">
          What's pulling the score down
        </h2>
        <p className="type-prose text-slate-500 mt-0.5 mb-3">
          Each bar is one thing this tool watches for. A longer bar doesn't always mean a bigger
          problem on its own — some checks (like weekend coverage) are weighted more heavily per
          occurrence and come up on almost every schedule, so they often show the longest bar even
          when there's nothing to fix. Check the "How often" and weight columns in the table below
          to see what's actually driving each bar.
        </p>
        {/* Decorative: the bar labels and point values read as loose
            unstructured text. The breakdown table below carries the same
            figures with real row and column headers. */}
        <svg aria-hidden="true" viewBox={`0 0 ${chartW} ${chartH}`} className="w-full h-auto">
          {criteria.map((c, idx) => {
            const barW = (c.weighted_penalty / maxPenalty) * barAreaW;
            const y = idx * rowH;
            return (
              <g key={c.criterion_id}>
                <text
                  x={labelW - 10}
                  y={y + rowH / 2 + 4}
                  textAnchor="end"
                  className="fill-slate-700"
                  style={{ fontSize: 11, fontWeight: 600 }}
                >
                  {criterionLabelFor(c.criterion_id, c.name)}
                </text>
                <rect
                  x={labelW}
                  y={y + 6}
                  width={Math.max(2, barW)}
                  height={rowH - 14}
                  rx={3}
                  className={statusFillClass(c.status)}
                  opacity={0.85}
                />
                <text
                  x={labelW + Math.max(2, barW) + 8}
                  y={y + rowH / 2 + 4}
                  className="fill-slate-500"
                  style={{ fontSize: 10, fontFamily: 'monospace' }}
                >
                  {c.weighted_penalty.toFixed(1)} pts{c.raw_violations_count > 0 ? ` · ${c.raw_violations_count}×` : ''}
                </text>
              </g>
            );
          })}
        </svg>
      </div>

      {/* Plain-language breakdown table */}
      <div className="card overflow-hidden">
        <div className="p-4 sm:px-6 border-b border-slate-200 bg-white">
          <h2 className="type-section-title text-slate-900">
            The {criteria.length} things this tool checks to avoid burning people out
          </h2>
        </div>

        <div className="overflow-x-auto">
          <table className="w-full text-left border-collapse text-xs">
            <thead>
              <tr className="bg-slate-50 border-b border-slate-200 text-xs font-bold uppercase tracking-wider text-slate-500">
                <th className="py-3 px-4">Check</th>
                <th className="py-3 px-3 text-right">How often</th>
                <th className="py-3 px-3 text-right">Weight</th>
                <th className="py-3 px-3 text-right">Penalty</th>
                <th className="py-3 px-4 text-center">Status</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-200">
              {criteria.map((c) => (
                <tr key={c.criterion_id} className="hover:bg-slate-50/80">
                  <td className="py-3 px-4">
                    <div className="font-semibold text-slate-900">
                      {criterionLabelFor(c.criterion_id, c.name)}
                    </div>
                    <div className="text-xs text-slate-500 mt-0.5">
                      {criterionExplanationFor(c.criterion_id, c.explanation)}
                    </div>
                  </td>
                  <td className="py-3 px-3 text-right font-mono-tabular font-semibold text-slate-800">
                    {c.raw_violations_count}×
                  </td>
                  <td className="py-3 px-3 text-right font-mono-tabular text-slate-500">
                    ×{c.base_weight}
                  </td>
                  <td className="py-3 px-3 text-right font-mono-tabular font-bold text-ink">
                    {c.weighted_penalty.toFixed(1)}
                  </td>
                  <td className="py-3 px-4 text-center">
                    <span
                      className={`px-2 py-0.5 rounded-full text-xs font-bold uppercase ${
                        c.status === 'optimal'
                          ? 'bg-status-ok-soft text-status-ok-ink border border-status-ok'
                          : c.status === 'acceptable'
                          ? 'bg-status-watch-soft text-status-watch-ink border border-status-watch'
                          : 'bg-status-risk-soft text-status-risk-ink border border-status-risk'
                      }`}
                    >
                      {c.status}
                    </span>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      {/* Weekly rotation hand-off balance */}
      <div className="card p-5">
        <div className="mb-3">
          <h3 className="type-subsection-title text-slate-700">
            Weekly rotation hand-offs
          </h3>
          <p className="type-prose text-slate-500 mt-0.5">
            For each day, how many people are starting a work stretch versus starting a rest
            stretch — these should match up so the {rotationWeeks}-week rotation keeps repeating
            cleanly.
          </p>
        </div>

        <div className="grid grid-cols-2 sm:grid-cols-4 lg:grid-cols-7 gap-2.5">
          {[0, 1, 2, 3, 4, 5, 6].map((g) => {
            const wNode = solution.multigraph_nodes.find(
              (n) => n.day_index === g && n.node_type === 'work'
            );
            const rNode = solution.multigraph_nodes.find(
              (n) => n.day_index === g && n.node_type === 'rest'
            );
            return (
              <div
                key={g}
                className="p-3 rounded-lg bg-slate-50 border border-[#7F8A92] space-y-2 text-xs"
              >
                <div className="font-bold text-slate-900 flex items-center justify-between">
                  <span>{wNode?.day_name}</span>
                </div>
                <div className="p-1.5 rounded bg-white border border-slate-200 font-mono-tabular text-xs flex justify-between">
                  <span className="text-slate-600">Starting work</span>
                  <span className="font-bold text-slate-900">
                    in:{wNode?.in_degree ?? '—'} / out:{wNode?.out_degree ?? '—'}
                  </span>
                </div>
                <div className="p-1.5 rounded bg-white border border-slate-200 font-mono-tabular text-xs flex justify-between">
                  <span className="text-slate-600">Starting rest</span>
                  <span className="font-bold text-slate-900">
                    in:{rNode?.in_degree ?? '—'} / out:{rNode?.out_degree ?? '—'}
                  </span>
                </div>
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
};
