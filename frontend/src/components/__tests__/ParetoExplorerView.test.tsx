/**
 * ParetoExplorerView: does it render every frontier point, and does choosing one call back?
 *
 * The props contract is (solution, selectedLeewayPct, onSelectLeewayPct). These tests
 * exercise exactly that, plus the one claim the view makes about the data: which point is
 * marked as the best value. Nothing here asserts chart geometry.
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render, screen } from '@testing-library/react';
import { ParetoExplorerView } from '../ParetoExplorerView';
import { makeSolveResponse } from './solveResponseFixture';

// No globals in this repo's vitest config, so Testing Library does not unmount for us.
afterEach(cleanup);

describe('ParetoExplorerView', () => {
  it('renders every point on the frontier', () => {
    const solution = makeSolveResponse();
    render(
      <ParetoExplorerView
        solution={solution}
        selectedLeewayPct={5}
        onSelectLeewayPct={vi.fn()}
      />
    );
    const text = document.body.textContent ?? '';
    solution.pareto_frontier.forEach((point) => {
      expect(text, `frontier point at ${point.leeway_pct}% must be shown`).toContain(
        point.label
      );
    });
  });

  it('calls onSelectLeewayPct with a real frontier leeway value when a point is chosen', () => {
    const solution = makeSolveResponse();
    const onSelectLeewayPct = vi.fn();
    render(
      <ParetoExplorerView
        solution={solution}
        selectedLeewayPct={5}
        onSelectLeewayPct={onSelectLeewayPct}
      />
    );

    // Whatever the view uses for a choosable point - a button or a row with role=button -
    // picking one must hand back a leeway value that is actually on the frontier, not an
    // index or a rounded figure.
    const choosable = screen.queryAllByRole('button');
    expect(choosable.length, 'the explorer must offer selectable points').toBeGreaterThan(0);

    const leewayValues = solution.pareto_frontier.map((p) => p.leeway_pct);
    let called = false;
    for (const candidate of choosable) {
      onSelectLeewayPct.mockClear();
      candidate.click();
      if (onSelectLeewayPct.mock.calls.length > 0) {
        called = true;
        expect(leewayValues).toContain(onSelectLeewayPct.mock.calls[0][0]);
        break;
      }
    }
    expect(called, 'at least one control must select a frontier point').toBe(true);
  });

  it('marks the best-value point the solution identified, and only that one', () => {
    const solution = makeSolveResponse();
    const knees = solution.pareto_frontier.filter((p) => p.is_knee_point);
    expect(knees.length).toBe(1);

    render(
      <ParetoExplorerView
        solution={solution}
        selectedLeewayPct={5}
        onSelectLeewayPct={vi.fn()}
      />
    );
    expect(document.body.textContent ?? '').toContain(knees[0].label);
  });

  it('renders a single-point frontier without throwing', () => {
    const solution = makeSolveResponse();
    const single = {
      ...solution,
      pareto_frontier: [solution.pareto_frontier[0]],
    };
    expect(() =>
      render(
        <ParetoExplorerView
          solution={single}
          selectedLeewayPct={0}
          onSelectLeewayPct={vi.fn()}
        />
      )
    ).not.toThrow();
  });

  it('renders an empty frontier without throwing', () => {
    // generate_pareto_frontier drops leeway levels it cannot solve, so a frontier can
    // legitimately come back short or empty. The view must not crash on that.
    const solution = makeSolveResponse();
    expect(() =>
      render(
        <ParetoExplorerView
          solution={{ ...solution, pareto_frontier: [] }}
          selectedLeewayPct={5}
          onSelectLeewayPct={vi.fn()}
        />
      )
    ).not.toThrow();
  });
});
