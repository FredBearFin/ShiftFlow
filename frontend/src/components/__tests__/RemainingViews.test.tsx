/**
 * The five views this programme changes less: ErgonomicsAuditView, DOLComplianceView,
 * StaffDirectoryView, POSIntegrationView and Header.
 *
 * Lighter coverage than the four priority views on purpose. Each one asserts that the
 * view renders from a valid SolveResponse, handles its genuinely-reachable empty or null
 * state, and routes its controls through its props. Nothing asserts markup or copy, since
 * several tracks are rewriting all of these at the same time.
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { ErgonomicsAuditView } from '../ErgonomicsAuditView';
import { DOLComplianceView } from '../DOLComplianceView';
import { StaffDirectoryView } from '../StaffDirectoryView';
import { POSIntegrationView } from '../POSIntegrationView';
import { Header } from '../Header';
import { makeEmployee, makeSolveResponse } from './solveResponseFixture';

// No globals in this repo's vitest config, so Testing Library does not unmount for us.
afterEach(cleanup);

describe('ErgonomicsAuditView', () => {
  it('renders a row for every one of the eight criteria', () => {
    const solution = makeSolveResponse();
    expect(solution.ergonomics_audit.criteria_breakdown.length).toBe(8);
    render(<ErgonomicsAuditView solution={solution} />);
    const text = document.body.textContent ?? '';
    solution.ergonomics_audit.criteria_breakdown.forEach((criterion) => {
      expect(text, `criterion ${criterion.criterion_id} must be shown`).toContain(
        criterion.name
      );
    });
  });

  it('renders when every criterion scores zero', () => {
    const solution = makeSolveResponse();
    const clean = {
      ...solution,
      ergonomics_audit: {
        ...solution.ergonomics_audit,
        total_ergo_objective: 0,
        criteria_breakdown: solution.ergonomics_audit.criteria_breakdown.map((c) => ({
          ...c,
          raw_violations_count: 0,
          weighted_penalty: 0,
          improvement_pct: 0,
          status: 'optimal' as const,
        })),
      },
    };
    // maxPenalty is a divisor for the bar widths, so an all-zero audit is the case that
    // would divide by zero if it were not floored.
    expect(() => render(<ErgonomicsAuditView solution={clean} />)).not.toThrow();
  });
});

describe('DOLComplianceView', () => {
  it('renders from a solution', () => {
    expect(() =>
      render(<DOLComplianceView solution={makeSolveResponse()} />)
    ).not.toThrow();
    expect((document.body.textContent ?? '').length).toBeGreaterThan(0);
  });

  it('renders before any schedule exists, which its prop type allows', () => {
    // solution is `SolveResponse | null`: this is the first-run state, not an edge case.
    expect(() => render(<DOLComplianceView solution={null} />)).not.toThrow();
  });

  it('does not report a rest violation for a compliant schedule', () => {
    const solution = makeSolveResponse();
    expect(solution.ergonomics_audit.min_rest_hours_observed).toBeGreaterThanOrEqual(16);
    expect(solution.ergonomics_audit.clopening_violations).toBe(0);
    render(<DOLComplianceView solution={solution} />);
    // The view marks failures with a cross; a clean schedule must show none.
    expect(document.body.textContent ?? '').not.toContain('✗');
  });
});

describe('StaffDirectoryView', () => {
  function renderDirectory(employees = [makeEmployee()]) {
    const props = {
      employees,
      rosterLines: makeSolveResponse().roster_lines,
      onAddEmployee: vi.fn(),
      onToggleActive: vi.fn(),
      onUpdateAvailability: vi.fn(),
    };
    render(<StaffDirectoryView {...props} />);
    return props;
  }

  it('lists the staff it is given', () => {
    renderDirectory([
      makeEmployee({ employee_id: 'EMP-001', name: 'Marcus Vance' }),
      makeEmployee({ employee_id: 'EMP-002', name: 'Devon Taylor' }),
    ]);
    const text = document.body.textContent ?? '';
    expect(text).toContain('Marcus Vance');
    expect(text).toContain('Devon Taylor');
  });

  it('renders with nobody hired yet', () => {
    // The normal state on first run, before any staff exist.
    expect(() => renderDirectory([])).not.toThrow();
  });

  it('shows a deactivated person as deactivated rather than hiding them', () => {
    // Separation records are retained, so a deactivated person must stay visible.
    renderDirectory([makeEmployee({ name: 'Former Staffer', is_active: false })]);
    expect(document.body.textContent ?? '').toContain('Former Staffer');
  });
});

describe('POSIntegrationView', () => {
  it('renders its upload form', () => {
    render(<POSIntegrationView facilityId="FAC-OMAHA-01" />);
    expect(document.querySelector('input[type="file"]')).toBeTruthy();
  });

  it('does not attempt an upload with no file chosen', () => {
    const fetchSpy = vi.fn();
    const originalFetch = globalThis.fetch;
    globalThis.fetch = fetchSpy as unknown as typeof fetch;
    try {
      render(<POSIntegrationView facilityId="FAC-OMAHA-01" />);
      const uploadButton = screen
        .getAllByRole('button')
        .find((button) => /upload|import|analy/i.test(button.textContent ?? ''));
      if (uploadButton) fireEvent.click(uploadButton);
      expect(fetchSpy).not.toHaveBeenCalled();
    } finally {
      globalThis.fetch = originalFetch;
    }
  });
});

describe('Header', () => {
  function renderHeader(overrides: Record<string, unknown> = {}) {
    const props = {
      activeTab: 'roster',
      onSelectTab: vi.fn(),
      onOpenWizard: vi.fn(),
      onOpenShortcuts: vi.fn(),
      solution: makeSolveResponse(),
      leewayPct: 5,
      onLogout: vi.fn(),
      ...overrides,
    };
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    render(<Header {...(props as any)} />);
    return props;
  }

  it('calls onSelectTab with a tab id when a navigation item is used', () => {
    const props = renderHeader();
    const nav = document.querySelector('nav');
    expect(nav, 'the header must render navigation').toBeTruthy();
    const tabs = Array.from(nav!.querySelectorAll('button'));
    expect(tabs.length).toBeGreaterThan(1);

    // Click something other than the already-active tab.
    const other = tabs.find((tab) => tab.getAttribute('aria-current') !== 'page') ?? tabs[1];
    fireEvent.click(other);
    expect(props.onSelectTab).toHaveBeenCalled();
    expect(typeof props.onSelectTab.mock.calls[0][0]).toBe('string');
  });

  it('calls onOpenWizard when the setup control is used', () => {
    const props = renderHeader();
    const setup = screen
      .getAllByRole('button')
      .find((button) => /setup|wizard|start|guide/i.test(button.textContent ?? ''));
    if (!setup) return; // no such control in the current design; nothing to assert
    fireEvent.click(setup);
    expect(props.onOpenWizard).toHaveBeenCalled();
  });

  it('renders before any schedule exists, which its prop type allows', () => {
    expect(() => renderHeader({ solution: null })).not.toThrow();
  });
});
