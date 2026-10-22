import React, { useEffect, useState } from 'react';
import type { SolveRequest } from '../types';
import { Button } from './ui/Button';
import {
  AuditRequest,
  AuditResponse,
  AuditShiftKind,
  AuditThresholds,
  CompareResponse,
  DEFAULT_AUDIT_THRESHOLDS,
  PatternListItem,
  getPattern,
  listPatterns,
  postAudit,
  postCompare,
} from '../services/auditApi';
import {
  ShiftRow,
  formatStartTime,
  gridToText,
  parseGrid,
  parseShifts,
} from '../services/auditParse';

interface RosterAuditViewProps {
  /** The schedule setup currently in the app, used by "Compare with a ShiftFlow schedule". */
  solveRequest?: SolveRequest | null;
}

const WEEKDAYS = ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday'];
const KINDS: { value: AuditShiftKind; label: string }[] = [
  { value: 'day', label: 'Day' },
  { value: 'evening', label: 'Evening' },
  { value: 'night', label: 'Night' },
  { value: 'other', label: 'Other' },
];

const THRESHOLD_FIELDS: { key: keyof AuditThresholds; label: string; unit: string; step: number }[] = [
  { key: 'min_rest_hours', label: 'Minimum rest between shifts', unit: 'hours', step: 0.5 },
  { key: 'max_consecutive_work_days', label: 'Longest run of work days', unit: 'days', step: 1 },
  { key: 'max_consecutive_nights', label: 'Longest run of night shifts', unit: 'nights', step: 1 },
  { key: 'long_shift_hours', label: 'A long shift is at least', unit: 'hours', step: 0.5 },
  { key: 'max_consecutive_long_shifts', label: 'Longest run of long shifts', unit: 'shifts', step: 1 },
  { key: 'max_hours_any_7_days', label: 'Most hours in any 7 days', unit: 'hours', step: 1 },
  { key: 'reference_avg_weekly_hours', label: 'Average weekly hours to note', unit: 'hours', step: 1 },
];

