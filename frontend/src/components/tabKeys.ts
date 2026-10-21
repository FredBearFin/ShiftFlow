/**
 * The single source of truth for the view tabs' number-key shortcuts.
 *
 * The cheatsheet used to carry its own hand-written copy of this map and had
 * drifted off it, documenting a view that did not exist and a key that did
 * nothing. Both the Header and KeyboardShortcutsModal read these, so the
 * documentation cannot describe a key the app does not bind.
 *
 * A tab absent from TAB_KEY_NUMBERS has no number key, and the cheatsheet says
 * so rather than leaving it unmentioned.
 */
import type { ActiveTabId } from '../types';

export const TAB_KEY_NUMBERS: Partial<Record<ActiveTabId, number>> = {
  roster: 1,
  labor: 2,
  coverage: 3,
  pareto: 4,
  ergonomics: 5,
  compliance: 6,
};

/** Every tab, in nav order, with the name the user sees on it. */
export const TAB_LABELS: { id: ActiveTabId; label: string }[] = [
  { id: 'roster', label: 'Weekly Schedule' },
  { id: 'staff', label: 'Staff Directory & Availability' },
  { id: 'labor', label: 'Labor & Payroll' },
  { id: 'coverage', label: '24h Coverage Heatmap' },
  { id: 'pareto', label: 'Flexibility vs. Rest' },
  { id: 'ergonomics', label: 'Ergonomics Health Audit' },
  { id: 'compliance', label: 'DOL Compliance' },
];
