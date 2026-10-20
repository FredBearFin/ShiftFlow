import { describe, it, expect } from 'vitest';
import { GLOSSARY, getTerm } from './glossary';

const BANNED_WORDS = [
  'guardrail',
  'leeway',
  'template',
  'm/d/e/n',
  'r_gi',
  'pareto',
  'obj',
  'becker',
  'nurmi',
  'hierholzer',
  'multigraph',
];

function entryText(entry: { term: string; plain: string; example: string }): string {
  return [entry.term, entry.plain, entry.example].join(' ');
}

describe('GLOSSARY', () => {
  it('has a non-empty term, plain and example for every entry', () => {
    for (const entry of GLOSSARY) {
      expect(entry.term.trim().length).toBeGreaterThan(0);
      expect(entry.plain.trim().length).toBeGreaterThan(0);
      expect(entry.example.trim().length).toBeGreaterThan(0);
    }
  });

  it('has no duplicate terms, case-insensitively', () => {
    const terms = GLOSSARY.map((entry) => entry.term.toLowerCase());
    expect(new Set(terms).size).toBe(terms.length);
  });

  it('uses no banned engine words in any definition or example', () => {
    for (const entry of GLOSSARY) {
      const text = entryText(entry).toLowerCase();
      for (const word of BANNED_WORDS) {
        expect(text, `"${word}" found in entry "${entry.term}"`).not.toContain(word);
      }
    }
  });
});

describe('getTerm', () => {
  it('finds an entry regardless of case', () => {
    expect(getTerm('shift')?.term).toBe('shift');
    expect(getTerm('SHIFT')?.term).toBe('shift');
    expect(getTerm('Extra Cost')?.term).toBe('extra cost');
    expect(getTerm('people NEEDED')?.term).toBe('people needed');
  });

  it('returns undefined for an unknown term', () => {
    expect(getTerm('not a real term')).toBeUndefined();
    expect(getTerm('')).toBeUndefined();
  });
});
