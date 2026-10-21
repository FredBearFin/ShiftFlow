/**
 * The heatmap's diverging ramp: does it encode magnitude, and does every step
 * still clear 4.5:1 after being deepened?
 *
 * Deepening the fills moves the ground under the cell text, so a naive ramp
 * change silently breaks a contrast check that used to pass. This file is the
 * gate: it resolves each step's fill and text token out of index.css, measures
 * the ratio itself, and refuses anything below 4.5:1. Changing a token value
 * without re-measuring fails here rather than in an audit.
 */
import { afterEach, describe, expect, it } from 'vitest';
import { cleanup, render } from '@testing-library/react';
import {
  COVERAGE_RAMP,
  COVERAGE_CLOSED_STEP,
  CoverageHeatmapView,
  coverageRampStep,
} from '../CoverageHeatmapView';
import { makeSolveResponse } from './solveResponseFixture';

// No globals in this repo's vitest config, so Testing Library does not unmount for us.
afterEach(cleanup);

const ALL_STEPS = [...COVERAGE_RAMP, COVERAGE_CLOSED_STEP];

// --- WCAG 2.1 contrast, computed rather than asserted from memory ----------
function relativeLuminance(hex: string): number {
  const channel = (c: number) => {
    const s = c / 255;
    return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
  };
  return (
    0.2126 * channel(parseInt(hex.slice(1, 3), 16)) +
    0.7152 * channel(parseInt(hex.slice(3, 5), 16)) +
    0.0722 * channel(parseInt(hex.slice(5, 7), 16))
  );
}
function ratio(fg: string, bg: string): number {
  const a = relativeLuminance(fg);
  const b = relativeLuminance(bg);
  const [hi, lo] = a > b ? [a, b] : [b, a];
  return (hi + 0.05) / (lo + 0.05);
}

// --- index.css is the source of truth for the token values ----------------
// Read as text so this measures the values the app actually ships rather than
// a second copy of them kept here. vitest stubs `import '…css'` to an empty
// string, so it is read from disk. The project's tsconfig carries no node
// types, so the two things needed from Node are declared rather than adding a
// dependency for one test file.
declare const process: { cwd(): string };
// Widened to string on purpose: a literal specifier would make TypeScript try
// to resolve 'node:fs', which has no types here, and a suppression comment
// would itself become an error the day @types/node is added.
const NODE_FS: string = 'node:fs';
const { readFileSync } = (await import(NODE_FS)) as {
  readFileSync: (path: string, encoding: string) => string;
};

const CSS: string = (() => {
  // `npm test` runs with frontend/ as the cwd; the repo root is allowed for.
  for (const candidate of ['src/index.css', 'frontend/src/index.css']) {
    try {
      return readFileSync(`${process.cwd()}/${candidate}`, 'utf8');
    } catch {
      /* try the next candidate */
    }
  }
  throw new Error('index.css could not be read; the token values cannot be verified');
})();

/** Resolves a custom property through any chain of var() indirections. */
function tokenValue(name: string, depth = 0): string {
  if (depth > 10) throw new Error(`--${name} does not resolve to a literal`);
  const match = CSS.match(new RegExp(`--${name}\\s*:\\s*([^;]+);`));
  if (!match) throw new Error(`--${name} is not declared in index.css`);
  const raw = match[1].trim();
  const indirect = raw.match(/^var\(\s*--([a-z0-9-]+)\s*\)$/i);
  return indirect ? tokenValue(indirect[1], depth + 1) : raw.toUpperCase();
}

/** The token behind a Tailwind utility, for the utilities this ramp uses. */
function tokenFor(utility: string): string {
  const status = utility.match(/^(?:bg|text)-status-(.+)$/);
  if (status) return `status-${status[1]}`;
  return utility.replace(/^(?:bg|text)-/, '');
}

function fillUtility(step: { classes: string }): string {
  return step.classes.split(' ').find((c) => c.startsWith('bg-'))!;
}
function inkUtility(step: { classes: string }): string {
  return step.classes.split(' ').find((c) => c.startsWith('text-'))!;
}

