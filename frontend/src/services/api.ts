/**
 * API client for the ShiftFlow Studio backend.
 * Connects to the FastAPI backend (/api/v1/...) when running via Docker Compose.
 */

import {
  ArchetypePreset,
  ErgonomicGuardrails,
  SeparationCategory,
  ShiftTemplate,
  SolveRequest,
  SolveResponse,
} from '../types';

export const DAYS_OF_WEEK = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];

function build24x7Demand(
  nightLvl: number,
  morningLvl: number,
  dayLvl: number,
  eveLvl: number,
  wkndDelta = -1
): number[][] {
  const matrix: number[][] = [];
  for (let g = 0; g < 7; g++) {
    const isWknd = g >= 5;
    const delta = isWknd ? wkndDelta : 0;
    const row: number[] = [];
    for (let hr = 0; hr < 24; hr++) {
      let val = nightLvl;
      if (hr >= 6 && hr < 14) val = Math.max(1, morningLvl + delta);
      else if (hr >= 14 && hr < 22) val = Math.max(1, eveLvl + delta);
      else val = Math.max(1, nightLvl);
      if (hr >= 10 && hr < 14 && dayLvl > morningLvl) {
        val = Math.max(val, dayLvl + delta);
      }
      row.push(val);
    }
    matrix.push(row);
  }
  return matrix;
}

