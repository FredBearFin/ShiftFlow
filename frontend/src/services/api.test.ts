import { describe, it, expect, vi, afterEach } from 'vitest';
import { solveScheduleApi, exportRosterToCsvString, authStatusApi, createEmployeeApi } from './api';
import type { SolveRequest, SolveResponse } from '../types';

const request = { demand_matrix: [], templates: [] } as unknown as SolveRequest;

afterEach(() => {
  vi.restoreAllMocks();
});

describe('solveScheduleApi failure path', () => {
  it('rejects with the real error when the request throws', async () => {
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new TypeError('network down')));
    await expect(solveScheduleApi(request)).rejects.toThrow('network down');
  });

  it('rejects with the status code when the response is not OK and has no detail', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: false, status: 500 }));
    await expect(solveScheduleApi(request)).rejects.toThrow('HTTP 500');
  });

  it('rejects with the backend detail message when the response body has one', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({ ok: false, status: 401, json: async () => ({ detail: 'Not logged in' }) })
    );
    await expect(solveScheduleApi(request)).rejects.toThrow('Not logged in');
  });

  it('resolves with the parsed body when the response is OK', async () => {
    const body = { employee_count: 3 };
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: true, json: async () => body }));
    await expect(solveScheduleApi(request)).resolves.toEqual(body);
  });
});

describe('exportRosterToCsvString', () => {
  it('quotes commas and doubles quotes in names', () => {
    const days = Array.from({ length: 7 }, () => ({ shift_code: 'OFF' }));
    const solution = {
      roster_lines: [
        {
          line_number: 1,
          cohort_id: 'C1',
          assigned_person: 'Smith, "Jo"',
          qualification_tier: 'Lead',
          hourly_wage: 17.5,
          weekly_hours: 40,
          overtime_hours: 0,
          estimated_weekly_payroll: 700,
          days,
        },
      ],
    } as unknown as SolveResponse;
    const csv = exportRosterToCsvString(solution);
    expect(csv).toContain('"Smith, ""Jo"""');
  });
});

describe('exported roster is readable off the page', () => {
  const workWeek = (code: string, window: string) =>
    Array.from({ length: 7 }, (_, i) =>
      i < 5 ? { shift_code: code, time_window: window } : { shift_code: 'OFF', time_window: 'Rest / Off' }
    );

  const buildSolution = (overrides: Record<string, unknown> = {}) =>
    ({
      roster_lines: [
        {
          line_number: 1,
          cohort_id: 'C1',
          assigned_person: 'Dana Reyes',
          qualification_tier: 'Lead',
          hourly_wage: 21,
          weekly_hours: 40,
          overtime_hours: 0,
          estimated_weekly_payroll: 840,
          days: workWeek('D', '11:00 – 19:00'),
          ...overrides,
        },
      ],
    }) as unknown as SolveResponse;

  const dataRows = (csv: string) => csv.split('\n').slice(2);

  it('writes every worked day cell as a code and its time window', () => {
    const csv = exportRosterToCsvString(buildSolution());
    expect(csv).toContain('D (11:00 – 19:00)');
    // The bare code, with no window beside it, is what made the printout undecodable.
    expect(csv).not.toMatch(/,D,/);
  });

  it('leaves rest days as OFF rather than repeating a rest window', () => {
    const csv = exportRosterToCsvString(buildSolution());
    expect(csv).toContain(',OFF,OFF');
    expect(csv).not.toContain('Rest / Off');
  });

  it('opens with a dated range that states what the date is based on', () => {
    const csv = exportRosterToCsvString(buildSolution(), new Date(2026, 9, 21));
    const [first] = csv.split('\n');
    expect(first).toContain('Mon 2026-10-19 to Sun 2026-10-25');
    expect(first).toContain('not from a stored schedule date');
  });

  it('never prints hours beside a blank employee name', () => {
    const csv = exportRosterToCsvString(
      buildSolution({ assigned_person: null, hourly_wage: null, estimated_weekly_payroll: null })
    );
    for (const row of dataRows(csv)) {
      const [, , person, , , hours] = row.split(',');
      if (Number(hours) > 0) expect(person.trim()).not.toBe('');
    }
  });

  it('marks an unstaffed line and strips its wage and payroll money', () => {
    const csv = exportRosterToCsvString(
      buildSolution({ assigned_person: null, hourly_wage: null, estimated_weekly_payroll: null })
    );
    const [row] = dataRows(csv);
    expect(row).toContain('UNASSIGNED');
    // Hours stay (it is a real coverage gap) but no money is attributed to nobody.
    expect(row).not.toContain('840.00');
    expect(row).not.toContain('21.00');
  });

  it('strips payroll money from a line whose wage survived but whose person did not', () => {
    const csv = exportRosterToCsvString(
      buildSolution({ assigned_person: '', hourly_wage: 21, estimated_weekly_payroll: 840 })
    );
    const [row] = dataRows(csv);
    expect(row).toContain('UNASSIGNED');
    expect(row).not.toContain('840.00');
  });
});

describe('requests no longer carry the retired X-API-Key header', () => {
  it('sends only a JSON content type when saving a staff member', async () => {
    const fetchMock = vi.fn().mockResolvedValue({ ok: true, json: async () => ({ id: 'EMP-1' }) });
    vi.stubGlobal('fetch', fetchMock);
    await createEmployeeApi('FAC-OMAHA-01', { name: 'Pat' });
    const init = fetchMock.mock.calls[0][1] as { headers: Record<string, string> };
    expect(init.headers).toEqual({ 'Content-Type': 'application/json' });
  });
});

describe('authStatusApi', () => {
  it('passes through whether sign-up is open', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({
        ok: true,
        json: async () => ({ login_required: true, logged_in: false, email: null, signup_allowed: false }),
      })
    );
    expect(await authStatusApi()).toEqual({
      login_required: true,
      logged_in: false,
      email: null,
      signup_allowed: false,
    });
  });

  it('treats a server that does not report sign-up as open, so an older backend still shows Create Account', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({
        ok: true,
        json: async () => ({ login_required: true, logged_in: false, email: null }),
      })
    );
    expect((await authStatusApi()).signup_allowed).toBe(true);
  });

  it('assumes no login screen is needed when the status call fails', async () => {
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new TypeError('offline')));
    const status = await authStatusApi();
    expect(status.login_required).toBe(false);
    expect(status.logged_in).toBe(true);
  });
});
