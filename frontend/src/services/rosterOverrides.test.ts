import { describe, it, expect } from 'vitest';
import type { RosterCellOverride, ShiftOrOffCode, SolveResponse } from '../types';
import { makeSolution, makeRosterLine } from '../test/solutionFixture';
import {
  MIN_REST_HOURS,
  OVERTIME_THRESHOLD_HOURS,
  availableShiftCodes,
  buildCycleSlots,
  checkLineAfterOverride,
  previewOverride,
  pruneOverrides,
  resolveCell,
  resolvedLineHours,
  restHoursBetween,
  shiftClocksFromSolution,
  indexOverrides,
} from './rosterOverrides';

/** A solve whose shift codes carry real clock windows, so rest arithmetic is exercised. */
const WINDOWS: Record<string, { window: string; hours: number; start: number }> = {
  M: { window: '06:00 - 14:00', hours: 8, start: 6 },
  D: { window: '10:00 - 18:00', hours: 8, start: 10 },
  E: { window: '16:00 - 24:00', hours: 8, start: 16 },
  N: { window: '22:00 - 06:00', hours: 8, start: 22 },
};

function lineWithCodes(lineNumber: number, codes: ShiftOrOffCode[]) {
  const line = makeRosterLine(lineNumber, {
    current_cycle_week: lineNumber,
    assigned_person: `Staff ${lineNumber}`,
    hourly_wage: 20,
  });
  line.days = codes.map((code, dayIndex) => ({
    ...line.days[dayIndex],
    day_index: dayIndex,
    shift_code: code,
    shift_type_id: code === 'OFF' ? null : `ST-${code}`,
    time_window: code === 'OFF' ? 'Rest / Off' : WINDOWS[code].window,
    duration_hours: code === 'OFF' ? 0 : WINDOWS[code].hours,
  }));
  line.weekly_hours = codes.reduce((a, c) => a + (c === 'OFF' ? 0 : WINDOWS[c].hours), 0);
  line.overtime_hours = Math.max(0, line.weekly_hours - OVERTIME_THRESHOLD_HOURS);
  return line;
}

/**
 * Two lines. Line 1 ends its week on an EVENING shift, line 2 opens its week OFF.
 * In the real cycle line 1's Sunday is followed by line 2's Monday, so turning line 2's
 * Monday into a MORNING shift creates a clopening across the line boundary.
 */
function twoLineSolution(
  line1: ShiftOrOffCode[] = ['M', 'M', 'M', 'M', 'OFF', 'OFF', 'E'],
  line2: ShiftOrOffCode[] = ['OFF', 'D', 'D', 'D', 'D', 'D', 'OFF']
): SolveResponse {
  return makeSolution({
    lineCount: 2,
    solution: { roster_lines: [lineWithCodes(1, line1), lineWithCodes(2, line2)] },
  });
}

describe('shift clocks read back from a solved roster', () => {
  it('recovers each code start hour and duration from the cell windows', () => {
    const clocks = shiftClocksFromSolution(twoLineSolution());
    expect(clocks.M).toEqual({ start_hour: 6, duration_hours: 8, time_window: '06:00 - 14:00' });
    expect(clocks.E.start_hour).toBe(16);
    expect(clocks.OFF).toEqual({ start_hour: 0, duration_hours: 0, time_window: 'Rest / Off' });
  });
});

describe('rest hours between consecutive day slots', () => {
  it('is a full day when either side is OFF', () => {
    expect(
      restHoursBetween(
        { line_number: 1, day_index: 0, shift_code: 'OFF', start_hour: 0, duration_hours: 0 },
        { line_number: 1, day_index: 1, shift_code: 'M', start_hour: 6, duration_hours: 8 }
      )
    ).toBe(24);
  });

  it('is the gap from one shift ending to the next starting', () => {
    // Evening ends at 24:00, morning starts at 06:00 the next day: 6 hours.
    expect(
      restHoursBetween(
        { line_number: 1, day_index: 6, shift_code: 'E', start_hour: 16, duration_hours: 8 },
        { line_number: 2, day_index: 0, shift_code: 'M', start_hour: 6, duration_hours: 8 }
      )
    ).toBe(6);
  });
});

describe('the cycle is continuous across line boundaries', () => {
  it('places line 2 Monday immediately after line 1 Sunday', () => {
    const solution = twoLineSolution();
    const slots = buildCycleSlots(solution.roster_lines, [], shiftClocksFromSolution(solution));

    expect(slots).toHaveLength(14);
    expect(slots[6]).toMatchObject({ line_number: 1, day_index: 6, shift_code: 'E' });
    expect(slots[7]).toMatchObject({ line_number: 2, day_index: 0, shift_code: 'OFF' });
  });

  it('wraps the last line Sunday round to the first line Monday', () => {
    const solution = twoLineSolution(['M', 'M', 'M', 'M', 'OFF', 'OFF', 'OFF'], [
      'OFF',
      'D',
      'D',
      'D',
      'D',
      'OFF',
      'E',
    ]);
    const clocks = shiftClocksFromSolution(solution);
    // Line 1's Monday becomes a morning shift. Its predecessor in the cycle is the LAST
    // line's Sunday evening, which is the wrap the solver's guardrail comment describes.
    const override: RosterCellOverride = {
      cycle_week: 1,
      day_index: 0,
      shift_code: 'M',
      original_shift_code: 'M',
    };
    const slots = buildCycleSlots(solution.roster_lines, [override], clocks);
    const findings = checkLineAfterOverride(slots, 0, 2);

    expect(findings.some((f) => f.rule === 'clopening')).toBe(true);
    expect(findings.find((f) => f.rule === 'clopening')!.message).toContain('line 2 closes');
  });
});

