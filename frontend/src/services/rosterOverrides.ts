/**
 * Manager edits to a generated roster, and the rule checks that run on an edited line.
 *
 * Why this is not a re-solve
 * --------------------------
 * A supervisor's week is edits, not greenfield generation: someone calls out, two
 * people swap, one cannot work Sundays. Feeding an edit back through the solver would
 * reshuffle every other line's week, so the one cell the manager wanted to change
 * arrives surrounded by six changes nobody asked for. Instead an override is applied
 * to the solved roster as-is and only the affected line is re-checked.
 *
 * The real adjacency
 * ------------------
 * A roster is ONE continuous cycle of employee_count * 7 day slots in line order, so
 * the day after a line's Sunday is the NEXT line's Monday, not that line's own Monday.
 * Every check below walks that flat cycle, wrapping at the end, which is the same
 * adjacency the solver's zero-clopening guardrail and per-cell rest figures use.
 */
import type {
  RosterCell,
  RosterCellOverride,
  RosterLine,
  RosterRuleFinding,
  ShiftClock,
  ShiftOrOffCode,
  SolveResponse,
} from '../types';

/** Matches backend/app/config.py: min_rest_hours_between_shifts. */
export const MIN_REST_HOURS = 16;

/** Matches the solver's regular-hours ceiling; hours past it are overtime. */
export const OVERTIME_THRESHOLD_HOURS = 40;

export const SHIFT_CODE_OPTIONS: ShiftOrOffCode[] = ['M', 'D', 'E', 'N', 'OFF'];

export const SHIFT_CODE_LABELS: Record<ShiftOrOffCode, string> = {
  M: 'Morning',
  D: 'Midday',
  E: 'Evening',
  N: 'Night',
  OFF: 'Off (rest day)',
};

const OFF_CLOCK: ShiftClock = { start_hour: 0, duration_hours: 0, time_window: 'Rest / Off' };

/** Reads "06:00 - 14:00" (either dash, with or without spaces) back to its start hour. */
function parseStartHour(window: string): number | null {
  const match = /^\s*(\d{1,2}):(\d{2})/.exec(window);
  if (!match) return null;
  const hour = Number(match[1]);
  const minute = Number(match[2]);
  if (!Number.isFinite(hour) || !Number.isFinite(minute)) return null;
  return hour + minute / 60;
}

/**
 * The clock times behind each shift code in a solved roster.
 *
 * `shift_types` is authoritative when the solve reports it. Some responses carry an
 * empty `shift_types` while the roster cells themselves still state each code's window
 * and duration, so the cells are read first and the shift types layered over them.
 */
export function shiftClocksFromSolution(solution: SolveResponse): Record<string, ShiftClock> {
  const clocks: Record<string, ShiftClock> = { OFF: OFF_CLOCK };

  for (const line of solution.roster_lines) {
    for (const cell of line.days) {
      if (cell.shift_code === 'OFF' || clocks[cell.shift_code]) continue;
      const start = parseStartHour(cell.time_window);
      if (start === null) continue;
      clocks[cell.shift_code] = {
        start_hour: start,
        duration_hours: cell.duration_hours,
        time_window: cell.time_window,
      };
    }
  }

  for (const st of solution.shift_types) {
    if (!st.active && clocks[st.template_code]) continue;
    clocks[st.template_code] = {
      start_hour: st.start_hour,
      duration_hours: st.duration_hours,
      time_window: st.formatted_window,
    };
  }

  return clocks;
}

/**
 * The codes a cell may be changed to: OFF, plus every shift this schedule has concrete
 * clock times for.
 *
 * A code with no clock behind it cannot be costed or rest-checked, so offering it would
 * let a manager move somebody onto a shift whose hours are unknown and have the cell
 * quietly read as zero hours. It is left out of the choices instead.
 */
export function availableShiftCodes(clocks: Record<string, ShiftClock>): ShiftOrOffCode[] {
  return SHIFT_CODE_OPTIONS.filter((code) => code === 'OFF' || clocks[code] !== undefined);
}

export interface ShiftSlot {
  line_number: number;
  day_index: number;
  shift_code: ShiftOrOffCode;
  start_hour: number;
  duration_hours: number;
}

/** Elapsed rest between a shift on one day and a shift on the next. Mirrors ergonomics.compute_rest_hours_between. */
export function restHoursBetween(prev: ShiftSlot, curr: ShiftSlot): number {
  if (prev.shift_code === 'OFF' || curr.shift_code === 'OFF') return 24;
  const prevEnd = prev.start_hour + prev.duration_hours;
  const currStart = 24 + curr.start_hour;
  return Math.max(0, currStart - prevEnd);
}

/** Overrides as a lookup, last write winning for a repeated cell. */
export function overrideKey(cycleWeek: number, dayIndex: number): string {
  return `${cycleWeek}:${dayIndex}`;
}

