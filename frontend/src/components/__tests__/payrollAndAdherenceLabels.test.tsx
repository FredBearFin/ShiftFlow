import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render, screen } from '@testing-library/react';
import { Header } from '../Header';
import { MasterRosterView } from '../MasterRosterView';
import { makeSolution } from '../../test/solutionFixture';

// This repo's vitest config has no globals, so Testing Library does not unmount
// between tests on its own.
afterEach(cleanup);

// The probed case: one staff member on a 12-line roster. One line is priced, so a
// $720 total describes a twelfth of the schedule, and 11 lines have nobody to check
// day availability against.
const underStaffed = () => makeSolution({ lineCount: 12, pricedLineCount: 1, wage: 18 });

function renderRoster(solution = underStaffed()) {
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
}

describe('payroll figures state the share of the roster they priced', () => {
  it('shows the priced-lines fraction beside the roster payroll total', () => {
    renderRoster();
    // The point of this test is that the priced fraction sits beside the total, so assert
    // the pairing rather than the bare amount: after Track F unified currency formatting,
    // $720.00 legitimately appears in more than one place in this view.
    const fraction = screen.getByText('1 of 12 lines priced');
    expect(fraction).toBeTruthy();
    expect(fraction.parentElement?.textContent).toContain('$720.00');
  });

  it('shows the priced-lines fraction on every header payroll figure', () => {
    render(
      <Header
        activeTab="roster"
        onSelectTab={vi.fn()}
        onOpenWizard={vi.fn()}
        solution={underStaffed()}
        leewayPct={10}
      />
    );
    expect(screen.getByText(/\$720\.00 Weekly Payroll · 1 of 12 lines priced/)).toBeTruthy();
    expect(screen.getByText('$720.00 · 1/12 priced')).toBeTruthy();
    expect(screen.getByText('(1/12 priced)')).toBeTruthy();
  });
});

// The adherence figure shares the value "100%" with the weekends-off card, so the
// assertions read the adherence card itself.
function adherenceCardText(): string {
  const card = screen.getByText('Availability Adherence').closest('.card');
  if (!card) throw new Error('Availability Adherence card not found');
  return card.textContent ?? '';
}

describe('availability adherence is suppressed when lines are unstaffed', () => {
  it('reads "Not assessable" rather than 100% with 11 of 12 lines unstaffed', () => {
    renderRoster();
    const text = adherenceCardText();
    expect(text).toContain('Not assessable');
    expect(text).not.toContain('100%');
    expect(text).toContain('Not assessable — 11 of 12 lines unstaffed');
  });

  it('reads 100% only when every line is staffed and conflict-free', () => {
    renderRoster(makeSolution({ lineCount: 3, pricedLineCount: 3, wage: 18 }));
    const text = adherenceCardText();
    expect(text).toContain('100%');
    expect(text).not.toContain('Not assessable');
    expect(text).toContain('Staff day availability checked on all lines');
  });
});

describe('a staff count below the line count is called out persistently', () => {
  it('names the shortfall and what the payroll total leaves out', () => {
    renderRoster();
    expect(screen.getByText(/0 active staff for 12 shift patterns\./)).toBeTruthy();
    expect(screen.getByText(/Staffing the remaining 11 would cost more than the total shown/)).toBeTruthy();
  });

  it('shows no shortfall notice when staffing matches the line count', () => {
    const solution = makeSolution({ lineCount: 2, pricedLineCount: 2, wage: 18 });
    render(
      <MasterRosterView
        solution={solution}
        rotationWeekOffset={0}
        staffAssignments={[]}
        employees={[
          {
            employee_id: 'EMP-1',
            name: 'Staff 1',
            role: 'Clerk',
            hourly_wage: 18,
            max_weekly_hours: 40,
            is_active: true,
            available_days: [0, 1, 2, 3, 4, 5, 6],
            preferred_shifts: ['M'],
          },
          {
            employee_id: 'EMP-2',
            name: 'Staff 2',
            role: 'Clerk',
            hourly_wage: 18,
            max_weekly_hours: 40,
            is_active: true,
            available_days: [0, 1, 2, 3, 4, 5, 6],
            preferred_shifts: ['M'],
          },
        ]}
        onAdvanceWeek={vi.fn()}
        onResetWeek={vi.fn()}
        onUpdateStaffAssignments={vi.fn()}
        onAddEmployee={vi.fn()}
        onToggleEmployeeStatus={vi.fn()}
        onUpdateEmployee={vi.fn()}
        onExportCsv={vi.fn()}
      />
    );
    expect(screen.queryByText(/active staff for .* shift patterns\./)).toBeNull();
  });
});