const RULE_NAMES: Record<string, string> = {
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

const DEFAULT_SHIFT_ROWS: ShiftRow[] = [
  { code: 'D', name: 'Day', start: '07:00', hours: '12', kind: 'day' },
  { code: 'N', name: 'Night', start: '19:00', hours: '12', kind: 'night' },
];

const inputClass =
  'w-full px-3 py-1.5 rounded-lg border border-slate-300 bg-white text-sm font-mono-tabular';
const labelClass = 'block text-xs font-medium text-slate-600 mb-1';

function fmt(n: number | null | undefined, digits = 1): string {
  return n === null || n === undefined ? '—' : String(Number(n.toFixed(digits)));
}

interface RunState {
  request: AuditRequest;
  response: AuditResponse;
}

export const RosterAuditView: React.FC<RosterAuditViewProps> = ({ solveRequest = null }) => {
  const [patterns, setPatterns] = useState<PatternListItem[]>([]);
  const [patternsError, setPatternsError] = useState<string | null>(null);
  const [patternId, setPatternId] = useState('');
  const [shiftRows, setShiftRows] = useState<ShiftRow[]>(DEFAULT_SHIFT_ROWS);
  const [cycleDays, setCycleDays] = useState('14');
  const [startWeekday, setStartWeekday] = useState('0');
  const [gridText, setGridText] = useState('');
  const [thresholds, setThresholds] = useState<Record<keyof AuditThresholds, string>>(
    () =>
      Object.fromEntries(
        Object.entries(DEFAULT_AUDIT_THRESHOLDS).map(([k, v]) => [k, String(v)])
      ) as Record<keyof AuditThresholds, string>
  );
  const [errors, setErrors] = useState<string[]>([]);
  const [running, setRunning] = useState(false);
  const [run, setRun] = useState<RunState | null>(null);
  const [compare, setCompare] = useState<CompareResponse | null>(null);
  const [comparing, setComparing] = useState(false);
  const [status, setStatus] = useState('');

  useEffect(() => {
    let alive = true;
    listPatterns()
      .then((list) => {
        if (alive) setPatterns(list);
      })
      .catch((err: unknown) => {
        if (alive) setPatternsError(err instanceof Error ? err.message : 'Examples could not be loaded.');
      });
    return () => {
      alive = false;
    };
  }, []);

  const loadExample = async () => {
    if (!patternId) return;
    setErrors([]);
    try {
      const req = await getPattern(patternId);
      setShiftRows(
        req.shifts.map((s) => ({
          code: s.code,
          name: s.name,
          start: formatStartTime(s.start_minute),
          hours: String(s.duration_minutes / 60),
          kind: s.kind,
        }))
      );
      setCycleDays(String(req.cycle_days));
      setStartWeekday(String(req.start_weekday));
      setGridText(gridToText(req.lines));
      setThresholds(
        Object.fromEntries(Object.entries(req.thresholds).map(([k, v]) => [k, String(v)])) as Record<
          keyof AuditThresholds,
          string
        >
      );
      setRun(null);
      setCompare(null);
      setStatus('Example loaded.');
    } catch (err) {
      setErrors([err instanceof Error ? err.message : 'The example could not be loaded.']);
    }
  };

  const updateShift = (index: number, patch: Partial<ShiftRow>) => {
    setShiftRows((rows) => rows.map((r, i) => (i === index ? { ...r, ...patch } : r)));
  };

  const buildRequest = (): AuditRequest | null => {
    const problems: string[] = [];
    const cycle = Number(cycleDays);
    if (!Number.isInteger(cycle) || cycle < 7 || cycle > 56) {
      problems.push('Days in the cycle must be a whole number from 7 to 56.');
    }
    const parsedShifts = parseShifts(shiftRows);
    problems.push(...parsedShifts.errors);
    const limits = {} as AuditThresholds;
    for (const field of THRESHOLD_FIELDS) {
      const value = Number(thresholds[field.key]);
      if (thresholds[field.key].trim() === '' || !Number.isFinite(value)) {
        problems.push(`${field.label} must be a number.`);
      } else {
        limits[field.key] = value;
      }
    }
    if (problems.length > 0) {
      setErrors(problems);
      return null;
    }
    const grid = parseGrid(
      gridText,
      cycle,
      parsedShifts.shifts.map((s) => s.code)
    );
    if (grid.errors.length > 0) {
      setErrors(grid.errors);
      return null;
    }
    setErrors([]);
    return {
      cycle_days: cycle,
      start_weekday: Number(startWeekday),
      shifts: parsedShifts.shifts,
      lines: grid.lines,
      thresholds: limits,
    };
  };

  const runAudit = async () => {
    const req = buildRequest();
    if (!req) return;
    setRunning(true);
    setStatus('Running the audit…');
    setCompare(null);
    try {
      const response = await postAudit(req);
      setRun({ request: req, response });
      setStatus('Audit finished.');
    } catch (err) {
      setRun(null);
      setErrors([err instanceof Error ? err.message : 'The audit could not be run.']);
      setStatus('');
    } finally {
      setRunning(false);
    }
  };

  const runCompare = async () => {
    if (!run || !solveRequest) return;
    setComparing(true);
    setStatus('Comparing with a ShiftFlow schedule…');
    try {
      setCompare(await postCompare({ solve_request: solveRequest, audit_request: run.request }));
      setErrors([]);
      setStatus('Comparison finished.');
    } catch (err) {
      setCompare(null);
      setErrors([err instanceof Error ? err.message : 'The comparison could not be run.']);
      setStatus('');
    } finally {
      setComparing(false);
    }
  };

  const response = run?.response ?? null;

  return (
    <div className="space-y-5">
      <div className="enterprise-card p-5 bg-white">
        <span className="text-xs font-bold uppercase tracking-wider text-[#5C6770] block">
          Audit a Roster
        </span>
        <h2 className="text-base font-bold text-slate-900 mt-0.5">Audit an existing roster</h2>
        <p className="text-xs text-slate-500 mt-0.5">
          Paste the rotation you run today. ShiftFlow checks rest, streaks, night work and weekend
          exposure against the limits you set. It does not tell you whether the roster is legal.
        </p>
      </div>

      <div className="enterprise-card p-5 bg-white space-y-3">
        <div className="flex flex-wrap items-end gap-3">
          <div className="min-w-[14rem] flex-1">
            <label htmlFor="audit-example" className={labelClass}>
              Load an example
            </label>
            <select
              id="audit-example"
              value={patternId}
              onChange={(e) => setPatternId(e.target.value)}
              className={inputClass}
            >
              <option value="">Choose an example…</option>
              {patterns.map((p) => (
                <option key={p.pattern_id} value={p.pattern_id}>
                  {p.name}
                </option>
              ))}
            </select>
          </div>
          <Button type="button" onClick={loadExample} disabled={!patternId}>
            Load
          </Button>
        </div>
        {patternsError && <p className="text-xs text-slate-500">Examples are not available: {patternsError}</p>}
      </div>

      <div className="enterprise-card p-5 bg-white space-y-3">
        <h3 className="text-xs font-bold uppercase tracking-wider text-slate-700">Shifts you use</h3>
        <div className="w-full overflow-x-auto">
          <table className="w-full text-xs" aria-label="Shifts you use">
            <caption className="sr-only">Shifts you use</caption>
            <thead>
              <tr className="text-left text-slate-500">
                <th className="py-1 pr-2 font-medium">Code</th>
                <th className="py-1 pr-2 font-medium">Name</th>
                <th className="py-1 pr-2 font-medium">Start (HH:MM)</th>
                <th className="py-1 pr-2 font-medium">Hours</th>
                <th className="py-1 pr-2 font-medium">Kind</th>
                <th className="py-1 font-medium">
                  <span className="sr-only">Remove</span>
                </th>
              </tr>
            </thead>
            <tbody>
              {shiftRows.map((row, i) => (
                <tr key={i}>
                  <td className="py-1 pr-2">
                    <input
                      aria-label={`Shift ${i + 1} code`}
                      value={row.code}
                      maxLength={4}
                      onChange={(e) => updateShift(i, { code: e.target.value })}
                      className={`${inputClass} w-20`}
                    />
                  </td>
                  <td className="py-1 pr-2">
                    <input
                      aria-label={`Shift ${i + 1} name`}
                      value={row.name}
                      maxLength={60}
                      onChange={(e) => updateShift(i, { name: e.target.value })}
                      className={inputClass}
                    />
                  </td>
                  <td className="py-1 pr-2">
                    <input
                      aria-label={`Shift ${i + 1} start time`}
                      value={row.start}
                      onChange={(e) => updateShift(i, { start: e.target.value })}
                      className={`${inputClass} w-24`}
                    />
                  </td>
                  <td className="py-1 pr-2">
                    <input
                      aria-label={`Shift ${i + 1} hours`}
                      type="number"
                      min={1}
                      max={20}
                      step={0.5}
                      value={row.hours}
                      onChange={(e) => updateShift(i, { hours: e.target.value })}
                      className={`${inputClass} w-20`}
                    />
                  </td>
                  <td className="py-1 pr-2">
                    <select
                      aria-label={`Shift ${i + 1} kind`}
                      value={row.kind}
                      onChange={(e) => updateShift(i, { kind: e.target.value as AuditShiftKind })}
                      className={inputClass}
                    >
                      {KINDS.map((k) => (
                        <option key={k.value} value={k.value}>
                          {k.label}
                        </option>
                      ))}
                    </select>
                  </td>
                  <td className="py-1">
                    <Button
                      type="button"
                      size="sm"
                      onClick={() => setShiftRows((rows) => rows.filter((_, j) => j !== i))}
                    >
                      Remove shift
                    </Button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <Button
          type="button"
          size="sm"
          disabled={shiftRows.length >= 12}
          onClick={() =>
            setShiftRows((rows) => [...rows, { code: '', name: '', start: '07:00', hours: '8', kind: 'day' }])
          }
        >
          Add a shift
        </Button>

        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 pt-2">
          <div>
            <label htmlFor="audit-cycle-days" className={labelClass}>
              Days in the cycle
            </label>
            <input
              id="audit-cycle-days"
              type="number"
              min={7}
              max={56}
              step={1}
              value={cycleDays}
              onChange={(e) => setCycleDays(e.target.value)}
              className={inputClass}
            />
          </div>
          <div>
            <label htmlFor="audit-start-weekday" className={labelClass}>
              First day of the cycle is a
            </label>
            <select
              id="audit-start-weekday"
              value={startWeekday}
              onChange={(e) => setStartWeekday(e.target.value)}
              className={inputClass}
            >
              {WEEKDAYS.map((name, i) => (
                <option key={name} value={i}>
                  {name}
                </option>
              ))}
            </select>
          </div>
        </div>

        <div>
          <label htmlFor="audit-grid" className={labelClass}>
            Roster grid (one line per row)
          </label>
          <textarea
            id="audit-grid"
            rows={6}
            value={gridText}
            onChange={(e) => setGridText(e.target.value)}
            aria-describedby="audit-grid-help"
            className={`${inputClass} font-mono`}
          />
          <p id="audit-grid-help" className="text-xs text-slate-500 mt-1">
            One row per crew or person: a name, then one cell for each day of the cycle. Use a shift code
            for a work day and OFF, a dash, a dot or an empty cell for a day off. Tabs, commas or spaces
            between cells all work, so a block copied from a spreadsheet can be pasted as it is.
          </p>
        </div>
      </div>

      <fieldset className="enterprise-card p-5 bg-white">
        <legend className="text-xs font-bold uppercase tracking-wider text-slate-700 px-1">
          Limits to check against
        </legend>
        <p className="text-xs text-slate-500 mb-3">
          These are starting values chosen for this tool, not legal limits. Change them to match your own
          policy.
        </p>
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
          {THRESHOLD_FIELDS.map((field) => (
            <div key={field.key}>
              <label htmlFor={`audit-th-${field.key}`} className={labelClass}>
                {field.label} ({field.unit})
              </label>
              <input
                id={`audit-th-${field.key}`}
                type="number"
                step={field.step}
                value={thresholds[field.key]}
                onChange={(e) => setThresholds((t) => ({ ...t, [field.key]: e.target.value }))}
                className={inputClass}
              />
            </div>
          ))}
        </div>
      </fieldset>

      <div className="flex flex-wrap items-center gap-3">
        <Button type="button" variant="primary" onClick={runAudit} disabled={running} aria-describedby={errors.length ? 'audit-errors' : undefined}>
          Run audit
        </Button>
        <span role="status" aria-live="polite" className="text-xs text-slate-500">
          {status}
        </span>
      </div>

      {errors.length > 0 && (
        <div id="audit-errors" role="alert" className="p-4 rounded-xl border border-amber-200 bg-amber-50 text-xs text-amber-900">
          <ul className="list-disc pl-4 space-y-0.5">
            {errors.map((e, i) => (
              <li key={i}>{e}</li>
            ))}
          </ul>
        </div>
      )}

      {response && (
        <AuditResults
          response={response}
          compareControls={
            <div className="space-y-2">
              <Button type="button" onClick={runCompare} disabled={!solveRequest || comparing}>
                {solveRequest ? 'Compare with a ShiftFlow schedule' : 'Build a schedule in the setup first'}
              </Button>
              {compare && <CompareResults data={compare} />}
            </div>
          }
        />
      )}
    </div>
  );
};

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

const CompareResults: React.FC<{ data: CompareResponse }> = ({ data }) => {
  const rows: [string, AuditResponse][] = [
    ['Your roster', data.existing],
    ['ShiftFlow schedule', data.generated],
  ];
  return (
    <div className="space-y-2">
      <div className="w-full overflow-x-auto">
        <table className="w-full text-xs" aria-label="Comparison">
          <caption className="sr-only">Comparison</caption>
          <thead>
            <tr className="text-left text-slate-500 border-b border-slate-200">
              <th className="py-1.5 pr-3 font-medium">Roster</th>
              <th className="py-1.5 pr-3 font-medium">Flags</th>
              <th className="py-1.5 pr-3 font-medium">Smallest rest (h)</th>
              <th className="py-1.5 pr-3 font-medium">Most hours in 7 days</th>
              <th className="py-1.5 pr-3 font-medium">Hours short a week</th>
              <th className="py-1.5 font-medium">Hours over a week</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100 font-mono-tabular">
            {rows.map(([name, r]) => (
              <tr key={name}>
                <td className="py-1.5 pr-3 font-sans font-semibold text-slate-900">{name}</td>
                <td className="py-1.5 pr-3">{r.summary.flag_count}</td>
                <td className="py-1.5 pr-3">{fmt(r.summary.overall_min_rest_hours)}</td>
                <td className="py-1.5 pr-3">{fmt(r.summary.overall_max_hours_in_7_days)}</td>
                <td className="py-1.5 pr-3">{fmt(r.coverage?.understaffed_hours_per_week)}</td>
                <td className="py-1.5">{fmt(r.coverage?.overstaffed_hours_per_week)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <ul className="list-disc pl-4 text-xs text-slate-500">
        {data.notes.map((n, i) => (
          <li key={i}>{n}</li>
        ))}
      </ul>
      <p className="text-xs text-slate-500">{data.generated.disclaimer}</p>
    </div>
  );
};
