import { describe, it, expect, vi, afterEach, beforeEach } from 'vitest';
import { render, cleanup, fireEvent, screen, waitFor } from '@testing-library/react';
import { MasterRosterView } from '../MasterRosterView';
import { makeRosterLine, makeSolution } from '../../test/solutionFixture';
import { buildStoredRosterShifts, coverAsOverrides } from '../../services/rosterOverrides';
import type {
  CalloutCandidate,
  EmergencyCalloutResponse,
  RosterCellOverride,
  ShiftOrOffCode,
  SolveResponse,
} from '../../types';

// This repo runs vitest without globals, so Testing Library does not unmount
// between cases on its own.
afterEach(cleanup);

const WINDOWS: Record<string, { window: string; hours: number }> = {
  M: { window: '06:00 - 14:00', hours: 8 },
  D: { window: '10:00 - 18:00', hours: 8 },
  E: { window: '16:00 - 24:00', hours: 8 },
};

function lineWithCodes(lineNumber: number, codes: ShiftOrOffCode[]) {
  const line = makeRosterLine(lineNumber, {
    current_cycle_week: lineNumber,
    assigned_person: `Staff ${lineNumber}`,
    assigned_employee_id: `EMP-0${lineNumber}`,
    hourly_wage: 20,
  });
  line.days = codes.map((code, dayIndex) => ({
    ...line.days[dayIndex],
    day_index: dayIndex,
    shift_code: code,
    time_window: code === 'OFF' ? 'Rest / Off' : WINDOWS[code].window,
    duration_hours: code === 'OFF' ? 0 : WINDOWS[code].hours,
  }));
  return line;
}

/** Line 1 works Saturday evening; line 2 is off then. Line 2 closes on Sunday. */
function coverableSolution(): SolveResponse {
  return makeSolution({
    lineCount: 2,
    solution: {
      roster_lines: [
        // The opening morning is in here so 'M' is a shift this schedule defines.
        lineWithCodes(1, ['OFF', 'M', 'D', 'D', 'OFF', 'E', 'OFF']),
        lineWithCodes(2, ['D', 'D', 'OFF', 'OFF', 'OFF', 'OFF', 'E']),
      ],
    },
  });
}

function candidate(overrides: Partial<CalloutCandidate> = {}): CalloutCandidate {
  return {
    employee_id: 'EMP-02',
    employee_name: 'Staff 2',
    role: 'Frontline Clerk',
    hourly_wage: 20,
    is_off_duty_target_day: true,
    prior_rest_hours: 24,
    next_rest_hours: 24,
    current_scheduled_hours: 24,
    hours_with_shift: 32,
    overtime_risk: false,
    clopening_risk: false,
    estimated_added_payroll: 160,
    is_recommended: true,
    status_label: 'Clear - 24h rest either side, 8h before overtime',
    audit_notes: ['Clear - 24h rest either side, 8h before overtime'],
    ...overrides,
  };
}

function calloutResponse(candidates: CalloutCandidate[]): EmergencyCalloutResponse {
  const recommended = candidates.find((c) => c.is_recommended);
  return {
    target_day_name: 'Saturday',
    target_shift_window: '16:00–00:00',
    target_shift_code: 'E',
    missing_employee_name: 'Staff 1',
    candidates_count: candidates.length,
    recommended_candidate_id: recommended?.employee_id,
    candidates,
    operational_guidance: recommended
      ? `${recommended.employee_name} is the clear cover.`
      : 'Nobody can cover this shift without breaking a rule.',
  };
}

let fetchMock: ReturnType<typeof vi.fn>;

beforeEach(() => {
  fetchMock = vi.fn();
  vi.stubGlobal('fetch', fetchMock);
});

afterEach(() => {
  vi.unstubAllGlobals();
});

/** The store PUT answers first, then the callout POST. */
function respondWith(body: EmergencyCalloutResponse) {
  fetchMock.mockImplementation((url: string) =>
    Promise.resolve({
      ok: true,
      json: async () =>
        url === '/api/emergency/stored-roster'
          ? { facility_id: 'FAC-TEST', slots_stored: 14, shifts: [] }
          : body,
    } as Response)
  );
}

