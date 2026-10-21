/**
 * The flexibility/rest chart's axes.
 *
 * The y gridlines were computed as `maxErgo * (1 - frac)`, which forces the
 * scale to zero. Staff strain across a frontier sits in a narrow band well
 * above zero, so most of the card was empty and the curve read far flatter
 * than the numbers are. The x axis carried no ticks and no values at all,
 * only a centred caption, and point labels were drawn at a fixed
 * (cx + 8, cy - 8), so the leftmost one overran the top edge of the plot.
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render, screen } from '@testing-library/react';
import { ParetoExplorerView } from '../ParetoExplorerView';
import { makeSolution } from '../../test/solutionFixture';
import type { ParetoPoint } from '../../types';

// This repo's vitest config has no globals, so Testing Library does not unmount
// between tests on its own.
afterEach(cleanup);

function point(leeway: number, ergo: number, shift: number, knee = false): ParetoPoint {
  return {
    point_index: leeway,
    leeway_pct: leeway,
    obj_shift: shift,
    obj_ergo: ergo,
    ergo_improvement_pct: leeway,
    becker_theoretical_improvement_pct: leeway,
    employee_count: 8,
    active_shift_types_count: 3,
    total_understaffing_hours: 100,
    total_overstaffing_hours: 0,
    full_weekends_off_pct: 50,
    estimated_weekly_payroll: 720,
    is_knee_point: knee,
    is_selected: leeway === 10,
    label: `Option ${leeway}`,
  };
}

// The probed shape: strain spans a narrow band far above zero, and several
// options share one shift total, so they land on identical coordinates.
const narrowBand = [
  point(0, 180, 406),
  point(10, 174, 406, true),
  point(25, 150, 406),
  point(50, 126, 523),
  point(75, 118, 523),
];

function renderChart(points: ParetoPoint[], selected = 10) {
  return render(
    <ParetoExplorerView
      solution={makeSolution({
        lineCount: 8,
        pricedLineCount: 8,
        wage: 18,
        solution: { pareto_frontier: points },
      })}
      selectedLeewayPct={selected}
      onSelectLeewayPct={vi.fn()}
    />
  );
}

/** The y-axis tick labels, which sit to the left of the plot. */
function yTickValues(container: HTMLElement): number[] {
  const svg = container.querySelector('svg')!;
  return Array.from(svg.querySelectorAll('text'))
    .filter((t) => t.getAttribute('text-anchor') === 'end' && /^-?\d+(\.\d+)?$/.test(t.textContent ?? ''))
    .map((t) => Number(t.textContent));
}

describe('the y axis is domained to the data, not to zero', () => {
  it('never prints a gridline at zero when the data sits far above it', () => {
    const { container } = renderChart(narrowBand);
    const values = yTickValues(container);
    expect(values.length).toBeGreaterThanOrEqual(2);
    expect(Math.min(...values)).toBeGreaterThan(100);
    expect(values).not.toContain(0);
  });

  it('covers the data range at both ends', () => {
    const { container } = renderChart(narrowBand);
    const values = yTickValues(container);
    expect(Math.min(...values)).toBeLessThanOrEqual(118);
    expect(Math.max(...values)).toBeGreaterThanOrEqual(180);
  });

  it('says in words that the scale does not start at zero', () => {
    renderChart(narrowBand);
    expect(screen.getByText(/does not start at zero/)).toBeTruthy();
  });

  it('does not fall over when every option has the same strain', () => {
    const flat = [point(0, 150, 400), point(50, 150, 500, true)];
    const { container } = renderChart(flat, 0);
    const values = yTickValues(container);
    expect(values.length).toBeGreaterThanOrEqual(2);
    expect(new Set(values).size).toBeGreaterThan(1);
  });
});

describe('the x axis has ticks and values', () => {
  it('names each tick for the staffing flexibility that lands there', () => {
    const { container } = renderChart(narrowBand);
    const svg = container.querySelector('svg')!;
    const labels = Array.from(svg.querySelectorAll('text')).map((t) => t.textContent ?? '');
    // Two distinct shift totals in this frontier, so two ticks.
    expect(labels).toContain('+0–25%');
    expect(labels).toContain('+50–75%');
  });

  it('makes no cost claim on the axis', () => {
    const { container } = renderChart(narrowBand);
    const svgText = container.querySelector('svg')!.textContent ?? '';
    expect(svgText).toMatch(/flexibility/i);
    expect(svgText).not.toMatch(/\bcost\b|\bbudget\b|payroll/i);
  });

  it('draws a tick mark per value, not just a caption', () => {
    const { container } = renderChart(narrowBand);
    const svg = container.querySelector('svg')!;
    // Vertical rules below the axis line: x1 === x2 and y2 > y1.
    const ticks = Array.from(svg.querySelectorAll('line')).filter(
      (l) => l.getAttribute('x1') === l.getAttribute('x2')
    );
    expect(ticks.length).toBeGreaterThanOrEqual(2);
  });
});

describe('point labels stay inside the plot', () => {
  it('keeps every label within the plot area', () => {
    const { container } = renderChart(narrowBand);
    const svg = container.querySelector('svg')!;
    const viewBox = (svg.getAttribute('viewBox') ?? '').split(/\s+/).map(Number);
    const [, , width, height] = viewBox;
    const labels = Array.from(svg.querySelectorAll('text')).filter((t) =>
      /% flex$/.test(t.textContent ?? '')
    );
    expect(labels.length).toBeGreaterThan(0);
    for (const label of labels) {
      const x = Number(label.getAttribute('x'));
      const y = Number(label.getAttribute('y'));
      // The old code drew the leftmost label above the top of the plot.
      expect(y).toBeGreaterThan(0);
      expect(y).toBeLessThan(height);
      expect(x).toBeGreaterThanOrEqual(0);
      expect(x).toBeLessThanOrEqual(width);
    }
  });

  it('does not stack two labels on options that share one position', () => {
    const { container } = renderChart(narrowBand);
    const svg = container.querySelector('svg')!;
    const boxes = Array.from(svg.querySelectorAll('text'))
      .filter((t) => /% flex$/.test(t.textContent ?? ''))
      .map((t) => ({ x: Number(t.getAttribute('x')), y: Number(t.getAttribute('y')) }));
    for (let i = 0; i < boxes.length; i += 1) {
      for (let j = i + 1; j < boxes.length; j += 1) {
        const sameSpot =
          Math.abs(boxes[i].x - boxes[j].x) < 4 && Math.abs(boxes[i].y - boxes[j].y) < 4;
        expect(sameSpot, 'two point labels printed on top of each other').toBe(false);
      }
    }
  });
});