describe('the coverage ramp encodes magnitude', () => {
  it('is a diverging ramp of five steps around an on-target centre', () => {
    expect(COVERAGE_RAMP).toHaveLength(5);
    expect(COVERAGE_RAMP[2].id).toBe('on-target');
    // The centre is the lightest step and both tails darken away from it.
    const lums = COVERAGE_RAMP.map((s) => relativeLuminance(s.fill));
    expect(lums[2]).toBeGreaterThan(lums[1]);
    expect(lums[2]).toBeGreaterThan(lums[3]);
    expect(lums[1]).toBeGreaterThan(lums[0]);
    expect(lums[3]).toBeGreaterThan(lums[4]);
  });

  it('gives an hour short by 1 a different fill from one short by 5', () => {
    expect(coverageRampStep(-1, false).id).not.toBe(coverageRampStep(-5, false).id);
    expect(coverageRampStep(1, false).id).not.toBe(coverageRampStep(5, false).id);
    // and the two directions never share a step
    expect(coverageRampStep(-1, false).id).not.toBe(coverageRampStep(1, false).id);
    expect(coverageRampStep(0, false).id).toBe('on-target');
    // An hour with no demand is outside the ramp entirely.
    expect(coverageRampStep(0, true).id).toBe('closed');
  });

  it('paints the grid with more than the two fills it used to have', () => {
    // One understaffed hour per day at 09:00 and one overstaffed at 15:00 is
    // not enough to exercise the ramp, so widen the gaps here.
    const base = makeSolveResponse();
    const solution = {
      ...base,
      interval_coverage: base.interval_coverage.map((c) => {
        if (c.hour === 9) return { ...c, scheduled_staff: Math.max(0, c.required_staff - 3) };
        if (c.hour === 10) return { ...c, scheduled_staff: Math.max(0, c.required_staff - 1) };
        if (c.hour === 15) return { ...c, scheduled_staff: c.required_staff + 1 };
        if (c.hour === 16) return { ...c, scheduled_staff: c.required_staff + 4 };
        return c;
      }),
    };
    const { container } = render(<CoverageHeatmapView solution={solution} />);
    const fills = new Set(
      Array.from(container.querySelectorAll('tbody td div')).map(
        (d) => Array.from(d.classList).find((c) => c.startsWith('bg-')) ?? ''
      )
    );
    // Four magnitude steps plus on-target, where the old code had three fills.
    expect(fills.size).toBeGreaterThanOrEqual(5);
  });
});

describe('every ramp step clears 4.5:1 after the fills were deepened', () => {
  it.each(ALL_STEPS.map((s) => [s.id, s] as const))('%s', (_id, step) => {
    const measured = ratio(step.ink, step.fill);
    expect(measured).toBeGreaterThanOrEqual(4.5);
    // The number recorded on the step must be the number this computes.
    expect(measured).toBeCloseTo(step.ratio, 1);
  });

  it('flips the text token to --card at the ramp midpoint and nowhere else', () => {
    const onCard = COVERAGE_RAMP.filter((s) => s.ink.toUpperCase() === '#FFFFFF');
    expect(onCard.map((s) => s.id)).toEqual(['short-strong', 'over-strong']);
    // --card as a text token is only ever used on a fill dark enough for it.
    for (const step of onCard) {
      expect(relativeLuminance(step.fill)).toBeLessThan(1.05 / 4.5 - 0.05);
    }
  });

  it('keeps every dark text token readable on white and on the warm canvas', () => {
    const darkInks = ALL_STEPS.map((s) => s.ink).filter((ink) => ink.toUpperCase() !== '#FFFFFF');
    for (const ink of darkInks) {
      expect(ratio(ink, '#FFFFFF')).toBeGreaterThanOrEqual(4.5);
      expect(ratio(ink, tokenValue('canvas'))).toBeGreaterThanOrEqual(4.5);
    }
  });
});

describe('the ramp is painted from design tokens, not hand-typed colours', () => {
  it.each(ALL_STEPS.map((s) => [s.id, s] as const))(
    '%s resolves to the hex it was measured at',
    (_id, step) => {
      expect(tokenValue(tokenFor(fillUtility(step)))).toBe(step.fill.toUpperCase());
      expect(tokenValue(tokenFor(inkUtility(step)))).toBe(step.ink.toUpperCase());
    }
  );

  it('puts no opacity modifier on a var()-backed utility', () => {
    // bg-canvas/80 emits no CSS rule at all under Tailwind v3 and the element
    // renders with no background while the build and tests stay green.
    for (const step of ALL_STEPS) {
      expect(step.classes).not.toMatch(/\b(?:bg|text|border)-[a-z-]+\/\d/);
    }
  });
});

describe('the grid keeps its per-cell labels', () => {
  it('states the exact figure on all 168 cells, deepened fills or not', () => {
    const { container } = render(<CoverageHeatmapView solution={makeSolveResponse()} />);
    // Scoped to the labelled cells: this view also renders a shift-type table.
    const cells = Array.from(container.querySelectorAll('tbody td[aria-label]'));
    expect(cells).toHaveLength(168);
    for (const cell of cells) {
      const label = cell.getAttribute('aria-label');
      expect(label).toBeTruthy();
      expect(label).toMatch(/understaffed by \d+|overstaffed by \d+|on target|no staffing required/);
    }
    // The fixture is one short at 09:00 every day, so the magnitude is spelled out.
    expect(
      cells.filter((c) => /understaffed by 1$/.test(c.getAttribute('aria-label') ?? '')).length
    ).toBe(7);
  });

  it('shows a legend naming every step the grid can paint', () => {
    const { container } = render(<CoverageHeatmapView solution={makeSolveResponse()} />);
    const text = container.textContent ?? '';
    for (const step of ALL_STEPS) {
      expect(text).toContain(step.legend);
    }
  });
});