export function indexOverrides(overrides: RosterCellOverride[]): Map<string, RosterCellOverride> {
  const byKey = new Map<string, RosterCellOverride>();
  for (const ov of overrides) byKey.set(overrideKey(ov.cycle_week, ov.day_index), ov);
  return byKey;
}

/**
 * The whole roster as one continuous cycle of day slots in line order, with overrides
 * applied. Index `i * 7 + d` is line i's day d, and slot i+1 is the day after slot i.
 */
export function buildCycleSlots(
  lines: RosterLine[],
  overrides: RosterCellOverride[],
  clocks: Record<string, ShiftClock>
): ShiftSlot[] {
  const byKey = indexOverrides(overrides);
  const slots: ShiftSlot[] = [];
  for (const line of lines) {
    for (const cell of line.days) {
      const ov = byKey.get(overrideKey(line.current_cycle_week, cell.day_index));
      const code = ov ? ov.shift_code : cell.shift_code;
      const clock = clocks[code] ?? OFF_CLOCK;
      slots.push({
        line_number: line.line_number,
        day_index: cell.day_index,
        shift_code: code,
        start_hour: code === 'OFF' ? 0 : clock.start_hour,
        duration_hours: code === 'OFF' ? 0 : clock.duration_hours,
      });
    }
  }
  return slots;
}

const DAY_FULL_NAMES = ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday'];

export function dayFullName(dayIndex: number): string {
  return DAY_FULL_NAMES[dayIndex] ?? `Day ${dayIndex + 1}`;
}

function formatHours(hours: number): string {
  return Number.isInteger(hours) ? String(hours) : hours.toFixed(1);
}

/**
 * Re-runs the rest, clopening and overtime checks on ONE line of an overridden roster.
 *
 * Reported findings are confined to that line's own week plus the two cycle boundaries
 * it touches: its Monday takes its rest from the previous line's Sunday, and its Sunday
 * sets up the next line's Monday. Nothing else in the cycle is read and nothing is
 * re-solved, so no other line's week moves.
 */
export function checkLineAfterOverride(
  slots: ShiftSlot[],
  lineIndex: number,
  lineCount: number
): RosterRuleFinding[] {
  if (lineCount === 0 || slots.length === 0) return [];
  const findings: RosterRuleFinding[] = [];
  const total = slots.length;
  const lineSlots = slots.slice(lineIndex * 7, lineIndex * 7 + 7);
  const lineNumber = lineSlots[0]?.line_number ?? lineIndex + 1;

  // Every adjacency this line is part of: its own six internal day pairs, the pair that
  // starts its Monday (previous line's Sunday) and the pair its Sunday starts (next
  // line's Monday). Both boundary pairs wrap at the ends of the cycle.
  const firstSlot = lineIndex * 7;
  const pairStarts = [-1, 0, 1, 2, 3, 4, 5, 6].map((d) => firstSlot + d);

  for (const rawStart of pairStarts) {
    const fromIdx = ((rawStart % total) + total) % total;
    const toIdx = (fromIdx + 1) % total;
    const prev = slots[fromIdx];
    const curr = slots[toIdx];
    if (prev.shift_code === 'OFF' || curr.shift_code === 'OFF') continue;

    if (prev.shift_code === 'E' && curr.shift_code === 'M') {
      findings.push({
        rule: 'clopening',
        line_number: curr.line_number,
        day_index: curr.day_index,
        message:
          `Clopening: line ${prev.line_number} closes on ${dayFullName(prev.day_index)} (evening) ` +
          `and line ${curr.line_number} opens the next day, ${dayFullName(curr.day_index)} (morning).`,
      });
    }

    const rest = restHoursBetween(prev, curr);
    if (rest < MIN_REST_HOURS) {
      findings.push({
        rule: 'rest',
        line_number: curr.line_number,
        day_index: curr.day_index,
        message:
          `Rest: only ${formatHours(rest)}h between line ${prev.line_number}'s ${dayFullName(prev.day_index)} ` +
          `${prev.shift_code} shift and line ${curr.line_number}'s ${dayFullName(curr.day_index)} ` +
          `${curr.shift_code} shift. The rule is ${MIN_REST_HOURS}h.`,
      });
    }
  }

  const weeklyHours = lineSlots.reduce((sum, s) => sum + s.duration_hours, 0);
  if (weeklyHours > OVERTIME_THRESHOLD_HOURS) {
    findings.push({
      rule: 'overtime',
      line_number: lineNumber,
      day_index: null,
      message:
        `Overtime: line ${lineNumber} now works ${formatHours(weeklyHours)}h, ` +
        `${formatHours(weeklyHours - OVERTIME_THRESHOLD_HOURS)}h past the ` +
        `${OVERTIME_THRESHOLD_HOURS}h boundary.`,
    });
  }

  return findings;
}

export interface OverridePreview {
  findings: RosterRuleFinding[];
  weekly_hours: number;
  overtime_hours: number;
}

