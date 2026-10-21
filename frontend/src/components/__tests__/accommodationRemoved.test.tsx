import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render, screen } from '@testing-library/react';
import { MasterRosterView } from '../MasterRosterView';
import { StaffDirectoryView } from '../StaffDirectoryView';
import { makeRosterLine, makeSolution } from '../../test/solutionFixture';

// This repo's vitest config has no globals, so Testing Library does not unmount
// between tests on its own.
afterEach(cleanup);

describe('the inert accommodation record is gone from the product', () => {
  it('offers no statutory accommodation field when adding staff', () => {
    render(
      <StaffDirectoryView
        employees={[]}
        rosterLines={[]}
        onAddEmployee={vi.fn()}
        onToggleActive={vi.fn()}
        onUpdateAvailability={vi.fn()}
      />
    );
    expect(screen.queryByLabelText(/Statutory Accommodation Protection/i)).toBeNull();
    expect(screen.queryByText(/Title VII/i)).toBeNull();
    expect(screen.queryByText(/Hard Invariant/i)).toBeNull();
    expect(screen.queryByText(/Statutory Protections/i)).toBeNull();
  });

  it('shows no accommodation badge or documentation note on a staff card', () => {
    render(
      <StaffDirectoryView
        employees={[
          {
            employee_id: 'EMP-1',
            name: 'Dana Reyes',
            role: 'Clerk',
            hourly_wage: 18,
            max_weekly_hours: 40,
            is_active: true,
            available_days: [0, 1, 2, 3, 4, 5],
            preferred_shifts: ['M'],
            accommodation_type: 'religious',
            statutory_notes: 'Sunday observance approved',
          },
        ]}
        rosterLines={[]}
        onAddEmployee={vi.fn()}
        onToggleActive={vi.fn()}
        onUpdateAvailability={vi.fn()}
      />
    );
    expect(screen.getByText('Dana Reyes')).toBeTruthy();
    expect(screen.queryByText(/Sabbath accom/i)).toBeNull();
    expect(screen.queryByText(/Schedule restriction on file/i)).toBeNull();
    expect(screen.queryByText(/Sunday observance approved/)).toBeNull();
  });

  it('never shows a Sabbath alert badge, even on a line carrying the engine flag', () => {
    const solution = makeSolution({
      lineCount: 1,
      pricedLineCount: 1,
      wage: 18,
      solution: {
        roster_lines: [
          makeRosterLine(1, {
            assigned_person: 'Dana Reyes',
            assigned_employee_id: 'EMP-1',
            hourly_wage: 18,
            estimated_weekly_payroll: 720,
            availability_conflicts_count: 1,
            statutory_accommodation_violation: true,
          }),
        ],
      },
    });
    render(
      <MasterRosterView
        solution={solution}
        rotationWeekOffset={0}
        staffAssignments={[]}
        employees={[]}
        onAdvanceWeek={vi.fn()}
        onResetWeek={vi.fn()}
        onUpdateStaffAssignments={vi.fn()}
        onAddEmployee={vi.fn()}
        onToggleEmployeeStatus={vi.fn()}
        onUpdateEmployee={vi.fn()}
        onExportCsv={vi.fn()}
      />
    );
    expect(screen.queryByText(/Title VII \/ ADA Sabbath Alert/)).toBeNull();
    // The honest reading of the same underlying fact is still shown.
    expect(screen.getByText('1 Avail Alert')).toBeTruthy();
  });
});
