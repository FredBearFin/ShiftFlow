import { describe, it, expect, vi, afterEach, beforeEach } from 'vitest';
import { render, cleanup, fireEvent, screen, waitFor } from '@testing-library/react';
import { MasterRosterView } from '../MasterRosterView';
import { makeRosterLine, makeSolution } from '../../test/solutionFixture';
import { buildSwapLines, swapAsOverrides } from '../../services/rosterOverrides';
import type {
  RosterCellOverride,
  ShiftOrOffCode,
  ShiftSwapValidationResponse,
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
  line.weekly_hours = codes.reduce((a, c) => a + (c === 'OFF' ? 0 : WINDOWS[c].hours), 0);
  return line;
}

function swappableSolution(): SolveResponse {
  return makeSolution({
    lineCount: 2,
    solution: {
      roster_lines: [
        lineWithCodes(1, ['M', 'D', 'D', 'D', 'D', 'OFF', 'OFF']),
        // Line 2 closes on Sunday, so the cycle really does wrap a close into line 1's
        // Monday and 'E' is a shift this schedule defines.
        lineWithCodes(2, ['D', 'D', 'D', 'D', 'OFF', 'OFF', 'E']),
      ],
    },
  });
}

const APPROVED: ShiftSwapValidationResponse = {
  is_approved: true,
  associate_a_name: 'Staff 1',
  associate_b_name: 'Staff 2',
  swap_summary: "Staff 1's Monday M shift for Staff 2's Tuesday D shift.",
  clopening_violation_a: false,
  clopening_violation_b: false,
  overtime_hours_a: 0,
  overtime_hours_b: 0,
  payroll_cost_delta: 0,
  validation_messages: ['Approved: both weeks keep at least 16 hours between shifts.'],
  next_monday_rotation_impact: 'Next Monday every line advances one row.',
};

const REFUSED: ShiftSwapValidationResponse = {
  ...APPROVED,
  is_approved: false,
  clopening_violation_a: true,
  overtime_hours_a: 8,
  payroll_cost_delta: 240,
  validation_messages: [
    'Refused - clopening: the swap puts a closing evening shift straight into an opening morning shift, Sunday on line 1 into Monday on line 2.',
    'Refused - overtime: the swap takes Staff 1 from 40 to 48 hours, 8 hours past the 40-hour boundary.',
  ],
};

let fetchMock: ReturnType<typeof vi.fn>;

beforeEach(() => {
  fetchMock = vi.fn();
  vi.stubGlobal('fetch', fetchMock);
});

afterEach(() => {
  vi.unstubAllGlobals();
});

function respondWith(body: ShiftSwapValidationResponse) {
  fetchMock.mockResolvedValue({ ok: true, json: async () => body } as Response);
}

