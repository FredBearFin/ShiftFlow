/**
 * Plain display labels for the business-type presets shown in wizard step 1.
 * Keys are preset ids from DEFAULT_ARCHETYPES. Ids and values are not changed here.
 * Holds no store names.
 */
export const PRESET_LABELS: Record<string, { label: string; description?: string }> = {
  downtown_foodmart_omaha: {
    label: 'Convenience store or smoke shop',
    description: 'A single store open long or odd hours — early mornings, late nights, or both. Covers opening, midday rush, and closing shifts.',
  },
  retail_grocery: {
    label: 'Liquor store, bar, or restaurant',
    description: 'A single location with a busy evening or weekend rush, plus opening prep and closing cleanup. Built for extended and late-night hours.',
  },
  healthcare_24_7: {
    label: 'Hospital and clinical care',
    description: 'Morning, midday, evening and night shifts, covering care around the clock.',
  },
  manufacturing_24_7: {
    label: 'Manufacturing and plant operations',
    description: 'Production lines and plants that run continuously, with crews covering assembly, packaging and maintenance around the clock.',
  },
  emergency_services: {
    label: 'Public safety and emergency response',
    description: 'Dispatch, rescue and response teams that must stay staffed at all hours to answer calls for help.',
  },
  custom: {
    label: 'Custom schedule',
    description: 'Set up your own operating hours, shift times and crew needs for any other kind of work.',
  },
};

/** Returns the plain display label for a preset id, or the fallback when none is mapped. */
export function presetLabelFor(id: string, fallback: string): string {
  const entry: { label: string; description?: string } | undefined = PRESET_LABELS[id];
  return entry ? entry.label : fallback;
}

export interface PresetSolveBlocker {
  /** Short marker shown on the preset's own button in the picker. */
  badge: string;
  /** What went wrong, and what fixes it, in the words the wizard itself uses. */
  message: string;
}

/*
 * Examples that do not produce a schedule as they ship: the scheduling service
 * turns them down every time, so loading one and working through setup ends in a
 * dead end. Checked against the service, not guessed.
 *
 * Delete an entry here as soon as its example builds a schedule again - the
 * marker in the picker and the warning both disappear with it.
 */
export const PRESET_SOLVE_BLOCKERS: Record<string, PresetSolveBlocker> = {};

/** Returns the known solve blocker for a preset id, or undefined when it solves. */
export function presetSolveBlocker(id: string): PresetSolveBlocker | undefined {
  return PRESET_SOLVE_BLOCKERS[id];
}
