import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, cleanup, fireEvent, screen } from '@testing-library/react';
import { MasterRosterView } from '../MasterRosterView';
import { makeRosterLine, makeSolution } from '../../test/solutionFixture';
import type { RosterCellOverride, ShiftOrOffCode, SolveResponse } from '../../types';

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
  line.estimated_weekly_payroll = line.weekly_hours * 20;
  return line;
}

/** Line 1 closes on Sunday evening; line 2 opens its week OFF. */
function editableSolution(): SolveResponse {
  return makeSolution({
    lineCount: 2,
    solution: {
      roster_lines: [
        lineWithCodes(1, ['M', 'M', 'M', 'M', 'OFF', 'OFF', 'E']),
        lineWithCodes(2, ['OFF', 'D', 'D', 'D', 'D', 'D', 'OFF']),
      ],
    },
  });
}

function renderRoster(overrides: RosterCellOverride[] = []) {
  const noop = vi.fn();
  const onUpdateRosterOverrides = vi.fn();
  const result = render(
    <MasterRosterView
      solution={editableSolution()}
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

/** Opens the editor on one cell by its accessible name. */
function openCellEditor(person: string, day: string) {
  const trigger = screen.getByRole('button', {
    name: new RegExp(`Change ${person}'s ${day} shift`),
  });
  fireEvent.click(trigger);
}

describe('editing one generated roster cell', () => {
  it('gives every cell a named control saying what it currently holds', () => {
    renderRoster();
    const trigger = screen.getByRole('button', { name: /Change Staff 2's Monday shift/ });

    expect(trigger.getAttribute('type')).toBe('button');
    expect(trigger.getAttribute('aria-label')).toContain('Currently OFF');
    expect(trigger.getAttribute('aria-label')).toContain('as generated');
  });

  it('opens a labelled shift chooser offering only the shifts this schedule defines', () => {
    renderRoster();
    openCellEditor('Staff 2', 'Monday');

    const select = screen.getByLabelText("Staff 2 — Monday shift") as HTMLSelectElement;
    expect(select.tagName).toBe('SELECT');
    expect(Array.from(select.options).map((o) => o.value)).toEqual(['M', 'D', 'E', 'OFF']);
  });

  it('records the edit with the generated value kept beside it', () => {
    const { onUpdateRosterOverrides } = renderRoster();
    openCellEditor('Staff 2', 'Monday');

    fireEvent.change(screen.getByLabelText("Staff 2 — Monday shift"), {
      target: { value: 'M' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Save' }));

    expect(onUpdateRosterOverrides).toHaveBeenCalledWith([
      { cycle_week: 2, day_index: 0, shift_code: 'M', original_shift_code: 'OFF' },
    ]);
  });

  it('records nothing when the manager picks the generated value back', () => {
    const { onUpdateRosterOverrides } = renderRoster();
    openCellEditor('Staff 2', 'Monday');
    fireEvent.click(screen.getByRole('button', { name: 'Save' }));

    expect(onUpdateRosterOverrides).toHaveBeenCalledWith([]);
  });
});

describe('the rules re-run on the affected line before the edit is saved', () => {
  it('names the clopening it would create across the line boundary', () => {
    renderRoster();
    openCellEditor('Staff 2', 'Monday');
    fireEvent.change(screen.getByLabelText("Staff 2 — Monday shift"), {
      target: { value: 'M' },
    });

    const select = screen.getByLabelText("Staff 2 — Monday shift");
    const describedBy = select.getAttribute('aria-describedby');
    expect(describedBy).toBeTruthy();
    const findings = document.getElementById(describedBy!)!;
    expect(findings.textContent).toContain('Clopening');
    expect(findings.textContent).toContain('line 1 closes on Sunday');
    expect(findings.textContent).toContain('Rest: only 6h');
  });

  it('names the overtime boundary it would cross', () => {
    renderRoster();
    openCellEditor('Staff 2', 'Sunday');
    fireEvent.change(screen.getByLabelText("Staff 2 — Sunday shift"), {
      target: { value: 'D' },
    });

    const findings = document.getElementById(
      screen.getByLabelText("Staff 2 — Sunday shift").getAttribute('aria-describedby')!
    )!;
    expect(findings.textContent).toContain('Overtime');
    expect(findings.textContent).toContain('48h');
    expect(findings.textContent).toContain('8h past the 40h boundary');
  });

  it('links no error text when the edit breaks nothing', () => {
    renderRoster();
    openCellEditor('Staff 2', 'Tuesday');
    fireEvent.change(screen.getByLabelText("Staff 2 — Tuesday shift"), {
      target: { value: 'OFF' },
    });

    expect(
      screen.getByLabelText("Staff 2 — Tuesday shift").getAttribute('aria-describedby')
    ).toBeNull();
  });
});

describe('a saved edit is visible, explained and undoable', () => {
  const edit: RosterCellOverride[] = [
    { cycle_week: 2, day_index: 0, shift_code: 'M', original_shift_code: 'OFF' },
  ];

  it('marks the cell and the row as modified from generated', () => {
    renderRoster(edit);

    expect(screen.getByText('Modified from OFF')).toBeTruthy();
    expect(screen.getAllByText('Modified from generated').length).toBeGreaterThan(0);
    expect(
      screen
        .getByRole('button', { name: /Change Staff 2's Monday shift/ })
        .getAttribute('aria-label')
    ).toContain('modified from the generated OFF');
  });

  it('recalculates that row hours and payroll, and says what they were', () => {
    const { container } = renderRoster(edit);
    const row = Array.from(container.querySelectorAll('tbody tr')).find((tr) =>
      tr.textContent?.includes('Staff 2')
    )!;

    // Line 2 generated 5 x 8h = 40h at $20/h. The edit adds a Monday morning: 48h,
    // 8h of it overtime, so 40 x 20 + 8 x 30 = $1,040.
    expect(row.textContent).toContain('48h');
    expect(row.textContent).toContain('+8h OT');
    expect(row.textContent).toContain('was 40h');
    expect(row.textContent).toContain('1,040');
  });

  it('reports the rule findings on the edited row', () => {
    const { container } = renderRoster(edit);
    const header = Array.from(container.querySelectorAll('tbody th[scope="row"]')).find((th) =>
      th.textContent?.includes('Staff 2')
    )!;

    expect(header.textContent).toContain('Clopening');
    expect(header.textContent).toContain('Rest: only 6h');
  });

  it('says plainly that the KPI cards above still describe the generated roster', () => {
    renderRoster(edit);
    expect(screen.getByText('1 cell modified from generated')).toBeTruthy();
    expect(
      screen.getByText(/KPI cards above[\s\S]*still describe the generated\s+roster/)
    ).toBeTruthy();
  });

  it('drops the edit when the manager undoes it', () => {
    const { onUpdateRosterOverrides } = renderRoster(edit);
    openCellEditor('Staff 2', 'Monday');
    fireEvent.click(screen.getByRole('button', { name: 'Undo edit' }));

    expect(onUpdateRosterOverrides).toHaveBeenCalledWith([]);
  });

  it('drops every edit when the manager undoes them all', () => {
    const { onUpdateRosterOverrides } = renderRoster(edit);
    fireEvent.click(screen.getByRole('button', { name: 'Undo all edits' }));

    expect(onUpdateRosterOverrides).toHaveBeenCalledWith([]);
  });
});

describe('making the cells editable keeps the grid a real table', () => {
  it('still names each row with a th scope="row" and scopes every column header', () => {
    const { container } = renderRoster([
      { cycle_week: 2, day_index: 0, shift_code: 'M', original_shift_code: 'OFF' },
    ]);
    const grid = container.querySelectorAll('table')[0];

    const firstCell = grid.querySelector('tbody tr')!.firstElementChild!;
    expect(firstCell.tagName).toBe('TH');
    expect(firstCell.getAttribute('scope')).toBe('row');

    const headerCells = Array.from(grid.querySelectorAll('thead th'));
    expect(headerCells.every((th) => th.getAttribute('scope') === 'col')).toBe(true);

    const foot = grid.querySelector('tfoot')!;
    expect(foot.querySelectorAll('th').length).toBe(1);
    expect(foot.querySelector('th')!.getAttribute('scope')).toBe('row');
  });

  it('puts the editor inside the day cell, not outside the table', () => {
    const { container } = renderRoster();
    openCellEditor('Staff 2', 'Monday');

    const select = screen.getByLabelText("Staff 2 — Monday shift");
    expect(select.closest('td')).not.toBeNull();
    expect(container.querySelectorAll('table')[0].contains(select)).toBe(true);
  });
});
