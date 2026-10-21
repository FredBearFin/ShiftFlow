# F2 — token codemod

`codemod-tokens.mjs` replaces the raw hex literals and default-palette `slate-*`
utilities in `frontend/src` with the design tokens that PR F1 declared in
`frontend/src/index.css` and `frontend/tailwind.config.js`. The system was
written down correctly at the start and then re-typed by hand per component;
this is the mechanical half of putting it back. No visual change is intended
beyond F1's two unifications (`slate-900` → `--ink`, `slate-500` → `--muted`).

**It has not been run against `src/`.** It is dry-run by default. Run it only
after tracks A, B, C, E and I have merged — it touches 19 of the 20 files under
`frontend/src`, so running it on an un-merged tree produces a conflict in every
one of them.

## What it rewrites

Arbitrary-value colour utilities and `slate-*` colour utilities, including any
variant stack (`hover:`, `focus-visible:`, `disabled:`, `before:`, `sm:`,
`group-hover:`, `data-[…]:`):

    bg-[#2B3A42]            ->  bg-ink
    hover:bg-[#F4F1EA]      ->  hover:bg-canvas
    border-[#7F8A92]        ->  border-border-control
    text-slate-600          ->  text-ink-soft
    divide-slate-200        ->  divide-border-subtle
    bg-slate-900            ->  bg-ink

`slate-*` is mapped by the **role** the colour plays, not by the step alone,
because `text-slate-200` is a light label on a dark fill, `bg-slate-200` is a
neutral chip fill and `border-slate-200` is a hairline — three different tokens.
The three role tables (`text`/`fill`/`stroke`…, `bg`/`from`/`via`/`to`,
`border`/`divide`/`ring`/`outline`) are at the top of the script.

Measured on `integration/base` + F1 and F3–F7: **615 rewrites across 19 files**,
reducing `frontend/src` from 275 hex literals to 3 and from 523 `slate-*`
utilities to 23.

## What it deliberately skips

Everything skipped is listed with `file:line` and a reason in the report, so
nothing is silent.

1. **`src/index.css`** — the token source of truth. Its hex values *are* the
   tokens.
2. **`src/services/api.ts` and `src/types.ts`** — frozen under Art. 4.
3. **Utilities carrying an opacity modifier** (`bg-slate-50/80`,
   `focus:ring-[#2B3A42]/30`) — 18 sites. This is the important one. Our tokens
   hold a full hex inside a CSS custom property, and Tailwind v3 cannot apply an
   alpha to that: `bg-canvas/80` emits **no rule at all**, so the utility
   disappears and the element renders with no background. Verified against this
   repo's Tailwind build. Fixing these needs either channel-only vars
   (`--canvas-rgb: 244 241 234` plus `rgb(var(--canvas-rgb) / <alpha-value>)`)
   or a `color-mix()` and a browser-support decision — a design call, not a
   codemod.
4. **Bare hex strings** — `stroke="#e2e8f0"` in `ParetoExplorerView.tsx:112`,
   1 site. CSS custom properties do **not** resolve inside SVG presentation
   attributes, so `fill="var(--accent)"` renders nothing. These need either a
   `fill-*`/`stroke-*` utility class or a `style={{ fill: 'var(--accent)' }}`
   object. F6 converted the chart colours this way by hand; this one is a grid
   line nobody has looked at.
5. **`slate-*` steps with no token for that role** — 7 sites:
   `text-slate-200`/`-300` (light text on a dark fill, where the right answer is
   `--card` or an on-ink token F1 did not declare), `bg-slate-300`
   (`--surface-sunken-strong` is `#D9DFE3` against slate-300's `#CBD5E1`, a
   visible lightening) and `border-t-slate-600`. Guessing here would be a visual
   change, which this PR is not allowed to make.
6. **`*.test.ts(x)` by default** — a test asserting on a class name the codemod
   just rewrote elsewhere will fail, and that failure should be seen rather than
   papered over. The report names every such assertion. There is exactly one
   today: `src/components/ui/Button.test.tsx:23` asserts `bg-[#4A6B5D]`. Pass
   `--include-tests` to rewrite them in the same run.
7. **`indigo-*`, `emerald-*`, `amber-*` and `shadow-[…]`** — out of remit. After
   a run, `frontend/src` still holds 39 indigo (all in `OnboardingWizard` and
   `components/onboarding/*`, where indigo is a deliberate lesson-panel colour
   that needs a design decision, not a rename), 20 emerald and 18 amber. Those
   belong in a follow-up that extends F6's ordered ramp to the remaining status
   pills. The single box-shadow is an `rgba()`, not a hex, and is not a colour
   token yet; making it `--shadow-button` would be a one-line F1 addition.

## How to verify

    node scripts/codemod-tokens.mjs                   # report, writes nothing
    node scripts/codemod-tokens.mjs --verbose          # every rewrite, one per line

    cp -r frontend /tmp/verify-frontend                # verify on a copy first
    node scripts/codemod-tokens.mjs --write --include-tests --root /tmp/verify-frontend
    cd /tmp/verify-frontend && npm run build && npm test

    # then, for real
    node scripts/codemod-tokens.mjs --write --include-tests
    cd frontend && npm run build && npm test
    git diff --stat

Four things to check after a run, in order of how quietly they fail:

1. `npm run build && npm test` exits 0. On the verification copy: build clean,
   **74/74 tests pass**, CSS 33.05 kB → 29.82 kB (fewer one-off arbitrary
   classes).
2. **No empty rule bodies in the built CSS** — `grep -cE '\{\s*\}'
   frontend/dist/assets/*.css` must print `0`. A non-zero count means a
   utility was rewritten into one Tailwind cannot generate, and the element
   silently lost that property. This is the failure mode an opacity modifier
   causes, and it will not fail the build or the tests.
3. Spot-check that the token utilities carry real declarations:
   `grep -oE '\.bg-ink\{[^}]*\}' frontend/dist/assets/*.css` → `.bg-ink{background-color:var(--ink)}`.
4. Open the app and look at the four views F6 touched, the shift-pill grid and
   the modal overlays — the overlays are where the skipped `bg-slate-900/40`
   sites live.

## The lint rule this needs

Without a guard the codemod drifts back within a few features, which is exactly
how 273 hand-typed hexes grew out of a palette that was declared correctly on
day one. Proposed, **not wired up**:

**Now, zero new dependencies.** The script already has the guard built in:

    node scripts/codemod-tokens.mjs --check

It exits 1 and names every offending site when any hex literal or `slate-*`
utility in `frontend/src` has a token that already exists, and 0 otherwise
(verified both ways). To adopt it, add `"lint:tokens": "node
../scripts/codemod-tokens.mjs --check"` to `frontend/package.json` and one
`- run: npm run lint:tokens` step to `.github/workflows/frontend-build.yml`
after `npm ci`. Deliberately left for whoever merges this, because it turns red
the moment it lands and the 615 sites have to be gone first — so it goes in the
commit *after* the codemod run, not before.

Note what `--check` does and does not catch: it fires on a colour that already
has a token name, which covers the drift that actually happened here. It does
*not* fire on a brand-new hex nobody has tokenised — that case needs the rule
below.

**Later, if the repo adopts ESLint.** There is no ESLint config in this repo
today, so this is a second step. With `typescript-eslint` in place, a flat-config
block scoped to `frontend/src/**` and `no-restricted-syntax` on string and
template contents covers the general case:

```js
{
  files: ['frontend/src/**/*.{ts,tsx}'],
  ignores: ['frontend/src/index.css'],
  rules: {
    'no-restricted-syntax': ['error',
      {
        selector: 'Literal[value=/(?:^|\\s)(?:[a-z-]+:)*(?:bg|text|border|fill|stroke|ring|divide|from|via|to)(?:-[a-z]+)?-\\[#[0-9A-Fa-f]{3,8}\\]/]',
        message: 'No hex literals in src/. Use a token from src/index.css; add one if the colour is new.',
      },
      {
        selector: 'Literal[value=/(?:^|\\s)(?:[a-z-]+:)*[a-z-]+-slate-[0-9]{2,3}/]',
        message: 'No default-palette slate-* in src/. The warm token ramp is canvas / surface / border / ink / muted.',
      },
    ],
  },
}
```

Two caveats worth knowing before adopting it. `no-restricted-syntax` sees one
`Literal` node at a time, so a class list split across a template literal with
an interpolation in the middle needs the same two selectors repeated for
`TemplateElement`. And it cannot see `index.css`, which is where new tokens are
legitimately declared — hence the `ignores`, and hence why the CSS file needs a
stylelint rule (or nothing, since it is one reviewed file) rather than this one.

If the project would rather take a dependency,
`eslint-plugin-better-tailwindcss`'s `no-restricted-classes` expresses both bans
declaratively and understands class attributes properly, including `clsx`-style
call sites. That is the better long-term answer; the `--check` step above is the
one that can land this week.