export const DEFAULT_ARCHETYPES: ArchetypePreset[] = [
  {
    id: 'downtown_foodmart_omaha',
    name: 'Sample retail store (fallback preset)',
    sector: 'Urban Retail & Convenience',
    tagline: 'Urban retail and convenience',
    description:
      'Fallback preset used when the server cannot list presets. Opening (6a–2p), Midday Rush (11a–7p) and Closing (4p–12a) shifts form a continuous forward rotation.',
    operating_hours_label: '06:00–12:00 AM Daily (126 hrs/wk)',
    typical_crew_size: '6–8 Shift Patterns',
    default_leeway_pct: 10.0,
    demand_matrix: Array.from({ length: 7 }, (_, g) =>
      Array.from({ length: 24 }, (__, hr) =>
        hr < 6 ? 0 : g < 4 ? (hr < 11 ? 3 : hr < 19 ? 4 : 3) : hr < 11 ? 4 : hr < 20 ? 5 : 4
      )
    ),
    templates: [
      { code: 'M', name: 'Opening Shift — 6a-2p (M)', earliest_start: 6, latest_end: 15, min_duration: 7, max_duration: 9, preferred_start: 6, preferred_duration: 8, enabled: true },
      { code: 'D', name: 'Midday Rush — 11a-7p (D)', earliest_start: 10, latest_end: 20, min_duration: 7, max_duration: 9, preferred_start: 11, preferred_duration: 8, enabled: true },
      { code: 'E', name: 'Closing Shift — 4p-12a (E)', earliest_start: 15, latest_end: 24, min_duration: 7, max_duration: 9, preferred_start: 16, preferred_duration: 8, enabled: true },
      { code: 'N', name: 'Night Freight / Restock (N)', earliest_start: 22, latest_end: 31, min_duration: 7, max_duration: 9, preferred_start: 23, preferred_duration: 8, enabled: false },
    ],
    guardrails: {
      min_consecutive_work_days: 3,
      max_consecutive_work_days: 5,
      min_consecutive_rest_days: 2,
      max_consecutive_rest_days: 3,
      max_consecutive_nights: 2,
      max_consecutive_evenings: 3,
      enforce_forward_rotation: true,
      enforce_zero_clopening: true,
      avoid_single_rest_days: true,
      avoid_single_night_shifts: true,
      prioritize_free_weekends: true,
    },
  },
  {
    id: 'healthcare_24_7',
    name: '24/7 Acute Healthcare & ICU Nursing',
    sector: 'Healthcare',
    tagline: 'Patient-ratio compliant 24/7 clinical telemetry & acute care staffing',
    description: 'Continuous 24-hour hospital ward coverage with Morning, Mid, Evening, and Night templates.',
    operating_hours_label: '24/7 Continuous (168 hrs/wk)',
    typical_crew_size: '12–18 Shift Patterns',
    default_leeway_pct: 5.0,
    demand_matrix: build24x7Demand(2, 4, 5, 3, -1),
    templates: [
      { code: 'M', name: 'Morning Clinical (M)', earliest_start: 5, latest_end: 15, min_duration: 8, max_duration: 9, preferred_start: 6, preferred_duration: 8, enabled: true },
      { code: 'D', name: 'Day Rounds / Mid (D)', earliest_start: 8, latest_end: 19, min_duration: 8, max_duration: 9, preferred_start: 10, preferred_duration: 8, enabled: true },
      { code: 'E', name: 'Evening Charge (E)', earliest_start: 13, latest_end: 23, min_duration: 8, max_duration: 9, preferred_start: 14, preferred_duration: 8, enabled: true },
      { code: 'N', name: 'Night Telemetry (N)', earliest_start: 21, latest_end: 31, min_duration: 8, max_duration: 9, preferred_start: 22, preferred_duration: 8, enabled: true },
    ],
    guardrails: {
      min_consecutive_work_days: 3,
      max_consecutive_work_days: 5,
      min_consecutive_rest_days: 2,
      max_consecutive_rest_days: 3,
      max_consecutive_nights: 2,
      max_consecutive_evenings: 3,
      enforce_forward_rotation: true,
      enforce_zero_clopening: true,
      avoid_single_rest_days: true,
      avoid_single_night_shifts: true,
      prioritize_free_weekends: true,
    },
  },
  {
    id: 'manufacturing_24_7',
    name: 'Continuous Process & Semiconductor Manufacturing',
    sector: 'Manufacturing',
    tagline: '3-shift 24/7 plant line rotation with union-grade weekend equity',
    description: 'Continuous plant line operations with 3-shift 8-hour rotations.',
    operating_hours_label: '24/7 Three-Shift Plant (168 hrs/wk)',
    typical_crew_size: '14–20 Shift Patterns',
    default_leeway_pct: 5.0,
    demand_matrix: build24x7Demand(3, 4, 4, 4, -1),
    templates: [
      { code: 'M', name: 'Shift 1 — Early Line (M)', earliest_start: 5, latest_end: 15, min_duration: 8, max_duration: 9, preferred_start: 6, preferred_duration: 8, enabled: true },
      { code: 'D', name: 'Day Maintenance (D)', earliest_start: 8, latest_end: 18, min_duration: 8, max_duration: 9, preferred_start: 9, preferred_duration: 8, enabled: false },
      { code: 'E', name: 'Shift 2 — Swing Line (E)', earliest_start: 13, latest_end: 23, min_duration: 8, max_duration: 9, preferred_start: 14, preferred_duration: 8, enabled: true },
      { code: 'N', name: 'Shift 3 — Graveyard Line (N)', earliest_start: 21, latest_end: 31, min_duration: 8, max_duration: 9, preferred_start: 22, preferred_duration: 8, enabled: true },
    ],
    guardrails: {
      min_consecutive_work_days: 3,
      max_consecutive_work_days: 5,
      min_consecutive_rest_days: 2,
      max_consecutive_rest_days: 3,
      max_consecutive_nights: 2,
      max_consecutive_evenings: 3,
      enforce_forward_rotation: true,
      enforce_zero_clopening: true,
      avoid_single_rest_days: true,
      avoid_single_night_shifts: true,
      prioritize_free_weekends: true,
    },
  },
  {
    id: 'emergency_services',
    name: 'Emergency Dispatch, EMS & Public Safety',
    sector: 'Public Safety',
    tagline: 'High-vigilance 24/7 emergency response with strict fatigue caps',
    description: '24/7 mission critical public safety response with strict fatigue limits.',
    operating_hours_label: '24/7 Mission Critical (168 hrs/wk)',
    typical_crew_size: '10–16 Shift Patterns',
    default_leeway_pct: 5.0,
    demand_matrix: build24x7Demand(3, 3, 4, 4, 0),
    templates: [
      { code: 'M', name: 'Alpha Watch — Morning (M)', earliest_start: 6, latest_end: 15, min_duration: 8, max_duration: 9, preferred_start: 6, preferred_duration: 8, enabled: true },
      { code: 'D', name: 'Bravo Watch — Tactical Day (D)', earliest_start: 9, latest_end: 19, min_duration: 8, max_duration: 9, preferred_start: 10, preferred_duration: 8, enabled: true },
      { code: 'E', name: 'Charlie Watch — Evening (E)', earliest_start: 14, latest_end: 23, min_duration: 8, max_duration: 9, preferred_start: 14, preferred_duration: 8, enabled: true },
      { code: 'N', name: 'Delta Watch — Midnight (N)', earliest_start: 22, latest_end: 31, min_duration: 8, max_duration: 9, preferred_start: 22, preferred_duration: 8, enabled: true },
    ],
    guardrails: {
      min_consecutive_work_days: 3,
      max_consecutive_work_days: 4,
      min_consecutive_rest_days: 2,
      max_consecutive_rest_days: 3,
      max_consecutive_nights: 2,
      max_consecutive_evenings: 2,
      enforce_forward_rotation: true,
      enforce_zero_clopening: true,
      avoid_single_rest_days: true,
      avoid_single_night_shifts: true,
      prioritize_free_weekends: true,
    },
  },
  {
    id: 'custom',
    name: 'Custom Enterprise Workforce Topology',
    sector: 'Custom Operations',
    tagline: 'Fully customizable 24-hour interval demand matrix and shift templates',
    description: 'Configure bespoke operating windows and demand from scratch.',
    operating_hours_label: 'Configurable (Up to 168 hrs/wk)',
    typical_crew_size: 'Dynamic',
    default_leeway_pct: 5.0,
    demand_matrix: build24x7Demand(1, 3, 3, 2, -1),
    templates: [
      { code: 'M', name: 'Morning Shift (M)', earliest_start: 5, latest_end: 15, min_duration: 7, max_duration: 9, preferred_start: 6, preferred_duration: 8, enabled: true },
      { code: 'D', name: 'Day / Mid Shift (D)', earliest_start: 8, latest_end: 19, min_duration: 7, max_duration: 9, preferred_start: 10, preferred_duration: 8, enabled: true },
      { code: 'E', name: 'Evening Shift (E)', earliest_start: 13, latest_end: 23, min_duration: 7, max_duration: 9, preferred_start: 14, preferred_duration: 8, enabled: true },
      { code: 'N', name: 'Night Shift (N)', earliest_start: 21, latest_end: 31, min_duration: 7, max_duration: 9, preferred_start: 22, preferred_duration: 8, enabled: true },
    ],
    guardrails: {
      min_consecutive_work_days: 3,
      max_consecutive_work_days: 5,
      min_consecutive_rest_days: 2,
      max_consecutive_rest_days: 3,
      max_consecutive_nights: 2,
      max_consecutive_evenings: 3,
      enforce_forward_rotation: true,
      enforce_zero_clopening: true,
      avoid_single_rest_days: true,
      avoid_single_night_shifts: true,
      prioritize_free_weekends: true,
    },
  },
];

