/**
 * LaborAnalysisView: does it report the real payroll figures, and does it leave an
 * unassigned line out of them rather than inventing a wage?
 *
 * The unassigned-line case is the one that matters most here: a line with no employee
 * mapped to it has hourly_wage null and estimated_weekly_payroll null, and this view must
 * not quietly price it. Nothing here asserts chart geometry or class names.
 */
import { afterEach, describe, expect, it } from 'vitest';
import { cleanup, render } from '@testing-library/react';
import { LaborAnalysisView } from '../LaborAnalysisView';
import { makeSolveResponse } from './solveResponseFixture';

// No globals in this repo's vitest config, so Testing Library does not unmount for us.
afterEach(cleanup);

describe('LaborAnalysisView', () => {
  it('reports the overtime hours the solution computed', () => {
    const solution = makeSolveResponse();
    expect(solution.labor_analysis.total_overtime_hours).toBe(8);
    render(<LaborAnalysisView solution={solution} />);
    expect(document.body.textContent ?? '').toContain('8');
  });

  it('reports the total payroll cost the solution computed', () => {
    const solution = makeSolveResponse();
    render(<LaborAnalysisView solution={solution} />);
    const text = document.body.textContent ?? '';
    // 2310 may be formatted as 2,310 or 2310.00; accept any grouping or decimals.
    expect(text).toMatch(/2[,.]?310/);
  });

  it('does not price the unassigned line', () => {
    const solution = makeSolveResponse();
    const unpriced = solution.roster_lines.filter((l) => l.estimated_weekly_payroll === null);
    expect(unpriced.length, 'the fixture must contain an unassigned line').toBe(1);

    render(<LaborAnalysisView solution={solution} />);
    const text = document.body.textContent ?? '';
    // 16.50 was this codebase's old hard-coded default wage for an unassigned line. If it
    // appears, something is pricing a line that has no wage.
    expect(text).not.toMatch(/16\.50/);
  });

  it('renders when no line has a wage at all', () => {
    const solution = makeSolveResponse();
    const unpaid = {
      ...solution,
      roster_lines: solution.roster_lines.map((line) => ({
        ...line,
        hourly_wage: null,
        estimated_weekly_payroll: null,
      })),
      labor_analysis: {
        ...solution.labor_analysis,
        regular_payroll_cost: 0,
        overtime_payroll_cost: 0,
        total_payroll_cost: 0,
        avg_hourly_wage: null,
      },
    };
    // A schedule solved before anyone is hired is the normal first-run state, and
    // avg_hourly_wage is genuinely null there, so this must not divide by it and crash.
    expect(() => render(<LaborAnalysisView solution={unpaid} />)).not.toThrow();
  });

  it('renders a week with no scheduled hours without throwing', () => {
    const solution = makeSolveResponse();
    const empty = {
      ...solution,
      labor_analysis: {
        ...solution.labor_analysis,
        total_scheduled_hours: 0,
        total_regular_hours: 0,
        total_overtime_hours: 0,
        hours_per_day: [0, 0, 0, 0, 0, 0, 0],
        cost_per_day: [0, 0, 0, 0, 0, 0, 0],
        overtime_lines_count: 0,
        labor_efficiency_pct: 0,
      },
    };
    expect(() => render(<LaborAnalysisView solution={empty} />)).not.toThrow();
  });

  it('renders without a facility id, which is an optional prop', () => {
    expect(() => render(<LaborAnalysisView solution={makeSolveResponse()} />)).not.toThrow();
  });
});
