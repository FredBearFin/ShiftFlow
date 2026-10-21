/**
 * Golden-file gate for the payroll CSV.
 *
 * The export used to write one row per rotation line, so an unstaffed line
 * became a row reading `,,"Union Line Standard",30.00,0.00,,,` — thirty hours
 * with no employee on them — and the UI called that a successful download.
 */
import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen, cleanup, fireEvent } from '@testing-library/react';
import { LaborAnalysisView, buildPayrollPeople } from '../LaborAnalysisView';
import { makeSolution, makeRosterLine } from '../../test/solutionFixture';

// This repo runs vitest without globals, so Testing Library does not unmount
// between cases on its own.
afterEach(cleanup);
afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

/** Captures the CSV text handed to the download link instead of writing a file. */
function captureDownloads(): string[] {
  const captured: string[] = [];
  const RealBlob = globalThis.Blob;
  vi.stubGlobal(
    'Blob',
    class extends RealBlob {
      constructor(parts: BlobPart[], opts?: BlobPropertyBag) {
        super(parts, opts);
        captured.push(parts.map(String).join(''));
      }
    },
  );
  vi.stubGlobal(
    'URL',
    Object.assign(Object.create(URL), URL, {
      createObjectURL: () => 'blob:test',
      revokeObjectURL: () => undefined,
    }),
  );
  vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => undefined);
  return captured;
}

const dataRows = (csv: string) => csv.split('\n').slice(1).filter((r) => r.trim() !== '');

describe('payroll CSV exports people, not rotation lines', () => {
  it('writes one row per assigned employee, not one per line', () => {
    const csv = captureDownloads();
    render(<LaborAnalysisView solution={makeSolution({ lineCount: 3 })} />);
    fireEvent.click(screen.getByRole('button', { name: /Gusto CSV/ }));

    expect(csv).toHaveLength(1);
    const rows = dataRows(csv[0]);
    expect(rows).toHaveLength(3);
    for (const row of rows) expect(row).toContain('EMP-');
  });

  it('never writes a row carrying hours with no employee on it', () => {
    const csv = captureDownloads();
    render(<LaborAnalysisView solution={makeSolution({ lineCount: 3 })} />);
    fireEvent.click(screen.getByRole('button', { name: /Gusto CSV/ }));
    fireEvent.click(screen.getByRole('button', { name: /ADP CSV/ }));

    expect(csv).toHaveLength(2);
    for (const file of csv) {
      const headers = file.split('\n')[0].split(',');
      // Both layouts name the person; ADP's leading Co Code / Batch ID cells are
      // blank on purpose, so the gate reads the employee columns by name.
      const nameCol = headers.indexOf('Employee Name');
      const hoursCols = headers
        .map((h, i) => (/hours/i.test(h) ? i : -1))
        .filter((i) => i >= 0);
      expect(nameCol).toBeGreaterThanOrEqual(0);
      expect(hoursCols.length).toBeGreaterThan(0);

      for (const row of dataRows(file)) {
        const cells = row.split(',');
        const carriesHours = hoursCols.some((i) => Number(cells[i]) > 0);
        if (carriesHours) expect(cells[nameCol].trim()).not.toBe('');
      }
      expect(file).not.toContain('Union Line Standard,30.00');
    }
  });

  it('refuses the download and says why when a line has nobody on it', () => {
    const csv = captureDownloads();
    render(<LaborAnalysisView solution={makeSolution({ lineCount: 3, pricedLineCount: 1 })} />);
    fireEvent.click(screen.getByRole('button', { name: /Gusto CSV/ }));

    expect(csv).toHaveLength(0);
    const alert = screen.getByRole('alert');
    expect(alert.textContent).toContain('No payroll file was created');
    expect(alert.textContent).toContain('2 of 3');
    expect(alert.textContent).toContain('lines 2, 3');
    // And it must not also claim success.
    expect(screen.getByRole('status').textContent).toBe('');
  });

  it('refuses the ADP download on the same ground', () => {
    const csv = captureDownloads();
    render(<LaborAnalysisView solution={makeSolution({ lineCount: 2, pricedLineCount: 1 })} />);
    fireEvent.click(screen.getByRole('button', { name: /ADP CSV/ }));

    expect(csv).toHaveLength(0);
    expect(screen.getByRole('alert').textContent).toContain('No payroll file was created');
  });

  it('exports once the unassigned line is gone', () => {
    const csv = captureDownloads();
    render(<LaborAnalysisView solution={makeSolution({ lineCount: 2 })} />);
    fireEvent.click(screen.getByRole('button', { name: /Gusto CSV/ }));

    expect(csv).toHaveLength(1);
    expect(screen.queryByRole('alert')?.textContent ?? '').toBe('');
    expect(screen.getByRole('status').textContent).toContain('2 employees written');
  });

  it('keeps CSV money columns raw numeric so payroll systems still parse them', () => {
    const csv = captureDownloads();
    render(<LaborAnalysisView solution={makeSolution({ lineCount: 2, wage: 18 })} />);
    fireEvent.click(screen.getByRole('button', { name: /Gusto CSV/ }));

    const [row] = dataRows(csv[0]);
    expect(row).toContain('18.00');
    expect(row).not.toContain('$');
  });

  it('escapes a name containing a quote instead of corrupting the row', () => {
    const people = buildPayrollPeople([
      makeRosterLine(1, { assigned_person: 'Smith, "Jo"', assigned_employee_id: 'EMP-1' }),
    ]);
    expect(people).toHaveLength(1);
    expect(people[0].name).toBe('Smith, "Jo"');
  });
});

