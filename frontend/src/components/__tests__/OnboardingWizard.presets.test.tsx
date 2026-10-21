import { describe, it, expect, vi, afterEach, beforeEach } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { OnboardingWizard } from '../OnboardingWizard';
import { TOUR_DONE_KEY } from '../onboarding/FirstRunTour';
import { PRESET_SOLVE_BLOCKERS } from '../onboarding/presetLabels';
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

function preset(id: string, sector: string): ArchetypePreset {
  return {
    id,
    name: sector,
    sector,
    tagline: 'Example',
    description: 'An example you can edit.',
    operating_hours_label: '00:00 - 24:00',
    typical_crew_size: '10-20',
    default_leeway_pct: 10,
    demand_matrix: demandMatrix,
    templates,
    guardrails,
  };
}

const BLOCKED_ID = 'healthcare_24_7';

// The mechanism is tested with a blocker this test registers itself, not with a
// real example that happens to be broken. Every bundled example solves at every
// flexibility setting now, so PRESET_SOLVE_BLOCKERS ships empty; registering one
// here keeps the picker's warning path covered for the next time one does break.
const TEST_BLOCKER = {
  badge: 'Needs extra setup',
  message: 'No shift start time and length fits these hours while the rest rules hold.',
};
const SOLVABLE_ID = 'downtown_foodmart_omaha';

function renderWizard() {
  const noop = vi.fn();
  const onSelectArchetype = vi.fn();
  const result = render(
    <OnboardingWizard
      isOpen={true}
      archetypes={[preset(SOLVABLE_ID, 'Food retail'), preset(BLOCKED_ID, 'Healthcare')]}
      selectedArchetypeId={SOLVABLE_ID}
      facilityName="Test Facility"
      demandMatrix={demandMatrix}
      templates={templates}
      guardrails={guardrails}
      leewayPct={10}
      onSelectArchetype={onSelectArchetype}
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
  fireEvent.click(screen.getByText(/Not sure where to start/));
  return { ...result, onSelectArchetype };
}

function presetButton(sector: string): HTMLElement {
  return screen.getByRole('button', { name: new RegExp(sector) });
}

describe('OnboardingWizard preset solve failures', () => {
  beforeEach(() => {
    window.localStorage.setItem(TOUR_DONE_KEY, '1');
    PRESET_SOLVE_BLOCKERS[BLOCKED_ID] = { ...TEST_BLOCKER };
  });

  afterEach(() => {
    delete PRESET_SOLVE_BLOCKERS[BLOCKED_ID];
    cleanup();
    window.localStorage.clear();
  });

  it('marks a preset the engine cannot schedule in the picker itself', () => {
    renderWizard();
    expect(presetButton('Healthcare').textContent).toContain(
      PRESET_SOLVE_BLOCKERS[BLOCKED_ID].badge
    );
    expect(presetButton('Food retail').textContent).not.toContain(
      PRESET_SOLVE_BLOCKERS[BLOCKED_ID].badge
    );
  });

  it('shows the engine failure inside the wizard on the click that loads the preset', () => {
    const { onSelectArchetype } = renderWizard();
    expect(screen.queryByRole('alert')).toBeNull();

    fireEvent.click(presetButton('Healthcare'));

    // The preset still loads, so the manager keeps the hours it filled in.
    expect(onSelectArchetype).toHaveBeenCalled();
    const alert = screen.getByRole('alert');
    expect(alert.textContent).toContain(PRESET_SOLVE_BLOCKERS[BLOCKED_ID].message);
    expect(presetButton('Healthcare').getAttribute('aria-describedby')).toBe(alert.id);
  });

  it('shows nothing for a preset with no known blocker', () => {
    renderWizard();
    fireEvent.click(presetButton('Food retail'));
    expect(screen.queryByRole('alert')).toBeNull();
  });

  it('deep links from the failure to the step holding the remedy', () => {
    renderWizard();
    fireEvent.click(presetButton('Healthcare'));

    fireEvent.click(screen.getByRole('button', { name: /Add a shift \(step 3\)/ }));
    expect(screen.getByRole('heading', { name: 'Shift times' })).toBeTruthy();
    expect(screen.queryByRole('alert')).toBeNull();
  });

  it('deep links to the guardrail step as well', () => {
    renderWizard();
    fireEvent.click(presetButton('Healthcare'));

    fireEvent.click(screen.getByRole('button', { name: /Ease a rest rule \(step 4\)/ }));
    expect(screen.getByRole('heading', { name: 'Scheduling rules' })).toBeTruthy();
  });

  it('can be dismissed', () => {
    renderWizard();
    fireEvent.click(presetButton('Healthcare'));
    fireEvent.click(screen.getByRole('button', { name: 'Dismiss' }));
    expect(screen.queryByRole('alert')).toBeNull();
  });
});
