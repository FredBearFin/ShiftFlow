import React from 'react';
import { SolveResponse } from '../types';
import { Term } from './ui/Term';
import { formatCurrency } from '../utils/format';

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
  fail: 'border-danger bg-white text-danger',
  unassessed: 'border-border bg-surface-subtle text-ink-soft',
};

const ROW_ICONS: Record<RowStatus, string> = { pass: '✓', warn: '!', fail: '✗', unassessed: '–' };

/** What the reader is being told, in words, rather than only in a colour. */
const ROW_VERDICTS: Record<RowStatus, string> = {
  pass: 'Meets it',
  warn: 'Worth a look',
  fail: 'Does not meet it',
  unassessed: 'Not assessed',
};

function ComplianceRow({
  status,
  title,
  detail,
  measured,
  span,
}: {
  status: RowStatus;
  title: string;
  detail: string;
  /** The figure this verdict was read off, named so it can be checked. */
  measured?: { label: string; value: string };
  span?: boolean;
}) {
  return (
    <div
      className={`p-4 rounded-xl border flex items-start gap-3 ${ROW_STYLES[status]} ${
        span ? 'md:col-span-2' : ''
      }`}
    >
      <span className="text-base font-bold leading-none" aria-hidden="true">{ROW_ICONS[status]}</span>
      <div className="min-w-0 flex-1">
        <div className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1">
          <div className="text-sm font-bold">{title}</div>
          <span className="text-xs font-bold uppercase tracking-wider">
            {ROW_VERDICTS[status]}
          </span>
        </div>
        <div className="text-xs mt-0.5">{detail}</div>
        {measured && (
          // Separated by spacing, not a rule: an alpha on a currentColor or
          // var()-backed border emits no CSS at all under Tailwind v3.
          <div className="mt-2.5 flex flex-wrap items-baseline justify-between gap-x-3 text-xs">
            <span>{measured.label}</span>
            <span className="font-mono-tabular font-bold">{measured.value}</span>
          </div>
        )}
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

  // A tally, so the page opens with the shape of the answer rather than making
  // the reader count five cards. Every check is in exactly one bucket, and
  // "not assessed" is counted separately from anything that passed.
  const statuses: RowStatus[] = [
    restPasses ? 'pass' : 'fail',
    clopeningPasses ? 'pass' : 'fail',
    consecutiveDaysViolations === 0 ? 'pass' : 'warn',
    otHours > 0 ? 'warn' : 'pass',
    fairWorkweekStatus,
  ];
  const tally = {
    checked: statuses.filter((s) => s !== 'unassessed').length,
    met: statuses.filter((s) => s === 'pass').length,
    attention: statuses.filter((s) => s === 'warn' || s === 'fail').length,
    unassessed: statuses.filter((s) => s === 'unassessed').length,
  };

  // Named individually rather than left in one run-on sentence, because this
  // is the list a supervisor has to go and check somewhere else.
  const notChecked = [
    'Fair Workweek and predictive-scheduling ordinances — advance-notice windows, good-faith estimates, predictability pay, right-to-rest declines.',
    'Meal and rest breaks, and any state rule about when they must fall.',
    'State and local rules of any kind: this page knows nothing about your location.',
    'Minor labor law — permitted hours, school-day limits, prohibited tasks.',
    'Whether the people on this schedule are actually available or qualified to work it.',
  ];

  return (
    <div className="space-y-5">
      <div className="enterprise-card p-5 bg-white">
        <span className="text-xs font-bold uppercase tracking-wider text-muted block">
          Compliance
        </span>
        <h2 className="type-section-title text-ink mt-0.5">
          What this schedule actually does, checked against common labor rules
        </h2>
        <p className="type-prose text-muted mt-0.5">
          These checks use the same schedule shown in Weekly Schedule and Ergonomics — nothing new is
          calculated here, it's the same numbers viewed as compliance checks instead of{' '}
          <Term explanation="How tiring the week looks for the people working it, counted in penalty points. Lower is better. The Ergonomics tab shows the same schedule scored this way.">
            comfort scores
          </Term>
          .
        </p>
        <p className="text-xs text-muted mt-1">
          A check this tool does not perform is marked "not assessed" and is never shown as a pass.
          Not assessed is not the same as compliant: it means you still have to check it yourself.
        </p>

        <dl className="mt-4 grid grid-cols-2 gap-3 border-t border-border-subtle pt-4 sm:grid-cols-4">
          <div>
            <dt className="text-xs font-bold uppercase tracking-wider text-muted">Checks run</dt>
            <dd className="type-section-title font-mono-tabular text-ink">{tally.checked}</dd>
          </div>
          <div>
            <dt className="text-xs font-bold uppercase tracking-wider text-muted">Met</dt>
            <dd className="type-section-title font-mono-tabular text-ink">{tally.met}</dd>
          </div>
          <div>
            <dt className="text-xs font-bold uppercase tracking-wider text-muted">
              Need a look
            </dt>
            <dd className="type-section-title font-mono-tabular text-ink">{tally.attention}</dd>
          </div>
          <div>
            <dt className="text-xs font-bold uppercase tracking-wider text-muted">
              Not assessed
            </dt>
            <dd className="type-section-title font-mono-tabular text-ink">{tally.unassessed}</dd>
          </div>
        </dl>
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
          measured={{
            label: `Shortest gap in the week, against a ${MIN_REST_HOURS}h target`,
            value: `${audit.min_rest_hours_observed.toFixed(1)}h`,
          }}
        />
        <ComplianceRow
          status={clopeningPasses ? 'pass' : 'fail'}
          title='No closing-then-opening shifts ("clopening")'
          detail={
            clopeningPasses
              ? 'No one is scheduled to close one day and open the next.'
              : `${audit.clopening_violations} instance(s) of someone closing one day and opening the next.`
          }
          measured={{
            label: 'Close-then-open pairs in this schedule',
            value: String(audit.clopening_violations),
          }}
        />
        <ComplianceRow
          status={consecutiveDaysViolations === 0 ? 'pass' : 'warn'}
          title="Consecutive work days"
          detail={
            consecutiveDaysViolations === 0
              ? "No one is scheduled outside your chosen minimum/maximum consecutive work days."
              : `${consecutiveDaysViolations} place(s) where someone works more or fewer consecutive days in a row than your scheduling rules call for.`
          }
          measured={{
            label: 'Work stretches outside your chosen range',
            value: String(consecutiveDaysViolations),
          }}
        />
        <ComplianceRow
          status={otHours > 0 ? 'warn' : 'pass'}
          title="Overtime (over 40 hours/week)"
          detail={
            otHours > 0
              ? `${otHours.toFixed(1)} overtime hours this week, costing ${formatCurrency(labor.overtime_payroll_cost)} at the 1.5× rate. Overtime isn't illegal by itself — just budget for the premium pay.`
              : 'No one is scheduled over 40 hours this week, so no overtime pay applies.'
          }
          measured={{
            label: 'Hours over 40 this week, and what the premium costs',
            value: `${otHours.toFixed(1)}h · ${formatCurrency(labor.overtime_payroll_cost)}`,
          }}
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
          span
        />
      </div>

      {/* The run-on disclaimer below used to be the only place this was said.
          Broken out, because this is the list a supervisor has to go and check
          somewhere else, and it is the substance of what this page is not. */}
      <div className="enterprise-card p-5">
        <h3 className="type-subsection-title text-ink">
          What this page does not check — {notChecked.length} things you still have to
        </h3>
        <p className="type-prose text-muted mt-0.5">
          Everything above is read off the shifts in this schedule. Anything that depends on where
          you are, who is working, or what you told people in advance is outside what this tool can
          see.
        </p>
        <ul className="mt-3 grid grid-cols-1 gap-2 lg:grid-cols-2">
          {notChecked.map((item) => (
            <li
              key={item}
              className="flex items-start gap-2.5 rounded-lg border border-border-subtle bg-surface-subtle p-3 text-xs text-ink-soft"
            >
              <span aria-hidden="true" className="font-bold leading-none text-muted">
                –
              </span>
              <span>{item}</span>
            </li>
          ))}
        </ul>
      </div>

      <div className="enterprise-card p-4 text-xs text-muted">
        This page checks scheduling mechanics it can actually compute from the shifts shown. It is
        not legal advice and does not check state-specific rules, meal/rest breaks, predictive
        scheduling ordinances, or minor labor law — check those separately for your location.
      </div>
    </div>
  );
};
