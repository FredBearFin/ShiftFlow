/**
 * API client for the ShiftFlow Studio backend.
 * Connects to the FastAPI backend (/api/v1/...) when running via Docker Compose.
 */

import {
  ArchetypePreset,
  ErgonomicGuardrails,
  EmergencyCalloutRequest,
  EmergencyCalloutResponse,
  PersistedSolveConfig,
  RosterCellOverride,
  SeparationCategory,
  ShiftOrOffCode,
  ShiftSwapRequest,
  ShiftSwapValidationResponse,
  ShiftTemplate,
  SolveRequest,
  SolveResponse,
  StoredAssignmentShift,
  StoredRosterResponse,
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

/* -------------------------------------------------------------------------
 * Saving the solve configuration between sessions
 *
 * Staff records are stored on the server and survive a reload. The rest of the
 * setup - the 7x24 staffing table most of all - used to live only in React state,
 * so a reload silently swapped a manager's work for defaults. Because the staff
 * survived, onboarding did not reopen and nothing reported the loss: the manager
 * saw a different schedule and no explanation.
 *
 * localStorage matches the pattern already used for this app's other saved choices
 * (shiftflow.planningOnly, shiftflow.singleKeyShortcuts). It is per-browser rather
 * than per-account, so App clears it on logout.
 * ------------------------------------------------------------------------- */

const SOLVE_CONFIG_KEY = 'shiftflow.solveConfig';
const SOLVE_CONFIG_VERSION = 1;

/**
 * What came back when the saved configuration was read. A restore that is partial or
 * that failed outright is reported, with the parts that did not survive named, so the
 * caller can tell the user instead of quietly presenting a different schedule.
 */
export type SolveConfigRestore =
  | { status: 'none' }
  | { status: 'ok'; config: PersistedSolveConfig }
  | { status: 'partial'; config: Partial<PersistedSolveConfig>; missing: string[] }
  | { status: 'failed'; reason: string };

/**
 * The manager's hand edits to the generated roster, stored in the same record as the
 * rest of the setup.
 *
 * Deliberately NOT part of PersistedSolveConfig: a roster with no edits on it has no
 * overrides, so an absent list is the normal case and must never be reported to the
 * manager as setup that failed to restore. A stored list that is unreadable is dropped
 * rather than partially applied — half a manager's edits is a roster nobody authored.
 */
const OVERRIDES_FIELD = 'roster_overrides';

const SHIFT_OR_OFF_CODES: ShiftOrOffCode[] = ['M', 'D', 'E', 'N', 'OFF'];

const isShiftOrOffCode = (v: unknown): v is ShiftOrOffCode =>
  typeof v === 'string' && (SHIFT_OR_OFF_CODES as string[]).includes(v);

function readRosterOverrides(raw: unknown): RosterCellOverride[] {
  if (!Array.isArray(raw)) return [];
  const out: RosterCellOverride[] = [];
  for (const entry of raw) {
    if (!entry || typeof entry !== 'object') return [];
    const rec = entry as Record<string, unknown>;
    if (!isFiniteNumber(rec.cycle_week) || rec.cycle_week < 1) return [];
    if (!isFiniteNumber(rec.day_index) || rec.day_index < 0 || rec.day_index > 6) return [];
    if (!isShiftOrOffCode(rec.shift_code) || !isShiftOrOffCode(rec.original_shift_code)) return [];
    out.push({
      cycle_week: Math.round(rec.cycle_week),
      day_index: Math.round(rec.day_index),
      shift_code: rec.shift_code,
      original_shift_code: rec.original_shift_code,
    });
  }
  return out;
}

/** Plain-language names for the saved fields, for telling a shift supervisor what was lost. */
const SOLVE_CONFIG_FIELD_LABELS: Record<keyof PersistedSolveConfig, string> = {
  archetype_id: 'the example it started from',
  facility_name: 'the business name',
  demand_matrix: 'the staffing table',
  templates: 'the shift times',
  guardrails: 'the scheduling rules',
  pareto_leeway_pct: 'the cost-versus-rest setting',
  rotation_week_offset: 'the rotation week',
};

const isFiniteNumber = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v);

