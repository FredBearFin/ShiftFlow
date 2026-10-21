import { describe, it, expect, afterEach } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { ExplainThis } from './ExplainThis';
import { getTerm } from './glossary';

/** Vocabulary the audit found on screen with nothing explaining it. */
const ON_SCREEN_JARGON = [
  'shift pattern',
  'qualification tier',
  'Union Line Standard',
  'rotation balance',
  'hand-off',
  'workload score',
  'role',
  'hourly wage',
  'available days',
];

function openPanel(stepId: number) {
  const result = render(<ExplainThis stepId={stepId} />);
  const panel = result.container.querySelector('dl')?.parentElement as HTMLElement;
  fireEvent.click(screen.getByRole('button', { name: 'Explain these words' }));
  return { ...result, panel };
}

describe('ExplainThis', () => {
  afterEach(() => {
    cleanup();
  });

  it('opens a panel with real definitions on step 6, not an empty one', () => {
    const { panel } = openPanel(6);
    expect(panel.hasAttribute('hidden')).toBe(false);
    const terms = Array.from(panel.querySelectorAll('dt')).map((dt) => dt.textContent);
    expect(terms.length).toBeGreaterThan(0);
    expect(terms).toContain('role');
    expect(terms).toContain('hourly wage');
    expect(terms).toContain('available days');
  });

  it('gives every step from 1 to 6 at least one definition', () => {
    for (let step = 1; step <= 6; step += 1) {
      const { panel } = openPanel(step);
      expect(
        panel.querySelectorAll('dt').length,
        `step ${step} opened an empty panel`
      ).toBeGreaterThan(0);
      cleanup();
    }
  });
});

describe('glossary coverage of on-screen vocabulary', () => {
  it.each(ON_SCREEN_JARGON)('explains "%s"', (term) => {
    const entry = getTerm(term);
    expect(entry, `no glossary entry for "${term}"`).toBeDefined();
    expect(entry?.plain.trim().length).toBeGreaterThan(0);
  });
});
