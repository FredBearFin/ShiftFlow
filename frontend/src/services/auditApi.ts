/**
 * Client for the roster audit routes (POST /api/v1/schedules/audit and friends).
 * Kept apart from api.ts, which is frozen. Types mirror backend/app/audit_schemas.py.
 */

import type { SolveRequest } from '../types';

export type AuditShiftKind = 'day' | 'evening' | 'night' | 'other';
export type AuditSeverity = 'flag' | 'info';

export interface AuditShiftDef {
  code: string;
  name: string;
  start_minute: number;
  duration_minutes: number;
  kind: AuditShiftKind;
}

export interface AuditLine {
  label: string;
  cells: string[];
}

export interface AuditThresholds {
  min_rest_hours: number;
  max_consecutive_work_days: number;
  max_consecutive_nights: number;
  long_shift_hours: number;
  max_consecutive_long_shifts: number;
  max_hours_any_7_days: number;
  reference_avg_weekly_hours: number;
}

export const DEFAULT_AUDIT_THRESHOLDS: AuditThresholds = {
  min_rest_hours: 11,
  max_consecutive_work_days: 6,
  max_consecutive_nights: 4,
  long_shift_hours: 10,
  max_consecutive_long_shifts: 4,
  max_hours_any_7_days: 60,
  reference_avg_weekly_hours: 48,
};

export interface AuditRequest {
  cycle_days: number;
  start_weekday: number;
  shifts: AuditShiftDef[];
  lines: AuditLine[];
  thresholds: AuditThresholds;
  demand_matrix?: number[][] | null;
}

export interface AuditFinding {
  rule_id: string;
  severity: AuditSeverity;
  line_label: string | null;
  day_index: number | null;
  value: number;
  threshold: number | null;
  message: string;
}

export interface AuditLineMetrics {
  label: string;
  shifts_per_cycle: number;
  avg_weekly_hours: number;
  min_rest_hours: number | null;
  longest_work_run_days: number;
  longest_night_run: number;
  longest_long_shift_run: number;
  max_hours_in_7_days: number;
  isolated_single_nights: number;
  isolated_single_rest_days: number;
  backward_rotation_events: number;
  weekends_fully_off_pct: number;
  nights_per_cycle: number;
  weekend_shifts_per_cycle: number;
}

export interface AuditWorstCell {
  day_index: number;
  weekday: number;
  hour: number;
  required: number;
  scheduled: number;
}

export interface AuditCoverage {
  super_period_days: number;
  understaffed_hours_per_week: number;
  overstaffed_hours_per_week: number;
  worst_cells: AuditWorstCell[];
}

export interface AuditSummary {
  flag_count: number;
  info_count: number;
  flags_by_rule: Record<string, number>;
  info_by_rule: Record<string, number>;
  overall_min_rest_hours: number | null;
  overall_longest_work_run_days: number;
  overall_max_hours_in_7_days: number;
  nights_stdev: number;
  weekend_shifts_stdev: number;
}

export interface AuditResponse {
  findings: AuditFinding[];
  lines: AuditLineMetrics[];
  coverage: AuditCoverage | null;
  summary: AuditSummary;
  thresholds_used: AuditThresholds;
  engine_version: string;
  disclaimer: string;
}

export interface PatternListItem {
  pattern_id: string;
  name: string;
  description: string;
  cycle_days: number;
}

export interface CompareResponse {
  generated: AuditResponse;
  existing: AuditResponse;
  notes: string[];
}

/** A readable message from a FastAPI error body: a plain string, or a list of validation errors. */
export function readableDetail(detail: unknown): string | undefined {
  if (typeof detail === 'string' && detail.trim()) return detail;
  if (Array.isArray(detail)) {
    const parts = detail
      .map((item) => {
        const msg = (item as { msg?: unknown } | null)?.msg;
        return typeof msg === 'string' ? msg.replace(/^Value error, /, '') : '';
      })
      .filter((s) => s.length > 0);
    if (parts.length > 0) return parts.join(' ');
  }
  return undefined;
}

async function request<T>(url: string, init?: RequestInit): Promise<T> {
  let res: Response;
  try {
    res = await fetch(url, init);
  } catch (err) {
    throw new Error(
      `The audit service could not be reached: ${err instanceof Error ? err.message : String(err)}`
    );
  }
  if (!res.ok) {
    let detail: string | undefined;
    try {
      detail = readableDetail((await res.json())?.detail);
    } catch {
      // Body is not JSON; fall back to the plain message below.
    }
    throw new Error(detail ?? `The audit service returned an error (HTTP ${res.status}).`);
  }
  return (await res.json()) as T;
}

function postJson<T>(url: string, body: unknown): Promise<T> {
  return request<T>(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
}

export function postAudit(req: AuditRequest): Promise<AuditResponse> {
  return postJson<AuditResponse>('/api/v1/schedules/audit', req);
}

export function listPatterns(): Promise<PatternListItem[]> {
  return request<PatternListItem[]>('/api/v1/schedules/audit/patterns');
}

export function getPattern(id: string): Promise<AuditRequest> {
  return request<AuditRequest>(`/api/v1/schedules/audit/patterns/${encodeURIComponent(id)}`);
}

export function postCompare(body: {
  solve_request: SolveRequest;
  audit_request: AuditRequest;
}): Promise<CompareResponse> {
  return postJson<CompareResponse>('/api/v1/schedules/audit/compare', body);
}
