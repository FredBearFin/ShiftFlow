import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render, screen } from '@testing-library/react';
import { DOLComplianceView } from '../DOLComplianceView';
import { ErgonomicsAuditView } from '../ErgonomicsAuditView';
import { MasterRosterView } from '../MasterRosterView';
import { makeRosterLine, makeSolution } from '../../test/solutionFixture';

// This repo's vitest config has no globals, so Testing Library does not unmount
// between tests on its own.
afterEach(cleanup);

describe('the compliance tab says what it did and did not assess', () => {
  it('renders an unassessed Fair Workweek check that is not green', () => {
    render(<DOLComplianceView solution={makeSolution()} />);
    const row = screen
      .getByText('Fair Workweek / predictive scheduling — not assessed')
      .closest('div.rounded-xl');
    expect(row).toBeTruthy();
    expect(row?.className).not.toContain('emerald');
    expect(row?.textContent).toContain('does not assess Fair Workweek');
    expect(row?.textContent).toContain('nothing on this page tells you whether you comply');
  });

  it('renders a verdict instead once the backend actually assesses it', () => {
    const solution = makeSolution();
    solution.ergonomics_audit.fair_workweek_compliant = true;
    render(<DOLComplianceView solution={solution} />);
    const row = screen
      .getByText('Fair Workweek / predictive scheduling — not assessed')
      .closest('div.rounded-xl');
    expect(row?.className).toContain('emerald');
  });

  it('makes no absolute claim that 16 hours of rest is enforced', () => {
    render(<ErgonomicsAuditView solution={makeSolution()} />);
    expect(screen.queryByText(/never schedules less than 16 hours of rest/)).toBeNull();
    expect(screen.getByText(/no gap in this schedule falls short of it/)).toBeTruthy();
  });

  it('states the shortfall when the schedule has one', () => {
    const solution = makeSolution();
    solution.ergonomics_audit.clopening_violations = 3;
    render(<ErgonomicsAuditView solution={solution} />);
    expect(screen.getByText(/does not guarantee it: 3 gaps in this schedule fall short/)).toBeTruthy();
  });

  it('shows no predictability-pay badge that depends on the viewed week', () => {
    const solution = makeSolution({
      lineCount: 1,
      pricedLineCount: 1,
      solution: {
        roster_lines: [
          makeRosterLine(1, {
            assigned_person: 'Dana Reyes',
            hourly_wage: 18,
            estimated_weekly_payroll: 720,
            availability_conflicts_count: 1,
            fair_workweek_predictability_warning: true,
          }),
        ],
      },
    });
    render(
      <MasterRosterView
        solution={solution}
        rotationWeekOffset={1}
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
    expect(screen.queryByText('Predictability Pay Risk')).toBeNull();
  });
});
