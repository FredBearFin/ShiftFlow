import { describe, it, expect, vi, afterEach, beforeEach } from 'vitest';
import { cleanup, fireEvent, render } from '@testing-library/react';
import { OnboardingWizard } from '../OnboardingWizard';
import { TOUR_DONE_KEY } from '../onboarding/FirstRunTour';
import type { ArchetypePreset, ErgonomicGuardrails, ShiftTemplate } from '../../types';

const FOCUSABLE =
  'a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])';

const guardrails: ErgonomicGuardrails = {
  min_consecutive_work_days: 2,
  max_consecutive_work_days: 5,
  min_consecutive_rest_days: 2,
  max_consecutive_rest_days: 4,
  max_consecutive_nights: 3,
  max_consecutive_evenings: 3,
  enforce_forward_rotation: true,
  enforce_zero_clopening: true,
  avoid_single_rest_days: true,
  avoid_single_night_shifts: true,
  prioritize_free_weekends: true,
};

const templates: ShiftTemplate[] = [
  {
    code: 'M',
    name: 'Morning',
    earliest_start: 6,
    latest_end: 14,
    min_duration: 6,
    max_duration: 8,
    preferred_start: 6,
    preferred_duration: 8,
    enabled: true,
  },
];

const demandMatrix: number[][] = Array.from({ length: 7 }, () =>
  Array.from({ length: 24 }, () => 0)
);

const archetype: ArchetypePreset = {
  id: 'custom',
  name: 'Custom schedule',
  sector: 'Custom',
  tagline: 'Set your own',
  description: 'Anything else.',
  operating_hours_label: '08:00 - 22:00',
  typical_crew_size: '10-20',
  default_leeway_pct: 10,
  demand_matrix: demandMatrix,
  templates,
  guardrails,
};

function renderWizard(overrides: { canSkip?: boolean; onClose?: () => void } = {}) {
  const noop = vi.fn();
  const result = render(
    <OnboardingWizard
      isOpen={true}
      archetypes={[archetype]}
      selectedArchetypeId={archetype.id}
      facilityName="Test Facility"
      demandMatrix={demandMatrix}
      templates={templates}
      guardrails={guardrails}
      leewayPct={10}
      onSelectArchetype={noop}
      onChangeFacilityName={noop}
      onChangeDemandMatrix={noop}
      onChangeTemplates={noop}
      onChangeGuardrails={noop}
      onChangeLeewayPct={noop}
      onCompleteWizard={noop}
      onClose={overrides.onClose ?? noop}
      employees={[]}
      onAddEmployee={noop}
      canSkip={overrides.canSkip}
    />
  );
  const dialog = result.container.querySelector<HTMLElement>('[role="dialog"]');
  if (!dialog) throw new Error('the wizard dialog did not render');
  return { ...result, dialog };
}

/** A control outside the wizard, standing in for the nav tabs and Log out button. */
function addOutsideButton(): HTMLButtonElement {
  const outside = document.createElement('button');
  outside.type = 'button';
  outside.textContent = 'Log out';
  document.body.appendChild(outside);
  return outside;
}

describe('OnboardingWizard focus management', () => {
  beforeEach(() => {
    // The first-run tour runs its own focus trap; these cases cover the wizard's.
    window.localStorage.setItem(TOUR_DONE_KEY, '1');
  });

  afterEach(() => {
    cleanup();
    window.localStorage.clear();
    document.body.querySelectorAll('button').forEach((b) => b.remove());
  });

  it('moves focus into the dialog when it opens', () => {
    const trigger = addOutsideButton();
    trigger.focus();
    const { dialog } = renderWizard();
    expect(dialog.contains(document.activeElement)).toBe(true);
  });

  it('keeps Tab inside the wizard at the end of the focus order', () => {
    const outside = addOutsideButton();
    const { dialog } = renderWizard();
    const items = Array.from(dialog.querySelectorAll<HTMLElement>(FOCUSABLE));
    expect(items.length).toBeGreaterThan(1);

    items[items.length - 1].focus();
    fireEvent.keyDown(document.activeElement as HTMLElement, { key: 'Tab' });

    expect(document.activeElement).toBe(items[0]);
    expect(document.activeElement).not.toBe(outside);
    expect(dialog.contains(document.activeElement)).toBe(true);
  });

  it('keeps Shift+Tab inside the wizard at the start of the focus order', () => {
    const outside = addOutsideButton();
    const { dialog } = renderWizard();
    const items = Array.from(dialog.querySelectorAll<HTMLElement>(FOCUSABLE));

    items[0].focus();
    fireEvent.keyDown(document.activeElement as HTMLElement, { key: 'Tab', shiftKey: true });

    expect(document.activeElement).toBe(items[items.length - 1]);
    expect(document.activeElement).not.toBe(outside);
    expect(dialog.contains(document.activeElement)).toBe(true);
  });

  it('never lets 40 Tab presses reach a control outside the wizard', () => {
    const outside = addOutsideButton();
    const { dialog } = renderWizard();
    const items = Array.from(dialog.querySelectorAll<HTMLElement>(FOCUSABLE));

    for (let press = 0; press < 40; press += 1) {
      const current = document.activeElement as HTMLElement;
      const index = items.indexOf(current);
      fireEvent.keyDown(current, { key: 'Tab' });
      // jsdom does not move focus for Tab itself, so advance it the way a browser would
      // whenever the trap did not wrap focus for us.
      if (document.activeElement === current && index >= 0 && index < items.length - 1) {
        items[index + 1].focus();
      }
      expect(document.activeElement).not.toBe(outside);
      expect(dialog.contains(document.activeElement)).toBe(true);
    }
  });

  it('closes on Escape when setup is skippable', () => {
    const onClose = vi.fn();
    renderWizard({ canSkip: true, onClose });
    fireEvent.keyDown(document.activeElement as HTMLElement, { key: 'Escape' });
    expect(onClose).toHaveBeenCalled();
  });

  it('does not close on Escape while setup cannot be skipped', () => {
    const onClose = vi.fn();
    renderWizard({ canSkip: false, onClose });
    fireEvent.keyDown(document.activeElement as HTMLElement, { key: 'Escape' });
    expect(onClose).not.toHaveBeenCalled();
  });

  it('marks exactly one dialog as modal, whether or not the tour is open', () => {
    window.localStorage.removeItem(TOUR_DONE_KEY);
    const { container } = renderWizard();
    expect(container.querySelectorAll('[aria-modal="true"]')).toHaveLength(1);
    cleanup();

    window.localStorage.setItem(TOUR_DONE_KEY, '1');
    const reopened = renderWizard();
    expect(reopened.container.querySelectorAll('[aria-modal="true"]')).toHaveLength(1);
    expect(reopened.dialog.getAttribute('aria-modal')).toBe('true');
  });
});
