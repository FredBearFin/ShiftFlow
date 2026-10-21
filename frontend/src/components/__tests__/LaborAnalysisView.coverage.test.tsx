import { afterEach, describe, expect, it } from 'vitest';
import { cleanup, render, screen } from '@testing-library/react';
import { LaborAnalysisView } from '../LaborAnalysisView';
import { makeSolution } from '../../test/solutionFixture';
import type { IntervalCoverageCell } from '../../types';

// This repo's vitest config has no globals, so Testing Library does not unmount
// between tests on its own.
afterEach(cleanup);

const DAY_NAMES = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];

/** 168 hourly cells, the first `shortHours` of which are one person short. */
function coverage(shortHours: number): IntervalCoverageCell[] {
  const cells: IntervalCoverageCell[] = [];
  for (let day = 0; day < 7; day++) {
    for (let hour = 0; hour < 24; hour++) {
      const short = cells.length < shortHours ? 1 : 0;
      cells.push({
        day_index: day,
        day_name: DAY_NAMES[day],
        hour,
        hour_label: `${hour}:00`,
        required_staff: 2,
        scheduled_staff: 2 - short,
        understaffing: short,
        overstaffing: 0,
        shift_breakdown: {},
      });
    }
  }
  return cells;
}

function renderLabor(shortHours: number) {
  render(
    <LaborAnalysisView
      solution={makeSolution({
        lineCount: 8,
        pricedLineCount: 8,
        wage: 18,
        solution: { interval_coverage: coverage(shortHours) },
      })}
    />
  );
}

describe('coverage is reported as uncovered hours, not an hours ratio', () => {
  it('shows the hour-by-hour shortfall as the headline figure', () => {
    // The probed roster read 95.3% "Coverage" with 60 uncovered hours.
    renderLabor(60);
    expect(screen.getByText('Uncovered Hours This Week')).toBeTruthy();
    expect(screen.getByText('60h')).toBeTruthy();
    expect(screen.getByText('Short')).toBeTruthy();
  });

  it('no longer captions the hours ratio "Coverage"', () => {
    renderLabor(60);
    expect(screen.queryByText('Coverage')).toBeNull();
    expect(screen.queryByText('Required ÷ scheduled hours')).toBeNull();
  });

  it('keeps the hours ratio only as a paid-versus-required hours figure', () => {
    renderLabor(60);
    expect(
      screen.getByText(/paid hours come to 95.3% of required hours/)
    ).toBeTruthy();
  });

  it('no longer runs the two helper sentences together', () => {
    renderLabor(60);
    expect(
      screen.queryByText(/fall short of required hours Floor requirements vs hours paid/)
    ).toBeNull();
  });

  it('reads fully covered when no hour is short', () => {
    renderLabor(0);
    const card = screen.getByText('Uncovered Hours This Week').closest('.card');
    expect(card?.textContent).toContain('0h');
    expect(card?.textContent).toContain('Fully covered');
  });
});
