#!/usr/bin/env node
/**
 * F2 — replace raw hex literals and default-palette slate-* utilities in
 * frontend/src with the design tokens declared in frontend/src/index.css and
 * frontend/tailwind.config.js (PR F1).
 *
 * Mechanical. No visual change is intended beyond F1's two unifications
 * (slate-900 -> --ink and slate-500 -> --muted).
 *
 * DRY RUN BY DEFAULT. Nothing is written unless --write is passed.
 *
 *   node scripts/codemod-tokens.mjs                 # report only
 *   node scripts/codemod-tokens.mjs --write         # apply
 *   node scripts/codemod-tokens.mjs --write --root /path/to/copy/frontend
 *   node scripts/codemod-tokens.mjs --verbose       # list every rewrite
 *   node scripts/codemod-tokens.mjs --write --include-tests   # rewrite *.test.tsx too
 *   node scripts/codemod-tokens.mjs --check        # exit 1 if any hex/slate-* remains
 *
 * --check is the guard that keeps the tree from drifting back. It is NOT
 * wired into CI yet; see the lint-rule section of the README.
 *
 * Run it AFTER tracks A, B, C, E and I have merged. It touches nearly every
 * file under frontend/src, so running it against an un-merged tree makes an
 * unresolvable conflict.
 *
 * See scripts/README-codemod-tokens.md.
 */

