/// <reference types="vite/client" />
import { describe, it, expect } from 'vitest';
import { GLOSSARY, getTerm } from './glossary';
import { LESSONS } from './lessons';
import lessonsSource from './lessons.ts?raw';
import glossarySource from './glossary.ts?raw';
import presetLabelsSource from './presetLabels.ts?raw';
import firstRunTourSource from './FirstRunTour.tsx?raw';
import explainThisSource from './ExplainThis.tsx?raw';

// Core terms that every lesson must contain somewhere in its text.
const CORE_TERMS = ['shift', 'rule', 'extra cost', 'staff comfort'];

// Fixed engine-term list. Independent of GLOSSARY on purpose. Any of these that
// a lesson uses must resolve via getTerm, or be absent from the lesson.
const ENGINE_TERMS = [...CORE_TERMS, 'guardrail', 'leeway', 'template', 'R_gi', 'Pareto'];

// Plain names that must appear on the same line as an engine letter.
const LETTER_PLAIN_NAMES: Record<string, string> = {
  M: 'Morning',
  D: 'Midday',
  E: 'Evening',
  N: 'Night',
};

// Copy of STEP_TERMS in ExplainThis.tsx. That constant is not exported, so the
// list is duplicated here. A test below asserts that the two stay identical.
const STEP_TERMS: Record<number, string[]> = {
  1: ['rule'],
  2: ['people needed', 'shift'],
  3: ['shift', 'shift type'],
  4: ['rule', 'consecutive days', 'consecutive nights', 'consecutive evenings', 'rest between shifts'],
  5: ['extra cost', 'staff comfort'],
  6: ['role', 'hourly wage', 'available days'],
};

// Default-screen sources to scan for engine words.
const SCANNED_FILES: Array<{ name: string; source: string }> = [
  { name: 'lessons.ts', source: lessonsSource },
  { name: 'glossary.ts', source: glossarySource },
  { name: 'presetLabels.ts', source: presetLabelsSource },
  { name: 'FirstRunTour.tsx', source: firstRunTourSource },
  { name: 'ExplainThis.tsx', source: explainThisSource },
];

// Whole-word, case-insensitive matches. Identifiers such as RefObject do not match.
const BANNED_WORD_PATTERNS: Array<{ word: string; pattern: RegExp }> = [
  { word: 'guardrail', pattern: /\bguardrail\b/i },
  { word: 'leeway', pattern: /\bleeway\b/i },
  { word: 'template', pattern: /\btemplate\b/i },
  { word: 'R_gi', pattern: /\bR_gi\b/i },
  { word: 'Pareto', pattern: /\bPareto\b/i },
  { word: 'obj', pattern: /\bobj\b/i },
  { word: 'Becker', pattern: /\bBecker\b/i },
  { word: 'Nurmi', pattern: /\bNurmi\b/i },
  { word: 'Hierholzer', pattern: /\bHierholzer\b/i },
  { word: 'multigraph', pattern: /\bmultigraph\b/i },
];

