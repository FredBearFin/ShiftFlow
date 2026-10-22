import { describe, it, expect } from 'vitest';
import { parseDemandGrid, parseFlatDemand, parseGrid, parseShifts, gridToText, MAX_AUDIT_CELLS } from './auditParse';

const CODES = ['D', 'N'];
const cycle7 = 'D D D - - N N';

describe('parseGrid', () => {
  it('reads space separated rows', () => {
    const { lines, errors } = parseGrid(`Crew1 ${cycle7}`, 7, CODES);
    expect(errors).toEqual([]);
    expect(lines).toEqual([{ label: 'Crew1', cells: ['D', 'D', 'D', 'OFF', 'OFF', 'N', 'N'] }]);
  });

  it('reads comma and tab separated rows', () => {
    const csv = parseGrid('A,D,D,D,OFF,OFF,N,N', 7, CODES);
    expect(csv.errors).toEqual([]);
    expect(csv.lines[0].cells[3]).toBe('OFF');
    const tsv = parseGrid('B\tD\tD\tD\t\t.\tn\tn', 7, CODES);
    expect(tsv.errors).toEqual([]);
    expect(tsv.lines[0].cells).toEqual(['D', 'D', 'D', 'OFF', 'OFF', 'N', 'N']);
  });

  it('treats blank, dash, dot and OFF cells as days off', () => {
    const { lines } = parseGrid('A,D,,-,.,off,D,D', 7, CODES);
    expect(lines[0].cells).toEqual(['D', 'OFF', 'OFF', 'OFF', 'OFF', 'D', 'D']);
  });

  it('names the row and day of an unknown code', () => {
    const rows = ['A D D D - - N N', 'B D D D - - N N', 'C D D D - - N N'];
    rows[2] = 'C D D D - - N XN';
    const { errors } = parseGrid(rows.join('\n'), 7, CODES);
    expect(errors).toEqual(['Row 3, day 7: "XN" is not a shift you defined.']);
  });

  it('reports a row with the wrong number of days', () => {
    const { errors } = parseGrid('A D D D', 7, CODES);
    expect(errors[0]).toContain('Row 1: has 3 days but the cycle is 7 days');
  });

  it('rejects a grid over the cell limit before sending', () => {
    const row = (n: number) => `L${n} ${new Array(56).fill('D').join(' ')}`;
    const text = Array.from({ length: MAX_AUDIT_CELLS / 56 + 1 }, (_, i) => row(i)).join('\n');
    const { errors } = parseGrid(text, 56, CODES);
    expect(errors.some((e) => e.includes('cells'))).toBe(true);
  });

  it('rejects duplicate line names', () => {
    const { errors } = parseGrid(`A ${cycle7}\nA ${cycle7}`, 7, CODES);
    expect(errors[0]).toContain('used twice');
  });

  it('returns labels as plain text without evaluating them', () => {
    const scriptLabel = '<script>alert(1)</script>';
    const formulaLabel = '=HYPERLINK("http://x","y")';
    const { lines, errors } = parseGrid(`${scriptLabel}\tD\tD\tD\t-\t-\tN\tN\n${formulaLabel}\tD\tD\tD\t-\t-\tN\tN`, 7, CODES);
    expect(errors).toEqual([]);
    expect(lines.map((l) => l.label)).toEqual([scriptLabel, formulaLabel]);
  });

  it('round-trips through gridToText', () => {
    const first = parseGrid(`Crew1 ${cycle7}`, 7, CODES);
    const second = parseGrid(gridToText(first.lines), 7, CODES);
    expect(second.lines).toEqual(first.lines);
  });
});

describe('parseDemandGrid', () => {
  const row = (n: number) => new Array(24).fill(String(n)).join('\t');
  const grid = (rows: string[]) => rows.join('\n');
  const seven = Array.from({ length: 7 }, (_, i) => row(i));

  it('reads a valid 7 by 24 grid', () => {
    const { matrix, errors } = parseDemandGrid(grid(seven));
    expect(errors).toEqual([]);
    expect(matrix).toHaveLength(7);
    expect(matrix?.[3]).toEqual(new Array(24).fill(3));
  });

  it('accepts commas and spaces and ignores blank lines', () => {
    const rows = [seven[0].replace(/\t/g, ','), '', seven[1].replace(/\t/g, ' '), ...seven.slice(2), '  '];
    const { matrix, errors } = parseDemandGrid(grid(rows));
    expect(errors).toEqual([]);
    expect(matrix?.[1][0]).toBe(1);
  });

  it('rejects the wrong number of rows', () => {
    const { matrix, errors } = parseDemandGrid(grid(seven.slice(0, 6)));
    expect(matrix).toBeNull();
    expect(errors[0]).toContain('6 rows but it needs 7');
  });

  it('rejects the wrong number of columns, naming the row', () => {
    const rows = [...seven];
    rows[4] = new Array(23).fill('1').join(' ');
    const { errors } = parseDemandGrid(grid(rows));
    expect(errors).toEqual(['Row 5: has 23 numbers but it needs 24, one for each hour.']);
  });

  it('names the row and hour of a value that is not a number', () => {
    const rows = [...seven];
    rows[2] = rows[2].split('\t').map((c, i) => (i === 14 ? 'x' : c)).join('\t');
    const { errors } = parseDemandGrid(grid(rows));
    expect(errors).toEqual(['Row 3, hour 14: "x" is not a whole number from 0 to 500.']);
  });

  it('rejects values out of range, negatives and decimals', () => {
    const rows = [...seven];
    rows[0] = ['501', '-1', '2.5', ...new Array(21).fill('1')].join(' ');
    const { errors, matrix } = parseDemandGrid(grid(rows));
    expect(matrix).toBeNull();
    expect(errors).toHaveLength(3);
    expect(errors[0]).toContain('Row 1, hour 0: "501"');
  });
});

describe('parseFlatDemand', () => {
  it('fills every cell and rejects bad values', () => {
    const ok = parseFlatDemand('4');
    expect(ok.matrix).toHaveLength(7);
    expect(ok.matrix?.every((r) => r.length === 24 && r.every((v) => v === 4))).toBe(true);
    expect(parseFlatDemand('501').matrix).toBeNull();
    expect(parseFlatDemand('1.5').errors).toHaveLength(1);
  });
});

describe('parseShifts', () => {
  const row = { code: 'D', name: 'Day', start: '07:00', hours: '12', kind: 'day' as const };

  it('builds shift definitions', () => {
    const { shifts, errors } = parseShifts([row]);
    expect(errors).toEqual([]);
    expect(shifts).toEqual([
      { code: 'D', name: 'Day', start_minute: 420, duration_minutes: 720, kind: 'day' },
    ]);
  });

  it('rejects bad codes, times and lengths', () => {
    expect(parseShifts([{ ...row, code: 'OFF' }]).errors[0]).toContain('OFF');
    expect(parseShifts([{ ...row, code: 'TOOLONG' }]).errors[0]).toContain('1 to 4');
    expect(parseShifts([{ ...row, start: '25:00' }]).errors[0]).toContain('start time');
    expect(parseShifts([{ ...row, hours: '0' }]).errors[0]).toContain('between 1 and 20');
    expect(parseShifts([row, { ...row, code: 'd' }]).errors[0]).toContain('twice');
  });
});
