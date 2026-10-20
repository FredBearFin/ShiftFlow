import { describe, it, expect, vi, afterEach } from 'vitest';
import { solveScheduleApi, exportRosterToCsvString, interpolateBeckerTable7 } from './api';
import type { SolveRequest, SolveResponse } from '../types';

const UNAVAILABLE = 'The scheduling service is unavailable, so no schedule was computed.';
const request = { demand_matrix: [], templates: [] } as unknown as SolveRequest;

afterEach(() => {
  vi.restoreAllMocks();
});

describe('solveScheduleApi failure path', () => {
  it('rejects with the unavailable message when the request throws', async () => {
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new TypeError('network down')));
    await expect(solveScheduleApi(request)).rejects.toThrow(UNAVAILABLE);
  });

  it('rejects with the unavailable message when the response is not OK', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: false, status: 500 }));
    await expect(solveScheduleApi(request)).rejects.toThrow(UNAVAILABLE);
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

describe('interpolateBeckerTable7 parity', () => {
  it('returns the same anchor values as the backend Table 7 law', () => {
    const backend: Record<number, number> = { 0: 1.8, 1: 8.37, 5: 27.34, 10: 39.46, 20: 54.64, 50: 79.06, 75: 89.71 };
    for (const [x, y] of Object.entries(backend)) {
      expect(interpolateBeckerTable7(Number(x))).toBeCloseTo(y, 2);
    }
  });
});
