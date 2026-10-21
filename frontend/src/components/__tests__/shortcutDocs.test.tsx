import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen, cleanup } from '@testing-library/react';
import { KeyboardShortcutsModal } from '../KeyboardShortcutsModal';
import { Header } from '../Header';
import { WIZARD_STEP_COUNT } from '../OnboardingWizard';
import { TAB_KEY_NUMBERS, TAB_LABELS } from '../tabKeys';
import type { ActiveTabId } from '../../types';
import { solutionFixture } from '../../test/solutionFixture';

// This repo runs vitest without globals, so Testing Library does not unmount
// between cases on its own.
afterEach(cleanup);

const ALL_TABS: ActiveTabId[] = [
  'roster',
  'staff',
  'labor',
  'coverage',
  'pareto',
  'ergonomics',
  'compliance',
];

function renderCheatsheet() {
  return render(
    <KeyboardShortcutsModal
      isOpen
      onClose={vi.fn()}
      singleKeyEnabled
      onToggleSingleKey={vi.fn()}
    />
  );
}

describe('the cheatsheet comes from its source of truth', () => {
  it('covers every tab exactly once, with no invented entries', () => {
    expect(TAB_LABELS.map((t) => t.id).sort()).toEqual([...ALL_TABS].sort());
    for (const key of Object.keys(TAB_KEY_NUMBERS)) {
      expect(ALL_TABS).toContain(key as ActiveTabId);
    }
  });

  it('documents each bound number key against the view it actually opens', () => {
    const { container } = renderCheatsheet();
    const rows = Array.from(container.querySelectorAll('kbd'))
      .map((k) => (k.textContent || '').trim())
      .filter((t) => /^\d$/.test(t));

    const bound = Object.values(TAB_KEY_NUMBERS).map(String).sort();
    expect(rows.filter((r) => bound.includes(r)).sort()).toEqual(bound);

    // Each bound key sits in a row naming its own view.
    for (const tab of TAB_LABELS) {
      const n = TAB_KEY_NUMBERS[tab.id];
      if (n === undefined) continue;
      const row = screen.getByText(tab.label).closest('div')!;
      expect(row.textContent).toContain(String(n));
    }
  });

  it('documents no key the app does not bind', () => {
    const { container } = renderCheatsheet();
    const jumpKeys = Array.from(container.querySelectorAll('kbd'))
      .map((k) => (k.textContent || '').trim())
      .filter((t) => /^\d$/.test(t));
    const bound = Object.values(TAB_KEY_NUMBERS).map(String);
    expect(jumpKeys.every((k) => bound.includes(k))).toBe(true);
    expect(container.textContent).not.toContain('CFO');
  });

  it('lists the keyless Staff Directory rather than omitting it', () => {
    const { container } = renderCheatsheet();
    expect(container.textContent).toContain('Staff Directory & Availability (no number key');
  });

  it('shows each tab label the header shows', () => {
    const { container } = render(
      <Header
        activeTab="roster"
        onSelectTab={vi.fn()}
        onOpenWizard={vi.fn()}
        solution={solutionFixture}
        leewayPct={10}
      />
    );
    const navText = container.querySelector('nav')!.textContent || '';
    for (const tab of TAB_LABELS) {
      expect(navText, `header nav is missing "${tab.label}"`).toContain(tab.label);
    }
  });

  it('states one step count in the header and in the wizard', () => {
    const { container } = render(
      <Header
        activeTab="roster"
        onSelectTab={vi.fn()}
        onOpenWizard={vi.fn()}
        solution={solutionFixture}
        leewayPct={10}
      />
    );
    expect(WIZARD_STEP_COUNT).toBe(6);
    expect(container.textContent).toContain(`${WIZARD_STEP_COUNT} Steps`);
    expect(container.textContent).not.toContain('5 Steps');
  });
});
