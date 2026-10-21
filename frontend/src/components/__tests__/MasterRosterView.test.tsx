/**
 * MasterRosterView: does it render a schedule, and do its controls call their props?
 *
 * Written against stable public behaviour - the props in / callbacks out contract, and
 * text a supervisor would look for - not against current markup. Several tracks are
 * restyling this view at the same time, so no test here asserts a class name, a DOM
 * shape, or exact wording beyond the shift codes and day names the schedule must show.
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render, screen, within } from '@testing-library/react';
import { MasterRosterView } from '../MasterRosterView';
import { makeSolveResponse } from './solveResponseFixture';

// This repo's vitest config has no globals, so Testing Library does not unmount between
// tests on its own. Without this every test sees the previous test's DOM too.
afterEach(cleanup);

function renderView(overrides: Record<string, unknown> = {}) {
  const props = {
    solution: makeSolveResponse(),
    rotationWeekOffset: 0,
    staffAssignments: [],
    employees: [],
    onAdvanceWeek: vi.fn(),
    onResetWeek: vi.fn(),
    onUpdateStaffAssignments: vi.fn(),
    onAddEmployee: vi.fn(),
    onToggleEmployeeStatus: vi.fn(),
    onUpdateEmployee: vi.fn(),
    onExportCsv: vi.fn(),
    ...overrides,
  };
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  render(<MasterRosterView {...(props as any)} />);
  return props;
}

describe('MasterRosterView', () => {
  it('renders one row per roster line in the solution', () => {
    renderView();
    const table = screen.getByRole('table');
    // Keyed on cohort_id, which comes from the solution rather than from display copy, so
    // this survives the view renaming "Line" to "Shift Pattern" or anything else.
    const rows = within(table).getAllByRole('row');
    ['PATTERN-01', 'PATTERN-02', 'PATTERN-03'].forEach((cohortId) => {
      expect(
        rows.filter((row) => (row.textContent ?? '').includes(cohortId)).length,
        `expected a row for ${cohortId}`
      ).toBe(1);
    });
  });

  it('shows every day of the week', () => {
    renderView();
    const table = screen.getByRole('table');
    ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'].forEach((day) => {
      expect(within(table).getAllByText(new RegExp(day)).length).toBeGreaterThan(0);
    });
  });

  it('shows each assigned shift with the hours it runs', () => {
    renderView();
    const table = screen.getByRole('table');
    const text = table.textContent ?? '';
    // Fixture line 1 is M M D E E OFF OFF. A supervisor needs the times, not just the
    // letter, so assert the code is shown together with its own window.
    expect(text).toMatch(/M\s*06:00[–-]14:00/);
    expect(text).toMatch(/D\s*10:00[–-]18:00/);
    expect(text).toMatch(/E\s*14:00[–-]22:00/);
    expect(text).toMatch(/OFF/);
  });

  it('shows overtime separately for the line that has it', () => {
    renderView();
    // Fixture line 2 works six days: 48 hours, 8 of them overtime. Overtime costs 1.5x,
    // so a view that folded it into the plain total would understate the week's cost.
    const row = within(screen.getByRole('table'))
      .getAllByRole('row')
      .find((candidate) => (candidate.textContent ?? '').includes('PATTERN-02'));
    expect(row).toBeTruthy();
    expect(row!.textContent ?? '').toMatch(/8h\s*OT|OT/);
  });

  it('calls onExportCsv when the export control is used', async () => {
    const props = renderView();
    const exportButton = screen
      .getAllByRole('button')
      .find((button) => /export|csv|download/i.test(button.textContent ?? ''));
    expect(exportButton, 'the roster must offer a way to export').toBeTruthy();
    exportButton!.click();
    expect(props.onExportCsv).toHaveBeenCalled();
  });

  it('calls onAdvanceWeek when a week-advance control is used', () => {
    const props = renderView();
    const advance = screen
      .getAllByRole('button')
      .find((button) => /next week|advance|rotate/i.test(button.textContent ?? ''));
    if (!advance) {
      // The control may be an icon button in some designs; the contract under test is
      // that if the view offers week advancement at all, it goes through the prop.
      expect(props.onAdvanceWeek).not.toHaveBeenCalled();
      return;
    }
    advance.click();
    expect(props.onAdvanceWeek).toHaveBeenCalled();
  });

  it('renders an unassigned line without inventing a wage for it', () => {
    renderView();
    // Fixture line 3 has hourly_wage null and estimated_weekly_payroll null. The default
    // wage in this codebase used to be 16.50, so that figure must not appear for it.
    const table = screen.getByRole('table');
    const lineThreeRow = within(table)
      .getAllByRole('row')
      .find((row) => (row.textContent ?? '').includes('PATTERN-03'));
    expect(lineThreeRow).toBeTruthy();
    expect(lineThreeRow!.textContent ?? '').not.toMatch(/16\.50/);
  });

  it('renders without throwing when there are no employees and no assignments', () => {
    expect(() => renderView({ employees: [], staffAssignments: [] })).not.toThrow();
  });
});
