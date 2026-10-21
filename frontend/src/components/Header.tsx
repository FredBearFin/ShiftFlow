import React from 'react';
import { ActiveTabId, SolveResponse } from '../types';
import { formatCurrency } from '../utils/format';
import { Button } from './ui/Button';
// Number keys bound in App.tsx's keyboard handler, shared with the cheatsheet
// so the two cannot drift. Tabs without a key show no badge.
import { TAB_KEY_NUMBERS } from './tabKeys';
import { WIZARD_STEP_COUNT } from './OnboardingWizard';

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
  // A payroll total only covers the lines that carry a wage, so every payroll figure
  // in this header is shown alongside the share of the roster it priced.
  const lineCount = solution ? solution.roster_lines.length : 0;
  const pricedLineCount = solution
    ? solution.roster_lines.filter((l) => l.estimated_weekly_payroll !== null).length
    : 0;

  // badgeReserve holds the space a data-dependent badge will occupy once the
  // solve returns. Without it the nav row reflows between the loading and
  // loaded states and the tabs move under the cursor. It is rendered
  // invisible and aria-hidden while badge is undefined, so it reserves width
  // without being announced. Tabs whose badge never depends on a solve
  // (coverage, pareto) and tabs with no badge (compliance) need no reserve.
  const navTabs: {
    id: ActiveTabId;
    label: string;
    badge?: string;
    badgeReserve?: string;
  }[] = [
    {
      id: 'roster',
      label: 'Weekly Schedule',
      badge: solution ? `${solution.employee_count} Shift Patterns` : undefined,
      badgeReserve: '00 Shift Patterns',
    },
    {
      id: 'staff',
      label: 'Staff Directory & Availability',
      badge: solution ? `${solution.employees.length} Associates` : undefined,
      badgeReserve: '000 Associates',
    },
    {
      id: 'labor',
      label: 'Labor & Payroll Economics',
      badge: solution
        ? `${formatCurrency(solution.labor_analysis.total_payroll_cost)} · ${pricedLineCount}/${lineCount} priced`
        : undefined,
      badgeReserve: formatCurrency(100000),
    },
    {
      id: 'coverage',
      label: '24h Coverage Heatmap',
      badge: '168 Intervals',
    },
    {
      id: 'pareto',
      label: 'Flexibility vs. Rest',
      badge: `+${leewayPct}% flexibility`,
    },
    {
      id: 'ergonomics',
      label: 'Ergonomics Health Audit',
      badge: solution ? `${solution.ergonomics_audit.health_index_score}/100` : undefined,
      badgeReserve: '000/100',
    },
    {
      id: 'compliance',
      label: 'DOL Compliance',
    },
  ];

  return (
    <header className="bg-white border-b border-border-subtle sticky top-0 z-30 no-print">
      <div className="max-w-[1920px] mx-auto px-4 sm:px-6 lg:px-8">
        <div className="flex flex-wrap items-center justify-between py-3.5 gap-4 border-b border-border-subtle">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-lg bg-ink text-white flex items-center justify-center font-bold text-sm">
              SF
            </div>
            <div>
              <div className="flex items-center gap-2">
                <h1 className="text-base font-bold text-ink tracking-tight">
                  ShiftFlow Studio
                </h1>
                <span className="inline-flex items-center px-2 py-0.5 rounded-md text-xs font-semibold bg-surface-sunken text-ink border border-border-subtle">
                  Enterprise Workforce OS
                </span>
              </div>
              <p className="text-xs text-muted font-medium mt-0.5">
                {solution
                  ? `${solution.instance_name}${solution.instance_name ? ' • ' : ''}${solution.total_weekly_staffing_hours} Scheduled Hrs • ${formatCurrency(solution.labor_analysis.total_payroll_cost)} Weekly Payroll · ${pricedLineCount} of ${lineCount} lines priced`
                  : 'Automated weekly schedule builder'}
              </p>
            </div>
          </div>

          <div className="flex items-center gap-2.5">
            {solution && (
              <div className="hidden lg:flex items-center gap-4 px-3.5 py-1.5 rounded-lg bg-surface-subtle border border-border-subtle text-xs">
                <div>
                  <span className="text-muted">Payroll:</span>
                  <span className="ml-1 font-mono-tabular font-bold text-ink">
                    {formatCurrency(solution.labor_analysis.total_payroll_cost)}
                  </span>
                  <span className="ml-1 font-mono-tabular text-muted">
                    ({pricedLineCount}/{lineCount} priced)
                  </span>
                </div>
                <div className="h-3.5 w-px bg-surface-sunken" />
                <div>
                  <span className="text-muted">OT Hours:</span>
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
                <div className="h-3.5 w-px bg-surface-sunken" />
                <div>
                  <span className="text-muted">Rest Gain:</span>
                  <span className="ml-1 font-mono-tabular font-semibold text-ink">
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
                <kbd className="px-1.5 py-0.5 rounded bg-surface border border-border text-xs font-mono-tabular text-ink-soft font-bold">
                  ?
                </kbd>
              </Button>
            )}

            <Button variant="primary" onClick={onOpenWizard}>
              <span>Configure Facility Wizard</span>
              <span className="px-1.5 py-0.5 rounded bg-ink-soft text-xs font-mono-tabular text-slate-200">
                {WIZARD_STEP_COUNT} Steps
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
            // Active is encoded three ways — a 2px accent bottom border, --ink
            // text and a --surface-sunken fill — and never by font weight,
            // because a weight change resizes the tab and moves the rest of
            // the row.
            return (
              <button
                key={tab.id}
                type="button"
                aria-current={isActive ? 'page' : undefined}
                onClick={() => onSelectTab(tab.id)}
                className={`px-3.5 py-2 rounded-t-md text-xs font-semibold transition-colors flex items-center gap-2 whitespace-nowrap border-b-2 ${
                  isActive
                    ? 'border-accent text-ink bg-surface-sunken'
                    : 'border-transparent text-muted hover:text-ink hover:bg-surface'
                }`}
              >
                {TAB_KEY_NUMBERS[tab.id] !== undefined && (
                  <kbd
                    className={`px-1 py-0.5 rounded text-xs font-mono-tabular font-bold ${
                      isActive
                        ? 'bg-card text-ink'
                        // --muted on --surface measures 5.02:1 at 12px; the slate-500
                        // this replaced measured 4.34:1 and failed.
                        : 'bg-surface text-muted'
                    }`}
                  >
                    {TAB_KEY_NUMBERS[tab.id]}
                  </kbd>
                )}
                <span>{tab.label}</span>
                {(tab.badge ?? tab.badgeReserve) && (
                  <span
                    aria-hidden={tab.badge ? undefined : true}
                    className={`px-1.5 py-0.5 rounded text-xs font-mono-tabular font-semibold text-center ${
                      tab.badge ? '' : 'invisible'
                    } ${isActive ? 'bg-card text-ink' : 'bg-surface text-muted'}`}
                  >
                    {tab.badge ?? tab.badgeReserve}
                  </span>
                )}
              </button>
            );
          })}
        </nav>

        {/* A number-key jump leaves focus where it was, so the active tab's own
            aria-current change is never read out. This says which view is up. */}
        <div role="status" aria-live="polite" className="sr-only">
          {navTabs.find((tab) => tab.id === activeTab)?.label} view</div>
      </div>
    </header>
  );
};