function renderRoster(overrides: RosterCellOverride[] = []) {
  const noop = vi.fn();
  const onUpdateRosterOverrides = vi.fn();
  const result = render(
    <MasterRosterView
      solution={coverableSolution()}
      rotationWeekOffset={0}
      staffAssignments={[]}
      employees={[]}
      rosterOverrides={overrides}
      onUpdateRosterOverrides={onUpdateRosterOverrides}
      facilityId="FAC-TEST"
      onAdvanceWeek={noop}
      onResetWeek={noop}
      onUpdateStaffAssignments={noop}
      onAddEmployee={noop}
      onToggleEmployeeStatus={noop}
      onUpdateEmployee={noop}
      onExportCsv={noop}
    />
  );
  return { ...result, onUpdateRosterOverrides };
}

/** Opens the editor on line 1's Saturday and asks for cover. */
function askForCover() {
  fireEvent.click(
    screen.getByRole('button', { name: /Change Staff 1's Saturday shift/ })
  );
  fireEvent.click(screen.getByRole('button', { name: 'Cover this shift' }));
}

describe('asking who can cover a shift', () => {
  it('offers cover only on a day somebody is actually working', () => {
    renderRoster();
    fireEvent.click(screen.getByRole('button', { name: /Change Staff 1's Saturday shift/ }));
    expect(screen.getByRole('button', { name: 'Cover this shift' })).toBeTruthy();

    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }));
    fireEvent.click(screen.getByRole('button', { name: /Change Staff 1's Monday shift/ }));
    expect(screen.queryByRole('button', { name: 'Cover this shift' })).toBeNull();
  });

  it('stores the roster on screen before asking, so the ranking matches it', async () => {
    respondWith(calloutResponse([candidate()]));
    renderRoster([{ cycle_week: 2, day_index: 2, shift_code: 'D', original_shift_code: 'OFF' }]);
    askForCover();

    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(2));
    const [storeUrl, storeInit] = fetchMock.mock.calls[0];
    expect(storeUrl).toBe('/api/emergency/stored-roster');
    expect((storeInit as RequestInit).method).toBe('PUT');
    const stored = JSON.parse((storeInit as RequestInit).body as string);
    expect(stored.facility_id).toBe('FAC-TEST');
    expect(stored.shifts).toHaveLength(14);
    // The edit on line 2's Wednesday is in what was stored, not the generated OFF.
    expect(
      stored.shifts.find(
        (s: { line_number: number; day_index: number }) =>
          s.line_number === 2 && s.day_index === 2
      ).shift_code
    ).toBe('D');

    const [calloutUrl, calloutInit] = fetchMock.mock.calls[1];
    expect(calloutUrl).toBe('/api/emergency/callout-replacement');
    expect(JSON.parse((calloutInit as RequestInit).body as string)).toEqual({
      facility_id: 'FAC-TEST',
      target_day_index: 5,
      target_shift_code: 'E',
      missing_employee_id: 'EMP-01',
      line_number: 1,
    });
  });

  it('shows the ranked queue in a labelled dialog with each candidate figures', async () => {
    respondWith(calloutResponse([candidate()]));
    renderRoster();
    askForCover();

    await waitFor(() => expect(screen.getByRole('dialog')).toBeTruthy());
    const dialog = screen.getByRole('dialog');
    expect(dialog.getAttribute('aria-modal')).toBe('true');
    expect(
      document.getElementById(dialog.getAttribute('aria-labelledby')!)!.textContent
    ).toContain('Cover the Saturday E shift on line 1');

    expect(screen.getByText('Recommended')).toBeTruthy();
    expect(screen.getByText(/Staff 2 is the clear cover/)).toBeTruthy();
    expect(screen.getByText(/rest 24h before \/ 24h after/)).toBeTruthy();
    expect(screen.getByText(/24h → 32h/)).toBeTruthy();
    expect(screen.getByText(/adds \$160/)).toBeTruthy();
  });

  it('shows every candidate reason when nobody can cover compliantly', async () => {
    respondWith(
      calloutResponse([
        candidate({
          is_recommended: false,
          clopening_risk: true,
          overtime_risk: true,
          status_label: 'Clopening',
          audit_notes: [
            'Would be a closing shift straight into an opening shift, which zero-clopening forbids.',
            'Takes the week to 48h, 8h past the 40h boundary.',
          ],
        }),
      ])
    );
    renderRoster();
    askForCover();

    await waitFor(() =>
      expect(screen.getByText(/Nobody can cover this shift without breaking a rule/)).toBeTruthy()
    );
    expect(screen.getByText(/zero-clopening forbids/)).toBeTruthy();
    expect(screen.getByText(/8h past the 40h boundary/)).toBeTruthy();
    expect(screen.queryByText('Recommended')).toBeNull();
  });

  it('surfaces the backend reason when there is nothing to rank against', async () => {
    fetchMock.mockImplementation((url: string) =>
      Promise.resolve(
        url === '/api/emergency/stored-roster'
          ? ({ ok: true, json: async () => ({ facility_id: 'FAC-TEST', slots_stored: 14, shifts: [] }) } as Response)
          : ({
              ok: false,
              status: 409,
              json: async () => ({
                detail: 'No roster is stored for this facility, so there are no shift times or rest intervals to assess a replacement against.',
              }),
            } as Response)
      )
    );
    renderRoster();
    askForCover();

    await waitFor(() =>
      expect(screen.getByRole('alert').textContent).toContain('No roster is stored')
    );
  });
});

describe('putting a cover in place', () => {
  it('moves the shift to the person covering and puts the absent person off', async () => {
    respondWith(calloutResponse([candidate()]));
    const { onUpdateRosterOverrides } = renderRoster();
    askForCover();

    await waitFor(() => expect(screen.getByText('Recommended')).toBeTruthy());
    fireEvent.click(screen.getByRole('button', { name: 'Give them this shift' }));

    expect(onUpdateRosterOverrides).toHaveBeenCalledWith([
      { cycle_week: 1, day_index: 5, shift_code: 'OFF', original_shift_code: 'E' },
      { cycle_week: 2, day_index: 5, shift_code: 'E', original_shift_code: 'OFF' },
    ]);
  });

  it('is an ordinary pair of cell overrides', () => {
    const solution = coverableSolution();
    expect(coverAsOverrides(solution, [], 1, 'EMP-02', 5)).toEqual([
      { cycle_week: 1, day_index: 5, shift_code: 'OFF', original_shift_code: 'E' },
      { cycle_week: 2, day_index: 5, shift_code: 'E', original_shift_code: 'OFF' },
    ]);
  });

  it('declines to cover a day nobody was working', () => {
    const solution = coverableSolution();
    expect(coverAsOverrides(solution, [], 1, 'EMP-02', 0)).toBeNull();
  });

  it('declines to have somebody cover their own shift', () => {
    const solution = coverableSolution();
    expect(coverAsOverrides(solution, [], 1, 'EMP-01', 5)).toBeNull();
  });
});

describe('what gets stored for the callout queue', () => {
  it('carries each slot clock times and the rest before it, on the real cycle', () => {
    const shifts = buildStoredRosterShifts(coverableSolution(), []);

    expect(shifts).toHaveLength(14);
    expect(shifts[0]).toEqual({
      line_number: 1,
      cycle_week: 1,
      day_index: 0,
      shift_code: 'OFF',
      employee_id: 'EMP-01',
      start_hour: 0,
      duration_hours: 0,
      rest_hours_before: 24,
    });

    // Line 2's Monday follows line 1's SUNDAY, which is OFF, so a full day of rest.
    const line2Monday = shifts.find((s) => s.line_number === 2 && s.day_index === 0)!;
    expect(line2Monday.rest_hours_before).toBe(24);

    // Line 1's Monday follows the LAST line's Sunday, which closes at midnight. A
    // check that compared line 1's Monday against its own Sunday would miss this wrap.
    expect(shifts[0].rest_hours_before).toBe(24); // its own Monday is OFF
    const line1Tuesday = shifts.find((s) => s.line_number === 1 && s.day_index === 1)!;
    expect(line1Tuesday.rest_hours_before).toBe(24);
  });

  it('computes the wrap rest from the last line Sunday into the first line Monday', () => {
    // Put a morning shift on line 1's Monday. Line 2 closes on Sunday at midnight, so
    // the wrap leaves 6 hours, not a full day.
    const shifts = buildStoredRosterShifts(coverableSolution(), [
      { cycle_week: 1, day_index: 0, shift_code: 'M', original_shift_code: 'OFF' },
    ]);
    const line1Monday = shifts.find((s) => s.line_number === 1 && s.day_index === 0)!;

    expect(line1Monday.shift_code).toBe('M');
    expect(line1Monday.start_hour).toBe(6);
    expect(line1Monday.rest_hours_before).toBe(6);
  });
});