/** Accepts only a full 7x24 grid of non-negative counts; a short or ragged grid is not a staffing table. */
function readDemandMatrix(raw: unknown): number[][] | null {
  if (!Array.isArray(raw) || raw.length !== 7) return null;
  const rows: number[][] = [];
  for (const row of raw) {
    if (!Array.isArray(row) || row.length !== 24) return null;
    if (!row.every((cell) => isFiniteNumber(cell) && cell >= 0)) return null;
    rows.push(row.map((cell) => Math.round(cell as number)));
  }
  return rows;
}

const TEMPLATE_NUMERIC_FIELDS = [
  'earliest_start',
  'latest_end',
  'min_duration',
  'max_duration',
  'preferred_start',
  'preferred_duration',
] as const;

function readTemplates(raw: unknown): ShiftTemplate[] | null {
  if (!Array.isArray(raw) || raw.length === 0) return null;
  for (const tpl of raw) {
    if (!tpl || typeof tpl !== 'object') return null;
    const rec = tpl as Record<string, unknown>;
    if (!['M', 'D', 'E', 'N'].includes(rec.code as string)) return null;
    if (typeof rec.name !== 'string' || typeof rec.enabled !== 'boolean') return null;
    if (!TEMPLATE_NUMERIC_FIELDS.every((field) => isFiniteNumber(rec[field]))) return null;
  }
  return raw as ShiftTemplate[];
}

const GUARDRAIL_NUMERIC_FIELDS = [
  'min_consecutive_work_days',
  'max_consecutive_work_days',
  'min_consecutive_rest_days',
  'max_consecutive_rest_days',
  'max_consecutive_nights',
  'max_consecutive_evenings',
] as const;

const GUARDRAIL_FLAG_FIELDS = [
  'enforce_forward_rotation',
  'enforce_zero_clopening',
  'avoid_single_rest_days',
  'avoid_single_night_shifts',
  'prioritize_free_weekends',
] as const;

function readGuardrails(raw: unknown): ErgonomicGuardrails | null {
  if (!raw || typeof raw !== 'object') return null;
  const rec = raw as Record<string, unknown>;
  if (!GUARDRAIL_NUMERIC_FIELDS.every((field) => isFiniteNumber(rec[field]))) return null;
  if (!GUARDRAIL_FLAG_FIELDS.every((field) => typeof rec[field] === 'boolean')) return null;
  return raw as ErgonomicGuardrails;
}

/**
 * Saves the whole solve configuration, with the manager's roster edits alongside it.
 * Returns false when the browser refuses to store it.
 */
export function saveSolveConfig(
  config: PersistedSolveConfig,
  rosterOverrides: RosterCellOverride[] = []
): boolean {
  try {
    window.localStorage.setItem(
      SOLVE_CONFIG_KEY,
      JSON.stringify({
        version: SOLVE_CONFIG_VERSION,
        ...config,
        [OVERRIDES_FIELD]: rosterOverrides,
      })
    );
    return true;
  } catch {
    // Storage can be blocked or full. The caller surfaces this rather than hiding it.
    return false;
  }
}

/**
 * The saved roster edits on their own, for the one read at startup that happens before
 * any solve has come back. Returns an empty list when there are none, when the record
 * cannot be read, or when its list is malformed.
 */
export function loadRosterOverrides(): RosterCellOverride[] {
  try {
    const raw = window.localStorage.getItem(SOLVE_CONFIG_KEY);
    if (raw === null) return [];
    const parsed: unknown = JSON.parse(raw);
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return [];
    const rec = parsed as Record<string, unknown>;
    if (rec.version !== SOLVE_CONFIG_VERSION) return [];
    return readRosterOverrides(rec[OVERRIDES_FIELD]);
  } catch {
    return [];
  }
}

/** Forgets the saved configuration. Called on logout, since the key is per-browser. */
export function clearSolveConfig(): void {
  try {
    window.localStorage.removeItem(SOLVE_CONFIG_KEY);
  } catch {
    // Nothing to clear if storage is unavailable.
  }
}

/**
 * Reads the saved configuration back. Every field is validated on the way in; a field
 * that is missing or unusable is left out of `config` (so the caller applies its own
 * default) and named in `missing`, never silently replaced.
 */
