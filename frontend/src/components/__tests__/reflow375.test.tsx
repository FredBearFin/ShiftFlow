import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, cleanup } from '@testing-library/react';
import { CoverageHeatmapView } from '../CoverageHeatmapView';
import { MasterRosterView } from '../MasterRosterView';
import { solutionFixture } from '../../test/solutionFixture';

// This repo runs vitest without globals, so Testing Library does not unmount
// between cases on its own.
afterEach(cleanup);

/*
 * jsdom does no layout, so the measurement itself (scrollWidth === clientWidth
 * at 375px on all seven tabs) is a browser check. What is asserted here is the
 * markup that made the two overflows possible: a flex row pinned at both ends
 * with no way to wrap and no way to shrink.
 */

describe('375px reflow', () => {
  it('lets the coverage KPI-and-toggle row wrap', () => {
    const { container } = render(<CoverageHeatmapView solution={solutionFixture} />);
    const toggle = container.querySelector('[aria-pressed]')!;
    const row = toggle.closest('div.flex')!.parentElement!;
    expect(row.className).toContain('flex-wrap');
  });

  it('lets the payroll KPI row reflow instead of pushing the page sideways', () => {
    const noop = vi.fn();
    const { container } = render(
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

    const wageChip = Array.from(container.querySelectorAll('span')).find((s) =>
      /^\$[\d.,]+\/hr$/.test((s.textContent || '').trim())
    )!;
    expect(wageChip).toBeTruthy();
    const row = wageChip.parentElement!;
    expect(row.className).toContain('flex-wrap');
    expect(row.className).toContain('min-w-0');
    // Both ends of the row must be allowed to shrink, not just the container.
    expect(Array.from(row.children).every((c) => c.className.includes('min-w-0'))).toBe(true);
    // And the figure is not truncated away: half a wage is a wrong wage.
    expect(row.className).not.toContain('truncate');
  });
});
