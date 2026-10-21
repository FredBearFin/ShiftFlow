import React, { useEffect, useState } from 'react';
import { fetchOwnerFacilitySummaryApi, OwnerFacilitySummary, OwnerLink } from '../services/api';

interface OwnerSummaryViewProps {
  links: OwnerLink[];
  onLogout: () => void;
}

const money = (n: number) =>
  `$${n.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

/**
 * What an invited business owner sees: a read-only labor-cost summary per facility they've
 * been given access to - not the full scheduling tool, which stays the manager's working
 * surface. See backend/app/api/owner_routes.py for the endpoint this reads.
 */
export const OwnerSummaryView: React.FC<OwnerSummaryViewProps> = ({ links, onLogout }) => {
  const [selectedId, setSelectedId] = useState(links[0]?.facility_id ?? '');
  const [summary, setSummary] = useState<OwnerFacilitySummary | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!selectedId) return;
    let isMounted = true;
    setLoading(true);
    setError(null);
    fetchOwnerFacilitySummaryApi(selectedId)
      .then((s) => {
        if (isMounted) setSummary(s);
      })
      .catch((err: unknown) => {
        if (isMounted) setError(err instanceof Error ? err.message : 'This summary could not be loaded.');
      })
      .finally(() => {
        if (isMounted) setLoading(false);
      });
    return () => {
      isMounted = false;
    };
  }, [selectedId]);

  return (
    <div className="min-h-screen flex flex-col bg-[#F4F1EA] text-[#2B3A42]">
      <header className="border-b border-slate-200 bg-white px-4 sm:px-6 py-4 flex items-center justify-between">
        <div className="flex items-center gap-3">
          <div className="w-9 h-9 rounded-lg bg-[#2B3A42] text-white flex items-center justify-center font-bold text-xs">
            SF
          </div>
          <div>
            <h1 className="text-sm font-bold">ShiftFlow Studio — Owner view</h1>
            <p className="text-xs text-slate-500">Read-only labor-cost summary</p>
          </div>
        </div>
        <button
          type="button"
          onClick={onLogout}
          className="px-3 py-1.5 rounded-md border border-[#7F8A92] text-xs font-semibold text-[#2B3A42] hover:bg-[#F4F1EA]"
        >
          Sign out
        </button>
      </header>

      <main className="flex-1 max-w-2xl w-full mx-auto px-4 sm:px-6 py-8 space-y-4">
        {links.length > 1 && (
          <div>
            <label htmlFor="owner-facility-select" className="block text-xs font-semibold text-slate-600 mb-1">
              Facility
            </label>
            <select
              id="owner-facility-select"
              value={selectedId}
              onChange={(e) => setSelectedId(e.target.value)}
              className="w-full px-3 py-2 border border-slate-300 rounded-md text-sm bg-white"
            >
              {links.map((l) => (
                <option key={l.facility_id} value={l.facility_id}>
                  {l.facility_name}
                </option>
              ))}
            </select>
          </div>
        )}

        {error && (
          <div role="alert" className="rounded-md border border-[#9F3A32] bg-white px-4 py-3 text-sm text-[#9F3A32]">
            {error}
          </div>
        )}

        {loading && !summary && (
          <div className="enterprise-card p-10 text-center text-sm text-slate-500">Loading summary…</div>
        )}

        {summary && (
          <div className="enterprise-card p-6 space-y-4">
            <div>
              <span className="text-xs font-bold uppercase tracking-wider text-[#5C6770] block">
                Labor cost summary
              </span>
              <h2 className="text-lg font-bold text-slate-900">{summary.facility_name}</h2>
            </div>

            <dl className="grid grid-cols-2 gap-4">
              <div>
                <dt className="text-xs text-slate-500">Active staff</dt>
                <dd className="text-xl font-bold text-slate-900">{summary.active_employee_count}</dd>
              </div>
              <div>
                <dt className="text-xs text-slate-500">Estimated weekly payroll</dt>
                <dd className="text-xl font-bold text-slate-900">{money(summary.estimated_weekly_payroll)}</dd>
              </div>
              <div>
                <dt className="text-xs text-slate-500">Estimated weekly hours</dt>
                <dd className="text-xl font-bold text-slate-900">{summary.estimated_weekly_hours}h</dd>
              </div>
              <div>
                <dt className="text-xs text-slate-500">Average hourly wage</dt>
                <dd className="text-xl font-bold text-slate-900">
                  {summary.average_hourly_wage !== null ? `$${summary.average_hourly_wage.toFixed(2)}/hr` : '—'}
                </dd>
              </div>
            </dl>

            <p className="text-xs text-slate-400 italic pt-2 border-t border-slate-100">{summary.note}</p>
          </div>
        )}
      </main>
    </div>
  );
};
