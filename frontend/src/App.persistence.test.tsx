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

/** What GET /api/facility-config returns in a given test. null (the default) is a
 *  plain 404 - no facility solve configuration saved on the server yet - which is the
 *  common case these persistence tests otherwise exercise via localStorage alone. */
let facilityConfigGetResponse: { status: number; body: unknown } | null = null;
/** Every body PUT to /api/facility-config, so tests can confirm the server write
 *  actually happens alongside the localStorage one. */
let facilityConfigPutBodies: Array<{ config: unknown }> = [];

beforeEach(() => {
  window.localStorage.clear();
  solveRequests = [];
  facilityConfigGetResponse = null;
  facilityConfigPutBodies = [];
  vi.stubGlobal(
    'fetch',
    vi.fn(async (url: unknown, init?: { method?: string; body?: unknown }) => {
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
      if (target.includes('/api/facility-config')) {
        if ((init?.method ?? 'GET') === 'PUT') {
          facilityConfigPutBodies.push(JSON.parse(String(init?.body)) as { config: unknown });
          return { ok: true, json: async () => ({ facility_id: 'FAC-OMAHA-01', config: {}, updated_at: 'now' }) };
        }
        if (facilityConfigGetResponse) {
          const { status, body } = facilityConfigGetResponse;
          return { ok: status >= 200 && status < 300, status, json: async () => body };
        }
        return { ok: false, status: 404, json: async () => ({ detail: 'No saved solve configuration' }) };
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

describe('the solve configuration also syncs through the server', () => {
  const SERVER_DEMAND: number[][] = Array.from({ length: 7 }, () =>
    Array.from({ length: 24 }, (_, hour) => (hour >= 0 && hour < 6 ? 1 : 3))
  );

  const serverConfig = {
    archetype_id: 'custom',
    facility_name: "Owner's First Laptop View",
    demand_matrix: SERVER_DEMAND,
    templates: DEFAULT_TEMPLATES,
    guardrails: DEFAULT_GUARDRAILS,
    pareto_leeway_pct: 17.5,
    rotation_week_offset: 0,
  };

  it('pulls the saved setup from the server when this browser has nothing in localStorage', async () => {
    // This reproduces the owner's-own-device scenario the server sync exists for: no
    // localStorage at all (asserted by the outer beforeEach's window.localStorage.clear()),
    // but the manager already saved a real configuration server-side.
    facilityConfigGetResponse = { status: 200, body: { facility_id: 'FAC-OMAHA-01', config: serverConfig, updated_at: 'now' } };

    render(<App />);

    await waitFor(() =>
      expect(solveRequests.some((r) => r.facility_name === "Owner's First Laptop View")).toBe(true)
    );
    const sent = solveRequests[solveRequests.length - 1];
    expect(sent.demand_matrix).toEqual(SERVER_DEMAND);
    expect(sent.pareto_leeway_pct).toBe(17.5);

    // And it is adopted as this browser's own fast local cache too, not just held in memory.
    await waitFor(() => {
      const raw = window.localStorage.getItem('shiftflow.solveConfig');
      expect(raw).toBeTruthy();
      expect(JSON.parse(raw as string).facility_name).toBe("Owner's First Laptop View");
    });
  });

  it('keeps the local setup when the server has not seen this facility yet (a plain 404)', async () => {
    saveSolveConfig(configured);
    facilityConfigGetResponse = { status: 404, body: { detail: 'No saved solve configuration' } };

    render(<App />);

    await waitFor(() => expect(solveRequests.length).toBeGreaterThan(0));
    expect(solveRequests[0].facility_name).toBe('Riverside Pharmacy');
  });

  it('writes a saved change to the server as well as to localStorage', async () => {
    render(<App />);

    await waitFor(() => expect(solveRequests.length).toBeGreaterThan(0));
    // The initial load's own write-through: once the (empty) server has been checked,
    // this browser's current setup - defaults, on a first visit - is pushed up as the
    // facility's saved configuration, the same way it was already saved to localStorage.
    await waitFor(() => expect(facilityConfigPutBodies.length).toBeGreaterThan(0));
    const lastSaved = facilityConfigPutBodies[facilityConfigPutBodies.length - 1].config as Record<string, unknown>;
    expect(lastSaved.facility_name).toBe('');
  });

  it('does not push this browser is blank starting state to the server ahead of a real saved one', async () => {
    // Regression guard: on a brand-new device the first render starts from defaults.
    // If the server write fired before the server was ever checked, it could overwrite
    // a real configuration with those defaults. The fetch mock below answers the GET
    // only after a tick, so this would fail if the PUT raced ahead of it.
    const gate: { resolve: (() => void) | null } = { resolve: null };
    const original = window.fetch;
    vi.stubGlobal(
      'fetch',
      vi.fn(async (url: unknown, init?: { method?: string; body?: unknown }) => {
        const target = String(url);
        if (target.includes('/api/facility-config') && (init?.method ?? 'GET') !== 'PUT') {
          await new Promise<void>((resolve) => {
            gate.resolve = resolve;
          });
        }
        return (original as typeof fetch)(target as string, init as RequestInit);
      })
    );
    facilityConfigGetResponse = { status: 200, body: { facility_id: 'FAC-OMAHA-01', config: serverConfig, updated_at: 'now' } };

    render(<App />);
    // Give any premature PUT a chance to fire before the GET is allowed to resolve.
    await new Promise((resolve) => setTimeout(resolve, 50));
    expect(facilityConfigPutBodies.length).toBe(0);

    gate.resolve?.();
    await waitFor(() =>
      expect(solveRequests.some((r) => r.facility_name === "Owner's First Laptop View")).toBe(true)
    );
  });
});
