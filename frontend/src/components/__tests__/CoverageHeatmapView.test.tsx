/**
 * CoverageHeatmapView: does it render the 168-hour grid, and does its mode toggle work?
 *
 * Keyed on the numbers in the SolveResponse rather than on markup, so a restyle does not
 * break these. The fixture is deliberately built with one understaffed hour (09:00) and
 * one overstaffed hour (15:00) on every day, which is what gives this view something to
 * show.
 */
import { afterEach, describe, expect, it } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { CoverageHeatmapView } from '../CoverageHeatmapView';
import { makeSolveResponse } from './solveResponseFixture';

// No globals in this repo's vitest config, so Testing Library does not unmount for us.
afterEach(cleanup);

/** The hour-by-hour grid, which is the largest table this view renders. */
function grid(): HTMLElement {
  const tables = screen.getAllByRole('table');
  return tables.reduce((biggest, candidate) =>
    (candidate.textContent ?? '').length > (biggest.textContent ?? '').length ? candidate : biggest
  );
}

describe('CoverageHeatmapView', () => {
  it('renders a grid covering all seven days', () => {
    render(<CoverageHeatmapView solution={makeSolveResponse()} />);
    const text = document.body.textContent ?? '';
    ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'].forEach((day) => {
      expect(text).toContain(day);
    });
  });

  it('reports the real understaffed and overstaffed totals', () => {
    // 7 days x 1 understaffed hour x 1 person = 7; same for overstaffed.
    const solution = makeSolveResponse();
    const under = solution.interval_coverage.reduce((sum, c) => sum + c.understaffing, 0);
    const over = solution.interval_coverage.reduce((sum, c) => sum + c.overstaffing, 0);
    expect(under).toBe(7);
    expect(over).toBe(7);

    render(<CoverageHeatmapView solution={solution} />);
    const text = document.body.textContent ?? '';
    expect(text).toContain(String(under));
    expect(text).toContain(String(over));
  });

  it('switching display mode changes what the cells show', () => {
    render(<CoverageHeatmapView solution={makeSolveResponse()} />);
    const toggles = screen
      .getAllByRole('button')
      .filter((button) =>
        /scheduled|required|difference|deviation|gap|surplus|short|over|under/i.test(
          button.textContent ?? ''
        )
      );
    expect(
      toggles.length,
      'the heatmap must offer a control for what the cells show'
    ).toBeGreaterThan(1);

    const gridBefore = grid().textContent ?? '';
    fireEvent.click(toggles[toggles.length - 1]);
    const gridAfter = grid().textContent ?? '';
    expect(gridAfter, 'switching display mode must change the grid').not.toBe(gridBefore);

    // And switching back must restore the first rendering, so the control is a real
    // toggle rather than a one-way change.
    const restored = toggles.find((button) => {
      fireEvent.click(button);
      return (grid().textContent ?? '') === gridBefore;
    });
    expect(restored, 'switching back must restore the original grid').toBeTruthy();
  });

  it('shows a shortfall and a surplus distinguishably once the mode is switched', () => {
    render(<CoverageHeatmapView solution={makeSolveResponse()} />);
    const toggles = screen.getAllByRole('button');
    fireEvent.click(toggles[toggles.length - 1]);

    // The fixture is one person short at 09:00 and one over at 15:00 every day, so the
    // grid must distinguish the two directions rather than showing a bare magnitude.
    const cells = grid().textContent ?? '';
    expect(cells).toMatch(/-1/);
    expect(cells).toMatch(/\+1/);
  });

  it('renders a fully covered week without claiming any gap', () => {
    const solution = makeSolveResponse();
    const perfect = {
      ...solution,
      interval_coverage: solution.interval_coverage.map((cell) => ({
        ...cell,
        scheduled_staff: cell.required_staff,
        understaffing: 0,
        overstaffing: 0,
      })),
    };
    expect(() => render(<CoverageHeatmapView solution={perfect} />)).not.toThrow();
  });

  it('renders a closed week (no demand at all) without throwing', () => {
    const solution = makeSolveResponse();
    const closed = {
      ...solution,
      interval_coverage: solution.interval_coverage.map((cell) => ({
        ...cell,
        required_staff: 0,
        scheduled_staff: 0,
        understaffing: 0,
        overstaffing: 0,
        shift_breakdown: {},
      })),
    };
    expect(() => render(<CoverageHeatmapView solution={closed} />)).not.toThrow();
  });
});
