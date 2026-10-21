import React from 'react';
import { SolveResponse } from '../types';
import { Term } from './ui/Term';

interface DOLComplianceViewProps {
  solution: SolveResponse | null;
}

// The backend builds every schedule to keep at least this many hours of rest between shifts.
const MIN_REST_HOURS = 16;

type RowStatus = 'pass' | 'warn' | 'fail';

const ROW_STYLES: Record<RowStatus, string> = {
  pass: 'border-emerald-200 bg-emerald-50 text-emerald-800',
  warn: 'border-amber-200 bg-amber-50 text-amber-800',
  fail: 'border-[#9F3A32] bg-white text-[#9F3A32]',
};

const ROW_ICONS: Record<RowStatus, string> = { pass: '✓', warn: '!', fail: '✗' };

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

  return (
    <div className="space-y-5">
      <div className="enterprise-card p-5 bg-white">
        <span className="text-xs font-bold uppercase tracking-wider text-[#5C6770] block">
          Fairness &amp; Fatigue Check
        </span>
        <h2 className="text-base font-bold text-slate-900 mt-0.5">
          A quick gut-check on burnout, before it costs you a good employee
        </h2>
        <p className="text-xs text-slate-500 mt-0.5">
          Tired, burnt-out staff are the ones who quit, call out, or make mistakes on the register. These
          checks use the same schedule shown in Weekly Schedule and Ergonomics — nothing new is
          calculated here, it's the same numbers viewed as a fairness check instead of{' '}
          <Term explanation="How tiring the week looks for the people working it, counted in penalty points. Lower is better. The Ergonomics tab shows the same schedule scored this way.">
            comfort scores
          </Term>
          .
        </p>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        <ComplianceRow
          status={restPasses ? 'pass' : 'fail'}
          title="Rest between shifts"
          detail={
            restPasses
              ? `Every shift has at least ${audit.min_rest_hours_observed.toFixed(1)} hours of rest before the next one, meeting the ${MIN_REST_HOURS}-hour minimum this schedule is built to enforce.`
              : `The shortest rest between two shifts is ${audit.min_rest_hours_observed.toFixed(1)} hours — under the ${MIN_REST_HOURS}-hour minimum this schedule is supposed to enforce.`
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
              ? `${otHours.toFixed(1)} overtime hours this week, costing $${labor.overtime_payroll_cost.toFixed(0)} at the 1.5× rate. Worth knowing before payroll runs, so it doesn't surprise you.`
              : 'No one is scheduled over 40 hours this week, so no overtime pay applies.'
          }
        />
      </div>

      <div className="enterprise-card p-4 text-xs text-slate-500">
        This page checks scheduling mechanics it can actually compute from the shifts shown — rest
        between shifts, clopenings, and runs of consecutive days — the things that wear a crew down
        and lead to turnover. It isn't legal advice and doesn't check state or local labor rules;
        check those separately if you're unsure.
      </div>
    </div>
  );
};