export function loadSolveConfig(): SolveConfigRestore {
  let raw: string | null;
  try {
    raw = window.localStorage.getItem(SOLVE_CONFIG_KEY);
  } catch {
    return { status: 'failed', reason: 'this browser is blocking saved data' };
  }
  if (raw === null) return { status: 'none' };

  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return { status: 'failed', reason: 'the saved copy could not be read' };
  }
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
    return { status: 'failed', reason: 'the saved copy could not be read' };
  }

  const rec = parsed as Record<string, unknown>;
  if (rec.version !== SOLVE_CONFIG_VERSION) {
    return { status: 'failed', reason: 'it was saved by a different version of this app' };
  }

  const config: Partial<PersistedSolveConfig> = {};
  const missing: (keyof PersistedSolveConfig)[] = [];

  const demandMatrix = readDemandMatrix(rec.demand_matrix);
  if (demandMatrix) config.demand_matrix = demandMatrix;
  else missing.push('demand_matrix');

  const templates = readTemplates(rec.templates);
  if (templates) config.templates = templates;
  else missing.push('templates');

  const guardrails = readGuardrails(rec.guardrails);
  if (guardrails) config.guardrails = guardrails;
  else missing.push('guardrails');

  if (typeof rec.archetype_id === 'string') config.archetype_id = rec.archetype_id;
  else missing.push('archetype_id');

  if (typeof rec.facility_name === 'string') config.facility_name = rec.facility_name;
  else missing.push('facility_name');

  if (isFiniteNumber(rec.pareto_leeway_pct)) config.pareto_leeway_pct = rec.pareto_leeway_pct;
  else missing.push('pareto_leeway_pct');

  if (isFiniteNumber(rec.rotation_week_offset)) {
    config.rotation_week_offset = Math.round(rec.rotation_week_offset);
  } else {
    missing.push('rotation_week_offset');
  }

  if (missing.length === 0) return { status: 'ok', config: config as PersistedSolveConfig };
  return {
    status: 'partial',
    config,
    missing: missing.map((field) => SOLVE_CONFIG_FIELD_LABELS[field]),
  };
}

/** Serialises the roster grid (one row per rotation line, one column per day). */

/** Serialises the weekly schedule grid (one row per shift pattern, one column per day). */
/** Marks a roster line nobody is working, so the row can never read as a real person's hours. */
export const UNASSIGNED_LINE_LABEL = 'UNASSIGNED — no staff member on this line';

/** Monday of the week containing `from`, so the printed range starts where the roster does. */
function mondayOf(from: Date): Date {
  const d = new Date(from.getFullYear(), from.getMonth(), from.getDate());
  // getDay(): 0 = Sunday. Shift back to the Monday that opens this week.
  d.setDate(d.getDate() - ((d.getDay() + 6) % 7));
  return d;
}

