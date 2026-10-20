import React, { useState } from 'react';
import { DAYS_OF_WEEK } from '../services/api';
import { Term } from './ui/Term';

interface POSIntegrationViewProps {
  onDemandUpdated?: (newDemand: number[][]) => void;
}

export const POSIntegrationView: React.FC<POSIntegrationViewProps> = ({
  onDemandUpdated,
}) => {
  const [selectedPOS, setSelectedPOS] = useState<'square' | 'clover' | 'toast'>('square');
  const [isUploading, setIsUploading] = useState(false);
  const [uploadStatus, setUploadStatus] = useState<React.ReactNode>(null);
  const [salesSummary, setSalesSummary] = useState<{
    weekly_sales: number;
    weekly_transactions: number;
    peak_day: string;
    peak_hour: string;
  }>({
    weekly_sales: 38450.0,
    weekly_transactions: 1420,
    peak_day: 'Friday',
    peak_hour: '18:00',
  });

  const handleSimulatedUpload = () => {
    setIsUploading(true);
    setTimeout(() => {
      setIsUploading(false);
      setUploadStatus(<>Successfully synced POS hourly demand. Demand matrix <Term explanation="How many people you need in each hour.">R_gi</Term> updated.</>);
      setSalesSummary({
        weekly_sales: 42180.5,
        weekly_transactions: 1580,
        peak_day: 'Saturday',
        peak_hour: '19:00',
      });
      if (onDemandUpdated) {
        // Generate realistic 7x24 demand from POS
        const newDemand = Array.from({ length: 7 }, (_, g) =>
          Array.from({ length: 24 }, (__, hr) =>
            hr < 6 ? 0 : g < 4 ? (hr < 11 ? 3 : hr < 19 ? 4 : 3) : hr < 11 ? 4 : hr < 20 ? 5 : 4
          )
        );
        onDemandUpdated(newDemand);
      }
    }, 800);
  };

  return (
    <div className="space-y-5">
      {/* Overview Card */}
      <div className="enterprise-card p-5 bg-white flex flex-wrap items-center justify-between gap-4">
        <div>
          <span className="text-[11px] font-bold uppercase tracking-wider text-indigo-700 block">
            Point-of-Sale Integration
          </span>
          <h2 className="text-base font-bold text-slate-900 mt-0.5">
            Auto-Calibrate Register Demand from Real Sales Velocity
          </h2>
          <p className="text-xs text-slate-500 mt-0.5">
            Connect Square, Clover, or Toast POS transaction receipts to continuously adjust staffing requirements $<Term explanation="How many people you need in each hour.">R_{'{gi}'}</Term>$.
          </p>
        </div>

        <div className="flex items-center gap-2">
          {(['square', 'clover', 'toast'] as const).map((pos) => (
            <button type="button"
              key={pos}
              onClick={() => setSelectedPOS(pos)}
              className={`px-3 py-1.5 rounded-lg border text-xs font-semibold capitalize ${
                selectedPOS === pos
                  ? 'bg-indigo-50 text-indigo-700 border-indigo-200'
                  : 'bg-white text-slate-600 border-slate-200'
              }`}
            >
              {pos} POS
            </button>
          ))}
        </div>
      </div>

      {/* POS Metrics Banner */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3.5">
        <div className="enterprise-card p-4">
          <span className="text-[11px] font-semibold uppercase tracking-wider text-slate-500 block">
            Weekly Sales Volume
          </span>
          <div className="flex items-baseline justify-between mt-1">
            <span className="text-2xl font-bold font-mono-tabular text-slate-900">
              ${salesSummary.weekly_sales.toLocaleString('en-US', { minimumFractionDigits: 2 })}
            </span>
          </div>
          <p className="text-[11px] text-slate-500 mt-1">Ingested from {selectedPOS.toUpperCase()}</p>
        </div>

        <div className="enterprise-card p-4">
          <span className="text-[11px] font-semibold uppercase tracking-wider text-slate-500 block">
            Transaction Count
          </span>
          <div className="flex items-baseline justify-between mt-1">
            <span className="text-2xl font-bold font-mono-tabular text-slate-900">
              {salesSummary.weekly_transactions.toLocaleString()}
            </span>
            <span className="text-xs font-mono-tabular text-slate-500">Receipts</span>
          </div>
          <p className="text-[11px] text-slate-500 mt-1">~202 tx / day</p>
        </div>

        <div className="enterprise-card p-4">
          <span className="text-[11px] font-semibold uppercase tracking-wider text-slate-500 block">
            Peak Demand Rush
          </span>
          <div className="flex items-baseline justify-between mt-1">
            <span className="text-2xl font-bold text-slate-900">
              {salesSummary.peak_day}
            </span>
            <span className="text-xs font-mono-tabular text-indigo-700 font-bold">
              {salesSummary.peak_hour}
            </span>
          </div>
          <p className="text-[11px] text-slate-500 mt-1">Demands 5 active registers</p>
        </div>

        <div className="enterprise-card p-4">
          <span className="text-[11px] font-semibold uppercase tracking-wider text-slate-500 block">
            Sync Health
          </span>
          <div className="flex items-baseline justify-between mt-1">
            <span className="text-2xl font-bold font-mono-tabular text-emerald-700">Live</span>
            <span className="w-2.5 h-2.5 rounded-full bg-emerald-500 animate-pulse"></span>
          </div>
          <p className="text-[11px] text-slate-500 mt-1">Webhook listener active</p>
        </div>
      </div>

      {/* Upload & Webhook Config Card */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-5">
        <div className="enterprise-card p-5 space-y-4">
          <h3 className="text-xs font-bold uppercase tracking-wider text-slate-700">
            Upload POS Export CSV
          </h3>
          <p className="text-xs text-slate-500">
            Export hourly sales from your {selectedPOS.toUpperCase()} dashboard and drop the CSV here to recalculate floor demand.
          </p>

          <div className="border-2 border-dashed border-slate-300 rounded-xl p-8 text-center bg-slate-50/50 hover:bg-slate-50 transition-colors">
            <div className="w-12 h-12 rounded-full bg-indigo-50 text-indigo-600 flex items-center justify-center mx-auto mb-3 font-bold text-lg">
              ↑
            </div>
            <p className="text-xs font-semibold text-slate-700">
              Drag & Drop your POS export CSV here
            </p>
            <p className="text-[11px] text-slate-400 mt-1">Supports Square, Clover, Toast standard CSV exports</p>

            <button type="button"
              onClick={handleSimulatedUpload}
              disabled={isUploading}
              className="mt-4 px-4 py-2 bg-indigo-600 hover:bg-indigo-700 text-white rounded-lg text-xs font-bold shadow-xs disabled:opacity-50"
            >
              {isUploading ? 'Parsing & Recalibrating Demand...' : 'Upload & Recalibrate Demand Matrix'}
            </button>
          </div>

          {uploadStatus && (
            <div className="p-3 bg-emerald-50 border border-emerald-200 rounded-lg text-xs text-emerald-800 font-semibold flex items-center gap-2">
              <span className="w-2 h-2 rounded-full bg-emerald-600"></span>
              {uploadStatus}
            </div>
          )}
        </div>

        {/* Real-time Webhook Configuration */}
        <div className="enterprise-card p-5 space-y-4">
          <h3 className="text-xs font-bold uppercase tracking-wider text-slate-700">
            Real-Time POS Webhook URL
          </h3>
          <p className="text-xs text-slate-500">
            Configure this webhook endpoint in your {selectedPOS.toUpperCase()} developer portal to stream transactions automatically.
          </p>

          <div className="space-y-3 font-mono-tabular text-xs">
            <div>
              <label className="block text-[11px] text-slate-500 font-sans font-semibold mb-1">
                Webhook Ingestion Endpoint:
              </label>
              <div className="p-2.5 bg-slate-900 text-slate-100 rounded-lg select-all">
                https://api.shiftflowstudio.com/api/v1/pos/webhook/{selectedPOS}
              </div>
            </div>

            <div>
              <label className="block text-[11px] text-slate-500 font-sans font-semibold mb-1">
                Store Secret Token:
              </label>
              <div className="p-2.5 bg-slate-100 text-slate-800 rounded-lg border border-slate-300 select-all">
                sf_live_tok_99a8b7c6d5e4f3a2b1
              </div>
            </div>
          </div>

          <div className="pt-3 border-t border-slate-100">
            <span className="text-[11px] text-slate-500 block">
              Hourly transactions are grouped and converted into target staffing:
              <br />
              • $220 net sales / hour = 1 register clerk
              • Minimum 1 clerk during open store hours (6am – 12am)
            </span>
          </div>
        </div>
      </div>
    </div>
  );
};
