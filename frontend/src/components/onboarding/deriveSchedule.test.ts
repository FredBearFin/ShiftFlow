import { describe, it, expect } from 'vitest';
import { buildDemandMatrix, buildShiftTemplates, BusinessAnswers } from './deriveSchedule';

const baseAnswers: BusinessAnswers = {
  openDays: [0, 1, 2, 3, 4, 5, 6],
  runs24Hours: false,
  openHour: 8,
  closeHour: 20,
  busyPeriod: 'midday',
  peakStaff: 5,
  minStaff: 2,
  weekendPattern: 'same',
};

describe('buildDemandMatrix', () => {
  it('is zero outside open hours', () => {
    const matrix = buildDemandMatrix(baseAnswers);
    for (const day of matrix) {
      for (let hr = 0; hr < 8; hr += 1) expect(day[hr]).toBe(0);
      for (let hr = 20; hr < 24; hr += 1) expect(day[hr]).toBe(0);
    }
  });

  it('is zero all day on a closed day', () => {
    const matrix = buildDemandMatrix({ ...baseAnswers, openDays: [0, 1, 2, 3, 4] });
    expect(matrix[5].every((v) => v === 0)).toBe(true);
    expect(matrix[6].every((v) => v === 0)).toBe(true);
  });

  it('peaks at the busy hour and tapers toward the minimum at the open/close edges', () => {
    const matrix = buildDemandMatrix(baseAnswers);
    const monday = matrix[0];
    expect(monday[12]).toBe(5); // midday peak
    expect(monday[8]).toBeLessThan(monday[12]);
    expect(monday[19]).toBeLessThan(monday[12]);
    expect(monday[8]).toBeGreaterThanOrEqual(2);
  });

  it('stays flat between min and max for a steady business', () => {
    const matrix = buildDemandMatrix({ ...baseAnswers, busyPeriod: 'steady' });
    const openHours = matrix[0].slice(8, 20);
    expect(new Set(openHours).size).toBe(1);
  });

  it('applies the weekend multiplier only on Saturday/Sunday', () => {
    const busier = buildDemandMatrix({ ...baseAnswers, busyPeriod: 'steady', weekendPattern: 'busier' });
    expect(busier[5][12]).toBeGreaterThan(busier[0][12]);
    expect(busier[0][12]).toBe(busier[1][12]);
  });

  it('covers all 24 hours for a 24-hour business', () => {
    const matrix = buildDemandMatrix({ ...baseAnswers, runs24Hours: true, busyPeriod: 'steady' });
    expect(matrix[0].every((v) => v > 0)).toBe(true);
  });

  it('never exceeds the 0-40 bounds the backend enforces', () => {
    const matrix = buildDemandMatrix({ ...baseAnswers, peakStaff: 1000, minStaff: 0 });
    for (const day of matrix) {
      for (const v of day) {
        expect(v).toBeGreaterThanOrEqual(0);
        expect(v).toBeLessThanOrEqual(40);
      }
    }
  });
});

describe('buildShiftTemplates', () => {
  it('produces at least one enabled template spanning the open hours', () => {
    const templates = buildShiftTemplates(baseAnswers);
    expect(templates.length).toBeGreaterThan(0);
    expect(templates.every((t) => t.enabled)).toBe(true);
  });

  it('keeps every template internally consistent (min <= preferred <= max duration)', () => {
    for (const answers of [
      baseAnswers,
      { ...baseAnswers, runs24Hours: true },
      { ...baseAnswers, openHour: 22, closeHour: 6 },
    ]) {
      for (const t of buildShiftTemplates(answers)) {
        expect(t.min_duration).toBeLessThanOrEqual(t.preferred_duration);
        expect(t.preferred_duration).toBeLessThanOrEqual(t.max_duration);
        expect(t.earliest_start).toBeLessThanOrEqual(t.preferred_start);
      }
    }
  });

  it('caps at 4 templates for a full 24-hour operation', () => {
    const templates = buildShiftTemplates({ ...baseAnswers, runs24Hours: true });
    expect(templates.length).toBeLessThanOrEqual(4);
  });
});