const DEFAULT_PRESET = DEFAULT_ARCHETYPES[0];
export const DEFAULT_TEMPLATES: ShiftTemplate[] = DEFAULT_PRESET.templates;
export const DEFAULT_GUARDRAILS: ErgonomicGuardrails = DEFAULT_PRESET.guardrails;

/** Serialises the weekly schedule grid (one row per shift pattern, one column per day). */
export function exportRosterToCsvString(solution: SolveResponse): string {
  const dayHeaders = DAYS_OF_WEEK.map((d) => `${d} Shift`);
  const header = ['Pattern', 'Pattern ID', 'Assigned Person', 'Qualification', 'Hourly Wage', 'Weekly Hours', 'Overtime Hours', 'Weekly Payroll', ...dayHeaders];
  const escape = (v: string | number | null) => {
    const s = v === null ? '' : String(v);
    return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
  };
  const rows = solution.roster_lines.map((line) => [
    line.line_number,
    line.cohort_id,
    line.assigned_person ?? '',
    line.qualification_tier,
    line.hourly_wage === null ? '' : line.hourly_wage.toFixed(2),
    line.weekly_hours,
    line.overtime_hours,
    line.estimated_weekly_payroll === null ? '' : line.estimated_weekly_payroll.toFixed(2),
    ...line.days.map((cell) => cell.shift_code),
  ]);
  return [header, ...rows].map((row) => row.map(escape).join(',')).join('\n');
}

