/**
 * The states the content area shows when it has no schedule to show.
 *
 * A failed solve used to put a 1px red-outlined bar at the top of the page and
 * leave roughly 800px of blank cream underneath it; the first solve showed a
 * small centred spinner before the page jumped to a 3000px roster; and a
 * re-solve left the previous schedule on screen at full strength with nothing
 * saying its figures were about to be replaced.
 *
 * The staleness behaviour itself — a failed solve clearing the stale schedule
 * — is not under test here and is deliberately left alone. This covers the
 * visual half.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { App } from '../../App';
import { DOLComplianceView } from '../DOLComplianceView';
import { StaffDirectoryView } from '../StaffDirectoryView';
import { ResultState } from '../ui/ResultState';
import { RosterSkeleton } from '../ui/RosterSkeleton';
import { makeSolution, solutionFixture } from '../../test/solutionFixture';

// This repo's vitest config has no globals, so Testing Library does not unmount
// between tests on its own.
afterEach(() => {
  cleanup();
  window.localStorage.clear();
  vi.restoreAllMocks();
});

let solveCount = 0;
/** Resolved per test, so a solve can be failed, held open or answered. */
let solveHandler: () => Promise<{ ok: boolean; status?: number; json: () => Promise<unknown> }>;

beforeEach(() => {
  window.localStorage.clear();
  // Planning mode: without it the setup wizard opens over everything.
  window.localStorage.setItem('shiftflow.planningOnly', '1');
  solveCount = 0;
  solveHandler = async () => ({
    ok: false,
    status: 503,
    json: async () => ({ detail: 'The scheduling service is unavailable.' }),
  });
  vi.stubGlobal(
    'fetch',
    vi.fn(async (url: unknown) => {
      const target = String(url);
      if (target.includes('/api/auth/status')) {
        return {
          ok: true,
          json: async () => ({ login_required: false, logged_in: true, email: null, signup_allowed: true }),
        };
      }
      if (target.includes('/api/v1/archetypes')) return { ok: true, json: async () => [] };
      if (target.includes('/api/employees')) return { ok: true, json: async () => [] };
      if (target.includes('/api/v1/schedules/solve')) {
        solveCount += 1;
        return solveHandler();
      }
      return { ok: true, json: async () => ({}) };
    })
  );
});

describe('a failed solve gets a designed state, not an empty page', () => {
  it('fills the content area instead of leaving it blank under a thin bar', async () => {
    render(<App />);
    const panel = await screen.findByRole('alert', {}, { timeout: 4000 });
    expect(panel.className).toContain('card');
    // It takes the area the schedule would have, rather than being a 1px rule.
    expect(panel.className).toMatch(/min-h-/);

    // The four things the state has to carry.
    expect(panel.querySelector('[aria-hidden="true"]')).toBeTruthy();
    expect(
      screen.getByText('No schedule could be worked out for these settings')
    ).toBeTruthy();
    expect(panel.textContent).toContain('open setup and check the hours you asked for');
    expect(panel.textContent).toContain('The scheduling service is unavailable.');
  });

  it('offers a recovery action that actually re-runs the solve', async () => {
    render(<App />);
    await screen.findByRole('alert', {}, { timeout: 4000 });
    const before = solveCount;
    fireEvent.click(screen.getByRole('button', { name: 'Try again' }));
    await waitFor(() => expect(solveCount).toBeGreaterThan(before), { timeout: 4000 });
  });

  it('offers a way into setup, where the settings that failed can be changed', async () => {
    render(<App />);
    await screen.findByRole('alert', {}, { timeout: 4000 });
    expect(screen.getByRole('button', { name: 'Open setup' })).toBeTruthy();
  });

  it('does not also leave the old thin banner in flow behind the state', async () => {
    render(<App />);
    await screen.findByRole('alert', {}, { timeout: 4000 });
    // One alert, not a banner and a panel saying the same thing twice.
    expect(screen.getAllByRole('alert').length).toBe(1);
  });
});

describe('the first solve shows the shape of what is coming', () => {
  it('renders a roster-shaped skeleton rather than an empty area', async () => {
    // Hold the solve open: the app stays in its first-load state.
    solveHandler = () => new Promise(() => {});
    const { container } = render(<App />);
    await waitFor(() => expect(solveCount).toBeGreaterThan(0), { timeout: 4000 });
    await waitFor(() => {
      expect(container.querySelectorAll('.animate-pulse').length).toBeGreaterThan(10);
    }, { timeout: 4000 });
  });

  it('keeps the skeleton out of the accessibility tree and announces instead', () => {
    const { container } = render(<RosterSkeleton />);
    expect(container.firstElementChild?.getAttribute('aria-hidden')).toBe('true');
    expect(container.querySelectorAll('.animate-pulse').length).toBeGreaterThan(10);
  });
});

