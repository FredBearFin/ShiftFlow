/**
 * Turns plain answers about a business ("open 8am-6pm, busiest in the evening,
 * need 2 people at minimum and 5 at peak") into the demand matrix and shift
 * templates the solver actually needs. Replaces forcing a business into one of
 * a handful of industry stereotypes with questions any business can answer.
 */
import { ShiftTemplate, TemplateCode } from '../../types';

export type BusyPeriod = 'morning' | 'midday' | 'evening' | 'night' | 'steady';
export type WeekendPattern = 'busier' | 'quieter' | 'same';

export interface BusinessAnswers {
  /** 0=Mon .. 6=Sun */
  openDays: number[];
  runs24Hours: boolean;
  openHour: number; // 0-23, ignored when runs24Hours
  closeHour: number; // 1-24 (24 = midnight), ignored when runs24Hours
  busyPeriod: BusyPeriod;
  peakStaff: number;
  minStaff: number;
  weekendPattern: WeekendPattern;
}

const PEAK_HOUR_FOR_PERIOD: Record<Exclude<BusyPeriod, 'steady'>, number> = {
  morning: 8,
  midday: 12,
  evening: 18,
  night: 23,
};

function openSpanHours(answers: BusinessAnswers): number {
  if (answers.runs24Hours) return 24;
  const span = answers.closeHour - answers.openHour;
  return span > 0 ? span : span + 24;
}

function isHourOpen(hour: number, answers: BusinessAnswers): boolean {
  if (answers.runs24Hours) return true;
  const span = openSpanHours(answers);
  const offset = (hour - answers.openHour + 24) % 24;
  return offset < span;
}

/** Builds a 7x24 matrix of how many staff are needed each hour, from plain answers. */
export function buildDemandMatrix(answers: BusinessAnswers): number[][] {
  const { openDays, busyPeriod, peakStaff, minStaff, weekendPattern } = answers;
  const peak = Math.max(minStaff, peakStaff);
  const min = Math.max(0, Math.min(minStaff, peak));
  const span = openSpanHours(answers);

  return Array.from({ length: 7 }, (_, day) => {
    if (!openDays.includes(day)) return Array(24).fill(0);

    const isWeekend = day === 5 || day === 6;
    const weekendMultiplier = isWeekend ? (weekendPattern === 'busier' ? 1.3 : weekendPattern === 'quieter' ? 0.7 : 1) : 1;

    return Array.from({ length: 24 }, (_, hour) => {
      if (!isHourOpen(hour, answers)) return 0;
      if (busyPeriod === 'steady') {
        return Math.max(0, Math.round(((peak + min) / 2) * weekendMultiplier));
      }
      const peakHour = PEAK_HOUR_FOR_PERIOD[busyPeriod];
      // Distance from this hour to the busiest hour, wrapped around a 24h clock.
      const rawDist = Math.abs(hour - peakHour);
      const dist = Math.min(rawDist, 24 - rawDist);
      // Half the open window: hours this far from the peak taper down to `min`.
      const falloffWidth = Math.max(1, span / 2);
      const closeness = Math.max(0, 1 - dist / falloffWidth);
      const value = min + (peak - min) * closeness;
      return Math.max(0, Math.min(40, Math.round(value * weekendMultiplier)));
    });
  });
}

const TEMPLATE_NAMES: Record<TemplateCode, string> = {
  M: 'Morning',
  D: 'Midday',
  E: 'Evening',
  N: 'Night',
};

/** Builds reasonable shift templates spanning the open hours, from plain answers. */
export function buildShiftTemplates(answers: BusinessAnswers): ShiftTemplate[] {
  const span = openSpanHours(answers);
  const count = Math.min(4, Math.max(1, Math.ceil(span / 8)));
  const codes: TemplateCode[] = (['M', 'D', 'E', 'N'] as TemplateCode[]).slice(0, count);
  const perShift = span / count;
  const startBase = answers.runs24Hours ? 0 : answers.openHour;

  return codes.map((code, i) => {
    const start = Math.round(startBase + i * perShift);
    const duration = Math.max(6, Math.min(9, Math.round(perShift)));
    return {
      code,
      name: `${TEMPLATE_NAMES[code]} Shift`,
      earliest_start: start,
      latest_end: start + duration + 2,
      min_duration: 6,
      max_duration: 9,
      preferred_start: start,
      preferred_duration: duration,
      enabled: true,
    };
  });
}
