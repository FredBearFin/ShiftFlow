/**
 * B3: a POS upload previews before it overwrites.
 *
 * Reproduced before the fix: uploading a POS CSV replaced a hand-built staffing table
 * the moment the request returned - no preview, no confirmation, no way back. A
 * rejected file also showed a generic failure, throwing away the row number the
 * backend had already worked out.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { render, screen, cleanup, fireEvent, waitFor } from '@testing-library/react';
import { POSIntegrationView } from '../POSIntegrationView';

// This repo's vitest config has no globals, so Testing Library does not unmount
// between tests on its own.
afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

/** A hand-built table: 2 people every hour, 9 at Monday 12:00. */
const handBuilt = (): number[][] => {
  const matrix = Array.from({ length: 7 }, () => Array(24).fill(2));
  matrix[0][12] = 9;
  return matrix;
};

/** What the server works out from the file: 4 people every hour. */
const fromPos = (): number[][] => Array.from({ length: 7 }, () => Array(24).fill(4));

const uploadResponse = {
  status: 'success',
  records_parsed: 1234,
  weekly_sales: 48000,
  weekly_transactions: 3100,
  suggested_demand_matrix: fromPos(),
};

function stubUpload(response: { ok: boolean; status?: number; body: unknown }) {
  vi.stubGlobal(
    'fetch',
    vi.fn(async () => ({
      ok: response.ok,
      status: response.status ?? 200,
      json: async () => response.body,
    }))
  );
}

/** Picks a CSV in the file input and presses the read button. */
async function uploadAFile() {
  const input = screen.getByLabelText('POS export CSV file') as HTMLInputElement;
  const file = new File(['amount,day_of_week,hour_of_day\n10,Mon,12\n'], 'pos.csv', { type: 'text/csv' });
  fireEvent.change(input, { target: { files: [file] } });
  fireEvent.click(screen.getByRole('button', { name: /Read the file/ }));
}

beforeEach(() => {
  stubUpload({ ok: true, body: uploadResponse });
});

describe('a POS upload is previewed, not applied', () => {
  it('shows both tables and changes nothing until the user confirms', async () => {
    const onDemandUpdated = vi.fn();
    render(
      <POSIntegrationView
        facilityId="FAC-OMAHA-01"
        currentDemandMatrix={handBuilt()}
        onDemandUpdated={onDemandUpdated}
      />
    );

    await uploadAFile();
    await waitFor(() => expect(screen.getByText(/What this POS file would change/)).toBeTruthy());

    // The hand-built table is untouched: the upload no longer hands it straight over.
    expect(onDemandUpdated).not.toHaveBeenCalled();

    // Both weekly totals are on screen: 2*168 + 7 = 343 now, 4*168 = 672 from the file.
    expect(screen.getByText('343')).toBeTruthy();
    expect(screen.getByText('672')).toBeTruthy();
    expect(screen.getByText('+329')).toBeTruthy();
  });

  it('applies the POS table only on confirmation, and keeps one undo', async () => {
    const onDemandUpdated = vi.fn();
    const original = handBuilt();
    render(
      <POSIntegrationView
        facilityId="FAC-OMAHA-01"
        currentDemandMatrix={original}
        onDemandUpdated={onDemandUpdated}
      />
    );

    await uploadAFile();
    await waitFor(() => expect(screen.getByRole('button', { name: /Use the POS table/ })).toBeTruthy());

    fireEvent.click(screen.getByRole('button', { name: /Use the POS table/ }));
    expect(onDemandUpdated).toHaveBeenCalledTimes(1);
    expect(onDemandUpdated.mock.calls[0][0]).toEqual(fromPos());

    // One undo puts the manager's own table back, cell for cell.
    fireEvent.click(screen.getByRole('button', { name: /Undo/ }));
    expect(onDemandUpdated).toHaveBeenCalledTimes(2);
    expect(onDemandUpdated.mock.calls[1][0]).toEqual(original);
    expect(onDemandUpdated.mock.calls[1][0][0][12]).toBe(9);

    // One undo only: the offer is gone afterwards.
    expect(screen.queryByRole('button', { name: /Undo/ })).toBeNull();
  });

  it('discards the preview without touching the table when the user keeps theirs', async () => {
    const onDemandUpdated = vi.fn();
    render(
      <POSIntegrationView
        facilityId="FAC-OMAHA-01"
        currentDemandMatrix={handBuilt()}
        onDemandUpdated={onDemandUpdated}
      />
    );

    await uploadAFile();
    await waitFor(() => expect(screen.getByRole('button', { name: 'Keep my table' })).toBeTruthy());

    fireEvent.click(screen.getByRole('button', { name: 'Keep my table' }));
    expect(onDemandUpdated).not.toHaveBeenCalled();
    expect(screen.queryByText(/What this POS file would change/)).toBeNull();
  });
});

describe('a rejected POS file', () => {
  it('names the row the server rejected instead of a generic failure', async () => {
    stubUpload({
      ok: false,
      status: 422,
      body: { detail: "POS CSV row 7 is invalid: amount '$abc' is not a number Nothing was saved." },
    });
    const onDemandUpdated = vi.fn();
    render(
      <POSIntegrationView
        facilityId="FAC-OMAHA-01"
        currentDemandMatrix={handBuilt()}
        onDemandUpdated={onDemandUpdated}
      />
    );

    await uploadAFile();
    await waitFor(() => expect(screen.getByRole('alert')).toBeTruthy());

    const alert = screen.getByRole('alert');
    expect(alert.textContent).toContain('row 7');
    expect(alert.textContent).toContain("amount '$abc' is not a number");
    expect(alert.textContent).toContain('not changed');
    expect(onDemandUpdated).not.toHaveBeenCalled();
  });

  it('refuses to compare a derived table that is not a full 7x24 grid', async () => {
    stubUpload({
      ok: true,
      body: { ...uploadResponse, suggested_demand_matrix: [[1, 2, 3]] },
    });
    const onDemandUpdated = vi.fn();
    render(
      <POSIntegrationView
        facilityId="FAC-OMAHA-01"
        currentDemandMatrix={handBuilt()}
        onDemandUpdated={onDemandUpdated}
      />
    );

    await uploadAFile();
    await waitFor(() => expect(screen.getByRole('alert')).toBeTruthy());

    expect(screen.getByRole('alert').textContent).toContain('Nothing was changed');
    expect(screen.queryByRole('button', { name: /Use the POS table/ })).toBeNull();
    expect(onDemandUpdated).not.toHaveBeenCalled();
  });
});