/**
 * What one candidate edit would do, without committing it: the rule findings on the
 * affected line and that line's resulting hours. Used to show the manager the
 * consequence before they save, and again on the line once they have.
 */
export function previewOverride(
  solution: SolveResponse,
  committed: RosterCellOverride[],
  candidate: RosterCellOverride
): OverridePreview {
  const clocks = shiftClocksFromSolution(solution);
  const lines = solution.roster_lines;
  const candidateKey = overrideKey(candidate.cycle_week, candidate.day_index);
  const merged = [
    ...committed.filter((o) => overrideKey(o.cycle_week, o.day_index) !== candidateKey),
    candidate,
  ];
  const slots = buildCycleSlots(lines, merged, clocks);

  const lineIndex = lines.findIndex((l) => l.current_cycle_week === candidate.cycle_week);
  if (lineIndex < 0) return { findings: [], weekly_hours: 0, overtime_hours: 0 };

  const weeklyHours = slots
    .slice(lineIndex * 7, lineIndex * 7 + 7)
    .reduce((sum, s) => sum + s.duration_hours, 0);

  return {
    findings: checkLineAfterOverride(slots, lineIndex, lines.length),
    weekly_hours: weeklyHours,
    overtime_hours: Math.max(0, weeklyHours - OVERTIME_THRESHOLD_HOURS),
  };
}

/** Every committed override's findings, grouped by the line each one lands on. */
export function findingsByLine(
  solution: SolveResponse,
  overrides: RosterCellOverride[]
): Map<number, RosterRuleFinding[]> {
  const byLine = new Map<number, RosterRuleFinding[]>();
  if (overrides.length === 0) return byLine;

  const clocks = shiftClocksFromSolution(solution);
  const lines = solution.roster_lines;
  const slots = buildCycleSlots(lines, overrides, clocks);
  const editedWeeks = new Set(overrides.map((o) => o.cycle_week));
  const seen = new Set<string>();

  lines.forEach((line, lineIndex) => {
    if (!editedWeeks.has(line.current_cycle_week)) return;
    for (const finding of checkLineAfterOverride(slots, lineIndex, lines.length)) {
      const dedupe = `${finding.rule}:${finding.line_number}:${finding.day_index}`;
      if (seen.has(dedupe)) continue;
      seen.add(dedupe);
      const bucket = byLine.get(finding.line_number);
      if (bucket) bucket.push(finding);
      else byLine.set(finding.line_number, [finding]);
    }
  });

  return byLine;
}

/** The cell as it now reads, with the generated value kept beside it. */
export interface ResolvedCell {
  cell: RosterCell;
  shift_code: ShiftOrOffCode;
  time_window: string;
  duration_hours: number;
  is_modified: boolean;
  original_shift_code: ShiftOrOffCode;
}

export function resolveCell(
  cell: RosterCell,
  cycleWeek: number,
  byKey: Map<string, RosterCellOverride>,
  clocks: Record<string, ShiftClock>
): ResolvedCell {
  const ov = byKey.get(overrideKey(cycleWeek, cell.day_index));
  if (!ov || ov.shift_code === cell.shift_code) {
    return {
      cell,
      shift_code: cell.shift_code,
      time_window: cell.time_window,
      duration_hours: cell.duration_hours,
      is_modified: false,
      original_shift_code: cell.shift_code,
    };
  }
  const clock = clocks[ov.shift_code] ?? OFF_CLOCK;
  return {
    cell,
    shift_code: ov.shift_code,
    time_window: ov.shift_code === 'OFF' ? 'Rest / Off' : clock.time_window,
    duration_hours: ov.shift_code === 'OFF' ? 0 : clock.duration_hours,
    is_modified: true,
    original_shift_code: ov.original_shift_code,
  };
}

/** The line's hours once its overrides are applied, so the Hours column stays true. */
export function resolvedLineHours(
  line: RosterLine,
  byKey: Map<string, RosterCellOverride>,
  clocks: Record<string, ShiftClock>
): { weekly_hours: number; regular_hours: number; overtime_hours: number } {
  let weekly = 0;
  for (const cell of line.days) {
    weekly += resolveCell(cell, line.current_cycle_week, byKey, clocks).duration_hours;
  }
  return {
    weekly_hours: weekly,
    regular_hours: Math.min(OVERTIME_THRESHOLD_HOURS, weekly),
    overtime_hours: Math.max(0, weekly - OVERTIME_THRESHOLD_HOURS),
  };
}

/** Drops overrides that no longer name a pattern in the current solve, or that changed nothing. */
export function pruneOverrides(
  overrides: RosterCellOverride[],
  solution: SolveResponse
): RosterCellOverride[] {
  const weeks = new Set(solution.roster_lines.map((l) => l.current_cycle_week));
  return overrides.filter(
    (o) =>
      weeks.has(o.cycle_week) &&
      o.day_index >= 0 &&
      o.day_index <= 6 &&
      o.shift_code !== o.original_shift_code
  );
}
