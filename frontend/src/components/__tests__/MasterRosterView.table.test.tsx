import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, cleanup } from '@testing-library/react';
import { MasterRosterView } from '../MasterRosterView';
import { solutionFixture } from '../../test/solutionFixture';

// This repo runs vitest without globals, so Testing Library does not unmount
// between cases on its own.
afterEach(cleanup);

function renderRoster() {
  const noop = vi.fn();
  return render(
    <MasterRosterView
      solution={solutionFixture}
      rotationWeekOffset={0}
      staffAssignments={[]}
      employees={[]}
      onAdvanceWeek={noop}
      onResetWeek={noop}
      onUpdateStaffAssignments={noop}
      onAddEmployee={noop}
      onToggleEmployeeStatus={noop}
      onUpdateEmployee={noop}
      onExportCsv={noop}
    />
  );
}

describe('weekly schedule grid semantics', () => {
  it('names each row with a th scope="row" carrying the line and person', () => {
    const { container } = renderRoster();
    const grid = container.querySelectorAll('table')[0];
    const firstCell = grid.querySelector('tbody tr')!.firstElementChild!;

    expect(firstCell.tagName).toBe('TH');
    expect(firstCell.getAttribute('scope')).toBe('row');
    expect(firstCell.textContent).toContain('PATTERN-01');
    expect(firstCell.textContent).toContain('Staff 1');
  });

  it('scopes every real column header', () => {
    const { container } = renderRoster();
    const grid = container.querySelectorAll('table')[0];
    const headerCells = Array.from(grid.querySelectorAll('thead th'));

    expect(headerCells.length).toBeGreaterThan(0);
    expect(headerCells.every((th) => th.getAttribute('scope') === 'col')).toBe(true);
  });

  it('keeps the understaffing totals out of thead and in tfoot as data cells', () => {
    const { container } = renderRoster();
    const grid = container.querySelectorAll('table')[0];

    expect(grid.querySelectorAll('thead tr').length).toBe(1);
    const foot = grid.querySelector('tfoot')!;
    expect(foot.textContent).toContain('Under-staffed hours per day');
    expect(foot.querySelectorAll('th').length).toBe(1);
    expect(foot.querySelector('th')!.getAttribute('scope')).toBe('row');
    expect(foot.querySelectorAll('td').length).toBeGreaterThan(7);
  });
});
