import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import { OnboardingWizard } from '../OnboardingWizard';
import type {
  ArchetypePreset,
  ErgonomicGuardrails,
  ShiftTemplate,
} from '../../types';

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
  {
    code: 'D',
    name: 'Day',
    earliest_start: 9,
    latest_end: 18,
    min_duration: 6,
    max_duration: 8,
    preferred_start: 10,
    preferred_duration: 8,
    enabled: true,
  },
  {
    code: 'E',
    name: 'Evening',
    earliest_start: 14,
    latest_end: 23,
    min_duration: 6,
    max_duration: 8,
    preferred_start: 14,
    preferred_duration: 8,
    enabled: true,
  },
  {
    code: 'N',
    name: 'Night',
    earliest_start: 22,
    latest_end: 30,
    min_duration: 6,
    max_duration: 8,
    preferred_start: 22,
    preferred_duration: 8,
    enabled: true,
  },
];

const demandMatrix: number[][] = Array.from({ length: 7 }, () =>
  Array.from({ length: 24 }, () => 0)
);

const archetype: ArchetypePreset = {
  id: 'retail-basic',
  name: 'Retail store',
  sector: 'Retail',
  tagline: 'Open daytime, busy evenings',
  description: 'A typical retail store.',
  operating_hours_label: '08:00 - 22:00',
  typical_crew_size: '10-20',
  default_leeway_pct: 10,
  demand_matrix: demandMatrix,
  templates,
  guardrails,
};

describe('OnboardingWizard smoke test', () => {
  it('renders the wizard heading when open', () => {
    const noop = vi.fn();
    render(
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
      />
    );
    expect(screen.getByText('Set up your schedule')).toBeTruthy();
  });
});
