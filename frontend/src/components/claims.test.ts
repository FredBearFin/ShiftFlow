import { describe, expect, it } from 'vitest';

// Claims policy (Constitution amendment of 2026-10-22): no visible string may say a schedule is
// legal, compliant, guaranteed or certified. This scans the string literals and JSX text of every
// component source file. Comments and identifiers are ignored.

const sources = import.meta.glob('./**/*.tsx', {
  query: '?raw',
  import: 'default',
  eager: true,
}) as Record<string, string>;

const BANNED = [
  'guarantee',
  'guaranteed',
  'compliant',
  'certified',
  'safe harbor',
  'protects the business',
  'fewer accidents',
  'compliance',
];

// Exact visible strings that may keep a banned word, each with its reason.
const ALLOWLIST: Record<string, string> = {
  // Names the existing tab in the shortcuts list; KeyboardShortcutsModal.tsx is outside WP-1.1's file list.
  'DOL Compliance': 'tab name in KeyboardShortcutsModal; rename needs its own WP',
};

function stripComments(src: string): string {
  return src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:'"`])\/\/[^\n]*/g, '$1');
}

function visibleStrings(src: string): string[] {
  const code = stripComments(src);
  const out: string[] = [];
  const literal = /(['"`])((?:\\.|(?!\1)[^\\\n])*)\1/g;
  let m: RegExpExecArray | null;
  while ((m = literal.exec(code)) !== null) out.push(m[2]);
  const jsxText = />([^<>{}]+)</g;
  while ((m = jsxText.exec(code)) !== null) out.push(m[1]);
  return out.map((s) => s.trim()).filter((s) => s.length > 0);
}

// Strings that are identifiers or ids, not visible text.
function looksLikeIdentifier(s: string): boolean {
  return /^[\w./:#@-]+$/.test(s) && !/\s/.test(s) && !/^[A-Z][a-z]+$/.test(s);
}

describe('claims policy', () => {
  it('finds component sources to scan', () => {
    expect(Object.keys(sources).length).toBeGreaterThan(5);
  });

  it('has no banned claim words in visible text', () => {
    const hits: string[] = [];
    for (const [file, src] of Object.entries(sources)) {
      if (file.endsWith('.test.tsx')) continue;
      for (const text of visibleStrings(src)) {
        if (looksLikeIdentifier(text) || text in ALLOWLIST) continue;
        const lower = text.toLowerCase();
        for (const word of BANNED) {
          if (new RegExp(`\\b${word}\\b`).test(lower)) hits.push(`${file}: "${text}" (${word})`);
        }
      }
    }
    expect(hits).toEqual([]);
  });
});
