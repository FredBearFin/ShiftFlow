/**
 * The shift pills' day-to-night ramp.
 *
 * The four fills were #E4E9EC / #FFFFFF / #F4F1EA / #D9DFE3 — 26.9 points of
 * relative luminance, not even monotonic in start-time order, and all four
 * sharing one border colour. In a 12x7 grid that left only the letter
 * distinguishing a night from a morning and the rotation pattern invisible.
 *
 * Widening the ramp drops a dark fill under text that used to sit on a light
 * one, so this measures each step rather than taking the old 8.7:1–11.8:1
 * figures on trust, and reads the values out of index.css so a token change
 * cannot quietly skip the re-measurement.
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render } from '@testing-library/react';
import { MasterRosterView } from '../MasterRosterView';
import { makeSolution } from '../../test/solutionFixture';

// This repo's vitest config has no globals, so Testing Library does not unmount
// between tests on its own.
afterEach(cleanup);

// Read as text so this measures the values the app ships. vitest stubs
// `import '…css'`, so index.css is read from disk; the project's tsconfig
// carries no node types, so what is needed from Node is declared here.
declare const process: { cwd(): string };
// Widened to string on purpose: a literal specifier would make TypeScript try
// to resolve 'node:fs', which has no types here, and a suppression comment
// would itself become an error the day @types/node is added.
const NODE_FS: string = 'node:fs';
const { readFileSync } = (await import(NODE_FS)) as {
  readFileSync: (path: string, encoding: string) => string;
};

const CSS: string = (() => {
  for (const candidate of ['src/index.css', 'frontend/src/index.css']) {
    try {
      return readFileSync(`${process.cwd()}/${candidate}`, 'utf8');
    } catch {
      /* try the next candidate */
    }
  }
  throw new Error('index.css could not be read; the pill ramp cannot be verified');
})();

function tokenValue(name: string, depth = 0): string {
  if (depth > 10) throw new Error(`--${name} does not resolve to a literal`);
  const match = CSS.match(new RegExp(`--${name}\\s*:\\s*([^;]+);`));
  if (!match) throw new Error(`--${name} is not declared in index.css`);
  const raw = match[1].trim();
  const indirect = raw.match(/^var\(\s*--([a-z0-9-]+)\s*\)$/i);
  return indirect ? tokenValue(indirect[1], depth + 1) : raw.toUpperCase();
}

/** The declared background and colour of a .shift-pill-X rule. */
function pillRule(code: string): { fill: string; ink: string } {
  const block = CSS.match(new RegExp(`\\.shift-pill-${code}\\s*\\{([^}]*)\\}`));
  if (!block) throw new Error(`.shift-pill-${code} is not declared in index.css`);
  const bg = block[1].match(/background-color:\s*var\(--([a-z0-9-]+)\)/i);
  const fg = block[1].match(/(?:^|[^-])color:\s*var\(--([a-z0-9-]+)\)/i);
  if (!bg || !fg) throw new Error(`.shift-pill-${code} must set both colours from tokens`);
  return { fill: tokenValue(bg[1]), ink: tokenValue(fg[1]) };
}

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

// In start-time order: morning, day, evening, night.
const RAMP = ['M', 'D', 'E', 'N'];

describe('the shift pills are a real day-to-night ramp', () => {
  it('darkens monotonically with the shift start time', () => {
    const lums = RAMP.map((code) => relativeLuminance(pillRule(code).fill));
    for (let i = 1; i < lums.length; i += 1) {
      expect(lums[i], `${RAMP[i]} must be darker than ${RAMP[i - 1]}`).toBeLessThan(lums[i - 1]);
    }
  });

  it('spans far more luminance than the 26.9 points it used to', () => {
    const lums = RAMP.map((code) => relativeLuminance(pillRule(code).fill) * 100);
    expect(Math.max(...lums) - Math.min(...lums)).toBeGreaterThan(60);
  });

  it('gives each code a fill of its own', () => {
    const fills = RAMP.map((code) => pillRule(code).fill);
    expect(new Set(fills).size).toBe(RAMP.length);
  });
});

describe('every pill still clears 4.5:1 after the ramp was widened', () => {
  it.each([...RAMP, 'OFF'])('%s', (code) => {
    const { fill, ink } = pillRule(code);
    expect(ratio(ink, fill)).toBeGreaterThanOrEqual(4.5);
  });

  it('flips to --card only where --ink can no longer reach 4.5:1', () => {
    for (const code of RAMP) {
      const { fill, ink } = pillRule(code);
      const inkReaches = ratio(tokenValue('ink'), fill) >= 4.5;
      expect(ink === tokenValue('card') ? !inkReaches : inkReaches).toBe(true);
    }
  });
});

describe('the pills keep their letter and their time window', () => {
  it('renders both on every scheduled cell, undimmed', () => {
    const solution = makeSolution({ lineCount: 4, pricedLineCount: 4, wage: 18 });
    const { container } = render(
      <MasterRosterView
        solution={solution}
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
    const pills = Array.from(container.querySelectorAll('[class*="shift-pill-"]'));
    expect(pills.length).toBeGreaterThan(0);
    for (const pill of pills) {
      const lines = Array.from(pill.querySelectorAll('span'));
      // The letter and the window: the dual encoding that makes colour optional.
      expect(lines.length).toBeGreaterThanOrEqual(2);
      expect(lines[0].textContent?.trim()).toBeTruthy();
      expect(lines[1].textContent?.trim()).toBeTruthy();
      // Dimming the window took it to 3.98:1 on the evening step.
      expect(lines[1].className).not.toMatch(/opacity-\d/);
    }
  });

  it('puts no opacity modifier on a var()-backed utility inside a pill', () => {
    // bg-canvas/80 emits no CSS rule at all under Tailwind v3.
    const pillCss = RAMP.concat('OFF')
      .map((c) => CSS.match(new RegExp(`\\.shift-pill-${c}\\s*\\{([^}]*)\\}`))?.[1] ?? '')
      .join('\n');
    expect(pillCss).not.toMatch(/var\(--[a-z0-9-]+\)\s*\/\s*\d/);
  });
});
