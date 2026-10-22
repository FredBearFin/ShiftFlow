import React from 'react';
import { csvSafeCell } from '../csvSafety';
import type {
  AuditResponse,
  AuditShiftDef,
  AuditThresholds,
} from '../services/auditApi';
import { formatStartTime } from '../services/auditParse';

export const RULE_NAMES: Record<string, string> = {
  SHORT_REST: 'Short rest',
  LONG_WORK_STREAK: 'Long work run',
  NIGHT_STREAK: 'Night run',
  LONG_SHIFT_STREAK: 'Long-shift run',
  WEEK_HOURS_HIGH: 'Hours in 7 days',
  AVG_WEEKLY_HOURS: 'Average weekly hours',
  ISOLATED_NIGHT: 'Lone night shift',
  ISOLATED_REST_DAY: 'Lone day off',
  BACKWARD_ROTATION: 'Backward rotation',
  WEEKEND_EXPOSURE: 'Weekend exposure',
  LONG_NIGHT_SHIFT: 'Long night shift',
  FAIRNESS_SPREAD: 'Uneven load',
  EMPTY_LINE: 'Empty line',
};

const WEEKDAYS = ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday'];

const THRESHOLD_LABELS: [keyof AuditThresholds, string, string][] = [
  ['min_rest_hours', 'Minimum rest between shifts', 'hours'],
  ['max_consecutive_work_days', 'Longest run of work days', 'days'],
  ['max_consecutive_nights', 'Longest run of night shifts', 'nights'],
  ['long_shift_hours', 'A long shift is at least', 'hours'],
  ['max_consecutive_long_shifts', 'Longest run of long shifts', 'shifts'],
  ['max_hours_any_7_days', 'Most hours in any 7 days', 'hours'],
  ['reference_avg_weekly_hours', 'Average weekly hours to note', 'hours'],
];

export function fmt(n: number | null | undefined, digits = 1): string {
  return n === null || n === undefined ? '—' : String(Number(n.toFixed(digits)));
}

const SummaryStrip: React.FC<{ response: AuditResponse }> = ({ response }) => {
  const s = response.summary;
  const items: [string, string][] = [
    ['Flags', String(s.flag_count)],
    ['Smallest rest', s.overall_min_rest_hours === null ? '—' : `${fmt(s.overall_min_rest_hours)} h`],
    ['Longest work run', `${s.overall_longest_work_run_days} days`],
    ['Most hours in 7 days', `${fmt(s.overall_max_hours_in_7_days)} h`],
  ];
  return (
    <dl className="grid grid-cols-2 lg:grid-cols-4 gap-3">
      {items.map(([name, value]) => (
        <div key={name} className="p-3 rounded-lg border border-slate-200 bg-slate-50">
          <dt className="text-xs text-slate-500">{name}</dt>
          <dd className="text-lg font-bold font-mono-tabular text-slate-900">{value}</dd>
        </div>
      ))}
    </dl>
  );
};