describe('buildPayrollPeople folds one person onto one row', () => {
  it('sums the hours of an employee who holds two rotation lines', () => {
    const people = buildPayrollPeople([
      makeRosterLine(1, {
        assigned_person: 'Dana Reyes',
        assigned_employee_id: 'EMP-1',
        regular_hours: 20,
        overtime_hours: 1,
        hourly_wage: 18,
        estimated_weekly_payroll: 360,
      }),
      makeRosterLine(2, {
        assigned_person: 'Dana Reyes',
        assigned_employee_id: 'EMP-1',
        regular_hours: 16,
        overtime_hours: 2,
        hourly_wage: 18,
        estimated_weekly_payroll: 288,
      }),
    ]);
    expect(people).toHaveLength(1);
    expect(people[0].regularHours).toBe(36);
    expect(people[0].overtimeHours).toBe(3);
    expect(people[0].estimatedPayroll).toBe(648);
    expect(people[0].note).toContain('lines 1 + 2');
  });

  it('leaves the hourly rate empty when the merged lines pay different rates', () => {
    const people = buildPayrollPeople([
      makeRosterLine(1, { assigned_person: 'Dana', assigned_employee_id: 'EMP-1', hourly_wage: 18 }),
      makeRosterLine(2, { assigned_person: 'Dana', assigned_employee_id: 'EMP-1', hourly_wage: 22 }),
    ]);
    expect(people).toHaveLength(1);
    expect(people[0].hourlyWage).toBeNull();
  });

  it('drops lines with nobody on them rather than exporting their hours', () => {
    const people = buildPayrollPeople([
      makeRosterLine(1, { assigned_person: 'Dana', assigned_employee_id: 'EMP-1' }),
      makeRosterLine(2),
      makeRosterLine(3, { assigned_person: '   ' }),
    ]);
    expect(people).toHaveLength(1);
    expect(people[0].name).toBe('Dana');
  });
});

describe('the payroll panel does not claim an integration', () => {
  it('describes a CSV the supervisor uploads, not a 1-click integration', () => {
    render(<LaborAnalysisView solution={makeSolution({ lineCount: 2 })} />);
    const panel = screen.getByRole('heading', { name: /Payroll CSV Export/ }).closest('div');
    expect(panel?.textContent ?? '').not.toMatch(/1-click/i);
    expect(panel?.textContent ?? '').not.toMatch(/integration/i);
    expect(panel?.textContent ?? '').toContain('nothing is sent to either system from here');
  });
});