function escapeRegExp(text: string): string {
  return text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

// Whole-word, case-insensitive, allowing a plural "s" and any spacing between words.
function termPattern(term: string): RegExp {
  const body = term.split(' ').map(escapeRegExp).join('\\s+');
  return new RegExp(`\\b${body}s?\\b`, 'i');
}

function lessonText(lesson: (typeof LESSONS)[number]): string {
  return [lesson.title, lesson.explanation, lesson.example, lesson.whyItMatters].join(' ');
}

/**
 * Removes only full-line // comments and /* ... *\/ blocks. A // that follows code
 * on the same line, or sits inside a string literal, is left alone.
 * Block comments keep their newlines so line numbers still match.
 */
function stripComments(source: string): string {
  const withoutBlocks = source.replace(/\/\*[\s\S]*?\*\//g, (block) => block.replace(/[^\n]/g, ''));
  return withoutBlocks.replace(/^[ \t]*\/\/.*$/gm, '');
}

/** Flags each engine letter such as "(M)" whose line does not also contain its plain name. */
function findEngineLetterHits(fileName: string, text: string): string[] {
  const hits: string[] = [];
  text.split('\n').forEach((line, index) => {
    const pattern = /\((M|D|E|N)\)/g;
    let match: RegExpExecArray | null = pattern.exec(line);
    while (match !== null) {
      const letter = match[1];
      if (!line.includes(LETTER_PLAIN_NAMES[letter])) {
        hits.push(`${fileName}:${index + 1} "(${letter})"`);
      }
      match = pattern.exec(line);
    }
  });
  return hits;
}

function findBannedHits(): string[] {
  const hits: string[] = [];
  for (const file of SCANNED_FILES) {
    const text = stripComments(file.source);
    for (const { word, pattern } of BANNED_WORD_PATTERNS) {
      if (pattern.test(text)) {
        hits.push(`${file.name}: "${word}"`);
      }
    }
    hits.push(...findEngineLetterHits(file.name, text));
  }
  return hits;
}

/** Reads the STEP_TERMS block from ExplainThis.tsx source as text. Returns undefined if not found. */
function extractStepTerms(source: string): Record<number, string[]> | undefined {
  const block = /const STEP_TERMS[^=]*=\s*\{([\s\S]*?)\n\};/.exec(source);
  if (block === null) return undefined;
  const parsed: Record<number, string[]> = {};
  const entry = /(\d+)\s*:\s*\[([^\]]*)\]/g;
  let match: RegExpExecArray | null = entry.exec(block[1]);
  while (match !== null) {
    const terms: string[] = [];
    const quoted = /'([^']*)'|"([^"]*)"/g;
    let term: RegExpExecArray | null = quoted.exec(match[2]);
    while (term !== null) {
      terms.push(term[1] ?? term[2] ?? '');
      term = quoted.exec(match[2]);
    }
    parsed[Number(match[1])] = terms;
    match = entry.exec(block[1]);
  }
  return parsed;
}

describe('lesson-to-glossary coverage', () => {
  it('resolves every engine term a lesson uses via getTerm', () => {
    const unresolved: string[] = [];
    for (const lesson of LESSONS) {
      const text = lessonText(lesson);
      for (const term of ENGINE_TERMS) {
        if (termPattern(term).test(text) && getTerm(term) === undefined) {
          unresolved.push(`step ${lesson.stepId}: "${term}"`);
        }
      }
    }
    expect(unresolved, `lesson terms not in GLOSSARY: ${unresolved.join(', ')}`).toEqual([]);
  });

  it('contains the four core terms in every lesson', () => {
    const missing: string[] = [];
    for (const lesson of LESSONS) {
      const text = lessonText(lesson);
      for (const term of CORE_TERMS) {
        if (!termPattern(term).test(text)) {
          missing.push(`step ${lesson.stepId}: "${term}"`);
        }
      }
    }
    expect(missing, `missing core terms: ${missing.join(', ')}`).toEqual([]);
  });

  it('resolves every STEP_TERMS entry used by ExplainThis via getTerm', () => {
    const unresolved: string[] = [];
    for (const [step, terms] of Object.entries(STEP_TERMS)) {
      for (const term of terms) {
        if (getTerm(term) === undefined) {
          unresolved.push(`step ${step}: "${term}"`);
        }
      }
    }
    expect(unresolved, `unresolved STEP_TERMS: ${unresolved.join(', ')}`).toEqual([]);
  });

  it('has glossary entries for the terms it checks', () => {
    expect(GLOSSARY.length).toBeGreaterThan(0);
  });
});

describe('glossary coverage', () => {
  it('gives every GLOSSARY entry a non-empty term, plain and example', () => {
    const incomplete = GLOSSARY.filter(
      (entry) => entry.term.trim() === '' || entry.plain.trim() === '' || entry.example.trim() === '',
    ).map((entry) => entry.term || '(empty term)');
    expect(incomplete, `incomplete GLOSSARY entries: ${incomplete.join(', ')}`).toEqual([]);
  });
});

describe('STEP_TERMS sync', () => {
  it('matches the STEP_TERMS block in ExplainThis.tsx', () => {
    expect(extractStepTerms(explainThisSource), 'STEP_TERMS block not found in ExplainThis.tsx').toEqual(STEP_TERMS);
  });
});

describe('lesson step coverage', () => {
  it('has a lesson for each step id 1 to 5', () => {
    for (let step = 1; step <= 5; step += 1) {
      expect(LESSONS.some((lesson) => lesson.stepId === step), `step ${step} has no lesson`).toBe(true);
    }
  });
});

describe('default-screen banned words', () => {
  it('contains no banned engine word and no engine letter without its plain name, outside comments', () => {
    const hits = findBannedHits();
    expect(hits, `banned words found: ${hits.join(', ')}`).toEqual([]);
  });
});
