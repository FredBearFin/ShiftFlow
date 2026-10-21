import React, { useState } from 'react';
import { uploadPosCsvApi, PosUploadResult } from '../services/api';
import { Term } from './ui/Term';
import { formatCurrency } from '../utils/format';

interface POSIntegrationViewProps {
  facilityId: string;
  onDemandUpdated?: (newDemand: number[][]) => void;
}

export const POSIntegrationView: React.FC<POSIntegrationViewProps> = ({
  facilityId,
  onDemandUpdated,
}) => {
  const [file, setFile] = useState<File | null>(null);
  const [isUploading, setIsUploading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<PosUploadResult | null>(null);
  const [openHour, setOpenHour] = useState<number>(6);
  const [closeHour, setCloseHour] = useState<number>(24);

  const handleUpload = async () => {
    if (!file) return;
    setIsUploading(true);
    setError(null);
    try {
      const summary = await uploadPosCsvApi(facilityId, file, openHour, closeHour);
      setResult(summary);
      onDemandUpdated?.(summary.suggested_demand_matrix);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'The POS file could not be uploaded.');
    } finally {
      setIsUploading(false);
    }
  };

  return (
    <div className="space-y-5">
      <div className="enterprise-card p-5 bg-white">
        <span className="text-xs font-bold uppercase tracking-wider text-[#5C6770] block">
          Point-of-Sale Integration
        </span>
        <h2 className="type-section-title text-slate-900 mt-0.5">
          Recalculate Register Demand from a POS Export
        </h2>
        <p className="type-prose text-slate-500 mt-0.5">
          Upload a transaction CSV to recalculate the hourly <Term explanation="How many people you need in each hour.">staff-needed</Term> table.
        </p>
      </div>

      <div className="enterprise-card p-4">
        <span className="text-xs font-semibold text-slate-700">
          {result
            ? `Last upload: ${result.records_parsed.toLocaleString()} transactions read from the file.`
            : 'Not connected: no POS data has been uploaded yet.'}
        </span>
      </div>

      <div className="enterprise-card p-5 space-y-4">
        <h3 className="type-subsection-title text-slate-700">
          Upload POS Export CSV
        </h3>
        <p className="type-prose text-slate-500">
          The file needs columns for the amount, day of week and hour of day. The server reads the rows and rebuilds the demand table for this facility.
        </p>

        <input
          type="file"
          accept=".csv,text/csv"
          aria-label="POS export CSV file"
          onChange={(e) => {
            setFile(e.target.files?.[0] ?? null);
            setResult(null);
            setError(null);
          }}
          className="text-xs"
        />

        <div className="grid grid-cols-2 gap-3">
          <div className="space-y-1">
            <label htmlFor="pos-open-hour" className="block text-xs font-semibold text-slate-700">
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
              className="w-full px-2 py-1.5 border border-slate-300 rounded-lg text-xs"
            />
          </div>
          <div className="space-y-1">
            <label htmlFor="pos-close-hour" className="block text-xs font-semibold text-slate-700">
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
              className="w-full px-2 py-1.5 border border-slate-300 rounded-lg text-xs"
            />
          </div>
        </div>

        <div>
          <button
            type="button"
            onClick={handleUpload}
            disabled={!file || isUploading}
            className="px-4 py-2 bg-[#4A6B5D] hover:bg-[#3E5C50] text-[#FFFFFF] rounded-lg text-xs font-bold shadow-[0_1px_2px_rgba(43,58,66,0.08)] disabled:opacity-50"
          >
            {isUploading ? 'Uploading and recalculating...' : 'Upload and recalculate demand'}
          </button>
        </div>

        {error && (
          <div role="alert" className="p-3 bg-red-50 border border-red-200 rounded-lg text-xs text-red-800 font-semibold">
            {error}
          </div>
        )}

        {result && (
          <div className="p-3 bg-[#FFFFFF] border border-[#7F8A92] rounded-lg text-xs text-[#2B3A42] font-semibold space-y-1">
            <div>Weekly sales in file: {formatCurrency(result.weekly_sales)}</div>
            <div>Weekly transactions in file: {result.weekly_transactions.toLocaleString()}</div>
            <div>The demand table for this facility has been updated.</div>
          </div>
        )}
      </div>
    </div>
  );
};