export async function fetchArchetypes(): Promise<ArchetypePreset[]> {
  try {
    const res = await fetch('/api/v1/archetypes');
    if (res.ok) return await res.json();
  } catch {
    // Fallback to embedded presets
  }
  return DEFAULT_ARCHETYPES;
}

export async function solveScheduleApi(request: SolveRequest): Promise<SolveResponse> {
  let res: Response;
  try {
    res = await fetch('/api/v1/schedules/solve', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'X-API-Key': import.meta.env.VITE_API_KEY ?? '' },
      body: JSON.stringify(request),
    });
  } catch (err) {
    throw new Error(`The scheduling service could not be reached: ${err instanceof Error ? err.message : String(err)}`);
  }
  if (!res.ok) {
    let detail: string | undefined;
    try {
      const body = await res.json();
      if (typeof body?.detail === 'string' && body.detail.trim()) detail = body.detail;
    } catch {
      // Body is not JSON; fall back to the plain message below.
    }
    throw new Error(detail ?? `The scheduling service returned an error (HTTP ${res.status}).`);
  }
  return await res.json();
}

/** Staff record as the backend returns it. Mapped to EmployeeRecord in App.tsx. */
export interface EmployeeApiRecord {
  id: string;
  facility_id: string;
  name: string;
  role: string;
  wage: number;
  active: boolean;
  available_days: number[];
  assigned_line: number | null;
  accommodation_type: string;
  statutory_notes: string | null;
  separation_category: SeparationCategory | null;
  separation_reason: string | null;
  separation_timestamp: string | null;
  recorded_by: string | null;
}

/** Staff fields the backend accepts when creating or updating a record. */
export interface EmployeeApiWrite {
  name?: string;
  role?: string;
  wage?: number;
  active?: boolean;
  available_days?: number[];
  assigned_line?: number | null;
  accommodation_type?: string;
  statutory_notes?: string | null;
}

export interface PosUploadResult {
  status: string;
  records_parsed: number;
  weekly_sales: number;
  weekly_transactions: number;
  suggested_demand_matrix: number[][];
}

/** Uploads a POS transaction CSV and returns the parsed summary and suggested demand matrix. */
export async function uploadPosCsvApi(
  facilityId: string,
  file: File,
  openHour: number,
  closeHour: number
): Promise<PosUploadResult> {
  const body = new FormData();
  body.append('file', file);
  const params = new URLSearchParams({
    facility_id: facilityId,
    open_hour: String(openHour),
    close_hour: String(closeHour),
  });
  const res = await fetch(`/api/pos/upload-csv?${params.toString()}`, {
    method: 'POST',
    headers: { 'X-API-Key': import.meta.env.VITE_API_KEY ?? '' },
    body,
  });
  if (!res.ok) {
    const detail = await res.json().then((j) => j.detail).catch(() => null);
    throw new Error(typeof detail === 'string' ? detail : 'The POS file could not be uploaded.');
  }
  return await res.json();
}

