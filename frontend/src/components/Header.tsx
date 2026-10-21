import React from 'react';
import { ActiveTabId, SolveResponse } from '../types';
import { formatCurrency } from '../utils/format';
import { Button } from './ui/Button';

// Number keys bound in App.tsx keyboard handler; tabs without a key show no badge.
const TAB_KEY_NUMBERS: Partial<Record<ActiveTabId, number>> = {
  roster: 1,
  labor: 2,
  coverage: 3,
  pareto: 4,
  ergonomics: 5,
  compliance: 6,
};

interface HeaderProps {
  activeTab: ActiveTabId;
  onSelectTab: (tab: ActiveTabId) => void;
  onOpenWizard: () => void;
  onOpenShortcuts?: () => void;
  solution: SolveResponse | null;
  leewayPct: number;
  onLogout?: () => void;
}

export const Header: React.FC<HeaderProps> = ({
  activeTab,
  onSelectTab,
  onOpenWizard,
  onOpenShortcuts,
  solution,
  leewayPct,
  onLogout,
}) => {
  const navTabs: { id: ActiveTabId; label: string; badge?: string }[] = [
    {
      id: 'roster',
      label: 'Weekly Schedule',
      badge: solution ? `${solution.employee_count} Shift Patterns` : undefined,
    },
    {
      id: 'staff',
      label: 'Staff Directory & Availability',
      badge: solution ? `${solution.employees.length} Associates` : undefined,
    },
    {
      id: 'labor',
      label: 'Labor & Payroll Economics',
      badge: solution
        ? formatCurrency(solution.labor_analysis.total_payroll_cost)
        : undefined,
    },
    {
      id: 'coverage',
      label: '24h Coverage Heatmap',
      badge: '168 Intervals',
    },
    {
      id: 'pareto',
      label: 'Cost vs. Rest Trade-off',
      badge: `+${leewayPct}% Leeway`,
    },
    {
      id: 'ergonomics',
      label: 'Ergonomics Health Audit',
      badge: solution ? `${solution.ergonomics_audit.health_index_score}/100` : undefined,
    },
    {
      id: 'compliance',
      label: 'DOL Compliance',
    },
  ];

  return (
    <header className="bg-white border-b border-slate-200 sticky top-0 z-30 no-print">
      <div className="max-w-[1920px] mx-auto px-4 sm:px-6 lg:px-8">
        <div className="flex flex-wrap items-center justify-between py-3.5 gap-4 border-b border-slate-100">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-lg bg-[#2B3A42] text-white flex items-center justify-center font-bold text-sm">
              SF
            </div>
            <div>
              <div className="flex items-center gap-2">
                <h1 className="text-base font-bold text-[#2B3A42] tracking-tight">
                  ShiftFlow Studio
                </h1>
                <span className="inline-flex items-center px-2 py-0.5 rounded-md text-xs font-semibold bg-[#E4E9EC] text-[#2B3A42] border border-slate-200">
                  Enterprise Workforce OS
                </span>
              </div>
              <p className="text-xs text-slate-500 font-medium mt-0.5">
                {solution
                  ? `${solution.instance_name}${solution.instance_name ? ' • ' : ''}${solution.total_weekly_staffing_hours} Scheduled Hrs • ${formatCurrency(solution.labor_analysis.total_payroll_cost)} Weekly Payroll`
                  : 'Automated weekly schedule builder'}
              </p>
            </div>
          </div>

          <div className="flex items-center gap-2.5">
            {solution && (
              <div className="hidden lg:flex items-center gap-4 px-3.5 py-1.5 rounded-lg bg-slate-50 border border-slate-200 text-xs">
                <div>
                  <span className="text-slate-500">Payroll:</span>
                  <span className="ml-1 font-mono-tabular font-bold text-slate-900">
                    {formatCurrency(solution.labor_analysis.total_payroll_cost)}
                  </span>
                </div>
                <div className="h-3.5 w-px bg-slate-200" />
                <div>
                  <span className="text-slate-500">OT Hours:</span>
                  <span
                    className={`ml-1 font-mono-tabular font-bold ${
                      solution.labor_analysis.total_overtime_hours > 0
                        ? 'text-amber-700'
                        : 'text-emerald-700'
                    }`}
                  >
                    {solution.labor_analysis.total_overtime_hours}h
                  </span>
                </div>
                <div className="h-3.5 w-px bg-slate-200" />
                <div>
                  <span className="text-slate-500">Rest Gain:</span>
                  <span className="ml-1 font-mono-tabular font-semibold text-[#2B3A42]">
                    +{solution.integrated_ergo_gain_pct}%
                  </span>
                </div>
              </div>
            )}

            {onOpenShortcuts && (
              <Button
                variant="secondary"
                size="sm"
                onClick={onOpenShortcuts}
                title="Keyboard Shortcuts Cheatsheet (?)"
              >
                <span>⌨️ Hotkeys</span>
                <kbd className="px-1.5 py-0.5 rounded bg-slate-100 border border-slate-300 text-xs font-mono-tabular text-slate-600 font-bold">
                  ?
                </kbd>
              </Button>
            )}

            <Button variant="primary" onClick={onOpenWizard}>
              <span>Configure Facility Wizard</span>
              <span className="px-1.5 py-0.5 rounded bg-slate-700 text-xs font-mono-tabular text-slate-200">
                5 Steps
              </span>
            </Button>

            {onLogout && (
              <Button variant="secondary" size="sm" onClick={onLogout} title="Log out">
                Log out
              </Button>
            )}
          </div>
        </div>

        {/* Primary View Navigation Tabs */}
        <nav className="flex flex-wrap items-center gap-1 py-2" aria-label="Workspace Views">
          {navTabs.map((tab, idx) => {
            const isActive = activeTab === tab.id;
            return (
              <button
                key={tab.id}
                type="button"
                onClick={() => onSelectTab(tab.id)}
                className={`px-3.5 py-2 rounded-lg text-xs font-semibold transition-all flex items-center gap-2 whitespace-nowrap ${
                  isActive
                    ? 'bg-[#E4E9EC] text-[#2B3A42] border border-slate-200/80 shadow-[0_1px_2px_rgba(43,58,66,0.08)]'
                    : 'text-slate-600 hover:text-slate-900 hover:bg-slate-100 border border-transparent'
                }`}
              >
                {TAB_KEY_NUMBERS[tab.id] !== undefined && (
                  <kbd
                    className={`px-1 py-0.5 rounded text-xs font-mono-tabular font-bold ${
                      isActive
                        ? 'bg-white text-[#2B3A42]'
                        : 'bg-slate-100 text-slate-500'
                    }`}
                  >
                    {TAB_KEY_NUMBERS[tab.id]}
                  </kbd>
                )}
                <span>{tab.label}</span>
                {tab.badge && (
                  <span
                    className={`px-1.5 py-0.5 rounded text-xs font-mono-tabular ${
                      isActive
                        ? 'bg-white text-[#2B3A42] font-bold'
                        : 'bg-slate-100 text-slate-600'
                    }`}
                  >
                    {tab.badge}
                  </span>
                )}
              </button>
            );
          })}
        </nav>
      </div>
    </header>
  );
};