import { readFileSync, writeFileSync, readdirSync, statSync } from 'node:fs';
import { join, relative, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { dirname } from 'node:path';

const HERE = dirname(fileURLToPath(import.meta.url));

// ---------------------------------------------------------------------------
// Options
// ---------------------------------------------------------------------------

const argv = process.argv.slice(2);
const WRITE = argv.includes('--write');
const VERBOSE = argv.includes('--verbose');
const INCLUDE_TESTS = argv.includes('--include-tests');
const CHECK = argv.includes('--check');
const rootFlag = argv.indexOf('--root');
const FRONTEND = rootFlag !== -1 && argv[rootFlag + 1]
  ? argv[rootFlag + 1]
  : join(HERE, '..', 'frontend');
const SRC = join(FRONTEND, 'src');

// ---------------------------------------------------------------------------
// Files this codemod deliberately leaves alone
// ---------------------------------------------------------------------------

const SKIP_FILES = [
  // The token source of truth. Its hex values ARE the tokens.
  join('src', 'index.css'),
  // Art. 4 freeze.
  join('src', 'services', 'api.ts'),
  join('src', 'types.ts'),
];

const isTest = (rel) =>
  /\.test\.(ts|tsx)$/.test(rel) || rel.startsWith(join('src', 'test') + sep);

const isSkipped = (rel) =>
  SKIP_FILES.some((s) => rel === s) ||
  // Tests assert on class-name strings, so by default they are left alone and
  // every hex/slate occurrence in them is reported as a required manual edit.
  // Button.test.tsx:23 asserts bg-[#4A6B5D] and WILL fail after a run until
  // it is updated. --include-tests rewrites them along with everything else.
  (!INCLUDE_TESTS && isTest(rel));

// ---------------------------------------------------------------------------
// Mapping tables
// ---------------------------------------------------------------------------

// Every hex that appears in frontend/src has exactly one token name (F1).
// Keys are upper-case; lookup upper-cases the match first.
const HEX_TO_TOKEN = {
  '#FFFFFF': 'card',
  '#F4F1EA': 'canvas',
  '#F8FAFC': 'surface-subtle',
  '#F1F5F9': 'surface',
  '#E4E9EC': 'surface-sunken',
  '#D9DFE3': 'surface-sunken-strong',
  '#E2E8F0': 'border-subtle',
  '#D1D5DB': 'border',
  '#7F8A92': 'border-control',
  '#2B3A42': 'ink',
  '#1E2A31': 'ink-strong',
  '#3A4650': 'ink-soft',
  '#5C6770': 'muted',
  '#4A6B5D': 'accent',
  '#3E5C50': 'accent-strong',
  '#EAF0EC': 'accent-soft',
  '#C28B47': 'warning',
  '#7A5420': 'warning-ink',
  '#F7EFE3': 'warning-soft',
  '#9F3A32': 'danger',
  '#862F28': 'danger-strong',
  '#F7EAE8': 'danger-soft',
};

// slate-* is role-dependent: text-slate-200 is a light label on a dark
// button, bg-slate-200 is a neutral chip fill, border-slate-200 is a hairline.
// They are three different tokens, so the table is keyed by role.
//
// A step left out of a role's table is NOT rewritten; it is reported for a
// human, because the right token depends on what it sits on.
const SLATE_BY_ROLE = {
  // text / fill / stroke / placeholder / caret / decoration
  text: {
    900: 'ink',
    800: 'ink',
    700: 'ink-soft',
    600: 'ink-soft',
    500: 'muted',
    // Track E is raising text-slate-400 for the 4.5:1 floor; --muted is
    // 5.79:1 on white and 5.13:1 on --canvas, which is where it wants to go.
    400: 'muted',
    // 50/100/200/300 omitted on purpose: as TEXT these only occur on a dark
    // fill, where the right token is --card or a dedicated on-ink token that
    // F1 did not declare. Reported, not guessed.
  },
  // bg / from / via / to
  bg: {
    50: 'surface-subtle',
    100: 'surface',
    200: 'surface-sunken',
    700: 'ink-soft',
    800: 'ink',
    900: 'ink',
    // 300/400/500/600 omitted on purpose: as a FILL these are mid-greys with
    // no exact token (--surface-sunken-strong is #D9DFE3 against slate-300's
    // #CBD5E1, a visible lightening). Reported, not guessed.
  },
  // border / border-{t,b,l,r,x,y} / divide / divide-{x,y} / ring / outline
  border: {
    50: 'border-subtle',
    100: 'border-subtle',
    200: 'border-subtle',
    300: 'border',
    400: 'border-control',
    500: 'border-control',
    700: 'ink-soft',
    800: 'ink',
    900: 'ink',
    // 600 omitted: no border at that weight exists in the tree today.
  },
};

// Tailwind colour families, grouped by the role their colour plays.
const FAMILY_ROLE = new Map();
for (const f of ['text', 'fill', 'stroke', 'placeholder', 'caret', 'decoration']) {
  FAMILY_ROLE.set(f, 'text');
}
for (const f of ['bg', 'from', 'via', 'to']) FAMILY_ROLE.set(f, 'bg');
for (const f of [
  'border', 'border-t', 'border-b', 'border-l', 'border-r', 'border-x', 'border-y',
  'divide', 'divide-x', 'divide-y', 'ring', 'ring-offset', 'outline',
]) {
  FAMILY_ROLE.set(f, 'border');
}
// Deliberately absent: `shadow-` (the single shadow is an rgba(), not a hex,
// and is not a colour token yet) and `accent-` (the form accent-color family,
// whose name would collide with the --accent token: accent-accent).

const FAMILIES = [...FAMILY_ROLE.keys()].sort((a, b) => b.length - a.length);
const FAMILY_ALT = FAMILIES.join('|');

// A Tailwind variant chain: hover:, focus-visible:, disabled:, group-hover:,
// before:, sm:, dark:, data-[x]:, peer-checked:, and any stack of them.
const VARIANTS = String.raw`(?:(?:[a-z0-9-]+|data-\[[^\]]*\]|group-[a-z-]+|peer-[a-z-]+|aria-\[[^\]]*\]):)*`;

// ---------------------------------------------------------------------------
// Rewrites
// ---------------------------------------------------------------------------

const rewrites = [];   // {file, line, from, to}
const residuals = [];  // {file, line, text, reason}

// bg-[#2B3A42] -> bg-ink   /   hover:border-[#7F8A92] -> hover:border-border-control
// An opacity modifier after the bracket is NOT rewritten: see the README.
const HEX_UTILITY = new RegExp(
  String.raw`\b(${VARIANTS})(${FAMILY_ALT})-\[(#[0-9A-Fa-f]{6})\](\/\d{1,3})?`,
  'g',
);

// text-slate-600 -> text-ink-soft   /   divide-slate-200 -> divide-border-subtle
const SLATE_UTILITY = new RegExp(
  String.raw`\b(${VARIANTS})(${FAMILY_ALT})-slate-(\d{2,3})(\/\d{1,3})?`,
  'g',
);

// A hex in a plain string: fill="#4f46e5", stroke='#e2e8f0', '#059669'.
// NEVER rewritten. CSS custom properties do not resolve inside SVG
// presentation attributes, so fill="var(--accent)" renders nothing.
const BARE_HEX = /(["'])(#[0-9A-Fa-f]{3,8})\1/g;

function lineOf(src, index) {
  let n = 1;
  for (let i = 0; i < index; i++) if (src[i] === '\n') n++;
  return n;
}

function transform(rel, src) {
  let out = src;

  out = out.replace(HEX_UTILITY, (match, variants, family, hex, alpha, offset) => {
    const line = lineOf(src, offset);
    const token = HEX_TO_TOKEN[hex.toUpperCase()];
    if (!token) {
      residuals.push({ file: rel, line, text: match, reason: 'hex has no token in F1' });
      return match;
    }
    if (alpha) {
      residuals.push({
        file: rel,
        line,
        text: match,
        reason: 'opacity modifier: a var()-backed utility drops silently with /NN',
      });
      return match;
    }
    const next = `${variants}${family}-${token}`;
    rewrites.push({ file: rel, line, from: match, to: next });
    return next;
  });

  out = out.replace(SLATE_UTILITY, (match, variants, family, step, alpha, offset) => {
    const line = lineOf(src, offset);
    if (alpha) {
      residuals.push({
        file: rel,
        line,
        text: match,
        reason: 'opacity modifier: a var()-backed utility drops silently with /NN',
      });
      return match;
    }
    const role = FAMILY_ROLE.get(family);
    const token = SLATE_BY_ROLE[role][Number(step)];
    if (!token) {
      residuals.push({
        file: rel,
        line,
        text: match,
        reason: `no ${role}-role token for slate-${step}; depends on what it sits on`,
      });
      return match;
    }
    const next = `${variants}${family}-${token}`;
    rewrites.push({ file: rel, line, from: match, to: next });
    return next;
  });

  for (const m of src.matchAll(BARE_HEX)) {
    residuals.push({
      file: rel,
      line: lineOf(src, m.index),
      text: m[0],
      reason: 'bare hex string: var() does not resolve in an SVG presentation attribute',
    });
  }

  return out;
}

// ---------------------------------------------------------------------------
// Walk
// ---------------------------------------------------------------------------

function walk(dir, acc = []) {
  for (const name of readdirSync(dir)) {
    const full = join(dir, name);
    if (statSync(full).isDirectory()) walk(full, acc);
    else if (/\.(ts|tsx)$/.test(name)) acc.push(full);
  }
  return acc;
}

let changedFiles = 0;
const skipped = [];

// A hex or slate-* utility inside a skipped test file is a class-name
// assertion that the codemod has just invalidated elsewhere. Name it loudly:
// the test will fail until a human updates it.
const CLASS_ASSERTION = /(#[0-9A-Fa-f]{6}|\bslate-\d{2,3}\b)/g;

for (const full of walk(SRC)) {
  const rel = relative(FRONTEND, full);
  if (isSkipped(rel)) {
    skipped.push(rel);
    if (isTest(rel)) {
      const src = readFileSync(full, 'utf8');
      for (const m of src.matchAll(CLASS_ASSERTION)) {
        residuals.push({
          file: rel,
          line: lineOf(src, m.index),
          text: m[0],
          reason: 'MANUAL: test asserts a class name this codemod rewrote; it will fail',
        });
      }
    }
    continue;
  }
  const src = readFileSync(full, 'utf8');
  const out = transform(rel, src);
  if (out !== src) {
    changedFiles++;
    if (WRITE) writeFileSync(full, out);
  }
}

// ---------------------------------------------------------------------------
// Report
// ---------------------------------------------------------------------------

const byReason = new Map();
for (const r of residuals) byReason.set(r.reason, (byReason.get(r.reason) || 0) + 1);

const MODE = WRITE
  ? 'APPLIED'
  : CHECK
  ? 'CHECK (nothing written)'
  : 'DRY RUN (nothing written; pass --write to apply)';
console.log(`\n${MODE}`);
console.log(`root: ${FRONTEND}\n`);
console.log(`rewrites:      ${rewrites.length}`);
console.log(`files changed: ${changedFiles}`);
console.log(`left alone:    ${residuals.length}`);
console.log(`files skipped: ${skipped.length}  (${skipped.join(', ') || 'none'})\n`);

if (VERBOSE) {
  console.log('--- rewrites ---');
  for (const r of rewrites) console.log(`  ${r.file}:${r.line}  ${r.from}  ->  ${r.to}`);
  console.log('');
}

if (residuals.length) {
  console.log('--- left alone, by reason ---');
  for (const [reason, n] of [...byReason].sort((a, b) => b[1] - a[1])) {
    console.log(`  ${String(n).padStart(4)}  ${reason}`);
  }
  console.log('\n--- left alone, detail ---');
  for (const r of residuals) console.log(`  ${r.file}:${r.line}  ${r.text}  (${r.reason})`);
  console.log('');
}

if (CHECK) {
  // Guard mode. A rewritable site means someone hand-typed a colour that
  // already has a token name, which is exactly how the current state arose
  // from a system that was declared correctly at the start.
  if (rewrites.length > 0) {
    console.error(
      `FAIL: ${rewrites.length} hex literal(s) or slate-* utilit(ies) in frontend/src ` +
        'have a token name already. Use the token, or add one in src/index.css.\n' +
        'Run `node scripts/codemod-tokens.mjs --verbose` to see each one.\n',
    );
    process.exit(1);
  }
  console.log('OK: no hex literal or slate-* utility in frontend/src has an unused token.\n');
  process.exit(0);
}

console.log('After --write, verify with:');
console.log('  cd frontend && npm run build && npm test');
console.log('  git diff --stat');
console.log("  grep -rnE '#[0-9A-Fa-f]{6}|slate-[0-9]' frontend/src --include='*.tsx'\n");