export const AuditResults: React.FC<{ response: AuditResponse; compareControls?: React.ReactNode }> = ({
  response,
  compareControls,
}) => (
  <div className="enterprise-card p-5 bg-white space-y-4">
    <h3 className="text-xs font-bold uppercase tracking-wider text-slate-700">Results</h3>
    <SummaryStrip response={response} />

    <div className="w-full overflow-x-auto">
      <table className="w-full text-xs" aria-label="Findings">
        <caption className="sr-only">Findings</caption>
        <thead>
          <tr className="text-left text-slate-500 border-b border-slate-200">
            <th className="py-1.5 pr-3 font-medium">Rule</th>
            <th className="py-1.5 pr-3 font-medium">Line</th>
            <th className="py-1.5 pr-3 font-medium">Day</th>
            <th className="py-1.5 pr-3 font-medium">Value</th>
            <th className="py-1.5 pr-3 font-medium">Limit</th>
            <th className="py-1.5 font-medium">What it means</th>
          </tr>
        </thead>
        <tbody className="divide-y divide-slate-100">
          {response.findings.length === 0 && (
            <tr>
              <td colSpan={6} className="py-2 text-slate-500">
                Nothing was found against the limits you set.
              </td>
            </tr>
          )}
          {response.findings.map((f, i) => (
            <tr key={i} className={f.severity === 'flag' ? 'bg-amber-50/60' : ''}>
              <td className="py-1.5 pr-3 font-semibold text-slate-900">
                {RULE_NAMES[f.rule_id] ?? f.rule_id}
                <span className="ml-1.5 font-normal text-slate-500">{f.severity === 'flag' ? 'flag' : 'info'}</span>
              </td>
              <td className="py-1.5 pr-3">{f.line_label ?? '—'}</td>
              <td className="py-1.5 pr-3 font-mono-tabular">{f.day_index === null ? '—' : f.day_index + 1}</td>
              <td className="py-1.5 pr-3 font-mono-tabular">{fmt(f.value, 2)}</td>
              <td className="py-1.5 pr-3 font-mono-tabular">{f.threshold === null ? '—' : fmt(f.threshold, 2)}</td>
              <td className="py-1.5">{f.message}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>

    <div className="w-full overflow-x-auto">
      <table className="w-full text-xs" aria-label="Per-line measures">
        <caption className="sr-only">Per-line measures</caption>
        <thead>
          <tr className="text-left text-slate-500 border-b border-slate-200">
            <th className="py-1.5 pr-3 font-medium">Line</th>
            <th className="py-1.5 pr-3 font-medium">Shifts</th>
            <th className="py-1.5 pr-3 font-medium">Avg hours/week</th>
            <th className="py-1.5 pr-3 font-medium">Smallest rest (h)</th>
            <th className="py-1.5 pr-3 font-medium">Longest work run</th>
            <th className="py-1.5 pr-3 font-medium">Longest night run</th>
            <th className="py-1.5 pr-3 font-medium">Most hours in 7 days</th>
            <th className="py-1.5 font-medium">Weekends fully off</th>
          </tr>
        </thead>
        <tbody className="divide-y divide-slate-100 font-mono-tabular">
          {response.lines.map((m) => (
            <tr key={m.label}>
              <td className="py-1.5 pr-3 font-sans font-semibold text-slate-900">{m.label}</td>
              <td className="py-1.5 pr-3">{m.shifts_per_cycle}</td>
              <td className="py-1.5 pr-3">{fmt(m.avg_weekly_hours)}</td>
              <td className="py-1.5 pr-3">{fmt(m.min_rest_hours)}</td>
              <td className="py-1.5 pr-3">{m.longest_work_run_days}</td>
              <td className="py-1.5 pr-3">{m.longest_night_run}</td>
              <td className="py-1.5 pr-3">{fmt(m.max_hours_in_7_days)}</td>
              <td className="py-1.5">{fmt(m.weekends_fully_off_pct, 0)}%</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>

    {response.coverage && (
      <p className="text-xs text-slate-600">
        Against the demand supplied: {fmt(response.coverage.understaffed_hours_per_week)} hours a week
        short and {fmt(response.coverage.overstaffed_hours_per_week)} hours a week over.
      </p>
    )}

    <p className="text-xs text-slate-500">{response.disclaimer}</p>
    {compareControls}
  </div>
);


/** Findings as CSV. Every cell goes through csvSafeCell because line labels are free text. */
export function buildFindingsCsv(response: AuditResponse): string {
  const header = ['rule', 'severity', 'line', 'day', 'value', 'limit', 'message'];
  const rows = response.findings.map((f) => [
    f.rule_id,
    f.severity,
    f.line_label ?? '',
    f.day_index === null ? '' : f.day_index + 1,
    f.value,
    f.threshold ?? '',
    f.message,
  ]);
  return [header, ...rows].map((row) => row.map((cell) => csvSafeCell(cell)).join(',')).join('\n') + '\n';
}

interface AuditReportProps {
  response: AuditResponse;
  shifts: AuditShiftDef[];
  cycleDays: number;
  startWeekday: number;
  thresholds: AuditThresholds;
}

/** A printable, single-document view of one audit run. Hidden on screen, shown when printing. */
export const AuditReport: React.FC<AuditReportProps> = ({
  response,
  shifts,
  cycleDays,
  startWeekday,
  thresholds,
}) => (
  <article className="space-y-4 text-slate-900" aria-label="Roster risk report">
    <header className="border-b border-slate-300 pb-2">
      <h1 className="text-lg font-bold">Roster risk report</h1>
      <p className="text-xs text-slate-600">Generated {new Date().toLocaleDateString()}</p>
    </header>

    <section className="space-y-1">
      <h2 className="text-sm font-bold">What was checked</h2>
      <p className="text-xs">
        A {cycleDays}-day cycle whose first day is a {WEEKDAYS[startWeekday]}.
      </p>
      <table className="w-full text-xs" aria-label="Shifts used">
        <caption className="sr-only">Shifts used</caption>
        <thead>
          <tr className="text-left text-slate-500">
            <th className="pr-3 font-medium">Code</th>
            <th className="pr-3 font-medium">Name</th>
            <th className="pr-3 font-medium">Start</th>
            <th className="pr-3 font-medium">Hours</th>
            <th className="font-medium">Kind</th>
          </tr>
        </thead>
        <tbody>
          {shifts.map((s) => (
            <tr key={s.code}>
              <td className="pr-3">{s.code}</td>
              <td className="pr-3">{s.name}</td>
              <td className="pr-3">{formatStartTime(s.start_minute)}</td>
              <td className="pr-3">{fmt(s.duration_minutes / 60)}</td>
              <td>{s.kind}</td>
            </tr>
          ))}
        </tbody>
      </table>
      <ul className="text-xs list-disc pl-4">
        {THRESHOLD_LABELS.map(([key, label, unit]) => (
          <li key={key}>
            {label}: {thresholds[key]} {unit}
          </li>
        ))}
      </ul>
    </section>

    <AuditResults response={response} />

    <p className="text-xs text-slate-600">Generated from the pattern entered by the user. Not legal advice.</p>
  </article>
);
