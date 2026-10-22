import { describe, it, expect, afterEach, beforeEach, vi } from 'vitest';
import { render, screen, cleanup, fireEvent, waitFor } from '@testing-library/react';
import { RosterAuditView } from './RosterAuditView';
import type { AuditRequest, AuditResponse, PatternListItem } from '../services/auditApi';
import { DEFAULT_AUDIT_THRESHOLDS } from '../services/auditApi';

const DISCLAIMER =
  'Rule-based check of the pattern you entered. Not legal advice. Thresholds are the values shown, not statutory limits.';

const PATTERNS: PatternListItem[] = [
  { pattern_id: 'pitman_2_2_3_12h', name: '2-2-3 (Pitman), 12-hour shifts', description: 'x', cycle_days: 14 },
];

const PATTERN_REQUEST: AuditRequest = {
  cycle_days: 7,
  start_weekday: 0,
  shifts: [{ code: 'D', name: 'Day', start_minute: 420, duration_minutes: 720, kind: 'day' }],
  lines: [{ label: 'Crew A', cells: ['D', 'D', 'OFF', 'OFF', 'D', 'D', 'D'] }],
  thresholds: DEFAULT_AUDIT_THRESHOLDS,
};

const RESPONSE: AuditResponse = {
  findings: [
    {
      rule_id: 'SHORT_REST',
      severity: 'flag',
      line_label: 'Crew A',
      day_index: 0,
      value: 8,
      threshold: 11,
      message: 'Line "Crew A" has only 8 hours between the shift on day 1 and the next one.',
    },
  ],
  lines: [
    {
      label: 'Crew A',
      shifts_per_cycle: 5,
      avg_weekly_hours: 60,
      min_rest_hours: 8,
      longest_work_run_days: 3,
      longest_night_run: 0,
      longest_long_shift_run: 3,
      max_hours_in_7_days: 60,
      isolated_single_nights: 0,
      isolated_single_rest_days: 0,
      backward_rotation_events: 0,
      weekends_fully_off_pct: 0,
      nights_per_cycle: 0,
      weekend_shifts_per_cycle: 2,
    },
  ],
  coverage: null,
  summary: {
    flag_count: 1,
    info_count: 0,
    flags_by_rule: { SHORT_REST: 1 },
    info_by_rule: {},
    overall_min_rest_hours: 8,
    overall_longest_work_run_days: 3,
    overall_max_hours_in_7_days: 60,
    nights_stdev: 0,
    weekend_shifts_stdev: 0,
  },
  thresholds_used: DEFAULT_AUDIT_THRESHOLDS,
  engine_version: 'audit-1',
  disclaimer: DISCLAIMER,
};

function jsonResponse(body: unknown, status = 200) {
  return Promise.resolve({ ok: status >= 200 && status < 300, status, json: () => Promise.resolve(body) });
}

let auditStatus = 200;
let auditBody: unknown = RESPONSE;

beforeEach(() => {
  auditStatus = 200;
  auditBody = RESPONSE;
  vi.stubGlobal(
    'fetch',
    vi.fn((url: string) => {
      if (url.endsWith('/audit/patterns')) return jsonResponse(PATTERNS);
      if (url.includes('/audit/patterns/')) return jsonResponse(PATTERN_REQUEST);
      if (url.endsWith('/audit')) return jsonResponse(auditBody, auditStatus);
      return jsonResponse({ detail: 'unexpected' }, 404);
    })
  );
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

function fillGrid() {
  fireEvent.change(screen.getByLabelText('Days in the cycle'), { target: { value: '7' } });
  fireEvent.change(screen.getByLabelText('Roster grid (one line per row)'), {
    target: { value: 'Crew A\tD\tD\t-\t-\tD\tD\tD' },
  });
}

describe('RosterAuditView', () => {
  it('shows labelled controls', async () => {
    render(<RosterAuditView solveRequest={null} />);
    for (const label of [
      'Load an example',
      'Days in the cycle',
      'First day of the cycle is a',
      'Roster grid (one line per row)',
    ]) {
      expect(screen.getByLabelText(label)).toBeTruthy();
    }
    expect(screen.getByLabelText(/Minimum rest between shifts \(hours\)/)).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Run audit' }).getAttribute('type')).toBe('button');
    await screen.findByRole('option', { name: /Pitman/ });
  });

  it('loads an example into the form', async () => {
    render(<RosterAuditView solveRequest={null} />);
    await screen.findByRole('option', { name: /Pitman/ });
    fireEvent.change(screen.getByLabelText('Load an example'), { target: { value: 'pitman_2_2_3_12h' } });
    fireEvent.click(screen.getByRole('button', { name: 'Load' }));
    await waitFor(() =>
      expect((screen.getByLabelText('Days in the cycle') as HTMLInputElement).value).toBe('7')
    );
    expect((screen.getByLabelText('Roster grid (one line per row)') as HTMLTextAreaElement).value).toContain(
      'Crew A'
    );
  });

  it('runs the audit and shows findings and the disclaimer', async () => {
    render(<RosterAuditView solveRequest={null} />);
    fillGrid();
    fireEvent.click(screen.getByRole('button', { name: 'Run audit' }));
    expect(await screen.findByText(/only 8 hours between/)).toBeTruthy();
    expect(screen.getByText(DISCLAIMER)).toBeTruthy();
    expect(screen.getByText('Short rest')).toBeTruthy();
  });

  it('shows a readable error in an alert when the service says no', async () => {
    auditStatus = 422;
    auditBody = { detail: [{ msg: 'Value error, Line "Crew A", day 3: "ZZ" is not a shift you defined' }] };
    render(<RosterAuditView solveRequest={null} />);
    fillGrid();
    fireEvent.click(screen.getByRole('button', { name: 'Run audit' }));
    const alert = await screen.findByRole('alert');
    expect(alert.textContent).toContain('is not a shift you defined');
  });

  it('names the row and day of a typo before sending anything', async () => {
    render(<RosterAuditView solveRequest={null} />);
    fireEvent.change(screen.getByLabelText('Days in the cycle'), { target: { value: '7' } });
    fireEvent.change(screen.getByLabelText('Roster grid (one line per row)'), {
      target: { value: 'Crew A\tD\tD\t-\t-\tD\tD\tXN' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Run audit' }));
    expect((await screen.findByRole('alert')).textContent).toContain('Row 1, day 7: "XN" is not a shift you defined');
  });

  it('disables the compare button when there is no schedule setup', async () => {
    render(<RosterAuditView solveRequest={null} />);
    fillGrid();
    fireEvent.click(screen.getByRole('button', { name: 'Run audit' }));
    const button = await screen.findByRole('button', { name: 'Build a schedule in the setup first' });
    expect((button as HTMLButtonElement).disabled).toBe(true);
  });
});
