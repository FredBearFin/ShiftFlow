/**
 * B2: the wizard regenerates the staffing table only when asked.
 *
 * Reproduced before the fix: set Monday 12:00 to 9 on step 2, change only the "when are
 * you busiest" dropdown on step 1, go back to step 2 - and the 9 was back to 2. The same
 * effect wiped custom shift start/length edits and a POS-derived matrix, and because the
 * component stays mounted it also fired on app start, clobbering a preset's demand
 * before the user had touched anything.
 */
import { describe, it, expect, afterEach, vi } from 'vitest';
import { render, screen, cleanup, fireEvent } from '@testing-library/react';
import { OnboardingWizard } from '../OnboardingWizard';
import type { ErgonomicGuardrails, ShiftTemplate } from '../../types';

// This repo's vitest config has no globals, so Testing Library does not unmount
// between tests on its own.
afterEach(() => {
  cleanup();
});

const guardrails: ErgonomicGuardrails = {
  min_consecutive_work_days: 3,
  max_consecutive_work_days: 5,
  min_consecutive_rest_days: 2,
  max_consecutive_rest_days: 3,
  max_consecutive_nights: 2,
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
    name: 'Morning Shift',
    earliest_start: 6,
    latest_end: 15,
    min_duration: 7,
    max_duration: 9,
    // A hand-edited shift start: the user moved it off the derived value.
    preferred_start: 5,
    preferred_duration: 11,
    enabled: true,
  },
];

/** A hand-built staffing table with 9 people at Monday 12:00. */
const handBuiltMatrix = (): number[][] => {
  const matrix = Array.from({ length: 7 }, () => Array(24).fill(2));
  matrix[0][12] = 9;
  return matrix;
};

const EMPTY_MATRIX = (): number[][] => Array.from({ length: 7 }, () => Array(24).fill(0));

function renderWizard(overrides: {
  demandMatrix: number[][];
  onChangeDemandMatrix: (m: number[][]) => void;
  onChangeTemplates: (t: ShiftTemplate[]) => void;
}) {
  const noop = vi.fn();
  return render(
    <OnboardingWizard
      isOpen={true}
      archetypes={[]}
      selectedArchetypeId="custom"
      facilityName="Riverside Pharmacy"
      demandMatrix={overrides.demandMatrix}
      templates={templates}
      guardrails={guardrails}
      leewayPct={10}
      onSelectArchetype={noop}
      onChangeFacilityName={noop}
      onChangeDemandMatrix={overrides.onChangeDemandMatrix}
      onChangeTemplates={overrides.onChangeTemplates}
      onChangeGuardrails={noop}
      onChangeLeewayPct={noop}
      onCompleteWizard={noop}
      onClose={noop}
      employees={[]}
      onAddEmployee={noop}
    />
  );
}

describe('a step-1 answer change does not destroy step-2 and step-3 work', () => {
  it('leaves a hand-entered demand cell alone when the busiest period changes', () => {
    const onChangeDemandMatrix = vi.fn();
    const onChangeTemplates = vi.fn();
    renderWizard({ demandMatrix: handBuiltMatrix(), onChangeDemandMatrix, onChangeTemplates });

    // Nothing is rebuilt on mount: the matrix already has figures in it.
    expect(onChangeDemandMatrix).not.toHaveBeenCalled();
    expect(onChangeTemplates).not.toHaveBeenCalled();

    fireEvent.change(screen.getByLabelText('When are you busiest?'), { target: { value: 'evening' } });

    // The whole point: changing a coarse answer rewrites nothing.
    expect(onChangeDemandMatrix).not.toHaveBeenCalled();
    expect(onChangeTemplates).not.toHaveBeenCalled();
  });

  it('leaves the table alone when the hours, weekend pattern and open days change too', () => {
    const onChangeDemandMatrix = vi.fn();
    const onChangeTemplates = vi.fn();
    renderWizard({ demandMatrix: handBuiltMatrix(), onChangeDemandMatrix, onChangeTemplates });

    fireEvent.click(screen.getByLabelText(/Open around the clock/));
    fireEvent.change(screen.getByLabelText('Weekends, compared to weekdays'), { target: { value: 'busier' } });
    fireEvent.click(screen.getByRole('button', { name: 'Wed' }));

    expect(onChangeDemandMatrix).not.toHaveBeenCalled();
    expect(onChangeTemplates).not.toHaveBeenCalled();
  });
});

describe('the explicit rebuild button', () => {
  it('warns that manual edits will be replaced and only rebuilds after confirmation', () => {
    const onChangeDemandMatrix = vi.fn();
    const onChangeTemplates = vi.fn();
    renderWizard({ demandMatrix: handBuiltMatrix(), onChangeDemandMatrix, onChangeTemplates });

    expect(screen.getByText(/will\s+be\s+replaced/)).toBeTruthy();

    fireEvent.click(screen.getByRole('button', { name: 'Rebuild my staffing table from these answers' }));
    // Armed, but nothing rewritten yet.
    expect(onChangeDemandMatrix).not.toHaveBeenCalled();

    fireEvent.click(screen.getByRole('button', { name: 'Keep what I have' }));
    expect(onChangeDemandMatrix).not.toHaveBeenCalled();

    fireEvent.click(screen.getByRole('button', { name: 'Rebuild my staffing table from these answers' }));
    fireEvent.click(screen.getByRole('button', { name: 'Yes, replace it' }));

    expect(onChangeDemandMatrix).toHaveBeenCalledTimes(1);
    expect(onChangeTemplates).toHaveBeenCalledTimes(1);
    const rebuilt = onChangeDemandMatrix.mock.calls[0][0] as number[][];
    expect(rebuilt).toHaveLength(7);
    expect(rebuilt[0]).toHaveLength(24);
    // The hand-entered 9 is gone - but only because the user asked for that.
    expect(rebuilt[0][12]).not.toBe(9);
  });
});

describe('seeding on first entry', () => {
  it('fills an all-zero staffing table once, since there is nothing to lose', () => {
    const onChangeDemandMatrix = vi.fn();
    const onChangeTemplates = vi.fn();
    renderWizard({ demandMatrix: EMPTY_MATRIX(), onChangeDemandMatrix, onChangeTemplates });

    expect(onChangeDemandMatrix).toHaveBeenCalledTimes(1);
    expect(onChangeTemplates).toHaveBeenCalledTimes(1);
    const seeded = onChangeDemandMatrix.mock.calls[0][0] as number[][];
    expect(seeded.reduce((acc, row) => acc + row.reduce((a, b) => a + b, 0), 0)).toBeGreaterThan(0);

    // And it does not seed again when an answer changes afterwards.
    fireEvent.change(screen.getByLabelText('When are you busiest?'), { target: { value: 'night' } });
    expect(onChangeDemandMatrix).toHaveBeenCalledTimes(1);
  });
});
