import { describe, it, expect, vi, afterEach, beforeEach } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { OnboardingWizard } from '../OnboardingWizard';
import { TOUR_DONE_KEY } from '../onboarding/FirstRunTour';
import { LESSONS } from '../onboarding/lessons';
import { getTerm } from '../onboarding/glossary';
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

/** Renders the wizard and walks to step 5, where the flexibility control lives. */
function renderStep5() {
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
      onClose={noop}
      employees={[]}
      onAddEmployee={noop}
    />
  );
  fireEvent.click(screen.getByRole('button', { name: /Cost vs\. rest/i }));
  return result;
}

/** The step-5 panel: its heading, its body copy and its control, excluding the guide beside it. */
function step5Panel(container: HTMLElement): HTMLElement {
  const heading = screen.getByRole('heading', {
    name: /How much staffing flexibility will you allow\?/,
  });
  const panel = heading.closest('div.space-y-4') as HTMLElement;
  expect(panel, 'step 5 panel not found').toBeTruthy();
  expect(container.contains(panel)).toBe(true);
  return panel;
}

describe('wizard step 5 describes staffing flexibility, not a payroll budget', () => {
  beforeEach(() => {
    window.localStorage.setItem(TOUR_DONE_KEY, '1');
  });

  afterEach(() => {
    cleanup();
    window.localStorage.clear();
  });

  it('heads the step with the name of the control it sits above', () => {
    const { container } = renderStep5();
    const panel = step5Panel(container);
    // The control's own label, which Track A relabelled, and the heading above it agree.
    expect(panel.textContent).toContain('How much staffing flexibility will you allow?');
    expect(panel.textContent).toContain("Staffing flexibility you'll allow");
  });

  it('makes no claim that a higher setting costs more', () => {
    const { container } = renderStep5();
    const copy = step5Panel(container).textContent ?? '';
    expect(copy).not.toMatch(/How much extra would you spend/);
    expect(copy).not.toMatch(/more payroll gives the solver room/);
    expect(copy).not.toMatch(/the real payroll cost/);
    // It says so outright, rather than only avoiding the claim.
    expect(copy).toContain('not the same as more money');
  });

  it('offers no preset tag that prices the setting', () => {
    const { container } = renderStep5();
    const copy = step5Panel(container).textContent ?? '';
    for (const stale of ['+1% cost', '+5% cost', '+10% cost', '+20% cost', '+50% cost']) {
      expect(copy, `${stale} still shown`).not.toContain(stale);
    }
    expect(copy).toContain('+10% flexibility');
  });

  it('explains the control in the step-5 glossary panel', () => {
    const entry = getTerm('staffing flexibility');
    expect(entry, 'no glossary entry for the control').toBeDefined();
    expect(entry?.plain).toContain('not a money budget');

    const { container } = renderStep5();
    fireEvent.click(screen.getAllByRole('button', { name: 'Explain these words' })[0]);
    const terms = Array.from(container.querySelectorAll('dt')).map((dt) => dt.textContent);
    expect(terms).toContain('staffing flexibility');
  });
});

describe('the step-5 guide beside it tells the same story', () => {
  it('names the control and does not price it', () => {
    const lesson = LESSONS.find((l) => l.stepId === 5);
    expect(lesson, 'no lesson for step 5').toBeDefined();
    const text = [
      lesson?.title,
      lesson?.explanation,
      lesson?.example,
      lesson?.whyItMatters,
    ].join(' ');

    expect(text).toContain('Staffing flexibility');
    expect(text).not.toContain('Extra cost allowed');
    expect(text).not.toContain('No extra cost');
    // The cost it does name is paid in shifts, not asserted as money.
    expect(text).toContain('paid in shifts, not automatically in money');
  });
});
