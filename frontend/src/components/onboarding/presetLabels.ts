/**
 * Plain display labels for the business-type presets shown in wizard step 1.
 * Keys are preset ids from DEFAULT_ARCHETYPES. Ids and values are not changed here.
 * Holds no store names.
 */
export const PRESET_LABELS: Record<string, { label: string; description?: string }> = {
  downtown_foodmart_omaha: {
    label: 'Retail and food service',
    description: 'Stores and food counters that sell groceries, prepared meals and everyday goods to walk-in customers. Staffing follows daily sales peaks.',
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