describe('a re-solve dims the schedule it is about to replace', () => {
  it('marks the stale content busy and stops it being clicked', async () => {
    let release: (() => void) | null = null;
    // solutionFixture carries a frontier, so the view has something to apply.
    solveHandler = async () => ({ ok: true, json: async () => solutionFixture });
    const { container } = render(<App />);
    await waitFor(() => expect(screen.queryAllByRole('table').length).toBeGreaterThan(0), {
      timeout: 4000,
    });
    expect(container.querySelector('[aria-busy="true"]')).toBeNull();

    // Hold the next solve open and trigger one from the view itself: applying
    // a different flexibility changes the solve input.
    solveHandler = () => new Promise<never>((resolve) => { release = resolve as () => void; });
    fireEvent.click(screen.getByRole('button', { name: /Flexibility vs\. Rest/ }));
    const apply = await screen.findAllByRole('button', { name: 'Apply' }, { timeout: 4000 });
    fireEvent.click(apply[0]);

    await waitFor(() => {
      const busy = container.querySelector('main [aria-busy="true"]');
      expect(busy).toBeTruthy();
      expect(busy!.className).toContain('opacity-60');
      expect(busy!.className).toContain('pointer-events-none');
    }, { timeout: 4000 });
    expect(release).toBeNull();
  });
});

describe('ResultState', () => {
  it('shows no detail block and no actions when it is given none', () => {
    const { container } = render(
      <ResultState glyph="?" headline="Nothing here">
        Try something else.
      </ResultState>
    );
    expect(container.querySelectorAll('button').length).toBe(0);
    expect(container.textContent).toContain('Nothing here');
  });

  it('puts no opacity modifier on a var()-backed utility', () => {
    const { container } = render(
      <ResultState tone="problem" glyph="!" headline="Problem">
        Body
      </ResultState>
    );
    for (const el of Array.from(container.querySelectorAll('*'))) {
      expect(el.className).not.toMatch(/\b(?:bg|text|border)-(?:status|ink|canvas|card|surface|accent|danger|warning|muted)[a-z-]*\/\d/);
    }
  });
});

describe('the compliance tab carries enough to not read as a stub', () => {
  it('opens with a tally of what was and was not assessed', () => {
    render(<DOLComplianceView solution={makeSolution()} />);
    expect(screen.getByText('Checks run')).toBeTruthy();
    expect(screen.getByText('Met')).toBeTruthy();
    expect(screen.getByText('Need a look')).toBeTruthy();
    expect(screen.getAllByText('Not assessed').length).toBeGreaterThan(0);
  });

  it('names the figure each verdict was read off', () => {
    render(<DOLComplianceView solution={makeSolution()} />);
    expect(screen.getByText(/Shortest gap in the week/)).toBeTruthy();
    expect(screen.getByText('Close-then-open pairs in this schedule')).toBeTruthy();
    expect(screen.getByText('Work stretches outside your chosen range')).toBeTruthy();
  });

  it('breaks out what it does not check, rather than one run-on sentence', () => {
    const { container } = render(<DOLComplianceView solution={makeSolution()} />);
    const section = screen.getByText(/What this page does not check/).closest('div')!;
    expect(section.querySelectorAll('li').length).toBeGreaterThanOrEqual(4);
    // And the page is no longer five cards and a line of small print.
    expect((container.textContent ?? '').length).toBeGreaterThan(2000);
  });
});

describe('the staff directory stops shouting its destructive action', () => {
  const employees = Array.from({ length: 6 }, (_, i) => ({
    employee_id: `EMP-00${i}`,
    name: `Person ${i}`,
    role: i === 0 ? 'A role with a notably long title that wraps onto a second line' : 'Clerk',
    hourly_wage: 20 + i,
    max_weekly_hours: 40,
    is_active: true,
    available_days: [0, 1, 2, 3, 4],
    preferred_shifts: ['M' as const],
    assigned_line_id: null,
  }));

  function renderDirectory() {
    return render(
      <StaffDirectoryView
        employees={employees}
        rosterLines={[]}
        onAddEmployee={vi.fn()}
        onToggleActive={vi.fn()}
        onUpdateAvailability={vi.fn()}
      />
    );
  }

  it('does not render a filled destructive button once per card', () => {
    renderDirectory();
    const separate = screen.getAllByRole('button', { name: /Separate \/ Deactivate/ });
    expect(separate.length).toBe(employees.length);
    for (const button of separate) {
      // The quiet treatment: an outline carrying the danger colour as text,
      // not a filled red block repeated down the grid.
      expect(button.className).toContain('text-danger');
      expect(button.className).not.toContain('bg-[var(--danger)]');
      expect(button.className).toContain('border');
      // Only the filled variants carry the single allowed shadow.
      expect(button.className).not.toContain('shadow-[');
    }
  });

  it('gives every card the same height regardless of its content', () => {
    const { container } = renderDirectory();
    const grid = container.querySelector('div.grid.auto-rows-fr');
    expect(grid, 'the staff grid must size its rows equally').toBeTruthy();
    for (const card of Array.from(grid!.children)) {
      expect(card.className).toContain('h-full');
    }
  });
});
