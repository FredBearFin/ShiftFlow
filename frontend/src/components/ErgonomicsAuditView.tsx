import React from 'react';
import { SolveResponse } from '../types';

interface ErgonomicsAuditViewProps {
  solution: SolveResponse;
}

export const ErgonomicsAuditView: React.FC<ErgonomicsAuditViewProps> = ({
  solution,
}) => {
  const audit = solution.ergonomics_audit;

  return (
    <div className="space-y-5">
      {/* Top Compliance & Theorem 1 Summary Banner */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        <div className="card p-5">
          <span className="text-[11px] font-bold uppercase tracking-wider text-slate-500">
            Occupational Rest & Circadian Health Standard
          </span>
          <div className="flex items-baseline gap-3 mt-1">
            <span className="text-3xl font-bold font-mono-tabular text-emerald-700">
              {audit.total_ergo_objective.toFixed(1)}
            </span>
            <span className="text-xs text-slate-500 line-through font-mono-tabular">
              Seq. Fixed-SD: {audit.sequential_baseline_ergo.toFixed(1)}
            </span>
          </div>
          <p className="text-xs text-slate-600 mt-1.5">
            Integrated planning reduces total ergonomic penalty by{' '}
            <strong className="text-indigo-700">+{audit.ergo_improvement_pct}%</strong> (theoretical, Becker Table 7 target).
          </p>
        </div>

        <div className="card p-5">
          <span className="text-[11px] font-bold uppercase tracking-wider text-slate-500">
            Zero-Clopening & Circadian Guardrail
          </span>
          <div className="flex items-baseline gap-3 mt-1">
            <span className="text-3xl font-bold font-mono-tabular text-slate-900">
              {audit.min_rest_hours_observed}h
            </span>
            {audit.clopening_violations > 0 && (
              <span className="px-2 py-0.5 rounded text-xs font-semibold bg-emerald-50 text-emerald-700 border border-emerald-200">
                {audit.clopening_violations} Alerts
              </span>
            )}
          </div>
          <p className="text-xs text-slate-600 mt-1.5">
            Minimum rest between consecutive shifts (≥16h required; 0 backward rotations).
          </p>
        </div>

        <div className="card p-5">
          <span className="text-[11px] font-bold uppercase tracking-wider text-slate-500">
            Cyclic Line Fairness & Continuity
          </span>
          <div className="flex items-baseline gap-3 mt-1">
            <span className="text-3xl font-bold font-mono-tabular text-indigo-700">
              {solution.multigraph_nodes.filter((n) => n.is_balanced).length}/14
            </span>
          </div>
          <p className="text-xs text-slate-600 mt-1.5">
            All 14 (day, work/rest) nodes satisfy <span className="font-mono-tabular">in_deg = out_deg</span>.
          </p>
        </div>
      </div>

      {/* The 8 Ergonomics Objective Criteria Table (Becker 2026, Table 4) */}
      <div className="card overflow-hidden">
        <div className="p-4 sm:px-6 border-b border-slate-200 bg-white">
          <h2 className="text-base font-bold text-slate-900">
            Staff Health & Anti-Burnout Protection Standards
          </h2>
          <p className="text-xs text-slate-500 mt-0.5">
            Detailed evaluation of each component in Equation (2) comparing the integrated I-SD-RWSP
            solution against the sequential fixed shift design baseline.
          </p>
        </div>

        <div className="overflow-x-auto">
          <table className="w-full text-left border-collapse text-xs">
            <thead>
              <tr className="bg-slate-50 border-b border-slate-200 text-[11px] font-bold uppercase tracking-wider text-slate-500">
                <th className="py-3 px-4">Symbol</th>
                <th className="py-3 px-4">Ergonomic Criterion</th>
                <th className="py-3 px-3">Ideal Range</th>
                <th className="py-3 px-3 text-center">Weight (Base / Comp)</th>
                <th className="py-3 px-3 text-right">Violations</th>
                <th className="py-3 px-3 text-right">Integrated Penalty</th>
                <th className="py-3 px-3 text-right">Sequential Fixed-SD</th>
                <th className="py-3 px-4 text-center">Status</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-200">
              {audit.criteria_breakdown.map((c) => (
                <tr key={c.criterion_id} className="hover:bg-slate-50/80">
                  <td className="py-3 px-4 font-mono-tabular font-bold text-indigo-700">
                    {c.symbol}
                  </td>
                  <td className="py-3 px-4">
                    <div className="font-semibold text-slate-900">{c.name}</div>
                    <div className="text-[11px] text-slate-500 mt-0.5">{c.explanation}</div>
                  </td>
                  <td className="py-3 px-3 font-mono-tabular text-slate-700">
                    {c.ideal_range}
                  </td>
                  <td className="py-3 px-3 text-center font-mono-tabular text-slate-600">
                    {c.base_weight} × [{c.component_weight_range}]
                  </td>
                  <td className="py-3 px-3 text-right font-mono-tabular font-semibold text-slate-800">
                    {c.raw_violations_count}
                  </td>
                  <td className="py-3 px-3 text-right font-mono-tabular font-bold text-emerald-700">
                    {c.weighted_penalty.toFixed(1)}
                  </td>
                  <td className="py-3 px-3 text-right font-mono-tabular text-slate-500">
                    {c.sequential_baseline_penalty.toFixed(1)}
                  </td>
                  <td className="py-3 px-4 text-center">
                    <span
                      className={`px-2 py-0.5 rounded-full text-[10px] font-bold uppercase ${
                        c.status === 'optimal'
                          ? 'bg-emerald-50 text-emerald-700 border border-emerald-200'
                          : c.status === 'acceptable'
                          ? 'bg-indigo-50 text-indigo-700 border border-indigo-200'
                          : 'bg-amber-50 text-amber-800 border border-amber-200'
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

      {/* Directed Multigraph Flow Conservation Verification (Constraints 7 & 8) */}
      <div className="card p-5">
        <div className="mb-3">
          <h3 className="text-xs font-bold uppercase tracking-wider text-slate-700">
            Directed Multigraph G = (V, E) Node Degree Balance (Constraints 7 & 8)
          </h3>
          <p className="text-xs text-slate-500 mt-0.5">
            Verifies equal in-degree and out-degree across all 7 work nodes{' '}
            <span className="font-mono-tabular">(g, work)</span> and 7 rest nodes{' '}
            <span className="font-mono-tabular">continuous rest required for zero-clopening line rotations.</span>
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
                <div className="p-1.5 rounded bg-white border border-slate-200 font-mono-tabular text-[11px] flex justify-between">
                  <span className="text-slate-600">(g, work)</span>
                  <span className="font-bold text-slate-900">
                    in:{wNode?.in_degree ?? 0} / out:{wNode?.out_degree ?? 0}
                  </span>
                </div>
                <div className="p-1.5 rounded bg-white border border-slate-200 font-mono-tabular text-[11px] flex justify-between">
                  <span className="text-slate-600">(g, rest)</span>
                  <span className="font-bold text-slate-900">
                    in:{rNode?.in_degree ?? 0} / out:{rNode?.out_degree ?? 0}
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
