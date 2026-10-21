/**
 * B1: the solve configuration must survive a reload.
 *
 * The 7x24 staffing table is the longest manual task in the product. It used to live
 * only in React state, so a reload replaced it (and the facility name, shift times,
 * guardrails and leeway) with defaults while the server-stored staff survived - which
 * meant onboarding never reopened and nothing told the manager their work was gone.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { loadSolveConfig, saveSolveConfig, clearSolveConfig, DEFAULT_TEMPLATES, DEFAULT_GUARDRAILS } from './api';
import type { PersistedSolveConfig } from '../types';

/** A configured facility: evening-heavy demand, not the flat default. */
const configured: PersistedSolveConfig = {
  archetype_id: 'custom',
  facility_name: 'Riverside Pharmacy',
  demand_matrix: Array.from({ length: 7 }, () =>
    Array.from({ length: 24 }, (_, hour) => (hour >= 16 && hour < 21 ? 5 : hour >= 8 ? 2 : 0))
  ),
  templates: DEFAULT_TEMPLATES,
  guardrails: DEFAULT_GUARDRAILS,
  pareto_leeway_pct: 22.5,
  rotation_week_offset: 3,
};

/** Total person-hours in a demand grid: the figure the header reports as Scheduled Hrs. */
const totalPersonHours = (matrix: number[][]) =>
  matrix.reduce((acc, row) => acc + row.reduce((a, b) => a + b, 0), 0);

beforeEach(() => {
  window.localStorage.clear();
});

afterEach(() => {
  window.localStorage.clear();
  vi.restoreAllMocks();
});

describe('solve configuration round-trip', () => {
  it('reports nothing saved on a first visit rather than inventing a config', () => {
    expect(loadSolveConfig()).toEqual({ status: 'none' });
  });

  it('restores the configured staffing table byte for byte, so a re-solve matches', () => {
    expect(saveSolveConfig(configured)).toBe(true);

    const restored = loadSolveConfig();
    expect(restored.status).toBe('ok');
    if (restored.status !== 'ok') throw new Error('expected a complete restore');

    // The whole solve input is identical, so the solver must return the same schedule
    // and the header the same scheduled-hours figure.
    expect(restored.config).toEqual(configured);
    expect(totalPersonHours(restored.config.demand_matrix)).toBe(totalPersonHours(configured.demand_matrix));
    expect(restored.config.facility_name).toBe('Riverside Pharmacy');
    expect(restored.config.pareto_leeway_pct).toBe(22.5);
    expect(restored.config.rotation_week_offset).toBe(3);
  });

  it('does not restore a cleared config, so logout does not leak setup to the next user', () => {
    saveSolveConfig(configured);
    clearSolveConfig();
    expect(loadSolveConfig()).toEqual({ status: 'none' });
  });
});

describe('a restore that cannot be completed says so', () => {
  it('fails loudly on an unreadable saved copy instead of falling back silently', () => {
    window.localStorage.setItem('shiftflow.solveConfig', '{not json');
    const restored = loadSolveConfig();
    expect(restored.status).toBe('failed');
  });

  it('fails loudly when the saved copy came from another version', () => {
    window.localStorage.setItem(
      'shiftflow.solveConfig',
      JSON.stringify({ ...configured, version: 99 })
    );
    const restored = loadSolveConfig();
    expect(restored.status).toBe('failed');
    if (restored.status !== 'failed') throw new Error('expected a failed restore');
    expect(restored.reason).toContain('version');
  });

  it('names the staffing table as missing when the saved grid is not 7x24', () => {
    saveSolveConfig({ ...configured, demand_matrix: [[1, 2, 3]] });
    const restored = loadSolveConfig();
    expect(restored.status).toBe('partial');
    if (restored.status !== 'partial') throw new Error('expected a partial restore');
    expect(restored.missing).toContain('the staffing table');
    // The parts that did survive are still handed back.
    expect(restored.config.facility_name).toBe('Riverside Pharmacy');
    expect(restored.config.demand_matrix).toBeUndefined();
  });

  it('names the shift times as missing when a template lost its numbers', () => {
    saveSolveConfig({
      ...configured,
      templates: [{ ...DEFAULT_TEMPLATES[0], preferred_start: undefined as unknown as number }],
    });
    const restored = loadSolveConfig();
    expect(restored.status).toBe('partial');
    if (restored.status !== 'partial') throw new Error('expected a partial restore');
    expect(restored.missing).toContain('the shift times');
  });

  it('reports a refused write rather than pretending the setup was saved', () => {
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
      throw new Error('QuotaExceededError');
    });
    expect(saveSolveConfig(configured)).toBe(false);
  });

  it('reports a blocked read rather than treating it as a first visit', () => {
    vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => {
      throw new Error('SecurityError');
    });
    const restored = loadSolveConfig();
    expect(restored.status).toBe('failed');
  });
});
