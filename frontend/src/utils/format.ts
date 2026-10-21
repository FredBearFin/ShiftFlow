/**
 * The single money formatter for the UI.
 *
 * Before this existed the same payroll total rendered as "$10,754.00",
 * "$10754.00" and "$10754" in one view, which reads as three different
 * numbers. Every on-screen dollar amount goes through formatCurrency so the
 * grouping and the decimal places are identical everywhere.
 *
 * Display only. CSV/export columns stay raw numeric (toFixed) so downstream
 * payroll systems keep parsing them.
 */

const CURRENCY = new Intl.NumberFormat('en-US', {
  style: 'currency',
  currency: 'USD',
  minimumFractionDigits: 2,
  maximumFractionDigits: 2,
});

/** Formats a dollar amount for display, e.g. 10754 -> "$10,754.00". */
export function formatCurrency(value: number | null | undefined): string {
  if (typeof value !== 'number' || !Number.isFinite(value)) return '';
  return CURRENCY.format(value);
}

/** Formats a wage rate for display, e.g. 18.5 -> "$18.50/hr". */
export function formatHourlyRate(value: number | null | undefined): string {
  const formatted = formatCurrency(value);
  return formatted === '' ? '' : `${formatted}/hr`;
}
