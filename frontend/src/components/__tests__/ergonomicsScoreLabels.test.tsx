import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render, screen } from '@testing-library/react';
import { ErgonomicsAuditView } from '../ErgonomicsAuditView';
import { MasterRosterView } from '../MasterRosterView';
import { makeSolution } from '../../test/solutionFixture';

// This repo's vitest config has no globals, so Testing Library does not unmount
// between tests on its own.
afterEach(cleanup);

// A live solve ran an 8-week rotation, not the hardcoded 6, with 14 hand-off nodes.
const eightWeek = () => makeSolution({ lineCount: 8, pricedLineCount: 8, wage: 18 });

describe('one fatigue scale, one direction, stated range', () => {
  it('names the score the same thing the roster does and says higher is better', () => {
    render(<ErgonomicsAuditView solution={eightWeek()} />);
    expect(screen.getByText('Ergonomics Health Index')).toBeTruthy();
    expect(screen.getByText('90.9/100')).toBeTruthy();
    expect(screen.queryByText('Workload Score')).toBeNull();
    const card = screen.getByText('Ergonomics Health Index').closest('.card');
    expect(card?.textContent).toContain('Higher is better');
    expect(card?.textContent).toContain('between 55 and 99.5');
    expect(card?.textContent).not.toContain('Lower is better here');
  });

  it('captions the penalty-point figure separately as the lower-is-better one', () => {
    render(<ErgonomicsAuditView solution={eightWeek()} />);
    const card = screen.getByText('Ergonomics Health Index').closest('.card');
    expect(card?.textContent).toContain('12.5 penalty points across the 2 checks below, where lower is better');
  });

  it('shows the score out of 100 and its direction on the roster tab too', () => {
    render(
      <MasterRosterView
        solution={eightWeek()}
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
    expect(screen.getByText('90.9/100')).toBeTruthy();
    expect(screen.queryByText('90.9%')).toBeNull();
    expect(screen.getByText(/Higher is better, 55–99.5 range/)).toBeTruthy();
  });
});

describe('rotation length and criterion count come from the solution', () => {
  it('reports the solved rotation length rather than a hardcoded 6 weeks', () => {
    render(<ErgonomicsAuditView solution={eightWeek()} />);
    expect(screen.getByText(/the 8-week rotation repeats without gaps/)).toBeTruthy();
    expect(screen.getByText(/so the 8-week rotation keeps repeating cleanly/)).toBeTruthy();
    expect(screen.queryByText(/6-week rotation/)).toBeNull();
  });

  it('reports the solved hand-off and check counts rather than hardcoded 14 and 8', () => {
    render(<ErgonomicsAuditView solution={eightWeek()} />);
    expect(screen.getByText('14/14')).toBeTruthy();
    expect(screen.getByText('The 2 things this tool checks to avoid burning people out')).toBeTruthy();
  });
});
