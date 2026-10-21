import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen, fireEvent, waitFor, cleanup } from '@testing-library/react';
import { OwnerSummaryView } from './OwnerSummaryView';
import * as api from '../services/api';
import type { OwnerFacilitySummary } from '../services/api';

vi.mock('../services/api', () => ({
  fetchOwnerFacilitySummaryApi: vi.fn(),
}));

afterEach(cleanup);

const links = [
  { facility_id: 'f1', facility_name: 'Omaha Foodmart' },
  { facility_id: 'f2', facility_name: 'Lincoln Foodmart' },
];

function makeSummary(facilityId: string, facilityName: string): OwnerFacilitySummary {
  return {
    facility_id: facilityId,
    facility_name: facilityName,
    active_employee_count: 5,
    estimated_weekly_hours: 120,
    estimated_weekly_payroll: 2400,
    average_hourly_wage: 20,
    note: 'Estimates only.',
  };
}

describe('OwnerSummaryView accessibility', () => {
  it('moves focus to its own heading on mount - this is the view an owner lands on right after accepting their invite', () => {
    vi.mocked(api.fetchOwnerFacilitySummaryApi).mockReturnValue(new Promise(() => {}));
    render(<OwnerSummaryView links={links} onLogout={vi.fn()} onViewFullSchedule={vi.fn()} />);
    const heading = screen.getByRole('heading', { name: /owner view/i });
    expect(document.activeElement).toBe(heading);
  });

  it('marks the loading state as role=status so it is actually announced', () => {
    vi.mocked(api.fetchOwnerFacilitySummaryApi).mockReturnValue(new Promise(() => {}));
    render(<OwnerSummaryView links={links} onLogout={vi.fn()} onViewFullSchedule={vi.fn()} />);
    expect(screen.getByRole('status').textContent).toMatch(/loading/i);
  });

  it('surfaces a load failure with role=alert', async () => {
    vi.mocked(api.fetchOwnerFacilitySummaryApi).mockRejectedValue(new Error('This facility summary could not be loaded.'));
    render(<OwnerSummaryView links={links} onLogout={vi.fn()} onViewFullSchedule={vi.fn()} />);
    expect((await screen.findByRole('alert')).textContent).toContain('could not be loaded');
  });

  it('labels the facility picker, and announces the swapped-in summary in a polite live region', async () => {
    vi.mocked(api.fetchOwnerFacilitySummaryApi).mockImplementation((id: string) =>
      Promise.resolve(makeSummary(id, id === 'f1' ? 'Omaha Foodmart' : 'Lincoln Foodmart'))
    );
    render(<OwnerSummaryView links={links} onLogout={vi.fn()} onViewFullSchedule={vi.fn()} />);
    await screen.findByRole('heading', { name: 'Omaha Foodmart' });

    const select = screen.getByLabelText('Facility');
    const liveRegion = select.closest('main')?.querySelector('[aria-live="polite"]');
    expect(liveRegion).not.toBeNull();

    fireEvent.change(select, { target: { value: 'f2' } });
    const updatedHeading = await waitFor(() => screen.getByRole('heading', { name: 'Lincoln Foodmart' }));
    expect(liveRegion?.contains(updatedHeading)).toBe(true);
  });
});
