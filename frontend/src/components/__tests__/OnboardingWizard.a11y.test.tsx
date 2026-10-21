import { describe, it, expect, vi, afterEach } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { OnboardingWizard } from '../OnboardingWizard';
import type { ArchetypePreset, ErgonomicGuardrails, ShiftTemplate } from '../../types';

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

function renderWizard() {
  const noop = vi.fn();
  return render(
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
      onClose={noop}
      employees={[]}
      onAddEmployee={noop}
    />
  );
}

/**
 * Resolves the computed accessible name of a form control the way a screen reader
 * does for these cases: aria-label, then aria-labelledby, then an associated
 * <label for=...>, then a wrapping <label>. Returns '' when there is no name.
 */
function accessibleName(el: HTMLElement): string {
  const ariaLabel = el.getAttribute('aria-label');
  if (ariaLabel && ariaLabel.trim()) return ariaLabel.trim();

  const labelledBy = el.getAttribute('aria-labelledby');
  if (labelledBy) {
    const text = labelledBy
      .split(/\s+/)
      .map((id) => document.getElementById(id)?.textContent ?? '')
      .join(' ')
      .trim();
    if (text) return text;
  }

  if (el.id) {
    const forLabel = document.querySelector<HTMLLabelElement>(
      `label[for="${el.id}"]`
    );
    if (forLabel?.textContent?.trim()) return forLabel.textContent.trim();
  }

  const wrapping = el.closest('label');
  if (wrapping?.textContent?.trim()) return wrapping.textContent.trim();

  return '';
}

const STEP_1_INPUTS: [string, string][] = [
  ['onboarding-opens-at', 'Opens at'],
  ['onboarding-closes-at', 'Closes at'],
  ['onboarding-peak-staff', 'People needed at your busiest'],
  ['onboarding-min-staff', 'People needed at your quietest (while open)'],
];

const STEP_6_INPUTS: [string, string][] = [
  ['onboarding-staff-name', 'Name'],
  ['onboarding-staff-role', 'Role'],
  ['onboarding-staff-wage', 'Hourly wage ($)'],
];

describe('OnboardingWizard accessible names', () => {
  afterEach(() => {
    cleanup();
  });

  it.each(STEP_1_INPUTS)(
    'step 1 input %s has the accessible name %s',
    (id, expected) => {
      const { container } = renderWizard();
      const input = container.querySelector<HTMLInputElement>(`#${id}`);
      expect(input).not.toBeNull();
      expect(accessibleName(input as HTMLElement)).toBe(expected);
    }
  );

  it.each(STEP_6_INPUTS)(
    'step 6 input %s has the accessible name %s',
    (id, expected) => {
      const { container } = renderWizard();
      fireEvent.click(screen.getByRole('button', { name: /Add your staff/ }));
      const input = container.querySelector<HTMLInputElement>(`#${id}`);
      expect(input).not.toBeNull();
      expect(accessibleName(input as HTMLElement)).toBe(expected);
    }
  );

  it('leaves no text input in steps 1 or 6 without an accessible name', () => {
    const { container } = renderWizard();
    const named = (root: HTMLElement) =>
      Array.from(root.querySelectorAll<HTMLInputElement>('input')).filter(
        (input) => accessibleName(input) === ''
      );

    expect(named(container)).toHaveLength(0);
    fireEvent.click(screen.getByRole('button', { name: /Add your staff/ }));
    expect(named(container)).toHaveLength(0);
  });
});
