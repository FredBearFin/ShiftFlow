/**
 * Plain display labels for the ergonomics criteria shown in the Ergonomics tab.
 * Keys are criterion_id values from the backend's ergonomics audit. Ids and the
 * underlying scoring are not changed here - only how they're described.
 */
export const CRITERIA_LABELS: Record<string, { label: string; explanation: string }> = {
  shift_duration: {
    label: 'Long shifts',
    explanation: 'Shifts longer than 9 hours in a row, which make the end of a shift more tiring.',
  },
  early_morning: {
    label: 'Very early starts',
    explanation: "Shifts that start before 6:00am, which cut into a full night's sleep.",
  },
  consecutive_work_days: {
    label: 'Long work stretches',
    explanation: 'Working more than 5 days in a row, or fewer than 3 — either can be hard to plan around.',
  },
  consecutive_nights: {
    label: 'Back-to-back night shifts',
    explanation: 'More than 2 night shifts in a row, which makes it harder for someone to get used to a normal sleep schedule.',
  },
  consecutive_evenings: {
    label: 'Back-to-back evening shifts',
    explanation: "More than 3 evening shifts in a row, cutting into someone's regular evenings for days at a time.",
  },
  single_night: {
    label: 'Lone night shifts',
    explanation: "A single night shift on its own, with day shifts the day before and after — worse than a short run of nights.",
  },
  weekend_work: {
    label: 'Weekend coverage',
    explanation: 'How much weekend work is scheduled, versus how many staff get a full Saturday+Sunday off.',
  },
  single_day_rest: {
    label: 'One-day breaks',
    explanation: "A single day off on its own, rather than 2+ days off together — less useful for actually resting.",
  },
};

/** Returns the plain label for a criterion id, or the fallback (e.g. the backend's own name) when none is mapped. */
export function criterionLabelFor(id: string, fallback: string): string {
  return CRITERIA_LABELS[id]?.label ?? fallback;
}

/** Returns the plain explanation for a criterion id, or the fallback (e.g. the backend's own explanation) when none is mapped. */
export function criterionExplanationFor(id: string, fallback: string): string {
  return CRITERIA_LABELS[id]?.explanation ?? fallback;
}
