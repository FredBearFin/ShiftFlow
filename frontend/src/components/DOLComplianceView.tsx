import React from 'react';
import { SolveResponse } from '../types';
import { Term } from './ui/Term';

interface DOLComplianceViewProps {
  solution: SolveResponse | null;
}

// The rest interval the backend aims for between two shifts. A shorter gap is reported
// as a clopening rather than refused, so this is a target, not a guarantee.
const MIN_REST_HOURS = 16;

// 'unassessed' is never green: a check this tool does not perform must not read as a pass.
type RowStatus = 'pass' | 'warn' | 'fail' | 'unassessed';

const ROW_STYLES: Record<RowStatus, string> = {
  pass: 'border-emerald-200 bg-emerald-50 text-emerald-800',
  warn: 'border-amber-200 bg-amber-50 text-amber-800',
  fail: 'border-[#9F3A32] bg-white text-[#9F3A32]',
  unassessed: 'border-slate-300 bg-slate-50 text-slate-700',
};

const ROW_ICONS: Record<RowStatus, string> = { pass: '✓', warn: '!', fail: '✗', unassessed: '–' };

function ComplianceRow({ status, title, detail }: { status: RowStatus; title: string; detail: string }) {
  return (
    <div className={`p-4 rounded-xl border flex items-start gap-3 ${ROW_STYLES[status]}`}>
      <span className="text-base font-bold leading-none" aria-hidden="true">{ROW_ICONS[status]}</span>
      <div>
        <div className="text-sm font-bold">{title}</div>
        <div className="text-xs mt-0.5">{detail}</div>
      </div>
    </div>
  );
}

export const DOLComplianceView: React.FC<DOLComplianceViewProps> = ({ solution }) => {
  if (!solution) return null;
  const audit = solution.ergonomics_audit;
  const labor = solution.labor_analysis;

  const restPasses = audit.min_rest_hours_observed >= MIN_REST_HOURS;
  const clopeningPasses = audit.clopening_violations === 0;
  const consecutiveDaysCriterion = audit.criteria_breakdown.find((c) =>
    c.name.toLowerCase().includes('consecutive days')
  );
  const consecutiveDaysViolations = consecutiveDaysCriterion?.raw_violations_count ?? 0;
  const otHours = labor.total_overtime_hours;

  // The backend reports fair_workweek_compliant as null when it did not assess Fair
  // Workweek at all, which is the only value it currently produces.
  const fairWorkweek = audit.fair_workweek_compliant;
  const fairWorkweekStatus: RowStatus =
    fairWorkweek === undefined || fairWorkweek === null ? 'unassessed' : fairWorkweek ? 'pass' : 'fail';

  return (
    <div className="space-y-5">
      <div className="enterprise-card p-5 bg-white">
        <span className="text-xs font-bold uppercase tracking-wider text-[#5C6770] block">
          Compliance
        </span>
        <h2 className="text-base font-bold text-slate-900 mt-0.5">
          What this schedule actually does, checked against common labor rules
        </h2>
        <p className="text-xs text-slate-500 mt-0.5">
          These checks use the same schedule shown in Weekly Schedule and Ergonomics — nothing new is
          calculated here, it's the same numbers viewed as compliance checks instead of{' '}
          <Term explanation="How tiring the week looks for the people working it, counted in penalty points. Lower is better. The Ergonomics tab shows the same schedule scored this way.">
            comfort scores
          </Term>
          .
        </p>
        <p className="text-xs text-slate-500 mt-1">
          A check this tool does not perform is marked "not assessed" and is never shown as a pass.
          Not assessed is not the same as compliant: it means you still have to check it yourself.
        </p>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        <ComplianceRow
          status={restPasses ? 'pass' : 'fail'}
          title="Rest between shifts"
          detail={
            restPasses
              ? `Every shift has at least ${audit.min_rest_hours_observed.toFixed(1)} hours of rest before the next one, meeting the ${MIN_REST_HOURS}-hour minimum this tool aims for.`
              : `The shortest rest between two shifts is ${audit.min_rest_hours_observed.toFixed(1)} hours — under the ${MIN_REST_HOURS}-hour minimum this tool aims for.`
          }
        />
        <ComplianceRow
          status={clopeningPasses ? 'pass' : 'fail'}
          title='No closing-then-opening shifts ("clopening")'
          detail={
            clopeningPasses
              ? 'No one is scheduled to close one day and open the next.'
              : `${audit.clopening_violations} instance(s) of someone closing one day and opening the next.`
          }
        />
        <ComplianceRow
          status={consecutiveDaysViolations === 0 ? 'pass' : 'warn'}
          title="Consecutive work days"
          detail={
            consecutiveDaysViolations === 0
              ? "No one is scheduled outside your chosen minimum/maximum consecutive work days."
              : `${consecutiveDaysViolations} place(s) where someone works more or fewer consecutive days in a row than your scheduling rules call for.`
          }
        />
        <ComplianceRow
          status={otHours > 0 ? 'warn' : 'pass'}
          title="Overtime (over 40 hours/week)"
          detail={
            otHours > 0
              ? `${otHours.toFixed(1)} overtime hours this week, costing $${labor.overtime_payroll_cost.toFixed(0)} at the 1.5× rate. Overtime isn't illegal by itself — just budget for the premium pay.`
              : 'No one is scheduled over 40 hours this week, so no overtime pay applies.'
          }
        />
        <ComplianceRow
          status={fairWorkweekStatus}
          title="Fair Workweek / predictive scheduling — not assessed"
          detail={
            fairWorkweekStatus === 'unassessed'
              ? 'This tool does not assess Fair Workweek or predictive scheduling rules: advance-notice windows, good-faith estimates, predictability pay for schedule changes, and right-to-rest declines are not checked anywhere in this product. If your location has such an ordinance, check it separately — nothing on this page tells you whether you comply.'
              : fairWorkweek
              ? 'Assessed as compliant with the Fair Workweek checks this tool performs.'
              : 'One or more Fair Workweek checks did not pass.'
          }
        />
      </div>

      <div className="enterprise-card p-4 text-xs text-slate-500">
        This page checks scheduling mechanics it can actually compute from the shifts shown. It is
        not legal advice and does not check state-specific rules, meal/rest breaks, predictive
        scheduling ordinances, or minor labor law — check those separately for your location.
      </div>
    </div>
  );
};