function isoDate(d: Date): string {
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

/**
 * Renders one day cell as e.g. `D (11:00 – 19:00)`.
 *
 * The shift code alone is undecodable on paper: its legend lives on a wizard
 * screen the person holding the printout does not have. The on-screen grid
 * already shows the time window, so the export carries it too. Matches the
 * backend's /export-csv formatting exactly.
 */
function formatDayCell(cell: { shift_code: string; time_window: string }): string {
  if (cell.shift_code === 'OFF') return 'OFF';
  const window = (cell.time_window ?? '').trim();
  return window === '' ? cell.shift_code : `${cell.shift_code} (${window})`;
}

/**
 * Exports the roster as CSV.
 *
 * `weekStartDate` dates the printed range. The solver returns a repeating
 * weekly pattern with no stored start date, so this defaults to the Monday of
 * the week the export is taken and the header row says so rather than
 * implying the backend supplied a date.
 */
export function exportRosterToCsvString(solution: SolveResponse, weekStartDate?: Date): string {
  const dayHeaders = DAYS_OF_WEEK.map((d) => `${d} Shift`);
  const header = ['Pattern', 'Pattern ID', 'Assigned Person', 'Qualification', 'Hourly Wage', 'Weekly Hours', 'Overtime Hours', 'Weekly Payroll', ...dayHeaders];
  const escape = (v: string | number | null) => {
    const s = v === null ? '' : String(v);
    return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
  };

  const start = mondayOf(weekStartDate ?? new Date());
  const end = new Date(start);
  end.setDate(end.getDate() + 6);
  const dateRangeRow = [
    `Schedule week: Mon ${isoDate(start)} to Sun ${isoDate(end)}`,
    'Repeating weekly pattern; dated from the week this export was taken, not from a stored schedule date.',
  ];

  const rows = solution.roster_lines.map((line) => {
    const staffed = line.assigned_person !== null && line.assigned_person !== undefined && line.assigned_person !== '';
    return [
      line.line_number,
      line.cohort_id,
      // Never leave this blank: a blank name beside 40 hours reads as a real
      // person's payroll row. Unstaffed lines stay in the file because they are
      // coverage gaps the supervisor has to see, but carry no wage or money.
      staffed ? (line.assigned_person as string) : UNASSIGNED_LINE_LABEL,
      line.qualification_tier,
      staffed && line.hourly_wage !== null ? line.hourly_wage.toFixed(2) : '',
      line.weekly_hours,
      line.overtime_hours,
      staffed && line.estimated_weekly_payroll !== null ? line.estimated_weekly_payroll.toFixed(2) : '',
      ...line.days.map(formatDayCell),
    ];
  });
  return [dateRangeRow, header, ...rows].map((row) => row.map(escape).join(',')).join('\n');
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
      headers: { 'Content-Type': 'application/json' },
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

/**
 * Asks the backend whether two assigned shifts may be traded.
 *
 * The solved roster goes with the request: there is no stored per-employee punch data,
 * so the verdict has no other honest source. A request the backend cannot validate at
 * all comes back 400 with the reason, which is surfaced rather than swallowed.
 */
export async function validateShiftSwapApi(
  request: ShiftSwapRequest
): Promise<ShiftSwapValidationResponse> {
  let res: Response;
  try {
    res = await fetch('/api/emergency/validate-swap', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(request),
    });
  } catch (err) {
    throw new Error(
      `The swap could not be checked: ${err instanceof Error ? err.message : String(err)}`
    );
  }
  if (!res.ok) {
    let detail: string | undefined;
    try {
      const body = await res.json();
      if (typeof body?.detail === 'string' && body.detail.trim()) detail = body.detail;
    } catch {
      // Body is not JSON; fall back to the plain message below.
    }
    throw new Error(detail ?? `The swap could not be checked (HTTP ${res.status}).`);
  }
  return await res.json();
}

/** Reads a JSON error body's `detail`, so a backend reason reaches the user verbatim. */
async function detailOrStatus(res: Response, fallback: string): Promise<string> {
  try {
    const body = await res.json();
    if (typeof body?.detail === 'string' && body.detail.trim()) return body.detail;
  } catch {
    // Body is not JSON; the caller's own message is used.
  }
  return `${fallback} (HTTP ${res.status}).`;
}

/**
 * Stores the roster's concrete shift times and rest intervals for this facility.
 *
 * The callout queue ranks replacements against this; without it there is nothing to
 * check a replacement's rest or hours against, which is why callout cover had no source.
 * It is replaced whole on every write.
 */
export async function storeRosterAssignmentsApi(
  facilityId: string,
  shifts: StoredAssignmentShift[]
): Promise<StoredRosterResponse> {
  let res: Response;
  try {
    res = await fetch('/api/emergency/stored-roster', {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ facility_id: facilityId, shifts }),
    });
  } catch (err) {
    throw new Error(
      `The roster could not be saved for cover: ${err instanceof Error ? err.message : String(err)}`
    );
  }
  if (!res.ok) {
    throw new Error(await detailOrStatus(res, 'The roster could not be saved for cover'));
  }
  return await res.json();
}

/** Asks who could cover a shift somebody has called out of, ranked by rest then overtime headroom. */
export async function findCalloutCoverApi(
  request: EmergencyCalloutRequest
): Promise<EmergencyCalloutResponse> {
  let res: Response;
  try {
    res = await fetch('/api/emergency/callout-replacement', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(request),
    });
  } catch (err) {
    throw new Error(
      `Cover could not be worked out: ${err instanceof Error ? err.message : String(err)}`
    );
  }
  if (!res.ok) {
    throw new Error(await detailOrStatus(res, 'Cover could not be worked out'));
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
    headers: { 'Content-Type': 'application/json' },
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
    headers: { 'Content-Type': 'application/json' },
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
    headers: { 'Content-Type': 'application/json' },
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
export interface AuthStatus {
  login_required: boolean;
  logged_in: boolean;
  email: string | null;
  /** Whether the server lets visitors create their own account. */
  signup_allowed: boolean;
}

export async function authStatusApi(): Promise<AuthStatus> {
  const noLogin: AuthStatus = { login_required: false, logged_in: true, email: null, signup_allowed: false };
  try {
    const res = await fetch('/api/auth/status');
    if (!res.ok) return noLogin;
    const body = await res.json();
    return { ...body, signup_allowed: body.signup_allowed !== false };
  } catch {
    return noLogin;
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
