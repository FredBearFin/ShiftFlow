import React from 'react';
import { SolveResponse } from '../types';

interface DOLComplianceViewProps {
  solution: SolveResponse | null;
}

export const DOLComplianceView: React.FC<DOLComplianceViewProps> = () => {
  return (
    <div className="space-y-6">
      <div className="enterprise-card p-6 bg-white">
        <h2 className="text-base font-bold text-slate-900">Timecard Punch Rounding</h2>
        <p className="text-xs text-slate-500 mt-1">
          This tab will compare raw clock punches with rounded pay times once punch data is loaded.
        </p>
        <p role="status" className="mt-4 p-3 rounded-xl bg-slate-50 border border-slate-200 text-xs text-slate-700 font-semibold">
          No timecard punches are loaded, so there are no rounding results to show.
        </p>
      </div>
    </div>
  );
};