describe('an override is re-checked on the affected line only', () => {
  it('refuses nothing but reports a clopening created across the line boundary', () => {
    const solution = twoLineSolution();
    const preview = previewOverride(solution, [], {
      cycle_week: 2,
      day_index: 0,
      shift_code: 'M',
      original_shift_code: 'OFF',
    });

    const clopening = preview.findings.find((f) => f.rule === 'clopening');
    expect(clopening).toBeDefined();
    expect(clopening!.line_number).toBe(2);
    expect(clopening!.message).toContain('Sunday');
    expect(clopening!.message).toContain('Monday');
  });

  it('reports the 16-hour rest shortfall with the hours it actually found', () => {
    const solution = twoLineSolution();
    const preview = previewOverride(solution, [], {
      cycle_week: 2,
      day_index: 0,
      shift_code: 'M',
      original_shift_code: 'OFF',
    });

    const rest = preview.findings.find((f) => f.rule === 'rest');
    expect(rest).toBeDefined();
    expect(rest!.message).toContain('only 6h');
    expect(rest!.message).toContain(`${MIN_REST_HOURS}h`);
  });

  it('reports crossing the 40-hour overtime boundary and by how much', () => {
    // Line 2 already works 5 days; a sixth puts it at 48 hours.
    const solution = twoLineSolution();
    const preview = previewOverride(solution, [], {
      cycle_week: 2,
      day_index: 6,
      shift_code: 'D',
      original_shift_code: 'OFF',
    });

    expect(preview.weekly_hours).toBe(48);
    expect(preview.overtime_hours).toBe(8);
    const ot = preview.findings.find((f) => f.rule === 'overtime');
    expect(ot).toBeDefined();
    expect(ot!.message).toContain('48h');
    expect(ot!.message).toContain('8h past');
  });

  it('finds nothing wrong with an edit that only removes work', () => {
    const solution = twoLineSolution();
    const preview = previewOverride(solution, [], {
      cycle_week: 2,
      day_index: 1,
      shift_code: 'OFF',
      original_shift_code: 'D',
    });

    expect(preview.findings).toEqual([]);
    expect(preview.weekly_hours).toBe(32);
    expect(preview.overtime_hours).toBe(0);
  });

  it('leaves the lines it did not touch unchanged', () => {
    const solution = twoLineSolution();
    const clocks = shiftClocksFromSolution(solution);
    const override: RosterCellOverride = {
      cycle_week: 2,
      day_index: 1,
      shift_code: 'OFF',
      original_shift_code: 'D',
    };
    const slots = buildCycleSlots(solution.roster_lines, [override], clocks);

    expect(slots.slice(0, 7).map((s) => s.shift_code)).toEqual([
      'M',
      'M',
      'M',
      'M',
      'OFF',
      'OFF',
      'E',
    ]);
  });
});

describe('the generated value stays retrievable', () => {
  it('marks the cell modified and keeps what it was generated as', () => {
    const solution = twoLineSolution();
    const clocks = shiftClocksFromSolution(solution);
    const byKey = indexOverrides([
      { cycle_week: 2, day_index: 0, shift_code: 'E', original_shift_code: 'OFF' },
    ]);
    const line2 = solution.roster_lines[1];

    const edited = resolveCell(line2.days[0], 2, byKey, clocks);
    expect(edited.is_modified).toBe(true);
    expect(edited.shift_code).toBe('E');
    expect(edited.original_shift_code).toBe('OFF');
    expect(edited.time_window).toBe('16:00 - 24:00');

    const untouched = resolveCell(line2.days[1], 2, byKey, clocks);
    expect(untouched.is_modified).toBe(false);
    expect(untouched.shift_code).toBe('D');
  });

  it('recalculates the edited line hours and overtime', () => {
    const solution = twoLineSolution();
    const clocks = shiftClocksFromSolution(solution);
    const byKey = indexOverrides([
      { cycle_week: 2, day_index: 0, shift_code: 'E', original_shift_code: 'OFF' },
      { cycle_week: 2, day_index: 6, shift_code: 'E', original_shift_code: 'OFF' },
    ]);

    expect(resolvedLineHours(solution.roster_lines[1], byKey, clocks)).toEqual({
      weekly_hours: 56,
      regular_hours: 40,
      overtime_hours: 16,
    });
  });
});

describe('only shifts this schedule defines can be chosen', () => {
  it('offers OFF plus the codes with real clock times, and nothing else', () => {
    const clocks = shiftClocksFromSolution(twoLineSolution());
    expect(availableShiftCodes(clocks)).toEqual(['M', 'D', 'E', 'OFF']);
  });
});

describe('restored overrides are checked against the current solve', () => {
  it('drops an edit naming a pattern the new solve does not have', () => {
    const solution = twoLineSolution();
    const kept = pruneOverrides(
      [
        { cycle_week: 2, day_index: 0, shift_code: 'M', original_shift_code: 'OFF' },
        { cycle_week: 9, day_index: 0, shift_code: 'M', original_shift_code: 'OFF' },
      ],
      solution
    );

    expect(kept).toHaveLength(1);
    expect(kept[0].cycle_week).toBe(2);
  });

  it('drops an edit that sets a cell to the value it was generated as', () => {
    const solution = twoLineSolution();
    expect(
      pruneOverrides([{ cycle_week: 1, day_index: 0, shift_code: 'M', original_shift_code: 'M' }], solution)
    ).toEqual([]);
  });
});
