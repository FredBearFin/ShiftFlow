/**
 * B1 regression gate: configure -> reload -> re-solve must send the same solve input.
 *
 * Reproduced before the fix: configure a facility with evening as the busiest period,
 * reload, and the app re-solved from the flat default staffing table - a different
 * schedule, a different scheduled-hours figure, no wizard and no notice.
 *
 * A fresh render of <App /> is the reload: the config is read from storage during the
 * first render, exactly as it is after a browser refresh.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { render, screen, cleanup, waitFor } from '@testing-library/react';
import { App } from './App';
import { saveSolveConfig, DEFAULT_TEMPLATES, DEFAULT_GUARDRAILS } from './services/api';
import type { PersistedSolveConfig, SolveRequest } from './types';

// This repo's vitest config has no globals, so Testing Library does not unmount
// between tests on its own.
afterEach(() => {
  cleanup();
  window.localStorage.clear();
  vi.restoreAllMocks();
});

/** Evening-busy demand: nothing like the flat default of 2 in every hour. */
const EVENING_DEMAND: number[][] = Array.from({ length: 7 }, () =>
  Array.from({ length: 24 }, (_, hour) => (hour >= 16 && hour < 21 ? 5 : hour >= 8 ? 2 : 0))
);

const configured: PersistedSolveConfig = {
  archetype_id: 'custom',
  facility_name: 'Riverside Pharmacy',
  demand_matrix: EVENING_DEMAND,
  templates: DEFAULT_TEMPLATES,
  guardrails: DEFAULT_GUARDRAILS,
  pareto_leeway_pct: 22.5,
  rotation_week_offset: 0,
};

const totalPersonHours = (matrix: number[][]) =>
  matrix.reduce((acc, row) => acc + row.reduce((a, b) => a + b, 0), 0);

/** Captures every solve request the app sends. The solve itself is failed on purpose,
 *  so no roster view renders and the request body stays the only thing under test. */
let solveRequests: SolveRequest[] = [];

beforeEach(() => {
  window.localStorage.clear();
  solveRequests = [];
  vi.stubGlobal(
    'fetch',
    vi.fn(async (url: unknown, init?: { body?: unknown }) => {
      const target = String(url);
      if (target.includes('/api/auth/status')) {
        return { ok: true, json: async () => ({ login_required: false, logged_in: true, email: null, signup_allowed: true }) };
      }
      if (target.includes('/api/v1/archetypes')) {
        return { ok: true, json: async () => [] };
      }
      if (target.includes('/api/employees')) {
        return { ok: true, json: async () => [] };
      }
      if (target.includes('/api/v1/schedules/solve')) {
        solveRequests.push(JSON.parse(String(init?.body)) as SolveRequest);
        return { ok: false, status: 503, json: async () => ({ detail: 'solver stubbed out' }) };
      }
      return { ok: true, json: async () => ({}) };
    })
  );
});

describe('the solve configuration survives a reload', () => {
  it('re-solves from the saved staffing table, not the default one', async () => {
    saveSolveConfig(configured);

    render(<App />);

    await waitFor(() => expect(solveRequests.length).toBeGreaterThan(0));
    const sent = solveRequests[0];

    expect(sent.facility_name).toBe('Riverside Pharmacy');
    expect(sent.demand_matrix).toEqual(EVENING_DEMAND);
    expect(sent.pareto_leeway_pct).toBe(22.5);
    // The scheduled-hours figure is a function of this input, so an equal input is
    // the thing that makes the header read the same after a reload.
    expect(totalPersonHours(sent.demand_matrix)).toBe(totalPersonHours(EVENING_DEMAND));
  });

  it('still uses the defaults on a genuine first visit', async () => {
    render(<App />);

    await waitFor(() => expect(solveRequests.length).toBeGreaterThan(0));
    const sent = solveRequests[0];

    expect(sent.facility_name).toBe('');
    // The untouched default: 2 people in every one of the 168 hours.
    expect(totalPersonHours(sent.demand_matrix)).toBe(336);
  });

  it('tells the user when only part of the saved setup came back', async () => {
    saveSolveConfig({ ...configured, demand_matrix: [[1, 2, 3]] });

    render(<App />);

    await waitFor(() => expect(solveRequests.length).toBeGreaterThan(0));
    // The banner names the part that was lost, rather than just saying something failed.
    const banner = screen.getByText(/Part of your saved setup could not be restored/);
    expect(banner.textContent).toContain('the staffing table');
  });

  it('tells the user when the saved setup could not be restored at all', async () => {
    window.localStorage.setItem('shiftflow.solveConfig', '{not json');

    render(<App />);

    await waitFor(() => expect(solveRequests.length).toBeGreaterThan(0));
    expect(screen.getByText(/Your saved setup could not be restored/)).toBeTruthy();
  });
});
