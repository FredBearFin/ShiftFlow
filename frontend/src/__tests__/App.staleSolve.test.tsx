import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render, screen, waitFor } from '@testing-library/react';
import { makeSolution } from '../test/solutionFixture';

// This repo's vitest config has no globals, so Testing Library does not unmount
// between tests on its own.
afterEach(cleanup);

const solveMock = vi.fn();

vi.mock('../services/api', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../services/api')>();
  return {
    ...actual,
    authStatusApi: vi.fn(async () => ({ login_required: false, logged_in: true, email: null })),
    fetchEmployeesApi: vi.fn(async () => []),
    fetchArchetypes: vi.fn(async () => []),
    solveScheduleApi: (...args: unknown[]) => solveMock(...args),
  };
});

const { App } = await import('../App');

describe('a failed solve leaves nothing presented as current', () => {
  beforeEach(() => {
    solveMock.mockReset();
    // Opt out of forced onboarding so the schedule itself is what's on screen.
    window.localStorage.setItem('shiftflow.planningOnly', '1');
  });

  afterEach(() => {
    window.localStorage.clear();
  });

  it('clears the previous roster, payroll and export paths when the next solve fails', async () => {
    const solution = makeSolution({ lineCount: 2, wage: 18 });
    solveMock
      .mockImplementationOnce(async () => solution)
      .mockImplementation(async () => {
        throw new Error('422: demand matrix is not solvable with these shift templates');
      });

    render(<App />);

    // The first solve succeeds, so the roster and its exports are on screen.
    const advance = await screen.findByTitle('Advance all shift patterns by 1 week');
    expect(screen.getByText(/Estimated Weekly Payroll/i)).toBeTruthy();
    expect(screen.getByRole('button', { name: /Export CSV/i })).toBeTruthy();
    expect(screen.getByRole('button', { name: /Print Roster/i })).toBeTruthy();

    // Advancing a week re-solves; this time the backend rejects the configuration.
    advance.click();

    await waitFor(() => {
      expect(screen.getByRole('alert').textContent).toContain('422');
    });

    // Nothing from the previous configuration may still read as the current result.
    expect(screen.queryByText(/Estimated Weekly Payroll/i)).toBeNull();
    expect(screen.queryByText(/Availability Adherence/i)).toBeNull();
    expect(screen.queryByText(/Ergonomics Health Index/i)).toBeNull();
    expect(screen.queryByRole('button', { name: /Export CSV/i })).toBeNull();
    expect(screen.queryByRole('button', { name: /Print Roster/i })).toBeNull();
    expect(screen.queryByText(/\$1,440/)).toBeNull();
  });
});
