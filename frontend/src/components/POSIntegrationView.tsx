import React, { useState } from 'react';
import { uploadPosCsvApi, PosUploadResult, DAYS_OF_WEEK } from '../services/api';
import { Term } from './ui/Term';
import { Button } from './ui/Button';
import { formatCurrency } from '../utils/format';

interface POSIntegrationViewProps {
  facilityId: string;
  /**
   * The staffing table a POS import would replace. Shown beside the derived one so the
   * manager can see what changes before anything is overwritten.
   */
  currentDemandMatrix?: number[][];
  onDemandUpdated?: (newDemand: number[][]) => void;
}

const weekTotal = (matrix: number[][]): number =>
  matrix.reduce((acc, row) => acc + row.reduce((a, b) => a + b, 0), 0);

const dayTotal = (matrix: number[][], day: number): number =>
  (matrix[day] ?? []).reduce((a, b) => a + b, 0);

/** A 7x24 grid of counts is the only thing that can stand in for a staffing table. */
const isUsableMatrix = (matrix: unknown): matrix is number[][] =>
  Array.isArray(matrix) &&
  matrix.length === 7 &&
  matrix.every(
    (row) =>
      Array.isArray(row) &&
      row.length === 24 &&
      row.every((cell) => typeof cell === 'number' && Number.isFinite(cell))
  );

const formatDelta = (delta: number): string =>
  delta === 0 ? 'no change' : delta > 0 ? `+${delta}` : String(delta);

