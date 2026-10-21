import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render, screen } from '@testing-library/react';
import { ParetoExplorerView } from '../ParetoExplorerView';
import { makeSolution } from '../../test/solutionFixture';
import type { ParetoPoint } from '../../types';

// This repo's vitest config has no globals, so Testing Library does not unmount
// between tests on its own.
afterEach(cleanup);

function point(leeway: number, uncovered: number, payroll: number, knee = false): ParetoPoint {
  return {
    point_index: leeway,
    leeway_pct: leeway,
    obj_shift: 100 + leeway,
    obj_ergo: 20 - leeway / 10,
    ergo_improvement_pct: leeway,
    becker_theoretical_improvement_pct: leeway,
    employee_count: 8,
    active_shift_types_count: 3,
    total_understaffing_hours: uncovered,
    total_overstaffing_hours: 0,
    full_weekends_off_pct: 50,
    estimated_weekly_payroll: payroll,
    is_knee_point: knee,
    is_selected: leeway === 10,
    label: `Option ${leeway}`,
  };
}

// The probed case: labels read +0% through +50% while payroll stayed flat at $720
// and uncovered hours swung 102h -> 60h -> 180h.
const points = [
  point(0, 102, 720),
  point(10, 60, 720, true),
  point(50, 180, 720),
];

function renderExplorer() {
  render(
    <ParetoExplorerView
      solution={makeSolution({ lineCount: 8, pricedLineCount: 1, wage: 18, solution: { pareto_frontier: points } })}
      selectedLeewayPct={10}
      onSelectLeewayPct={vi.fn()}
    />
  );
}

describe('the leeway column is named for what it controls', () => {
  it('labels it staffing flexibility, not extra cost', () => {
    renderExplorer();
    expect(screen.getByText('Staffing flexibility')).toBeTruthy();
    expect(screen.queryByText('Extra cost')).toBeNull();
    expect(screen.queryByText(/extra payroll allowed/)).toBeNull();
  });

  it('makes no cost claim from the leeway percentage', () => {
    renderExplorer();
    // Payroll is flat across the frontier, so the page must not imply otherwise.
    expect(screen.queryByText('+50% cost')).toBeNull();
    expect(screen.getByText('+50% flexibility')).toBeTruthy();
    expect(screen.getByText('+10% staffing flexibility allowed')).toBeTruthy();
  });
});

describe('uncovered hours are a column of their own', () => {
  it('shows each point its own total_understaffing_hours', () => {
    renderExplorer();
    expect(screen.getByText('Uncovered hours')).toBeTruthy();
    expect(screen.getByText('102h')).toBeTruthy();
    expect(screen.getByText('60h')).toBeTruthy();
    expect(screen.getByText('180h')).toBeTruthy();
  });

  it('names the worst-coverage option rather than leaving it to be spotted', () => {
    renderExplorer();
    expect(screen.getByText('worst coverage here')).toBeTruthy();
  });

  it('drives the payroll column from each point estimated_weekly_payroll', () => {
    renderExplorer();
    // Three identical payroll figures, one per option — not scaled by leeway.
    expect(screen.getAllByText('$720.00').length).toBe(3);
  });
});
