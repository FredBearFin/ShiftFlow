/**
 * Pure helpers that turn what a person types or pastes into an audit request.
 * Labels and cells are plain text: nothing here evaluates or renders them as markup.
 */

import type { AuditLine, AuditShiftDef, AuditShiftKind } from './auditApi';

export const MAX_AUDIT_CELLS = 11200;
export const MAX_AUDIT_LINES = 200;

export interface ShiftRow {
  code: string;
  name: string;
  /** Start time as HH:MM. */
  start: string;
  /** Length in hours; decimals allowed. */
  hours: string;
  kind: AuditShiftKind;
}

export interface ParsedShifts {
  shifts: AuditShiftDef[];
  errors: string[];
}

export interface ParsedGrid {
  lines: AuditLine[];
  errors: string[];
}

const OFF_TOKENS = new Set(['', 'OFF', '-', '.']);

export function parseStartTime(text: string): number | null {
  const m = /^(\d{1,2}):(\d{2})$/.exec(text.trim());
  if (!m) return null;
  const hours = Number(m[1]);
  const minutes = Number(m[2]);
  if (hours > 23 || minutes > 59) return null;
  return hours * 60 + minutes;
}

export function formatStartTime(minute: number): string {
  const h = Math.floor(minute / 60);
  const m = minute % 60;
  return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`;
}

export function parseShifts(rows: ShiftRow[]): ParsedShifts {
  const errors: string[] = [];
  const shifts: AuditShiftDef[] = [];
  const seen = new Set<string>();
  rows.forEach((row, index) => {
    const where = `Shift ${index + 1}`;
    const code = row.code.trim();
    if (!/^[A-Za-z0-9]{1,4}$/.test(code)) {
      errors.push(`${where}: the code must be 1 to 4 letters or digits.`);
      return;
    }
    if (code.toUpperCase() === 'OFF') {
      errors.push(`${where}: OFF is used for days off, so it cannot be a shift code.`);
      return;
    }
    if (seen.has(code.toUpperCase())) {
      errors.push(`${where}: the code ${code} is used twice.`);
      return;
    }
    const start = parseStartTime(row.start);
    if (start === null) {
      errors.push(`${where}: the start time must look like 07:00.`);
      return;
    }
    const hours = Number(row.hours);
    if (!Number.isFinite(hours) || hours < 1 || hours > 20) {
      errors.push(`${where}: the length must be between 1 and 20 hours.`);
      return;
    }
    seen.add(code.toUpperCase());
    shifts.push({
      code,
      name: row.name.trim().slice(0, 60),
      start_minute: start,
      duration_minutes: Math.round(hours * 60),
      kind: row.kind,
    });
  });
  if (rows.length === 0) errors.push('Add at least one shift.');
  return { shifts, errors };
}

function splitRow(line: string): string[] {
  if (line.includes('\t')) return line.split('\t').map((s) => s.trim());
  if (line.includes(',')) return line.split(',').map((s) => s.trim());
  return line.trim().split(/\s+/);
}

/**
 * Reads a pasted grid: one line per row, the first column is the line label and the
 * remaining columns are the days of the cycle. Tab, comma or space separated.
 * OFF, -, . or an empty cell all mean a day off.
 */
export function parseGrid(text: string, cycleDays: number, shiftCodes: string[]): ParsedGrid {
  const errors: string[] = [];
  const lines: AuditLine[] = [];
  const canonical = new Map(shiftCodes.map((c) => [c.toUpperCase(), c]));
  const labels = new Set<string>();
  const rows = text.split(/\r?\n/);
  let nonEmpty = 0;

  rows.forEach((raw, rowIndex) => {
    if (raw.trim() === '') return;
    nonEmpty += 1;
    const rowNo = rowIndex + 1;
    const parts = splitRow(raw);
    const label = parts[0];
    const cells = parts.slice(1);
    if (!label) {
      errors.push(`Row ${rowNo}: the first column must be a name for the line.`);
      return;
    }
    if (labels.has(label)) {
      errors.push(`Row ${rowNo}: the line name "${label}" is used twice.`);
      return;
    }
    labels.add(label);
    if (cells.length !== cycleDays) {
      errors.push(
        `Row ${rowNo}: has ${cells.length} day${cells.length === 1 ? '' : 's'} but the cycle is ${cycleDays} days.`
      );
      return;
    }
    const out: string[] = [];
    let bad = false;
    cells.forEach((cell, dayIndex) => {
      const upper = cell.toUpperCase();
      if (OFF_TOKENS.has(upper)) {
        out.push('OFF');
        return;
      }
      const code = canonical.get(upper);
      if (!code) {
        errors.push(`Row ${rowNo}, day ${dayIndex + 1}: "${cell}" is not a shift you defined.`);
        bad = true;
        return;
      }
      out.push(code);
    });
    if (!bad) lines.push({ label, cells: out });
  });

  if (nonEmpty === 0) errors.push('Paste at least one roster line.');
  if (nonEmpty > MAX_AUDIT_LINES) errors.push(`The audit takes up to ${MAX_AUDIT_LINES} lines.`);
  if (nonEmpty * cycleDays > MAX_AUDIT_CELLS) {
    errors.push(`The grid has ${nonEmpty * cycleDays} cells; the audit takes up to ${MAX_AUDIT_CELLS}.`);
  }
  return { lines, errors };
}

/** Turns lines back into the pasteable text the grid box takes. */
export function gridToText(lines: AuditLine[]): string {
  return lines.map((l) => [l.label, ...l.cells.map((c) => (c === 'OFF' ? '-' : c))].join('\t')).join('\n');
}