export const POSIntegrationView: React.FC<POSIntegrationViewProps> = ({
  facilityId,
  currentDemandMatrix,
  onDemandUpdated,
}) => {
  const [file, setFile] = useState<File | null>(null);
  const [isUploading, setIsUploading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<PosUploadResult | null>(null);
  const [openHour, setOpenHour] = useState<number>(6);
  const [closeHour, setCloseHour] = useState<number>(24);
  // A POS import used to replace a hand-built staffing table the moment the upload
  // returned, with no preview and no way back. It is now previewed, confirmed, and
  // kept undoable once.
  const [applied, setApplied] = useState(false);
  const [undoMatrix, setUndoMatrix] = useState<number[][] | null>(null);
  const [selectedDay, setSelectedDay] = useState<number>(0);

  const suggested = result?.suggested_demand_matrix;
  const canCompare = isUsableMatrix(suggested) && isUsableMatrix(currentDemandMatrix);

  const handleUpload = async () => {
    if (!file) return;
    setIsUploading(true);
    setError(null);
    try {
      const summary = await uploadPosCsvApi(facilityId, file, openHour, closeHour);
      // Deliberately does NOT call onDemandUpdated: the manager confirms first.
      setResult(summary);
      setApplied(false);
      setUndoMatrix(null);
    } catch (err) {
      // The server names the exact row it rejected. Show that, not a generic failure.
      setError(
        err instanceof Error && err.message.trim()
          ? err.message
          : 'The POS file could not be uploaded.'
      );
      setResult(null);
    } finally {
      setIsUploading(false);
    }
  };

  const applyPreview = () => {
    if (!isUsableMatrix(suggested) || !onDemandUpdated) return;
    if (isUsableMatrix(currentDemandMatrix)) {
      setUndoMatrix(currentDemandMatrix.map((row) => [...row]));
    }
    onDemandUpdated(suggested.map((row) => [...row]));
    setApplied(true);
  };

  const undoApply = () => {
    if (!undoMatrix || !onDemandUpdated) return;
    onDemandUpdated(undoMatrix.map((row) => [...row]));
    // One undo, as promised. Going back again would need another upload.
    setUndoMatrix(null);
    setApplied(false);
  };

  const discardPreview = () => {
    setResult(null);
    setApplied(false);
    setUndoMatrix(null);
  };

  return (
    <div className="space-y-5">
      <div className="enterprise-card p-5 bg-white">
        <span className="text-xs font-bold uppercase tracking-wider text-muted block">
          Point-of-Sale Integration
        </span>
        <h2 className="type-section-title text-ink mt-0.5">
          Recalculate Register Demand from a POS Export
        </h2>
        <p className="type-prose text-muted mt-0.5">
          Upload a transaction CSV to work out an hourly{' '}
          <Term explanation="How many people you need in each hour.">staff-needed</Term> table
          from your sales. You see it next to your current table and decide whether to use it.
        </p>
      </div>

      <div className="enterprise-card p-4">
        <span className="text-xs font-semibold text-ink-soft">
          {result
            ? `Last upload: ${result.records_parsed.toLocaleString()} transactions read from the file.`
            : 'Not connected: no POS data has been uploaded yet.'}
        </span>
      </div>

      <div className="enterprise-card p-5 space-y-4">
        <h3 className="type-subsection-title text-ink-soft">
          Upload POS Export CSV
        </h3>
        <p className="type-prose text-muted">
          The file needs columns for the amount, day of week and hour of day. Nothing in your
          staffing table changes until you choose to use the result.
        </p>

        {/* The aria-label was the only label: nothing on screen named this
            field. CONSTITUTION 7 asks for a visible one. */}
        <label htmlFor="pos-csv-file" className="block text-xs font-semibold text-ink-soft">
          POS export CSV file
        </label>
        <input
          id="pos-csv-file"
          type="file"
          accept=".csv,text/csv"
          onChange={(e) => {
            setFile(e.target.files?.[0] ?? null);
            setResult(null);
            setError(null);
            setApplied(false);
            setUndoMatrix(null);
          }}
          className="text-xs"
        />

        <div className="grid grid-cols-2 gap-3">
          <div className="space-y-1">
            <label htmlFor="pos-open-hour" className="block text-xs font-semibold text-ink-soft">
              Opening hour (0-23)
            </label>
            <input
              id="pos-open-hour"
              type="number"
              min={0}
              max={23}
              step={1}
              value={openHour}
              onChange={(e) => setOpenHour(Number(e.target.value))}
              className="w-full px-2 py-1.5 border border-border rounded-lg text-xs"
            />
          </div>
          <div className="space-y-1">
            <label htmlFor="pos-close-hour" className="block text-xs font-semibold text-ink-soft">
              Closing hour (1-24)
            </label>
            <input
              id="pos-close-hour"
              type="number"
              min={1}
              max={24}
              step={1}
              value={closeHour}
              onChange={(e) => setCloseHour(Number(e.target.value))}
              className="w-full px-2 py-1.5 border border-border rounded-lg text-xs"
            />
          </div>
        </div>

        <div>
          <button
            type="button"
            onClick={handleUpload}
            disabled={!file || isUploading}
            className="px-4 py-2 bg-accent hover:bg-accent-strong text-card rounded-lg text-xs font-bold shadow-[0_1px_2px_rgba(43,58,66,0.08)] disabled:opacity-50"
          >
            {isUploading ? 'Reading the file...' : 'Read the file and show me the result'}
          </button>
        </div>

        {error && (
          <div role="alert" className="p-3 bg-red-50 border border-red-200 rounded-lg text-xs text-red-800 space-y-1">
            <p className="font-semibold">{error}</p>
            <p>Your staffing table was not changed.</p>
          </div>
        )}

        {result && (
          <div role="status" aria-live="polite" className="p-3 bg-card border border-border-control rounded-lg text-xs text-ink font-semibold space-y-1">
            <div>Weekly sales in file: {formatCurrency(result.weekly_sales)}</div>
            <div>Weekly transactions in file: {result.weekly_transactions.toLocaleString()}</div>
          </div>
        )}
      </div>

      {result && !canCompare && (
        <div role="alert" className="enterprise-card p-5 text-xs text-red-800 bg-red-50 border border-red-200">
          <p className="font-semibold">
            The staffing table worked out from this file is not a full 7-day, 24-hour table, so
            it cannot be compared with yours.
          </p>
          <p className="mt-1">Nothing was changed. Try the upload again, or edit the table by hand in setup.</p>
        </div>
      )}

      {result && canCompare && isUsableMatrix(suggested) && isUsableMatrix(currentDemandMatrix) && (
        <div className="enterprise-card p-5 space-y-4">
          <div className="pb-3 border-b border-border-subtle">
            <h3 className="text-xs font-bold uppercase tracking-wider text-ink-soft">
              {applied ? 'What the POS file changed' : 'What this POS file would change'}
            </h3>
            <p className="text-xs text-ink-soft mt-1">
              {applied
                ? 'Your staffing table now comes from this file. You can put back the table you had before.'
                : 'Your current staffing table is on the left, the one worked out from this file on the right. Nothing has changed yet.'}
            </p>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
            <div className="p-3 rounded-lg bg-surface-subtle border border-border-control">
              <span className="text-xs font-semibold uppercase tracking-wider text-muted block">
                Your table now
              </span>
              <span className="text-xl font-bold font-mono-tabular text-ink">
                {weekTotal(currentDemandMatrix)}
              </span>
              <span className="text-xs text-muted block">person-hours a week</span>
            </div>
            <div className="p-3 rounded-lg bg-surface-subtle border border-border-control">
              <span className="text-xs font-semibold uppercase tracking-wider text-muted block">
                From this POS file
              </span>
              <span className="text-xl font-bold font-mono-tabular text-ink">
                {weekTotal(suggested)}
              </span>
              <span className="text-xs text-muted block">person-hours a week</span>
            </div>
            <div className="p-3 rounded-lg bg-surface-subtle border border-border-control">
              <span className="text-xs font-semibold uppercase tracking-wider text-muted block">
                Change
              </span>
              <span className="text-xl font-bold font-mono-tabular text-ink">
                {formatDelta(weekTotal(suggested) - weekTotal(currentDemandMatrix))}
              </span>
              <span className="text-xs text-muted block">person-hours a week</span>
            </div>
          </div>

          <div className="overflow-x-auto">
            <table className="w-full text-left border-collapse text-xs">
              <caption className="sr-only">
                Person-hours a day in your current staffing table and in the one worked out from
                this POS file
              </caption>
              <thead>
                <tr className="bg-surface-subtle border-b border-border-subtle text-xs font-bold uppercase tracking-wider text-muted">
                  <th scope="col" className="py-2 px-3">Day</th>
                  <th scope="col" className="py-2 px-3 text-right">Your table now</th>
                  <th scope="col" className="py-2 px-3 text-right">From this POS file</th>
                  <th scope="col" className="py-2 px-3 text-right">Change</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border-subtle font-mono-tabular">
                {DAYS_OF_WEEK.map((dayName, idx) => {
                  const now = dayTotal(currentDemandMatrix, idx);
                  const next = dayTotal(suggested, idx);
                  return (
                    <tr key={dayName} className={selectedDay === idx ? 'bg-surface-subtle' : undefined}>
                      <th scope="row" className="py-2 px-3 font-sans font-semibold text-ink">
                        <button
                          type="button"
                          aria-pressed={selectedDay === idx}
                          onClick={() => setSelectedDay(idx)}
                          className="underline underline-offset-2 hover:text-indigo-700"
                        >
                          {dayName}
                        </button>
                      </th>
                      <td className="py-2 px-3 text-right text-ink-soft">{now}</td>
                      <td className="py-2 px-3 text-right text-ink font-bold">{next}</td>
                      <td className="py-2 px-3 text-right text-ink-soft">{formatDelta(next - now)}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>

          <div className="p-3 rounded-lg bg-surface-subtle border border-border-subtle">
            <span className="text-xs font-bold uppercase tracking-wider text-ink-soft block mb-2">
              {DAYS_OF_WEEK[selectedDay]}, hour by hour — now, then from this file
            </span>
            <div className="grid grid-cols-4 sm:grid-cols-6 md:grid-cols-12 gap-2">
              {Array.from({ length: 24 }, (_, hr) => {
                const now = currentDemandMatrix[selectedDay][hr];
                const next = suggested[selectedDay][hr];
                return (
                  <div
                    key={hr}
                    className={`p-1.5 rounded border text-center ${
                      now === next ? 'bg-white border-border-subtle' : 'bg-amber-50 border-amber-300'
                    }`}
                  >
                    <span className="block text-[9px] font-mono-tabular text-muted">
                      {String(hr).padStart(2, '0')}:00
                    </span>
                    <span className="block text-xs font-mono-tabular font-bold text-ink">
                      {now} → {next}
                    </span>
                  </div>
                );
              })}
            </div>
          </div>

          <div className="flex flex-wrap items-center gap-2 pt-1">
            {!applied && (
              <>
                <Button variant="primary" onClick={applyPreview} disabled={!onDemandUpdated}>
                  Use the POS table instead of mine
                </Button>
                <Button variant="secondary" onClick={discardPreview}>
                  Keep my table
                </Button>
              </>
            )}
            {applied && (
              <>
                <span role="status" className="text-xs font-semibold text-ink-soft">
                  Your staffing table was replaced with the one from this file.
                </span>
                {undoMatrix && (
                  <Button variant="secondary" onClick={undoApply}>
                    Undo — put my table back
                  </Button>
                )}
              </>
            )}
          </div>
        </div>
      )}
    </div>
  );
};