export async function fetchEmployeesApi(facilityId: string): Promise<EmployeeApiRecord[]> {
  const res = await fetch(`/api/employees?facility_id=${encodeURIComponent(facilityId)}`);
  if (!res.ok) throw new Error('Staff records could not be loaded from the server.');
  return await res.json();
}

export async function createEmployeeApi(
  facilityId: string,
  payload: EmployeeApiWrite & { name: string }
): Promise<EmployeeApiRecord> {
  const res = await fetch('/api/employees', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'X-API-Key': import.meta.env.VITE_API_KEY ?? '' },
    body: JSON.stringify({ facility_id: facilityId, ...payload }),
  });
  if (!res.ok) throw new Error('The staff member could not be saved.');
  return await res.json();
}

export async function updateEmployeeApi(
  employeeId: string,
  payload: EmployeeApiWrite
): Promise<EmployeeApiRecord> {
  const res = await fetch(`/api/employees/${encodeURIComponent(employeeId)}`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json', 'X-API-Key': import.meta.env.VITE_API_KEY ?? '' },
    body: JSON.stringify(payload),
  });
  if (!res.ok) throw new Error('The staff change could not be saved.');
  return await res.json();
}

/** Records a separation (audit row) and deactivates the employee on the backend. */
export async function deactivateEmployee(
  empId: string,
  payload: { category: SeparationCategory; reason: string; recorded_by: string }
): Promise<{
  status: string;
  employee: {
    active: boolean;
    assigned_line: number | null;
    separation_category: SeparationCategory | null;
    separation_reason: string | null;
    separation_timestamp: string | null;
    recorded_by: string | null;
  };
}> {
  const res = await fetch(`/api/employees/${encodeURIComponent(empId)}/deactivate`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'X-API-Key': import.meta.env.VITE_API_KEY ?? '' },
    body: JSON.stringify({
      separation_category: payload.category,
      separation_reason: payload.reason,
      recorded_by: payload.recorded_by,
    }),
  });
  if (!res.ok) {
    let detail = `Separation could not be recorded (HTTP ${res.status}).`;
    try {
      const body = await res.json();
      if (typeof body?.detail === 'string') detail = body.detail;
    } catch {
      // Keep the generic message when the body is not JSON.
    }
    throw new Error(detail);
  }
  return await res.json();
}

/** Whether account login is configured on the backend, and who (if anyone) is signed in. */
export async function authStatusApi(): Promise<{ login_required: boolean; logged_in: boolean; email: string | null }> {
  try {
    const res = await fetch('/api/auth/status');
    if (!res.ok) return { login_required: false, logged_in: true, email: null };
    return await res.json();
  } catch {
    return { login_required: false, logged_in: true, email: null };
  }
}

async function authFormRequest(path: string, email: string, password: string): Promise<string | null> {
  try {
    const res = await fetch(path, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email, password }),
    });
    if (res.ok) return null;
    const body = await res.json().catch(() => null);
    if (typeof body?.detail === 'string') return body.detail;
    if (Array.isArray(body?.detail) && body.detail[0]?.msg) return body.detail[0].msg;
    return 'Something went wrong.';
  } catch {
    return 'Could not reach the login service.';
  }
}

/** Returns an error message on failure, or null on success (a session cookie is now set). */
export async function loginApi(email: string, password: string): Promise<string | null> {
  return authFormRequest('/api/auth/login', email, password);
}

/** Creates a new account and signs in. Returns an error message on failure, or null on success. */
export async function signupApi(email: string, password: string): Promise<string | null> {
  return authFormRequest('/api/auth/signup', email, password);
}

export async function logoutApi(): Promise<void> {
  await fetch('/api/auth/logout', { method: 'POST' }).catch(() => undefined);
}