function renderRoster(overrides: RosterCellOverride[] = []) {
  const noop = vi.fn();
  const onUpdateRosterOverrides = vi.fn();
  const result = render(
    <MasterRosterView
      solution={swappableSolution()}
      rotationWeekOffset={0}
      staffAssignments={[]}
      employees={[]}
      rosterOverrides={overrides}
      onUpdateRosterOverrides={onUpdateRosterOverrides}
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

function enterSwapMode() {
  fireEvent.click(screen.getByRole('button', { name: 'Swap two shifts' }));
}

function pickShift(person: string, day: string) {
  fireEvent.click(
    screen.getByRole('button', { name: new RegExp(`Choose for the swap: ${person}'s ${day} shift`) })
  );
}

describe('choosing two shifts to trade', () => {
  it('offers the swap mode as a pressed-state control', () => {
    renderRoster();
    const toggle = screen.getByRole('button', { name: 'Swap two shifts' });
    expect(toggle.getAttribute('type')).toBe('button');
    expect(toggle.getAttribute('aria-pressed')).toBe('false');

    enterSwapMode();
    expect(screen.getByRole('button', { name: 'Done swapping' }).getAttribute('aria-pressed')).toBe(
      'true'
    );
  });

  it('turns each cell into a swap choice that says what picking it does', () => {
    renderRoster();
    enterSwapMode();

    const cell = screen.getByRole('button', {
      name: /Choose for the swap: Staff 1's Monday shift/,
    });
    expect(cell.getAttribute('aria-pressed')).toBe('false');
    fireEvent.click(cell);

    const picked = screen.getByRole('button', {
      name: /Remove from the swap: Staff 1's Monday shift/,
    });
    expect(picked.getAttribute('aria-pressed')).toBe('true');
    expect(screen.getByText('Chosen for swap')).toBeTruthy();
  });

  it('names both chosen shifts', () => {
    renderRoster();
    enterSwapMode();
    pickShift('Staff 1', 'Monday');
    pickShift('Staff 2', 'Tuesday');

    expect(
      screen.getByText('Line 1, Monday (M) ↔ Line 2, Tuesday (D)')
    ).toBeTruthy();
  });
});

describe('a choice that is not a trade is blocked before it is sent', () => {
  it('refuses two shifts on the same line, with the reason', () => {
    renderRoster();
    enterSwapMode();
    pickShift('Staff 1', 'Monday');
    pickShift('Staff 1', 'Tuesday');

    const check = screen.getByRole('button', { name: 'Check this swap' });
    expect((check as HTMLButtonElement).disabled).toBe(true);
    const describedBy = check.getAttribute('aria-describedby');
    expect(describedBy).toBeTruthy();
    expect(document.getElementById(describedBy!)!.textContent).toContain(
      'Both of these shifts are on the same line'
    );
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('refuses a day nobody is working, and points at the single-cell change instead', () => {
    renderRoster();
    enterSwapMode();
    pickShift('Staff 1', 'Monday');
    pickShift('Staff 2', 'Friday'); // OFF on line 2

    const check = screen.getByRole('button', { name: 'Check this swap' });
    expect((check as HTMLButtonElement).disabled).toBe(true);
    expect(
      document.getElementById(check.getAttribute('aria-describedby')!)!.textContent
    ).toContain('change that one cell instead');
  });
});

describe('the verdict decides whether anything is applied', () => {
  it('sends the whole cycle in line order, with the clock times behind each code', async () => {
    respondWith(APPROVED);
    renderRoster();
    enterSwapMode();
    pickShift('Staff 1', 'Monday');
    pickShift('Staff 2', 'Tuesday');
    fireEvent.click(screen.getByRole('button', { name: 'Check this swap' }));

    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1));
    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe('/api/emergency/validate-swap');
    const body = JSON.parse((init as RequestInit).body as string);
    expect(body.associate_a_id).toBe('EMP-01');
    expect(body.associate_b_id).toBe('EMP-02');
    expect(body.day_a_index).toBe(0);
    expect(body.day_b_index).toBe(1);
    expect(body.roster_lines.map((l: { line_number: number }) => l.line_number)).toEqual([1, 2]);
    expect(body.roster_lines[0].days).toHaveLength(7);
    expect(body.roster_lines[0].days[0]).toEqual({
      day_index: 0,
      shift_code: 'M',
      start_hour: 6,
      duration_hours: 8,
    });
  });

  it('shows an approved verdict and only then lets the swap be applied', async () => {
    respondWith(APPROVED);
    const { onUpdateRosterOverrides } = renderRoster();
    enterSwapMode();
    pickShift('Staff 1', 'Monday');
    pickShift('Staff 2', 'Tuesday');

    expect((screen.getByRole('button', { name: 'Apply swap' }) as HTMLButtonElement).disabled).toBe(
      true
    );

    fireEvent.click(screen.getByRole('button', { name: 'Check this swap' }));
    await waitFor(() => expect(screen.getByText(/Swap allowed/)).toBeTruthy());

    fireEvent.click(screen.getByRole('button', { name: 'Apply swap' }));
    expect(onUpdateRosterOverrides).toHaveBeenCalledWith([
      { cycle_week: 1, day_index: 0, shift_code: 'D', original_shift_code: 'M' },
      { cycle_week: 2, day_index: 1, shift_code: 'M', original_shift_code: 'D' },
    ]);
  });

  it('shows a refused verdict with every specific reason, and applies nothing', async () => {
    respondWith(REFUSED);
    const { onUpdateRosterOverrides } = renderRoster();
    enterSwapMode();
    pickShift('Staff 1', 'Monday');
    pickShift('Staff 2', 'Tuesday');
    fireEvent.click(screen.getByRole('button', { name: 'Check this swap' }));

    await waitFor(() => expect(screen.getByText(/Swap refused/)).toBeTruthy());
    expect(screen.getByText(/Refused - clopening/)).toBeTruthy();
    expect(screen.getByText(/Sunday on line 1 into Monday on line 2/)).toBeTruthy();
    expect(screen.getByText(/Refused - overtime/)).toBeTruthy();
    expect(screen.getByText(/8 hours past the 40-hour boundary/)).toBeTruthy();

    const apply = screen.getByRole('button', { name: 'Apply swap' }) as HTMLButtonElement;
    expect(apply.disabled).toBe(true);
    fireEvent.click(apply);
    expect(onUpdateRosterOverrides).not.toHaveBeenCalled();
  });

  it('surfaces the backend reason when the swap cannot be validated at all', async () => {
    fetchMock.mockResolvedValue({
      ok: false,
      status: 400,
      json: async () => ({ detail: 'Staff 1 is off on Sunday, so there is no assigned shift to trade.' }),
    } as Response);
    renderRoster();
    enterSwapMode();
    pickShift('Staff 1', 'Monday');
    pickShift('Staff 2', 'Tuesday');
    fireEvent.click(screen.getByRole('button', { name: 'Check this swap' }));

    await waitFor(() =>
      expect(screen.getByRole('alert').textContent).toContain('is off on Sunday')
    );
  });

  it('drops a stale verdict when the choices change', async () => {
    respondWith(APPROVED);
    renderRoster();
    enterSwapMode();
    pickShift('Staff 1', 'Monday');
    pickShift('Staff 2', 'Tuesday');
    fireEvent.click(screen.getByRole('button', { name: 'Check this swap' }));
    await waitFor(() => expect(screen.getByText(/Swap allowed/)).toBeTruthy());

    pickShift('Staff 2', 'Wednesday');
    expect(screen.queryByText(/Swap allowed/)).toBeNull();
    expect((screen.getByRole('button', { name: 'Apply swap' }) as HTMLButtonElement).disabled).toBe(
      true
    );
  });
});

describe('an applied swap is an ordinary roster edit', () => {
  it('becomes two cell overrides, each keeping what it was generated as', () => {
    const solution = swappableSolution();
    expect(
      swapAsOverrides(
        solution,
        [],
        { line_number: 1, day_index: 0 },
        { line_number: 2, day_index: 1 }
      )
    ).toEqual([
      { cycle_week: 1, day_index: 0, shift_code: 'D', original_shift_code: 'M' },
      { cycle_week: 2, day_index: 1, shift_code: 'M', original_shift_code: 'D' },
    ]);
  });

  it('records no override for a cell the trade puts back to its generated value', () => {
    const solution = swappableSolution();
    // Line 1 Monday was already edited from M to D. Trading it back for line 2's
    // Tuesday D leaves it at D, which is not the generated M, while line 2's Tuesday
    // lands back on its own generated D and so needs no override.
    const existing: RosterCellOverride[] = [
      { cycle_week: 2, day_index: 1, shift_code: 'M', original_shift_code: 'D' },
    ];
    expect(
      swapAsOverrides(
        solution,
        existing,
        { line_number: 1, day_index: 0 },
        { line_number: 2, day_index: 1 }
      )
    ).toEqual([
      { cycle_week: 2, day_index: 1, shift_code: 'M', original_shift_code: 'D' },
    ]);
  });
});

describe('the swap is validated against the roster the manager is looking at', () => {
  it('sends the edited shift, not the generated one', () => {
    const solution = swappableSolution();
    const lines = buildSwapLines(solution, [
      { cycle_week: 1, day_index: 0, shift_code: 'E', original_shift_code: 'M' },
    ]);

    expect(lines[0].days[0]).toEqual({
      day_index: 0,
      shift_code: 'E',
      start_hour: 16,
      duration_hours: 8,
    });
    expect(lines[1].days[0].shift_code).toBe('D');
  });
});
