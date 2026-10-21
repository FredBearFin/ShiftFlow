import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen, cleanup, fireEvent } from '@testing-library/react';
import { StaffDirectoryView } from '../StaffDirectoryView';
import { CoverageHeatmapView } from '../CoverageHeatmapView';
import { solutionFixture } from '../../test/solutionFixture';

// This repo runs vitest without globals, so Testing Library does not unmount
// between cases on its own.
afterEach(cleanup);

const WHITE = '#ffffff';
const SLATE_50 = '#f8fafc';
const SLATE_100 = '#f1f5f9';
const SLATE_400 = '#94a3b8';
const SLATE_500 = '#64748b';
const SLATE_600 = '#475569';
const MUTED = '#5c6770'; // --muted, the design token

function relativeLuminance(hex: string): number {
  const channel = (c: number) => {
    const s = c / 255;
    return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
  };
  const r = channel(parseInt(hex.slice(1, 3), 16));
  const g = channel(parseInt(hex.slice(3, 5), 16));
  const b = channel(parseInt(hex.slice(5, 7), 16));
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

function ratio(fg: string, bg: string): number {
  const a = relativeLuminance(fg);
  const b = relativeLuminance(bg);
  const [hi, lo] = a > b ? [a, b] : [b, a];
  return (hi + 0.05) / (lo + 0.05);
}

describe('muted text meets 1.4.3 on the surfaces it is used on', () => {
  it('fails on slate-400 and passes on the muted token', () => {
    for (const bg of [WHITE, SLATE_50, SLATE_100]) {
      expect(ratio(SLATE_400, bg)).toBeLessThan(4.5);
      expect(ratio(MUTED, bg)).toBeGreaterThanOrEqual(4.5);
    }
  });

  it('keeps the inactive tab number badge above 4.5:1 on its slate-100 chip', () => {
    // Measured in a browser at 12px: slate-500 on slate-100 is 4.34:1.
    expect(ratio(SLATE_500, SLATE_100)).toBeLessThan(4.5);
    expect(ratio(SLATE_600, SLATE_100)).toBeGreaterThanOrEqual(4.5);
  });
});

describe('lost content uses the muted token, not slate-400', () => {
  function renderDirectory() {
    return render(
      <StaffDirectoryView
        employees={[
          {
            employee_id: 'EMP-001',
            name: 'Alex Morgan',
            role: 'Frontline Associate',
            hourly_wage: 22.72,
            max_weekly_hours: 40,
            is_active: true,
            available_days: [0, 1, 2, 3, 4],
            preferred_shifts: ['M'],
            assigned_line_id: null,
          },
        ]}
        rosterLines={[]}
        onAddEmployee={vi.fn()}
        onToggleActive={vi.fn()}
        onUpdateAvailability={vi.fn()}
      />
    );
  }

  it('shows the employee id and the unassigned-pool note in muted, not slate-400', () => {
    renderDirectory();
    expect(screen.getByText('EMP-001').className).toContain('text-muted');
    expect(screen.getByText('Unassigned Pool').className).toContain('text-muted');
  });

  it('keeps the dialog close controls above 4.5:1', () => {
    const { container } = renderDirectory();
    fireEvent.click(screen.getByRole('button', { name: '+ Add Employee' }));
    const close = container.querySelector('[role=dialog] button')!;
    expect(close.className).toContain('text-muted');
    expect(close.className).not.toContain('text-slate-400');
  });

  it('keeps closed-hour heatmap cells readable', () => {
    const closed = solutionFixture.interval_coverage.map((c) =>
      c.hour === 3 ? { ...c, required_staff: 0, scheduled_staff: 0 } : c
    );
    const { container } = render(
      <CoverageHeatmapView solution={{ ...solutionFixture, interval_coverage: closed }} />
    );
    const closedCells = Array.from(container.querySelectorAll('tbody td div')).filter((d) =>
      d.className.includes('bg-slate-50')
    );
    expect(closedCells.length).toBeGreaterThan(0);
    expect(closedCells.every((d) => d.className.includes('text-muted'))).toBe(true);
  });

  it('renders no text below 12px in the directory', () => {
    const { container } = renderDirectory();
    expect(container.querySelectorAll('[class*="text-[9px]"], [class*="text-[10px]"]').length).toBe(0);
  });
});
