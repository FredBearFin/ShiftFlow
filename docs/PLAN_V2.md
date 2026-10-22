# ShiftFlow Change Plan v2 — Agent Execution Edition

Repo: FredBearFin/ShiftFlow (baseline inspected: shallow clone, HEAD 080b09c, 2026-10-22)
Owner / "King" under docs/CONSTITUTION.md: Freddy
Audience: AI coding agents (Builder, Lawman, Judge, Police roles as defined in the Constitution) and the owner.

This document is written so that each work package (WP) can be handed to one agent with no other context except the repo and this file. Every list entry is written out in full on purpose. Nothing says "same as above". If you are an agent, read Sections 0 to 4 completely before touching any file, then read only your own WP plus Appendices A to F.

---

## 0. What this plan is for, in plain words

ShiftFlow today is a rotating-roster optimizer. It takes hourly demand, shift templates and ergonomic rules, and builds a weekly rotating schedule with a "cost vs. fairness" frontier. Research (summarized in Section 1) found that the underlying problem is real, but that the product as shipped:

1. Is pitched at the wrong customer (convenience stores, bars, smoke shops), for whom an engine that builds 7-day rotating lines is the wrong tool.
2. Makes several claims the code does not support (a "guaranteed" 16-hour rest rule that blocks every 12-hour shift pattern; a toggle that does nothing; a "Becker Table 7" trade-off law the engine does not reproduce; a cost axis that is flat or zero).
3. Has one genuinely differentiated idea: showing the trade-off between schedule cost and worker strain, and scoring an existing roster against fatigue rules. That idea fits 24/7 operations (plants, utilities, hospital units, dispatch centers) and the consultants who redesign their rosters.

The plan therefore has five phases. Phases 1 and 2 make the product true. Phase 3 builds the one feature the market validation points at: "audit the roster you already run". Phase 4 repositions the repo, the docs and the go-to-market material to match. Phase 5 contains the things only the owner can do (customer interviews, a paid pilot, legal and naming decisions, and the kill/continue gate).

The order matters. Do not start Phase 3 front-end work before the Phase 2 rest-rule work lands, because the audit screen would otherwise repeat the false 16-hour claim.

---

## 1. Verdict the plan is built on (so agents understand intent, not just instructions)

Short form of the earlier research and code review. Agents must not re-litigate this; they must not put any of these as marketing claims either.

1. Problem realness: Shift-schedule fatigue is a real, well documented problem in 24/7 work. A Finnish occupational-health precedent exists (Titania scheduling software with an ergonomic traffic-light, reported about 20% fewer accidents, and only about 20% of planners using the ergonomic features regularly). Treat those two numbers as "reported precedent, owner to re-verify before quoting".
2. Market: Workforce-scheduling is crowded and consolidating (UKG acquired Shiftboard in May 2025). Large vendors do not market a "cost vs. strain Pareto" view in the US; that is the only differentiator found. Open-source optimizers (Timefold, OR-Tools) are free competition for anyone who can code.
3. Fit: The product's best niche is "audit my current roster" for 24/7 operations and for shift-schedule consultants. The small-business target does not match the engine.
4. Legal reality: Fair Workweek jurisdictions use rest minimums in roughly the 9 to 11 hour range, not 16 hours. The 16-hour rule is a house rule, not the law. The code must never imply it is the law. The owner must have counsel review any compliance wording.
5. Name risk: another product uses the name shiftflow.app. The owner decides whether to rename (Section 12, WP-4.2).
6. Stop gate: Continue only if at least 3 interviewees describe a real roster-redesign event with a budget, and at least 1 pays for a pilot of about $500 to $1,500. Otherwise stop building features (Section 14).

### 1.1 Facts verified by running the code (not inferred)

These were measured on 2026-10-22 against the cloned repo with read-only probe scripts. Agents can reproduce them with the probes in Appendix E.

1. The global rest constant is `settings.min_rest_hours_between_shifts = 16` (backend/app/config.py line 47). With it, any template longer than 8 hours fails: 12-hour D/N, 10-hour M/E and 9-hour M/E/N all raise `SolverInfeasibleError`, which main.py turns into HTTP 422. Only the 8-hour M/E/N case solves.
2. With the same constant lowered in memory to 11, 10, 9 or 8: 12-hour D/N solves (12 lines, minimum observed rest 12.0, understaffed/overstaffed hours 132/132 on flat demand of 4 around the clock) and 9-hour M/E/N solves (18 lines, minimum observed rest 15.0, understaffed/overstaffed 142/226). 10-hour M/E still fails at every setting, because a second, code-based check (isd_rwsp_solver.py lines 679 to 689) raises whenever an E shift is followed by an M shift, without looking at hours.
3. `enforce_zero_clopening` is effectively not a rest toggle. The three rest-hour comparisons in the generator (isd_rwsp_solver.py lines 468, 500, 818) read the global constant and ignore the toggle. Only the E-then-M check at lines 679 to 689 reads the toggle, and with 8-hour M/E/N it produced the same roster on or off.
4. The cost axis is meaningless as shipped: payroll is $0 when no employees are entered (the Pareto points then all show `estimated_weekly_payroll` 0), and even with wages entered it is hours times wage, which does not move across leeway for these presets.
5. Coverage is poor at 0% leeway even on flat demand: 8-hour M/E/N on a flat demand of 4 around the clock produced 160 understaffed and 160 overstaffed staff-hours out of 672 required (about 24% each way); 12-hour D/N produced 132/132 (about 20%). The engine builds the right number of lines but does not place people on the right days.
6. The "ergonomic improvement" figure compares total strain penalties between schedules that do not have the same coverage, so it can read 100% improvement for a schedule that is simply understaffed. Example seen: the manufacturing preset at 50% leeway showed 100% improvement with 272 understaffed and 272 overstaffed hours.
7. The field `becker_theoretical_improvement_pct` in ParetoPointSchema is filled with the same value as `ergo_improvement_pct` (pareto.py line 56). It is not a theoretical number. It is referenced only in pareto.py:56, schemas.py:323 and frontend/src/types.ts:228.
8. The README (lines 42 to 46) still states Table 7 figures (8.37%, 27.34%, 39.46%, "$0 extra payroll") that the engine does not reproduce.
9. `fair_workweek_compliant` is `None` ("not assessed", ergonomics.py line 475). Good. Keep it that way.
10. The 0.65 quantile in `_solve_daily_shift_counts` (isd_rwsp_solver.py line 269) carries a code comment saying it has no source and is not from Becker. Keep that comment until a source exists.
11. Three well known 12-hour rotations were checked by script (Appendix A): 2-2-3 (Pitman, 14-day cycle), 4-on-4-off (8-day cycle) and the DuPont 28-day pattern, each with 4 crews, give exactly one day crew and one night crew every day and an average of 42 hours per week per crew. These are the first fixtures for the audit feature.
12. A 12-hour shift is already penalized by the existing ergonomics code (`evaluate_shift_type_penalties`: duration over 9 hours gets penalty 1, 2 or 3, with 12 hours or more at 3). So even after the rest rule is fixed, 12-hour patterns will show a strain penalty. That is acceptable and honest. Do not remove that penalty to make 12-hour patterns look good.

---

## 2. Governing law inside the repo: the Constitution, and what it blocks

docs/CONSTITUTION.md is the only source of law for agents working on this repo (Section 1 of that file). The plan below cannot be executed under the current text. The following are the specific conflicts, and Section 3 gives the exact amendment text the owner should adopt before any agent starts work.

### 2.1 Articles that matter for this plan

1. Header scope: "Scope: `frontend/` only". Only amendments for PR 24 and a few later PRs extended it to named backend files. This plan edits backend/, docs/, gtm/ and README.md.
2. Art. 1: One PR is one commit. Only the files the PR lists may change. The exception made for the PR 8 and PR 9 pair is not a precedent.
3. Art. 2 and Art. 3: `cd frontend && npm install && npm run build` and `cd frontend && npm test` must exit 0. The backend equivalent is `cd backend && python run_all_tests.py` (named in PR 24 and PR 33 acceptance lines).
4. Art. 4: `frontend/src/services/api.ts` and `frontend/src/types.ts` are frozen from baseline commit `2e6ee18`, except the narrow exceptions already granted (PR 24 for types.ts, PR 25 for api.ts). "The solver is never modified." The 2026-10-20 lone-E ruling also keeps the E guard (`if cand == "E" and len(candidates) > 1:`) as is.
5. Art. 5: The 16-prop interface of `OnboardingWizard` is frozen.
6. Art. 6: No new runtime dependencies. This plan adds none. Agents must not add any.
7. Art. 7: package-lock.json was committed in PR 1 only. This plan does not change it.
8. Art. 8: Commit messages contain no secrets, no model names and no attribution lines naming a model. See Section 2.3.
9. Section 7 quality floor: every input has a visible label, every button has an explicit `type`, no new inline `any`, no new console errors or warnings, layout works at 375px width with no horizontal scroll.
10. Section 8: Only the owner amends the Constitution.
11. The 2026-10-20 "Mechanical fixes applied without a Builder" rule: pure text swaps may be written as replacement lists (file, exact old text, exact new text, expected match count) and applied by a non-agentic applier. This plan uses that rule for copy-only work.
12. PR numbering: the highest number recorded is PR 37 (plus 12a and 0A). New work packages below carry WP ids. The owner assigns PR numbers 38 and up when each is approved.

### 2.2 What each phase needs from the owner before it can start

1. Phase 1 (truthful copy and labels): Amendments A1, A3 (only the items for WP-1.4) and A5.
2. Phase 2 (engine): Amendments A1, A2, A3, A5.
3. Phase 3 (audit feature): Amendments A1, A3, A5.
4. Phase 4 (repositioning): Amendment A1 and A6.
5. All phases: Amendment A4 (commit trailers) and A7 (branching and numbering).

### 2.3 A conflict agents must know about: automatic commit trailers

Some agent harnesses append lines such as `Co-Authored-By: <model name> <address>`, a session URL, or "Generated with ..." to commit messages and pull request bodies. Art. 8 forbids model names and attribution lines naming a model in commit messages. For this repo, the Constitution governs. Every agent must therefore check the final commit message with `git log -1 --format=%B` and strip any such trailer before the commit is considered done. Police must run the check in Appendix D. If a harness insists on adding the trailer, stop and report; do not commit with it.

---

## 3. Amendment pack for the owner to adopt (copy, edit, paste into docs/CONSTITUTION.md)

Only the owner may adopt these. Agents must never edit docs/CONSTITUTION.md except to paste owner-approved text, and only in a WP that says so (WP-0.1). The wording follows the style of earlier amendments. Dates are placeholders: replace YYYY-MM-DD with the adoption date.

### A1. Scope extension and the governing plan

> **YYYY-MM-DD. Scope extension and Plan v2 (King).** The header scope "`frontend/` only" is extended to `backend/`, `docs/`, `gtm/`, `.github/` and the repo-root `README.md`, for the work packages (WPs) listed in `docs/PLAN_V2.md` ("Plan v2") and no other work. Plan v2 is added as a governing plan next to the wizard Plan; where they conflict on a file Plan v2 lists, Plan v2 governs for that WP only. Each WP is one PR and one commit under Art. 1, and the file list of the WP in Plan v2 is its fixed file list. Reason: the product has been found to make claims its engine does not support, and the fixes live outside `frontend/`.

### A2. Solver exception

> **YYYY-MM-DD. Solver exception for WP-2.1 through WP-2.5 (King).** The sentence "The solver is never modified" in Art. 4 is suspended for the named hunks of `backend/app/engine/isd_rwsp_solver.py`, `backend/app/engine/ergonomics.py` and `backend/app/engine/pareto.py` listed in WP-2.1, WP-2.2, WP-2.3, WP-2.4 and WP-2.5 of Plan v2, and only for those hunks. A Lawman checks the exception by listing the changed hunks with `git diff -U0` and comparing each hunk to the WP. The lone-E ruling of 2026-10-20 (the `cand == "E" and len(candidates) > 1` guard stays) is unaffected and no WP may touch it. Each solver WP must be preceded by WP-2.0 (golden snapshots) and must leave every golden snapshot byte-identical unless the WP states which snapshot changes and why. Reason: the 16-hour rest rule and the E-then-M check are hard-coded in the solver, so the product cannot be made truthful without touching it.

### A3. Art. 4 exceptions for the two frozen frontend files

> **YYYY-MM-DD. Art. 4 exceptions for Plan v2 (King; each exception covers the named WP only and is not precedent).**
> `frontend/src/types.ts`:
> (a) WP-1.3: remove the line `becker_theoretical_improvement_pct: number;` from `ParetoPoint` (line 228).
> (b) WP-2.1: add the optional property `min_rest_hours?: number;` to `ErgonomicGuardrails`.
> (c) WP-2.1 and WP-2.4: add optional properties to `ParetoPoint`: `non_dominated?: boolean;` and `coverage_comparable?: boolean;`; and to the ergonomics audit type: `min_rest_hours_required?: number;` (WP-2.1) and `improvement_coverage_adjusted?: boolean;` (WP-2.4).
> (d) WP-2.6: add optional property `scheduled_hours?: number;` to `ParetoPoint`.
> (e) WP-3.4: add `'audit'` to the `ActiveTabId` union (line 324).
> No other line of `types.ts` changes in any of these WPs.
> `frontend/src/services/api.ts`:
> (f) WP-2.1: in `readGuardrails` only, after the existing validation passes, return `{ min_rest_hours: 16, ...raw }` so saved configurations written before this change still load. `GUARDRAIL_NUMERIC_FIELDS` and `GUARDRAIL_FLAG_FIELDS` are NOT extended, because that would make every previously saved configuration fail validation and be silently discarded.
> No other line of `api.ts` changes.
> The check `git diff --quiet 2e6ee18 -- frontend/src/services/api.ts frontend/src/types.ts` is replaced, for each of these WPs, by a check that the diff contains exactly the hunks listed here.

### A4. Commit trailers

> **YYYY-MM-DD. Art. 8 clarification (King).** Art. 8 applies to trailers added automatically by tools. A commit whose message contains `Co-Authored-By` naming a model, a session URL, or a line such as "Generated with" is NONCOMPLIANT. Police check: `git log --format=%B <range> | grep -iE 'co-authored-by|claude|anthropic|generated with|session_'` returns nothing. Reason: some agent harnesses add these lines by default.

### A5. Approved new test and fixture files

> **YYYY-MM-DD. New files approved under Art. 1 for Plan v2 (King).** Each file below is added to the file list of the named WP and to no other WP. Backend: `backend/app/tests/test_golden_snapshots.py` and `backend/app/tests/golden/` (WP-2.0); `backend/app/tests/test_min_rest_guardrail.py` (WP-2.1); `backend/app/tests/test_coverage_fidelity.py` (WP-2.3); `backend/app/tests/test_pareto_dominance.py` (WP-2.4); `backend/app/tests/test_benchmarks.py` and `backend/benchmarks/` (WP-2.5); `backend/app/tests/test_roster_audit.py`, `backend/app/tests/test_rotation_patterns.py`, `backend/app/tests/test_solver_to_audit.py` (WP-3.1 through WP-3.3 and WP-3.6). Frontend: `frontend/src/services/auditApi.ts`, `frontend/src/services/auditParse.ts`, `frontend/src/services/auditParse.test.ts`, `frontend/src/components/RosterAuditView.tsx`, `frontend/src/components/RosterAuditView.test.tsx`, `frontend/src/components/AuditReport.tsx` (WP-3.4 and WP-3.5); `frontend/src/components/claims.test.ts` (WP-1.1).

### A6. Claims policy

> **YYYY-MM-DD. Claims policy (King).** No screen, README line, gtm document or API description may say that a schedule is "legal", "compliant", "guaranteed", "certified", "safe harbor", or "protects" the business, unless a counsel opinion is added to the repo and the line cites it. The words "fewer accidents", "burnout" and "health" may appear only with the phrase "reported" or "heuristic" and a source or formula nearby. A test (`frontend/src/components/claims.test.ts`, WP-1.1) scans visible strings for the banned words, in the same style as the PR 17 banned-word scan. Reason: the 2026-10-20 financial rulings already removed one safe-harbor claim; this makes the rule standing.

### A7. Branching and numbering

> **YYYY-MM-DD. Plan v2 execution rules (King).** Work happens on a branch named `plan-v2`, created from the current main. WPs are merged in the order of Plan v2 Section 4, one commit each, rebased not merged. The owner assigns PR numbers 38 and up when approving each WP. Judge and Police follow Sections 5 and 6 of this Constitution without change.

---

## 4. Work package index, dependencies and parallelism

Size key: S = under about 150 changed lines, M = about 150 to 600, L = over 600 or touches the solver. "Owner" means only Freddy can do it.

| WP | Title | Phase | Size | Needs first | Touches solver | Touches frozen files |
|---|---|---|---|---|---|---|
| 0.1 | Paste amendments into the Constitution and add docs/PLAN_V2.md | 0 | S | owner approval | no | no |
| 0.2 | Create branch plan-v2, baseline test run, record baseline | 0 | S | 0.1 | no | no |
| 1.1 | Truthful copy: remove "never", "guarantee", "enforces 16 hours" claims and add claims test | 1 | M | 0.1 | no | no |
| 1.2 | README and gtm claim cleanup (Table 7, "$0 extra payroll", SMB pitch banner) | 1 | S | 0.1 | no | no |
| 1.3 | Remove the mislabeled Becker field | 1 | S | 0.1 | no (pareto.py is not the solver but is covered by A2) | types.ts (A3a) |
| 1.4 | Label the cost axis honestly in the Pareto view and header | 1 | S | 1.1 | no | no |
| 1.5 | Relabel the health score as a heuristic | 1 | S | 1.1 | no | no |
| 2.0 | Golden snapshot tests of current solver output | 2 | M | 0.2 | no | no |
| 2.1 | Configurable minimum rest hours, live toggle, rest-based wrap check | 2 | L | 2.0, 1.1 | yes | types.ts (A3b), api.ts (A3f) |
| 2.2 | Rest-aware 12-hour and 9-hour presets | 2 | M | 2.1 | no | no |
| 2.3 | Coverage forensics, then coverage fixes | 2 | L | 2.0 | yes | no |
| 2.4 | Dominance filter and coverage-adjusted improvement | 2 | M | 2.3 | yes (pareto.py, ergonomics.py) | types.ts (A3c) |
| 2.5 | Benchmark harness against published instances | 2 | M | 2.3 | no | no |
| 2.6 | Cost axis in scheduled hours | 2 | S | 1.4 | yes (pareto.py) | types.ts (A3d) |
| 3.1 | Cyclic sequence audit engine | 3 | L | 2.1 | new file | no |
| 3.2 | Audit API route | 3 | M | 3.1 | no | no |
| 3.3 | Rotation pattern library with coverage verification | 3 | M | 3.1 | no | no |
| 3.4 | Audit screen in the frontend | 3 | L | 3.2 | no | types.ts (A3e) |
| 3.5 | Printable roster risk report | 3 | M | 3.4 | no | no |
| 3.6 | Solver-to-audit adapter and comparison view | 3 | M | 3.2, 2.2 | no | no |
| 4.1 | Presets and display labels re-pointed at 24/7 | 4 | S | 2.2 | no | no |
| 4.2 | Rename (optional, owner decision) | 4 | L | owner | no | maybe |
| 4.3 | README rewrite | 4 | S | 3.4 | no | no |
| 4.4 | gtm restructure and discovery kit | 4 | M | owner | no | no |
| 4.5 | docs/SCOPE.md and dormant-module freeze notes | 4 | S | 4.3 | no | no |
| 5.x | Owner-only gates | 5 | owner | 3.4 | no | no |

Parallelism rules for orchestration:

1. After 0.2, WP-1.1, 1.2, 1.3 can run in parallel because they touch disjoint files. WP-1.4 and 1.5 wait for 1.1 because they share frontend component files with it.
2. WP-2.0 can run in parallel with Phase 1.
3. WP-2.1 must not run in parallel with 2.3, 2.4 or 2.6, because all of them edit isd_rwsp_solver.py, ergonomics.py or pareto.py.
4. WP-3.1 can start as soon as 2.1 is merged. WP-3.3 can run in parallel with 3.2 once 3.1 exists.
5. WP-3.4 and 3.5 are sequential (same new component files).

Merge order: 0.1, 0.2, 1.1, 1.2, 1.3, 1.4, 1.5, 2.0, 2.1, 2.2, 2.3, 2.4, 2.6, 2.5, 3.1, 3.2, 3.3, 3.6, 3.4, 3.5, 4.1, 4.3, 4.4, 4.5, then 4.2 only if the owner decides to rename.

---

## 5. Rules of engagement for every agent (paste this block at the top of every agent prompt)

1. Work only on the WP you were assigned. Touch only the files that WP lists. If you believe another file must change, stop and report it to the owner; do not edit it.
2. Before editing, run the baseline commands in Section 6 and record the pass/fail state. After editing, run them again. A WP is not done until all three suites exit 0.
3. One WP is one commit. The commit message follows Section 7. Strip any automatic trailers (Section 2.3).
4. Never modify `docs/CONSTITUTION.md` unless your WP is WP-0.1.
5. Never add a dependency to `frontend/package.json` or `backend/` requirements. If a standard-library or existing-dependency solution is not possible, stop and report.
6. Do not change the lone-E guard (`if cand == "E" and len(candidates) > 1:`), the 0.65 quantile comment, `fair_workweek_compliant=None`, or the `# Fair Workweek: not assessed` comment.
7. Do not enable or edit the dormant modules (emergency, handover, POS, billing, payroll export). They are out of scope for every WP.
8. Every user-visible string you add must pass the claims policy (Amendment A6). Do not write "guarantee", "compliant", "legal", "certified", "safe harbor", "protects", "never", or "always" in visible text about schedules.
9. Every new input must have a visible label; every `<button>` must have an explicit `type`; no new inline `any`; no new console errors or warnings; 375px layout must not scroll horizontally (Constitution Section 7).
10. If a test you did not write starts failing, do not edit the test to make it pass. Report which test, which assertion, and why the behavior changed. The only exception is a test the WP names.
11. Prefer small, reviewable hunks. Do not reformat or rename anything outside the hunks the WP lists.
12. If an instruction in this plan contradicts the code you can see, trust the code, stop, and report the contradiction. Do not guess.
13. The frontend `tsconfig.json` is strict and sets `noUnusedLocals: true`, and it includes test files under `src`. An unused import or variable fails `npm run build`. There is no `@types/node`, so frontend tests must not import Node modules such as `fs`.

## 6. Baseline and acceptance commands (from Constitution Art. 2, Art. 3 and the PR 24 and PR 33 acceptance lines)

1. Backend: `cd backend && python run_all_tests.py` exits 0. The runner gives each module in `app/tests/__init__.py::_modules` its own temporary SQLite file. A new backend test module must be added to `_modules` in `backend/app/tests/__init__.py` and will then be picked up by `backend/run_all_tests.py`, which imports `_modules`. Keep the list order and add new entries at the end unless a WP says otherwise. (WP-2.1 and later add entries; that file is therefore in their file lists.)
2. Frontend build: `cd frontend && npm install && npm run build` exits 0 (`build` is `tsc && vite build`).
3. Frontend tests: `cd frontend && npm test` exits 0 (`vitest run`, jsdom, setup file `src/test/setup.ts`).
4. CI mirrors these: `.github/workflows/backend-tests.yml` (Python 3.11, `python run_all_tests.py`) and `.github/workflows/frontend-build.yml` (Node 20, `npm ci`, `npm run build`, `npm test`). Python 3.13 was used for the local probes; CI uses 3.11. Do not use syntax newer than 3.11.
5. Hunk check for frozen files: `git diff -U0 2e6ee18 -- frontend/src/services/api.ts frontend/src/types.ts` must show only hunks listed in the adopted amendment for the current WP.

## 7. Commit message format

```
<WP id>: <imperative summary, max 70 chars>

<2 to 6 lines: what changed and why, plain words>
Files: <comma-separated list from the WP>
Tests: <commands run and results>
```

No trailers. No model names. No session links. Art. 8 and Amendment A4 apply.

---

## 8. Phase 0 — Governance and baseline

### WP-0.1 Paste the approved amendments and add this plan to the repo (owner approves; Builder pastes)

Goal: make the work legal under the Constitution before any other WP starts.

Preconditions: the owner has edited and approved the text of Amendments A1 to A7 in Section 3, filling in dates.

Files (exactly two):
1. `docs/CONSTITUTION.md` — append the approved amendments under the "Amendments" heading, in order A1 to A7, using the same bullet style as the existing entries. Change nothing else in the file.
2. `docs/PLAN_V2.md` — a verbatim copy of this plan document.

Steps:
1. Copy this plan to `docs/PLAN_V2.md` unchanged.
2. Append the owner-approved amendment text. Do not reword it. Do not renumber existing amendments.
3. Update the Art. 9 sentence only if the owner's text for A7 says so; otherwise leave Art. 9 alone.

Acceptance:
1. `git diff --stat` shows exactly the two files above.
2. `git diff docs/CONSTITUTION.md` shows only added lines (no deletions) except where the owner's text says otherwise.
3. All three suites still exit 0 (nothing in code changed).

Commit message: `WP-0.1: adopt Plan v2 amendments and add docs/PLAN_V2.md`

### WP-0.2 Create the branch and record a baseline

Goal: know exactly what is green and red before any change, so later failures are attributable.

Files: none changed. Output is a report in the pull request description or in `docs/forensics/baseline_YYYYMMDD.md` if the owner wants it in the repo (then that file is the only file).

Steps:
1. Create branch `plan-v2` from the current main.
2. Run, and record exit codes and the last 20 lines of output for: `cd backend && python run_all_tests.py`; `cd frontend && npm install && npm run build`; `cd frontend && npm test`.
3. Record the Python and Node versions used. CI uses Python 3.11 and Node 20.
4. Run each backend test module twice and record whether any test is flaky (passes once, fails once). Report flaky tests by name; do not fix them in this WP.

Acceptance: a written baseline exists. If any suite is red on main, stop and report to the owner; Phase 1 does not start on a red baseline.

---

## 9. Phase 1 — Stop the false claims (no solver changes)

### WP-1.1 Claims policy test and rename of "compliance" export wording

Goal: enforce Amendment A6 with a test, and fix the visible wording that still says "compliance" for an export that assesses nothing legal.

Preconditions: WP-0.1 merged.

Files (exactly):
1. `frontend/src/components/claims.test.ts` (new).
2. `frontend/src/components/ParetoExplorerView.tsx` — the export button text and filename only.
3. `frontend/src/components/paretoScenarios.ts` — the CSV section headings and the function name's doc comment only; do not rename the exported function (other files import `buildRosterComplianceCsv`).

Steps:
1. In `claims.test.ts`, write a Vitest test that reads the source text of every `.tsx` file under `frontend/src/components` (use `import.meta.glob('./**/*.tsx', { query: '?raw', import: 'default', eager: true })`, which Vite supports without a new dependency) and scans only string literals and JSX text, ignoring comments, attribute values for `id`, `htmlFor`, `className`, `key`, `role`, `type`, `data-*`, and `aria-*` (the same ignore rules as the PR 17 banned-word scan in the Constitution). Banned visible words (case-insensitive, whole word): `guarantee`, `guaranteed`, `compliant`, `certified`, `safe harbor`, `protects the business`, `fewer accidents`. The word `compliance` is allowed only in identifiers, file names and comments, not in visible text.
2. Seed the test with an explicit allowlist of the exact strings that already contain a banned word today, found by running the scan once. Each allowlist entry must have a one-line reason. Expected today: the conditional row `'Fair workweek compliant'` in `paretoScenarios.ts` (line 166), which only renders when `fair_workweek_compliant` is a boolean and is currently always `None`. Replace that visible label with `Fair Workweek check` and delete the allowlist entry for it if you can; if you cannot because a test depends on the old text, keep the entry and say so.
3. In `ParetoExplorerView.tsx`, change the visible export button text at line 422 from `↓ Export roster & compliance CSV` to `↓ Export roster & fairness CSV`, the status message at line 68 from `Roster & compliance CSV downloaded.` to `Roster & fairness CSV downloaded.`, and the filename at line 63 from `roster_compliance_${solution.archetype_id}.csv` to `roster_fairness_${solution.archetype_id}.csv`. Change the comment at line 391 to match.
4. In `paretoScenarios.ts`, change the second CSV section's headers only if they contain the word "compliance" in visible output (the `complianceHeaders` array holds `Metric` and `Value`, which are fine). Change the doc comment at lines 112 to 116 to say "fairness summary". Do not rename variables.

Tests: the new claims test; existing tests for the Pareto view if any (search `ParetoExplorerView.test.tsx`, `paretoScenarios.test.ts`) must be updated only where they assert the old export text, and each such edit must be listed in the commit body.

Acceptance: `cd frontend && npm install && npm run build` and `npm test` exit 0; `grep -rn "compliance CSV\|roster_compliance" frontend/src` returns nothing.

Out of scope: the `compliance` tab id, the `DOLComplianceView` component name, file names, and anything about rest-hours wording (that is WP-2.1b).

Commit message: `WP-1.1: add claims-policy test and rename compliance export to fairness`

### WP-1.2 README and gtm: remove the claims the engine does not support

Goal: nobody reading the repo is told the engine reproduces published figures or guarantees anything.

Preconditions: WP-0.1 merged.

Files (exactly): `README.md`, `gtm/cfo_financial_audit.md`, `gtm/chaos_engineering_audit.md`, `gtm/customer_success_onboarding_playbook.md`, `gtm/legal_compliance_audit.md`, `gtm/ux_design_systems_audit.md`, `gtm/launch_marketing_copy.md`, `gtm/sales_pitch_deck.md`, `gtm/commercial_pricing.md`, `gtm/roi_calculator.md`, `gtm/saas_financial_model.md`, `gtm/demo_script.md`, `gtm/api_integration_guide.md`, `gtm/terms_and_privacy.md`, `gtm/distributed_systems_audit.md`, and `gtm/target_prospect_database.csv` (banner not possible in CSV: do not edit that file; list it in the PR body instead). Drop any gtm file from the commit if it needs no change after the scan in step 2, and say which were dropped.

Steps:
1. In `README.md`, delete lines 43 to 46 (the "Pareto Trade-Off Law (Becker 2026, Table 7)" bullet and its three sub-bullets that state 8.37%, 27.34%, 39.46% and "$0 extra payroll"). Replace them with exactly this paragraph: `**Cost versus strain trade-off.** For each facility the engine re-solves the schedule at several staffing-cost levels and reports the measured strain score at each level. These are results for your inputs, not published figures. The engine has not been validated against the benchmark instances in the cited paper; see the benchmark harness (WP-2.5) for status.`
2. In `README.md` line 42, replace `**Zero-Clopening Hard Guardrail**: Enforces $\ge 16$ hours rest between consecutive shifts and strict circadian forward rotation ($M \to D \to E \to N$).` with `**Rest and rotation rules**: the generator keeps a fixed minimum rest between consecutive shifts (currently 16 hours; this is a house rule, not a legal standard) and rotates forward ($M \to D \to E \to N$). A configurable minimum is planned (WP-2.1).`
3. In `README.md` line 3, do not rewrite the pitch here (that is WP-4.3). Insert, directly under the `# ShiftFlow` title, a blockquote: `> Status: research prototype. The small-business positioning below is a hypothesis that market research did not support. The strongest use found so far is auditing an existing 24/7 roster. See docs/PLAN_V2.md.`
4. For each gtm file, run `grep -nEi "guarantee|safe harbor|zero-clopening|never be scheduled|fair workweek-compliant|100%|shield|fewer accidents|\$0 extra|Table 7|8\.37|27\.34|39\.46"` on it. For every hit, decide: (a) a measured fact with a source in this repo (leave it), (b) an overclaim (replace with the softened wording below), or (c) a quoted competitor/industry statement (leave it, but make sure it is attributed). Report every (b) replacement as old text and new text in the commit body.
5. Softened wording to use for (b): rest rules → `The generator keeps at least 16 hours between shifts by default (a house rule, not a legal standard) and the audit flags any shorter gap.` Legal → `This is not legal advice and does not assess Fair Workweek or any other statute.` Savings → `Planning estimate, not measured.` Never use the words "guarantee", "certified", "compliant" or "safe harbor" in new text.
6. Specific known lines to check first: `gtm/chaos_engineering_audit.md:75` ("100% feasible, zero-clopening, Fair Workweek-compliant schedule instantly (not measured)"), `gtm/customer_success_onboarding_playbook.md:55` ("You will never be scheduled to close at 11 PM and open at 8 AM"), `gtm/legal_compliance_audit.md:41` ("Cyclic Line Safe Harbor"), `gtm/ux_design_systems_audit.md:65` ("Zero-Clopening Shield: 100%"), `gtm/cfo_financial_audit.md:68`.
7. At the very top of each gtm `.md` file you edited, insert this banner (the King's 2026-10-20 rulings already corrected several figures; do not undo them): `> STATUS: hypothesis document written for a small-business pitch. Figures are planning estimates, not validated. Do not quote externally. See docs/PLAN_V2.md.`

Acceptance: `grep -rniE "8\.37|27\.34|39\.46|\$0 extra payroll" README.md gtm docs` returns nothing; `grep -rniE "safe harbor" gtm README.md` returns only lines that say it is NOT claimed; `git diff --stat` lists only files from the list above.

Commit message: `WP-1.2: remove unsupported claims from README and gtm docs`

### WP-1.3 Remove the mislabeled Becker field

Goal: stop pretending a measured number is a theoretical one.

Preconditions: WP-0.1 merged with Amendment A3(a).

Files (exactly): `backend/app/engine/pareto.py`, `backend/app/schemas.py`, `frontend/src/types.ts`.

Steps:
1. `backend/app/engine/pareto.py` line 56: delete the line `becker_theoretical_improvement_pct=sol_i.ergonomics_audit.ergo_improvement_pct,` from the `ParetoPointSchema(...)` call.
2. `backend/app/schemas.py` line 323: delete the field `becker_theoretical_improvement_pct: float` from `ParetoPointSchema`.
3. `frontend/src/types.ts` line 228: delete `becker_theoretical_improvement_pct: number;` from `ParetoPoint`.
4. Run `grep -rn "becker_theoretical" backend frontend/src docs gtm README.md` and fix any other reference you find (the research found only the three above, so any other hit is a surprise: stop and report it).
5. If a stored saved scenario in the frontend (localStorage) or the database may contain the field, confirm that reading extra or missing fields is tolerated; extra fields are ignored by Pydantic by default. Report your reading of this in the commit body.

Acceptance: `grep -rn "becker_theoretical" backend frontend/src` returns nothing; all three suites exit 0; the `types.ts` diff has exactly one removed line.

Commit message: `WP-1.3: remove mislabeled becker_theoretical_improvement_pct field`

### WP-1.4 Say what the cost axis really is when no wages are entered

Goal: the Pareto screen must not show "$0/wk" as if that were a cost.

Preconditions: WP-1.1 merged.

Files (exactly): `frontend/src/components/ParetoExplorerView.tsx`, `frontend/src/components/Header.tsx`.

Steps:
1. In `ParetoExplorerView.tsx`, add a local constant `const hasWages = points.some((p) => p.estimated_weekly_payroll > 0);` where `points` is the existing array the view already maps over.
2. Wherever the view prints `${Math.round(pt.estimated_weekly_payroll).toLocaleString()}/wk` (lines about 145, 262, 313 and 367, found by `grep -n "estimated_weekly_payroll" frontend/src/components/ParetoExplorerView.tsx`), print `${Math.round(...).toLocaleString()}/wk` only when `hasWages`; otherwise print `{pt.employee_count} shift patterns` (the value the table already shows in another column).
3. Add one sentence under the chart title: when `hasWages` is false: `No wages are entered, so cost here means staffing level (how many shift patterns). Add wages in Staff & Availability to see dollars.`
4. In `Header.tsx` subtitle (around line 99), show `$X Weekly Payroll` only when `solution.labor_analysis.total_payroll_cost > 0`.
5. Do not touch `types.ts` or `api.ts`. Do not change any calculation.

Tests: add or extend `ParetoExplorerView.test.tsx` (if absent, create it; add the file to this commit's list and say so) with one case where all payroll values are 0 (expects the staffing-level sentence and no `$0`) and one case where payroll is positive (expects dollar text).

Acceptance: frontend build and tests exit 0; with the "custom" preset and no employees, the Pareto screen shows no `$0` text (agent verifies by rendering in the test).

Commit message: `WP-1.4: show staffing level instead of $0 when no wages are entered`

### WP-1.5 Present the health score as a heuristic

Goal: the 0 to 100 score is built as `100 - (total_ergo / max(25, 8 * lines)) * 35 + 4`, clamped to the range 55 to 99.5 (ergonomics.py lines 456 to 460). It cannot read below 55 or above 99.5. That is a display heuristic, not a clinical or validated index.

Preconditions: WP-1.1 merged.

Files (exactly): `frontend/src/components/Header.tsx`, `frontend/src/components/ErgonomicsAuditView.tsx`, `frontend/src/components/onboarding/glossary.ts`.

Steps:
1. Find every place the score is shown: `grep -rn "health_index_score" frontend/src`.
2. In `Header.tsx` the tab badge `${solution.ergonomics_audit.health_index_score}/100` becomes `${...}/100 (rough)`.
3. In `ErgonomicsAuditView.tsx`, where the score is shown, add a one-line caption: `A rough comfort score built from the strain points below. It is not a medical or validated measure and always falls between 55 and 99.5.`
4. In `glossary.ts`, if a term describes this score, add the same caveat to its `plain` text (keep the existing field structure and the PR 17 limits on sentence counts; check `coverage.test.ts` after).
5. Do not change the formula in this WP.

Acceptance: frontend build and tests exit 0 (including the existing lesson/glossary coverage tests).

Commit message: `WP-1.5: label the health score as a rough heuristic`

---

## 10. Phase 2 — Make the engine tell the truth

### WP-2.0 Golden snapshots of the current solver output

Goal: a safety net. Before touching the solver, freeze what it produces today, so every later WP can prove it did or did not change schedules.

Preconditions: WP-0.2 done. No amendment is needed because no solver code changes.

Files (exactly): `backend/app/tests/test_golden_snapshots.py` (new), `backend/app/tests/golden/presets_v1.json` (new), `backend/app/tests/golden/regenerate.py` (new, not run by tests), `backend/app/tests/__init__.py` (append `"test_golden_snapshots"` to `_modules`).

Steps:
1. In `regenerate.py`, for each key in `ARCHETYPE_PRESETS` (downtown_foodmart_omaha, retail_grocery, healthcare_24_7, manufacturing_24_7, emergency_services, custom) and for each leeway in `[0.0, 5.0, 20.0]`, build `SolveRequestSchema` exactly like `test_solver_contracts.py` does (archetype_id, facility_name, demand_matrix, templates, guardrails from the preset, `pareto_leeway_pct`), run `ISDRWSPSolver(req, include_pareto_frontier=False).solve()`, and record: `employee_count`, `active_shift_types_count`, `obj_shift`, `[[cell.shift_code for cell in line.days] for line in roster_lines]`, `ergonomics_audit.total_ergo_objective`, `min_rest_hours_observed`, `clopening_violations`, and `sum(understaffing)` and `sum(overstaffing)` over `interval_coverage`. Record infeasible cases as `{"error": "<message>"}`. Never record `solve_time_ms` or ids that vary.
2. Run the generator twice and diff the outputs. They must be identical; if the solver is not deterministic, stop and report which field varies (the rest of the plan depends on determinism).
3. Save the JSON. Format it with sorted keys and 2-space indentation so diffs are readable.
4. In `test_golden_snapshots.py`, load the JSON and re-run the same procedure, asserting equality per preset and leeway with `subTest`. Include a docstring that says: regenerate only with owner approval and only in a WP that states which snapshot changes and why.
5. Also snapshot `generate_pareto_frontier` for `manufacturing_24_7` with `selected_leeway_pct=5.0`: the list of `(leeway_pct, employee_count, obj_ergo, total_understaffing_hours, total_overstaffing_hours)` per point (not the payroll or label strings).

Acceptance: `cd backend && python run_all_tests.py` exits 0 including the new module; running the test twice gives the same result.

Commit message: `WP-2.0: add golden snapshot tests for preset solves`

### WP-2.1 Configurable minimum rest, a live toggle, and a rest-hours wrap check

Goal: replace the hard-coded global 16-hour constant with a per-request setting; make `enforce_zero_clopening` mean "enforce the minimum rest when generating"; replace the hour-blind E-then-M check by an hour-based check. Default behavior stays identical (16 hours, toggle on), so every golden snapshot stays byte-identical.

Preconditions: WP-2.0 merged; Amendments A2, A3(b) and A3(f) adopted.

Files (exactly):
1. `backend/app/schemas.py` (`ErgonomicGuardrailsSchema` and `ErgonomicsAuditSchema` only).
2. `backend/app/engine/isd_rwsp_solver.py` (the four hunks listed below only).
3. `backend/app/engine/ergonomics.py` (the audit constructor call only).
4. `backend/app/main.py` (the two keys of the `/health` response only).
5. `frontend/src/types.ts` (A3(b), and the `min_rest_hours_required?: number;` line of A3(c)).
6. `frontend/src/services/api.ts` (`readGuardrails` return line only, A3(f)).
7. `backend/app/tests/test_min_rest_guardrail.py` (new) and `backend/app/tests/__init__.py` (append the module).

Steps, in this order:
1. Schema, guardrails: in `ErgonomicGuardrailsSchema` add `min_rest_hours: int = Field(default=16, ge=8, le=24, description="Minimum hours between the end of one shift and the start of the next. Used to generate the schedule when enforce_zero_clopening is on, and always used to flag short gaps in the audit.")`. Change the description of `enforce_zero_clopening` (line 69, currently "Enforce >= 16h rest between shifts") to `"When on, the generator never places two shifts closer together than min_rest_hours. When off, short gaps are allowed but still flagged."` Check for a circular import before using `settings` as the default; if there is one, hard-code 16 and add a comment pointing to `config.py` line 47.
2. Schema, audit: in `ErgonomicsAuditSchema` add `min_rest_hours_required: int = 16`.
3. Solver, forced night-after-night check (isd_rwsp_solver.py about lines 458 to 476): change the condition from `if forced_rest_hrs < settings.min_rest_hours_between_shifts:` to `if self.guardrails.enforce_zero_clopening and forced_rest_hrs < self.guardrails.min_rest_hours:`. Keep the error text but add the numbers: `... with the required {self.guardrails.min_rest_hours} hours of rest between them (this shift pair gives {forced_rest_hrs} hours). Shorten the night template or lower the minimum rest.`
4. Solver, candidate filter (about line 500): change `if rest_hrs < settings.min_rest_hours_between_shifts: continue` to `if self.guardrails.enforce_zero_clopening and rest_hrs < self.guardrails.min_rest_hours: continue`.
5. Solver, wrap check (about lines 679 to 689): replace the body of `if self.guardrails.enforce_zero_clopening:` with an hour-based check. For each line and each day `d` in 0..6, compute `a = aligned_shifts[line_idx*7+d]` and `b = aligned_shifts[line_idx*7+(d+1)%7]`; if both are not `"OFF"` and both are in `st_by_code`, compute `compute_rest_hours_between(a, st_by_code[a]["start_hour"], st_by_code[a]["duration_hours"], b, st_by_code[b]["start_hour"])`; if it is below `self.guardrails.min_rest_hours`, raise `SolverInfeasibleError` with a message that names both shift codes and the hours. Do not keep the old `today == "E" and tomorrow == "M"` test.
6. Solver, cell flag (about lines 815 to 819): change `settings.min_rest_hours_between_shifts` to `self.guardrails.min_rest_hours`. This runs regardless of the toggle so the audit always reports short gaps.
7. `ergonomics.py`: in the `ErgonomicsAuditSchema(...)` return at the end of `evaluate_ergonomics_audit`, add `min_rest_hours_required=guardrails.min_rest_hours,`. Update the comment at "Inspect cells for Clopening (< 16h rest)" to say "(< min_rest_hours)".
8. `main.py` `/health` (lines 151 and 152): change `"default_safe_rest_hours": 16.0` to `"default_min_rest_hours": float(settings.min_rest_hours_between_shifts)` and `"clopening_forbidden": True` to `"clopening_forbidden_by_default": True`. First run `grep -rn "default_safe_rest_hours\|clopening_forbidden" backend frontend/src gtm` (the research found only main.py:151-152); if anything else reads those keys, keep the old keys too and add the new ones beside them.
9. `types.ts` and `api.ts` hunks exactly as in Amendment A3. `readGuardrails`: after the two `every(...)` checks, `return { min_rest_hours: 16, ...(raw as ErgonomicGuardrails) } as ErgonomicGuardrails;` so an old saved configuration without the field gets the default and a new saved one keeps its own value. Do NOT add `min_rest_hours` to `GUARDRAIL_NUMERIC_FIELDS`.
10. Leave `settings.min_rest_hours_between_shifts` in `config.py` as the documented default only. Do not delete it; `/health` and the schema default read it.

Tests (`test_min_rest_guardrail.py`), each as its own test method with a docstring:
1. `test_default_guardrail_is_16_and_enabled`: `ErgonomicGuardrailsSchema()` has `min_rest_hours == 16` and `enforce_zero_clopening is True`.
2. `test_schema_bounds`: 7 and 25 raise `ValidationError`; 8 and 24 are accepted.
3. `test_12h_day_night_infeasible_at_16`: 12-hour D (earliest 6, latest 20, duration 12, preferred start 7) and N (earliest 18, latest 31, duration 12, preferred start 19) on `_build_24_7_demand(4, 4, 4, 4, 0)` raise `SolverInfeasibleError` with the default guardrails.
4. `test_12h_day_night_solves_at_11`: the same templates with `min_rest_hours=11` solve, `clopening_violations == 0`, and `min_rest_hours_observed >= 11`. (Observed during research: 12 lines, minimum rest 12.0. Do not assert those numbers.)
5. `test_toggle_off_allows_short_rest_but_flags_it`: a case that is infeasible with the toggle on (use the 12-hour pair at `min_rest_hours=16`) either solves with the toggle off and reports `clopening_violations > 0`, or still raises; assert whichever the code does and document it. If it raises, find why (forward rotation, minimum work days) and put the reason in the test docstring.
6. `test_audit_reports_required_rest`: `solution.ergonomics_audit.min_rest_hours_required` equals the guardrail value.
7. `test_wrap_check_is_hours_based`: construct a case where an E-like shift followed by an M-like shift has at least `min_rest_hours` of rest (for example a late-start "E" at 12:00 to 18:00 and an "M" at 06:00, 12 hours rest, with `min_rest_hours=11`) and assert it no longer raises the old "closing shift followed by an opening shift" error. If the case cannot be built with the schema's constraints, explain why in the test and skip it with `unittest.skip` and a reason; do not delete the test.
8. `test_health_endpoint_reports_default`: `TestClient(app).get("/health")` returns `default_min_rest_hours == 16.0` (follow the client setup used in `test_solver_contracts.py`).
9. Golden: `test_golden_snapshots` must pass unchanged. If any snapshot differs, stop; that is a defect in this WP.

Acceptance: all three suites exit 0; golden snapshots byte-identical; `git diff -U0 2e6ee18 -- frontend/src/services/api.ts frontend/src/types.ts` shows only the A3 hunks; the solver diff shows only the hunks at the four sites above plus the `__init__` line if you add a convenience attribute (do not add one unless needed).

Risks: (a) behavior with the toggle off is new; the generator may produce schedules with short rest that the audit flags; that is intended. (b) the wrap check now looks at all shift pairs, not only E then M; if any preset starts failing, that preset's golden snapshot fails, which is the signal; report instead of loosening the check.

Rollback: revert the single commit; schema default keeps old clients working.

Commit message: `WP-2.1: make minimum rest configurable and the rest toggle real`

### WP-2.1b Rest wording follows the engine (frontend copy and one input)

Goal: after WP-2.1 the UI must no longer say "never schedules less than 16 hours" or "the solver checks this one rule", and must let the user set the minimum.

Preconditions: WP-2.1 merged.

Files (exactly): `frontend/src/components/ErgonomicsAuditView.tsx`, `frontend/src/components/DOLComplianceView.tsx`, `frontend/src/components/onboarding/glossary.ts`, `frontend/src/components/onboarding/lessons.ts`, `frontend/src/components/OnboardingWizard.tsx`, plus the test files that assert the replaced strings.

Steps:
1. `ErgonomicsAuditView.tsx` lines 66 to 68: replace `This tool never schedules less than 16 hours of rest between shifts.` with `The schedule was built to keep at least {audit.min_rest_hours_required ?? 16} hours between shifts when the rest rule is on; any shorter gap is counted as too-short above.`
2. `DOLComplianceView.tsx`: delete the constant `MIN_REST_HOURS = 16` (line 10) and its comment (line 9). Inside the component, compute `const minRest = audit.min_rest_hours_required ?? 16;` and use it in the pass test (line 39) and in both detail strings (lines 73 and 74). Change `meeting the ${MIN_REST_HOURS}-hour minimum this schedule is built to enforce` to `meeting the ${minRest}-hour minimum you set` and `under the ${MIN_REST_HOURS}-hour minimum this schedule is supposed to enforce` to `under the ${minRest}-hour minimum you set`. Keep the disclaimer paragraph at lines 107 to 111 as is.
3. `glossary.ts` lines 46 to 48: keep the `term`; make the example neutral: `With 12 hours of rest, a person who finishes a late shift at 23:00 cannot start before 11:00 the next day.`. Run the lesson/glossary coverage test.
4. `lessons.ts`: in the stepId 4 lesson, keep the text within the PR 17 and PR 18 limits (one-sentence whyItMatters, explanation of at most three sentences, banned-word rule, core terms verbatim). Only replace statements that say the rule is only about closing-then-opening. Do not change any other lesson.
5. `OnboardingWizard.tsx` around lines 1049 to 1052: label becomes `Keep the minimum rest between shifts`; desc becomes `When on, no two shifts are placed closer together than the minimum below. When off, shorter gaps can appear and are flagged.` (This replaces `The solver checks this one rule. It does not check other rest periods.`, which is wrong.)
6. In the same file, in step 4's numeric rule fields (the group around lines 490 to 560 whose labels were fixed under G3), add one more numeric input: visible label `Minimum rest between shifts (hours)`, bound to `guardrails.min_rest_hours ?? 16`, min 8, max 24, step 1, with the same `htmlFor`/`id` pattern as its neighbors and the same `onChange` helper that updates the other numeric fields. Follow Constitution Section 7 exactly (visible label, explicit button types, no inline `any`).
7. Do not change the 16-prop interface of `OnboardingWizard`.

Tests: update the tests that assert the old strings (search with `grep -rn "never schedules\|supposed to enforce\|checks this one rule" frontend/src`); add a test in the existing wizard test file that the new input renders with its label and writes the value. Each test edit must be named in the commit body.

Acceptance: build and tests exit 0; `grep -rn "never schedules less\|checks this one rule\|supposed to enforce" frontend/src` returns nothing; the claims test from WP-1.1 passes.

Commit message: `WP-2.1b: rest wording and input follow the configurable minimum`

### WP-2.2 Add a 12-hour continuous-operations preset

Goal: give the 24/7 audience a preset that actually represents their world.

Preconditions: WP-2.1 and WP-2.1b merged.

Files (exactly): `backend/app/api/archetype_routes.py`, `backend/app/tests/test_solver.py` (append one test), `backend/app/tests/golden/presets_v1.json` and `backend/app/tests/golden/regenerate.py` (extend only: add the new preset's entries; existing entries must not change), `frontend/src/components/onboarding/presetLabels.ts`.

Steps:
1. In `archetype_routes.py`, add an `ARCHETYPE_PRESETS` entry with id `continuous_ops_12h`. Use `_build_24_7_demand(4, 4, 4, 4, 0)` as the demand shape, the 12-hour day template (code D, earliest_start 6, latest_end 20, min and max duration 12, preferred_start 7, preferred_duration 12) and 12-hour night template (code N, earliest_start 18, latest_end 31, min and max duration 12, preferred_start 19, preferred_duration 12), and guardrails with `min_rest_hours=11`, `enforce_zero_clopening=True`, and the other fields copied from `manufacturing_24_7`. First read an existing preset (for example `manufacturing_24_7`) to copy the exact constructor and field names; do not guess them.
2. Confirm by running the solver at leeways 0, 5 and 20 that the preset solves. If any leeway is infeasible, change the guardrails (for example `max_consecutive_nights`) until all three solve, and record each change and the reason in the code comment.
3. Add the display label and a plain description in `presetLabels.ts` (follow the existing entries and the PR 7 rules: no store names, no banned engine words). Label: `Continuous operations (12-hour days and nights)`.
4. Extend the golden JSON with the new preset's three leeway entries via `regenerate.py`; the diff to the JSON must be additions only.
5. Add one test in `test_solver.py` mirroring test_05: the new preset solves and has `clopening_violations == 0`.

Acceptance: all suites exit 0; golden diff is additions only; `GET /api/v1/archetypes` lists the new id (check with `TestClient` in the test).

Commit message: `WP-2.2: add continuous_ops_12h preset`

### WP-2.3 Coverage fidelity: find out why people land on the wrong days, then fix it

This WP has two commits because the root cause is a hypothesis. The first is a read-only investigation; the second is gated on the owner approving its findings.

Measured symptom (see Section 1.1, item 5): on flat 24/7 demand of 4, the generator picks about the right number of lines but 20% to 24% of staff-hours land in the wrong places (160/160 for 8-hour M/E/N, 132/132 for 12-hour D/N, 142/226 for 9-hour M/E/N).

Hypothesis to test, not to assume: `_solve_daily_shift_counts` produces correct per-day, per-shift targets, but the placement step (`g_start` alignment, isd_rwsp_solver.py about lines 640 to 700) rotates each line without regard to those targets. A cyclic 7-day line can be rotated by any of 7 offsets without changing its internal structure (consecutive days, nights, rest blocks), so the offsets are free parameters that could be chosen to minimize the gap between actual and target counts.

#### WP-2.3a Coverage forensics (no solver changes)

Preconditions: WP-2.0 merged.

Files (exactly): `backend/app/tests/test_coverage_fidelity.py` (new), `backend/app/tests/__init__.py` (append the module), `docs/forensics/coverage_YYYYMMDD.md` (new, written by the agent from the script's output).

Steps:
1. Read `_solve_daily_shift_counts` (line 254), `_partition_into_alternating_sequences` (line 311), `_assign_forward_rotating_shifts_to_work_sequences` (line 389) and the code in `solve()` from line 618 to about line 720 that computes `g_start`, `aligned_shifts` and `actual_daily_counts`. Write down in the forensic document, in your own words, what each does and how `g_start` is chosen.
2. In the test file (as a helper, not a solver edit), instrument by calling the solver's public `solve()` and reading what you can from the response (`roster_lines`, `interval_coverage`, `multigraph_arcs`, `shift_types`). If a target per-day count is not exposed in the response, reproduce it by calling `solver._solve_daily_shift_counts(...)` directly on a solver instance; if that requires private state, say so in the document rather than editing the solver.
3. For flat demand d in {2, 3, 4, 5, 6} and the template sets 8-hour M/E/N, 12-hour D/N (with `min_rest_hours=11`), and every shipped preset (including `custom`), compute and tabulate: number of lines, target shifts per (day, type), actual shifts per (day, type), sum of absolute differences, understaffed and overstaffed hours, and the fraction of required hours understaffed.
4. State which of these is true, with evidence: (i) targets are right and placement is wrong; (ii) targets themselves are wrong; (iii) both; (iv) neither (the gap comes from template windows, duration choice or hour-level overlaps).
5. Compute a lower bound for (i) if feasible with the standard library: for each shift type, the minimum achievable sum of absolute differences over all 7^n rotation offsets is hard to enumerate for n=18, so instead run a coordinate-descent over rotation offsets in the test helper (try all 7 offsets for one line at a time, keep the best, repeat until no improvement) on the solver's output grid, and report the gap it reaches. This estimates how much of the problem rotation offsets alone can fix. Do not edit the solver to do this; operate on the output grid.
6. Write the document with: method, tables, the verdict on the hypothesis, and a recommended fix with its expected effect and its risk to the ergonomic score (rotating a line can change weekend-related penalties).
7. Tests: add tests that only characterize (no fixes): the sums above are recorded in the test as the current values with a tolerance of zero, so WP-2.3b can tighten them. Name the tests `test_current_gap_*`.

Acceptance: suites exit 0; the document exists; no file outside the list changed; the owner reads the document and approves, rejects or amends the proposed fix before 2.3b starts.

Commit message: `WP-2.3a: coverage forensics report and characterization tests`

#### WP-2.3b Coverage fix (only after the owner approves the forensics)

Preconditions: WP-2.3a merged and approved; Amendment A2.

Files (exactly): `backend/app/engine/isd_rwsp_solver.py` (the hunks the approved fix names, no others), `backend/app/tests/test_coverage_fidelity.py`, `backend/app/tests/golden/presets_v1.json` (regenerated; see below).

Required content (the approved fix may refine it):
1. If the hypothesis holds, add a placement refinement after `aligned_shifts` is built and before `actual_daily_counts` is computed: for each line, try all 7 rotation offsets of its 7-day pattern, keep the offset that minimizes the sum of absolute differences between actual and target counts, iterate over lines until a full pass changes nothing (cap at 20 passes). Break ties by keeping the current offset so results are deterministic.
2. Keep the weekend logic honest: after rotating, `full_weekend_off` and weekend penalties must be recomputed from the rotated grid, not carried over. Verify with a test that `ergonomics_audit.full_weekends_off_count` matches a recount from the cell data.
3. Comment the new code with what it is and what it is not: an extra placement step added by this repo, not part of the cited paper. Do not change any class or function docstring to claim paper fidelity.
4. Golden snapshots will change. Regenerate them with `regenerate.py`, and put in the commit body a table of old and new understaffed and overstaffed hours and ergonomic totals per preset and leeway. If any preset gets worse on either metric, say so and stop for owner review.
5. Tighten the `test_current_gap_*` tests into `test_gap_at_most_*` tests with the new measured values plus a 10% margin, and add a property test: for flat demand d in {2, 3, 4, 5, 6} with 8-hour M/E/N the understaffed hours at 0% leeway are at most 10% of required hours. If the approved fix cannot reach 10%, use the measured value plus 10% and write the real number in the commit body. Do not claim a figure the code does not reach.

Acceptance: suites exit 0; every changed golden value is explained in the commit body; clopening violations remain 0 for all presets that had 0 before.

Commit message: `WP-2.3b: place shift patterns on the days that need them`

### WP-2.4 Dominance filter and coverage-adjusted improvement

Goal: the frontier must not recommend a point that is worse on every axis, and the "improvement" figure must not credit a schedule for being strained less because it has fewer people working.

Preconditions: WP-2.3b merged; Amendments A2 and A3(c).

Files (exactly): `backend/app/engine/pareto.py`, `backend/app/engine/isd_rwsp_solver.py` (only the spot where `ergonomics_audit` is combined with `interval_coverage`), `backend/app/engine/ergonomics.py` (only to carry one new field through), `backend/app/schemas.py` (`ParetoPointSchema`, `ErgonomicsAuditSchema`), `backend/app/config.py` (one constant), `frontend/src/types.ts` (A3(c)), `frontend/src/components/ParetoExplorerView.tsx`, `backend/app/tests/test_pareto_dominance.py` (new), `backend/app/tests/__init__.py`.

Steps:
1. `config.py`: add `coverage_tolerance_hours: int = 2` to the settings class, with a comment: a schedule counts as having comparable coverage when its understaffed hours are at most the baseline's plus this many hours.
2. `schemas.py`: add to `ParetoPointSchema`: `non_dominated: bool = True` and `coverage_comparable: bool = True`. Add to `ErgonomicsAuditSchema`: `improvement_coverage_adjusted: bool = False`.
3. `pareto.py`, after the loop that builds `points`: compute the baseline as the point with the smallest `leeway_pct`. For each point set `coverage_comparable = point.total_understaffing_hours <= baseline.total_understaffing_hours + settings.coverage_tolerance_hours`. Then define dominance on three axes, all minimized: `employee_count`, `obj_ergo`, `total_understaffing_hours + total_overstaffing_hours`. Point P dominates Q when P is less than or equal to Q on all three and strictly less on at least one; mark every dominated point `non_dominated = False`. Ties (identical on all three) are both kept.
4. Change the knee selection (the current rule is the maximum of `ergo_improvement_pct / leeway_pct` over points with positive leeway) to consider only points that are non-dominated and coverage-comparable. If none qualify, set no knee (existing code must tolerate that; check the frontend handles `knee` being undefined, it already does conditional rendering on `{knee && ...}`).
5. `isd_rwsp_solver.py`: at the spot in `solve()` where both the audit and the coverage cells are known (read the code; the audit is created from `evaluate_ergonomics_audit` and coverage is built from `interval_coverage`), compare this solution's total understaffing to the baseline solution's total understaffing (the baseline is already solved for the improvement figure). If this solution is understaffed by more than the baseline plus the tolerance, set the audit's `ergo_improvement_pct` to `0.0` and `improvement_coverage_adjusted` to `True`. Do not change `total_ergo_objective` or any penalty.
6. `ParetoExplorerView.tsx`: draw dominated points as hollow markers and add a legend line `Hollow points are worse on cost, strain and coverage than another point.` Show a small note `(coverage worse than the no-extra-cost schedule; improvement not counted)` beside any point with `coverage_comparable === false`. Keep it readable at 375px. Treat missing fields as `true`, since saved scenarios from before this change will not have them.
7. Do not remove any point from the response; the filter flags, it does not delete (so the owner can see the raw frontier).

Tests (`test_pareto_dominance.py`):
1. A pure-function test of the dominance logic with hand-built points (extract a helper `mark_dominance(points)` in `pareto.py` so it can be tested without solving).
2. `manufacturing_24_7` at leeway 50 no longer reports `ergo_improvement_pct == 100.0` together with a coverage gap larger than the baseline's plus the tolerance; assert the audit's `improvement_coverage_adjusted` is `True` in that case, or, if coverage is now comparable after WP-2.3b, that the improvement is below 100.
3. For every shipped preset, the knee point (if any) has `non_dominated` and `coverage_comparable` both true.
4. The golden test: ergonomic totals and rosters unchanged, `ergo_improvement_pct` may change only where `improvement_coverage_adjusted` is true; regenerate and explain.

Acceptance: suites exit 0; `git diff -U0 2e6ee18 -- frontend/src/types.ts` shows only the A3(c) lines.

Commit message: `WP-2.4: flag dominated frontier points and coverage-confounded improvement`

### WP-2.5 Benchmark harness (do not claim reproduction until it is run on real instances)

Goal: a repeatable way to compare ShiftFlow output with published rotating-workforce benchmark results, and honest status text until that is done.

Preconditions: WP-2.3b merged.

Files (exactly): `backend/benchmarks/README.md`, `backend/benchmarks/runner.py`, `backend/benchmarks/instances/synthetic_*.json` (three small hand-checked instances), `backend/benchmarks/published_results.template.json`, `backend/app/tests/test_benchmarks.py`, `backend/app/tests/__init__.py`.

Steps:
1. Define a plain JSON instance format: `{"name": str, "demand_matrix": [[int]*24]*7, "templates": [...as in SolveRequestSchema...], "guardrails": {...}, "notes": str}`. The runner loads an instance, solves at leeway 0 and at the anchors in `LEEWAY_ANCHORS`, and prints a table of employee count, understaffed hours, overstaffed hours, total strain, and minimum rest.
2. `published_results.template.json` is an empty template with fields `source_citation`, `source_url`, `instance_name`, `published_employees`, `published_notes`, and `verified_by_owner_on`. The agent must NOT fill any real value or URL; the owner supplies them after checking the primary source. The README says in the first paragraph: the benchmark instance files and published numbers have not been obtained or verified; any claim of reproducing a published result is forbidden until they are.
3. Create three synthetic instances whose minimum line count can be derived by hand and write the derivation as a comment inside the instance's `notes`: flat demand 1 around the clock with 8-hour M/E/N (21 shifts per week; at about 4.65 working days per line the lower bound is ceil(21 / 5) = 5 lines when every line works 5 days, and 21 / 4.65 = 4.5 on average); flat demand 2 same templates; and a Monday-to-Friday day-only instance. Do not assert that the solver reaches the lower bound; assert only that it returns a feasible schedule and print the gap.
4. `test_benchmarks.py`: load the synthetic instances, solve at leeway 0, assert feasibility, zero clopening, and print (not assert) the gap to the hand bound. Add a test that fails if `published_results.template.json` contains any non-empty `source_url`, so nobody commits an unverified citation by accident (a deliberately blunt guard; the owner removes it when they add verified data).

Acceptance: suites exit 0; `python backend/benchmarks/runner.py backend/benchmarks/instances/synthetic_flat1.json` runs and prints the table.

Commit message: `WP-2.5: add benchmark runner and synthetic instances`

### WP-2.6 Show scheduled hours as the cost axis when wages are absent

Goal: give the frontier a real cost number that exists without wages: scheduled hours.

Preconditions: WP-1.4 merged; WP-2.4 merged; Amendment A3(d).

Files (exactly): `backend/app/schemas.py` (`ParetoPointSchema` only), `backend/app/engine/pareto.py`, `frontend/src/types.ts` (A3(d)), `frontend/src/components/ParetoExplorerView.tsx`, `backend/app/tests/test_pareto_dominance.py` (append).

Steps:
1. Add `scheduled_hours: int = 0` to `ParetoPointSchema`.
2. In `pareto.py`, set `scheduled_hours=sol_i.labor_analysis.total_scheduled_hours` in the `ParetoPointSchema(...)` call.
3. In `ParetoExplorerView.tsx`, where WP-1.4 prints the staffing level when there are no wages, print `{pt.scheduled_hours ?? 0} paid hours/wk` followed by the staffing level, and when wages exist print dollars first and hours second.
4. Test: for a preset, `scheduled_hours` on every point equals that point's solution `labor_analysis.total_scheduled_hours` (solve at the point's leeway and compare).

Acceptance: suites exit 0; `types.ts` diff has only the A3(d) line.

Commit message: `WP-2.6: report scheduled hours on each frontier point`

---

## 11. Phase 3 — Build "audit the roster you already run"

Why this phase exists: market research found no clear need for another generator of schedules, but a real gap for a tool that takes the rotation a plant, unit or dispatch center already runs (often a 12-hour pattern in a spreadsheet) and flags fatigue and rest problems, and compares it with an alternative. This phase builds that, using only computations that can be checked by hand.

Design rules for the whole phase:

1. The audit is rule-based and deterministic. It does not optimize, it does not claim a legal finding, and every threshold is a visible, editable input with a stated default.
2. It works on cyclic patterns of any length from 7 to 56 days, because real 12-hour rotations run 8, 14 or 28 days. It does not reuse the engine's 7-day `RosterLineSchema`, because that shape cannot represent a 28-day cycle.
3. It lives in new files so it cannot disturb the solver or the frozen frontend files, except the single `ActiveTabId` line in WP-3.4.
4. Findings are of two kinds only: `flag` (a rule the user's thresholds say is broken) and `info` (a fact worth knowing). There is no "compliant" or "pass" language anywhere.

### WP-3.1 Cyclic sequence audit engine

Preconditions: WP-2.1 merged (so the repo's own rest default is no longer a hidden constant). No amendment beyond A1 and A5 is needed because no existing file is edited.

Files (exactly): `backend/app/audit_schemas.py` (new), `backend/app/engine/roster_audit.py` (new), `backend/app/tests/test_roster_audit.py` (new), `backend/app/tests/__init__.py` (append `"test_roster_audit"`), `docs/audit_rules.md` (new).

Schemas (`audit_schemas.py`, Pydantic v2, same style as `schemas.py`):
1. `AuditShiftDef`: `code` (string, 1 to 4 characters, letters and digits only, case-insensitively not equal to `OFF`), `name` (up to 60 characters), `start_minute` (0 to 1439), `duration_minutes` (60 to 1200), `kind` (`"day"`, `"evening"`, `"night"` or `"other"`).
2. `AuditLine`: `label` (up to 80 characters), `cells` (list of strings; each is a shift `code` or `"OFF"`; length must equal the request's `cycle_days`).
3. `AuditThresholds` with these fields and defaults: `min_rest_hours: float = 11.0` (range 4 to 24); `max_consecutive_work_days: int = 6` (range 2 to 14); `max_consecutive_nights: int = 4` (range 1 to 14); `long_shift_hours: float = 10.0`; `max_consecutive_long_shifts: int = 4` (range 1 to 14); `max_hours_any_7_days: float = 60.0` (range 20 to 120); `reference_avg_weekly_hours: float = 48.0` (used only for an `info` finding).
4. `AuditRequest`: `cycle_days` (7 to 56), `start_weekday` (0=Monday to 6=Sunday; the weekday of day index 0), `shifts` (1 to 12 `AuditShiftDef`), `lines` (1 to 200 `AuditLine`), `thresholds` (default `AuditThresholds()`), `demand_matrix` (optional, 7 by 24 non-negative integers, 0 to 500, where row 0 is Monday). Validators: shift codes unique case-insensitively; every cell is `OFF` (any case) or a defined code; every line has exactly `cycle_days` cells; labels unique; total cells at most 11,200.
5. `AuditFinding`: `rule_id` (string), `severity` (`"flag"` or `"info"`), `line_label` (optional), `day_index` (optional int), `value` (float), `threshold` (optional float), `message` (plain English, no banned words).
6. `AuditLineMetrics`: `label`, `shifts_per_cycle`, `avg_weekly_hours`, `min_rest_hours`, `longest_work_run_days`, `longest_night_run`, `longest_long_shift_run`, `max_hours_in_7_days`, `isolated_single_nights`, `isolated_single_rest_days`, `backward_rotation_events`, `weekends_fully_off_pct`, `nights_per_cycle`, `weekend_shifts_per_cycle`.
7. `AuditCoverage` (only when demand supplied): `super_period_days`, `understaffed_hours_per_week`, `overstaffed_hours_per_week`, `worst_cells` (up to 10 items with weekday, hour, required, scheduled).
8. `AuditResponse`: `findings` (sorted by severity then rule_id then line label then day index), `lines` (list of `AuditLineMetrics`), `coverage` (optional), `summary` (counts of flags and infos per rule, overall minimum rest, overall longest run), `thresholds_used`, `engine_version` (string constant `"audit-1"`), `disclaimer` (constant text: `Rule-based check of the pattern you entered. Not legal advice. Thresholds are the values shown, not statutory limits.`).

Engine (`roster_audit.py`), public function `audit_roster(request: AuditRequest) -> AuditResponse`. Implementation requirements:
1. Time model: day `i` of the cycle starts at minute `i * 1440`. A shift on day `i` starts at `i * 1440 + start_minute` and ends `duration_minutes` later (it may end after midnight). Treat each line as cyclic: the day after the last day is day 0 again.
2. Rest rule `SHORT_REST` (flag): list every worked shift in chronological order, cyclically; for each consecutive pair, gap = next start minus previous end (wrap by adding `cycle_days * 1440` for the pair that crosses the cycle end). Flag any gap below `min_rest_hours`. One finding per line, reporting the smallest gap and the day index of the earlier shift; the line metric `min_rest_hours` is that smallest gap. If a line has a single worked shift in the cycle, the gap is measured from that shift to itself one cycle later; if a line has no worked shifts, skip rest rules for it and add an `info` finding `EMPTY_LINE`.
3. `LONG_WORK_STREAK` (flag): longest cyclic run of consecutive worked days exceeds `max_consecutive_work_days`. A line with every day worked has run length `cycle_days`.
4. `NIGHT_STREAK` (flag): longest cyclic run of consecutive days whose shift has `kind == "night"` exceeds `max_consecutive_nights`.
5. `LONG_SHIFT_STREAK` (flag): longest cyclic run of consecutive days whose shift duration is at least `long_shift_hours` exceeds `max_consecutive_long_shifts`.
6. `WEEK_HOURS_HIGH` (flag): in every cyclic window of 7 consecutive days, add the full duration of each shift to the day it starts; the maximum over windows is `max_hours_in_7_days`; flag when it exceeds `max_hours_any_7_days`. Report the earliest start day of the worst window.
7. `AVG_WEEKLY_HOURS` (info): total shift hours divided by `cycle_days` times 7; add an `info` finding only when it exceeds `reference_avg_weekly_hours`.
8. `ISOLATED_NIGHT` (info): a night run of length 1 (cyclic). `ISOLATED_REST_DAY` (info): an OFF run of length 1 between worked days (cyclic).
9. `BACKWARD_ROTATION` (info): for each pair of consecutive days that are both worked, count one event when the kind order decreases, using the order day < evening < night and ignoring `other`; that is, night then evening, night then day, or evening then day. Include the wrap pair.
10. `WEEKEND_EXPOSURE` (info): over the super-period of `lcm(cycle_days, 7)` days, using weekday `(start_weekday + d) % 7`, count Saturday-Sunday pairs; `weekends_fully_off_pct` is the percentage where neither day has a shift starting (a shift counts on the day it starts, so a Friday night shift does not count against the weekend). Add an `info` finding when a line has 0%.
11. `LONG_NIGHT_SHIFT` (info): any night-kind shift of 12 hours or more; one finding per shift code, not per cell.
12. Fairness spread (info, at response level not per line): standard deviation of `nights_per_cycle` and of `weekend_shifts_per_cycle` across lines; `FAIRNESS_SPREAD` info when the maximum minus the minimum of either exceeds 2.
13. Coverage (only when `demand_matrix` is given): super-period `D = lcm(cycle_days, 7)`; for each day `t` in `0..D-1` and each hour `h`, count lines that are on shift during hour `h` of day `t`, counting the part of a previous day's shift that runs past midnight (cyclically: the day before day 0 is day `D-1`); required = `demand_matrix[(start_weekday + t) % 7][h]`; accumulate under and over; divide by `D / 7` to get hours per week. The 10 worst cells are those with the largest absolute gap, ties by earliest weekday then hour. All lines must have the same `cycle_days` (already guaranteed by the request).
14. Complexity: nothing may be quadratic in the number of lines times cycle length squared; with 200 lines and 56 days the call must complete in well under one second (the test checks 2 seconds).
15. `docs/audit_rules.md`: one section per rule id with the exact definition above, the default threshold, and the sentence `Default is a house setting chosen by the repo owner. It is not a statutory limit.` For `min_rest_hours` also write `Reference: EU Working Time Directive 2003/88/EC, Article 3 (11 consecutive hours of rest per 24 hours). Owner to verify before quoting.` and for `reference_avg_weekly_hours` write `Reference: the 48-hour average weekly limit in the same Directive (Article 6, averaged over a reference period). Owner to verify before quoting. Not a rolling 7-day limit.` Do not add any other citation; leave a `Source:` line blank for the owner where one is missing.

Tests (`test_roster_audit.py`; the fixtures use the pattern strings in Appendix A and the verification function in Appendix A):
1. `test_pitman_four_crews_no_flags_at_defaults`: shifts D = start 07:00 (420) 720 minutes `day`, N = start 19:00 (1140) 720 minutes `night`; crews are `DD--DDD--DD---` at offsets 0 and 7 for day crews and the same pattern with `D` replaced by `N` at offsets 0 and 7 for night crews; `cycle_days=14`. Expect no `flag` findings at default thresholds, `min_rest_hours == 12.0` for night crews with a repeated night shift (night to night next day gives 12 hours) and for day crews, and `max_hours_in_7_days == 60`. Expect the `LONG_NIGHT_SHIFT` info.
2. `test_dupont_flags_72_hour_week`: the 28-day DuPont string `NNNN---DDD-NNN---DDDD-------` at offsets 0, 7, 14, 21 for four crews with the same shifts. Expect one `WEEK_HOURS_HIGH` flag per crew with value 72 and threshold 60. (The string has 14 worked shifts per 28 days: an average of 42 hours per week with a 72-hour peak week; the research script confirmed both.) Expect no `SHORT_REST` flags at defaults.
3. `test_four_on_four_off_night_streak_flag_only_when_threshold_lowered`: night crews `NNNN----` at offsets 0 and 4: no `NIGHT_STREAK` at the default 4; with `max_consecutive_nights=3` both night crews are flagged with value 4.
4. `test_short_rest_detected_inside_the_cycle`: shifts E = start 14:00 duration 8 hours kind `evening`, M = start 06:00 duration 8 hours kind `day`; a 7-day line `E,M,OFF,OFF,OFF,OFF,OFF` has rest 8 hours between E and M; expect a `SHORT_REST` flag with value 8.0 at day index 0.
5. `test_short_rest_detected_across_cycle_wrap`: the 7-day line `M,OFF,OFF,OFF,OFF,OFF,E` (E on the last day, M on the first day) has the E-to-M gap across the wrap; expect the flag with day index 6.
6. `test_all_days_worked_is_a_streak`: a 7-day line of seven `M` shifts has `longest_work_run_days == 7` and a `LONG_WORK_STREAK` flag at the default threshold 6.
7. `test_empty_line_is_info_not_error`: a line of all `OFF` returns an `EMPTY_LINE` info and no exception.
8. `test_coverage_perfect_for_pitman_with_demand_one`: with `demand_matrix` all ones and the four-crew Pitman roster, `understaffed_hours_per_week == 0` and `overstaffed_hours_per_week == 0` (this works because Appendix A's checker shows exactly one day crew and one night crew every day).
9. `test_coverage_counts_midnight_spill`: a single night line `N` every day with demand 1 only from 19:00 to 23:00 gives zero understaffing and a positive overstaffing in the early-morning hours of every day, proving spill is counted.
10. `test_weekend_exposure_uses_start_weekday`: the same 7-day line with `start_weekday=0` versus `start_weekday=5` yields different `weekends_fully_off_pct` when the OFF days are placed on indexes 0 and 1.
11. `test_validation_errors`: unknown cell code, wrong cell count, duplicate labels, 201 lines, cycle 6 and cycle 57 each raise `ValidationError`.
12. `test_performance_bound`: 200 lines times 56 days finishes in under 2 seconds.
13. `test_no_banned_words_in_messages`: run the audit on several fixtures and assert that no finding message or disclaimer contains `compliant`, `guarantee` or `certified`, and that the phrase `legal advice` appears only inside the constant disclaimer sentence.

Acceptance: all suites exit 0; `git diff --stat` lists only the five files above.

Commit message: `WP-3.1: add cyclic roster audit engine and rules doc`

### WP-3.2 Audit API route

Preconditions: WP-3.1 merged.

Files (exactly): `backend/app/api/audit_routes.py` (new), `backend/app/main.py` (two lines: the import and the `include_router`), `backend/app/api/__init__.py` (add `"audit_routes"` to `_modules` to match sibling modules), `backend/app/tests/test_roster_audit.py` (append API tests).

Steps:
1. `audit_routes.py`: `router = APIRouter(prefix="/schedules", tags=["Roster Audit"])`; `@router.post("/audit", response_model=AuditResponse)` taking `AuditRequest` and returning `audit_roster(request)`. Plain `def`, not `async def`, to match `schedule_routes.py`.
2. `main.py`: next to the existing `from app.api.schedule_routes import router as schedule_router` add `from app.api.audit_routes import router as audit_router`, and after `app.include_router(schedule_router, prefix=settings.api_prefix)` (line 118) add `app.include_router(audit_router, prefix=settings.api_prefix)`. The app-level `dependencies=[Depends(require_login)]` (line 53) already protects it; do not add per-route auth.
3. The route is stateless: no database access, no persistence, no idempotency key. Do not add it to the solver concurrency middleware path list (`middleware.py` lines 395 to 400); the request caps in `AuditRequest` bound the cost.
4. Tests: a valid request returns 200 and a body that validates as `AuditResponse`; an invalid cell returns 422 and the message names the line label and day; with auth enabled the endpoint returns 401 without a session. For the 401 test, copy the pattern used in `test_auth.py` around line 225 (`self.client.get("/api/employees").status_code == 401`), including how that file turns login on (it sets its own `SHIFTFLOW_SESSION_SECRET`, see `tests/__init__.py`'s comment). Do not weaken `AUTH_DISABLED` for other modules.
5. The OpenAPI docs flag: `enable_api_docs` defaults to false, so nothing else is needed.

Acceptance: suites exit 0; `curl`-equivalent `TestClient` call with the Pitman fixture returns zero flags.

Commit message: `WP-3.2: add POST /api/v1/schedules/audit`

### WP-3.3 Rotation pattern library with verified coverage

Preconditions: WP-3.1 merged.

Files (exactly): `backend/app/engine/rotation_patterns.py` (new), `backend/app/api/audit_routes.py` (add two read-only routes), `backend/app/tests/test_rotation_patterns.py` (new), `backend/app/tests/__init__.py` (append).

Steps:
1. In `rotation_patterns.py`, define a frozen dataclass `RotationPattern` with `pattern_id`, `name`, `description`, `cycle_days`, `shifts` (a list of `AuditShiftDef`), `crews` (list of `(label, pattern_string, offset_days)`), and `coverage` (dict of shift code to the number of crews on duty every day). A pattern string uses one character per day: a shift code character or `-` for off.
2. Ship exactly these three patterns, all verified by the script in Appendix A (do not add others unless the same checker passes and the owner supplies a source for the name): `pitman_2_2_3_12h` (14 days; crew pattern `DD--DDD--DD---`; day crews at offsets 0 and 7; night crews with `N` in place of `D`, offsets 0 and 7; coverage D=1, N=1), `four_on_four_off_12h` (8 days; `DDDD----` at offsets 0 and 4 for day crews; `NNNN----` at offsets 0 and 4 for night crews; coverage D=1, N=1), and `dupont_28_12h` (28 days; `NNNN---DDD-NNN---DDDD-------` at offsets 0, 7, 14 and 21; coverage D=1, N=1; note in the description that this pattern has a 72-hour peak week).
3. Descriptions must be factual and short, with no claims. Example: `Four crews, 12-hour day and night shifts, 14-day cycle. Average 42 hours per week per crew.` Do not write that any pattern is "best" or "safe".
4. Function `pattern_to_audit_request(pattern_id, start_weekday=0, thresholds=None) -> AuditRequest` that expands crews and offsets into `AuditLine` rows (rotate the pattern string left by the offset).
5. Function `verify_coverage(pattern) -> list[str]` returning an empty list when every day of the cycle has exactly the stated number of crews on each shift code (port the logic of Appendix A's `rollout`/`check`).
6. Routes in `audit_routes.py`: `GET /schedules/audit/patterns` returns the list of ids, names, descriptions and cycle lengths; `GET /schedules/audit/patterns/{pattern_id}` returns a ready-to-post `AuditRequest` body (404 for an unknown id).
7. Tests: for each pattern, `verify_coverage` returns `[]`; each average weekly hours is 42.0; `pattern_to_audit_request` output validates; the unknown id returns 404; all descriptions pass the banned-word list.

Acceptance: suites exit 0.

Commit message: `WP-3.3: add verified 12-hour rotation pattern library`

### WP-3.6 Solver-to-audit adapter (so ShiftFlow's own output can be audited and compared)

Why: the solver's roster is 7-day cyclic lines that people move between week to week (`current_cycle_week`, `next_week_line_number` on `RosterLineSchema`). A fair comparison must audit the real sequence a person works, not one week in isolation.

Preconditions: WP-3.2 and WP-2.2 merged.

Files (exactly): `backend/app/engine/solver_to_audit.py` (new), `backend/app/api/audit_routes.py` (add one route), `backend/app/tests/test_solver_to_audit.py` (new), `backend/app/tests/__init__.py` (append).

Steps:
1. First read how the solver computes `rest_before` for day 0 of a line (isd_rwsp_solver.py around lines 790 to 820: which previous cell is used for `d == 0`: the same line's day 6, or the previous line in the rotation). Write the answer as a comment at the top of the new file with the line numbers you read. If the solver wraps within the same line, the adapter must say so in its docstring and the comparison must use the same assumption; if it uses the previous line, follow that.
2. Function `solution_to_audit_request(solution: SolveResponseSchema, templates, start_weekday=0, thresholds=None) -> AuditRequest`. Build the successor map from `next_week_line_number` over `roster_lines`; split lines into orbits of that permutation; for each orbit, create one `AuditLine` whose cells are the concatenation of the orbit's lines' 7-day cells in orbit order, and `cycle_days = 7 * len(orbit)`. If orbits have different lengths, pad by repeating each orbit's pattern until all share `lcm` of the orbit lengths times 7 days, or, if that exceeds 56 days, split into separate audit calls grouped by orbit length and say so in the response. Shift definitions come from `shift_types` (start hour times 60, duration times 60, kind from the code: M day, D day, E evening, N night).
3. Route `POST /schedules/audit/compare` taking `{ "solve_request": SolveRequestSchema, "audit_request": AuditRequest }` and returning `{ "generated": AuditResponse, "existing": AuditResponse, "notes": [str] }`. It solves, adapts, audits both, and returns them side by side. Add the same input caps. If solving raises `SolverInfeasibleError`, let the existing 422 handler respond.
4. Tests: (a) round trip: solve `manufacturing_24_7` at leeway 5, adapt, audit; assert the audit's overall minimum rest equals the solution's `min_rest_hours_observed` (or, if the definitions differ, assert the difference and explain it in the test docstring); (b) the adapter never produces a cycle over 56 days for the shipped presets or reports the split; (c) comparing the Pitman fixture against `continuous_ops_12h` returns both responses with the disclaimer; (d) a request with a bad audit body returns 422.

Acceptance: suites exit 0.

Commit message: `WP-3.6: audit solver output and compare with an existing roster`

### WP-3.4 Audit screen in the frontend

Preconditions: WP-3.2, WP-3.3 and WP-3.6 merged; Amendment A3(e).

Files (exactly): `frontend/src/types.ts` (A3(e): add `'audit'` to the union at line 324 and nothing else), `frontend/src/services/auditApi.ts` (new), `frontend/src/services/auditParse.ts` (new), `frontend/src/services/auditParse.test.ts` (new), `frontend/src/components/RosterAuditView.tsx` (new), `frontend/src/components/RosterAuditView.test.tsx` (new), `frontend/src/components/Header.tsx` (one entry in `navTabs`, and the tab-number map at line 11 if the Header keeps one), `frontend/src/App.tsx` (the render line and the keyboard shortcut, see below), `frontend/src/components/KeyboardShortcutsModal.tsx` (only if shortcuts are listed there and the new tab needs one).

Steps:
1. `auditApi.ts`: define the TypeScript types that mirror `AuditRequest`, `AuditResponse`, `AuditFinding`, `AuditLineMetrics`, `AuditCoverage` (field names exactly as in WP-3.1). Do not put them in `types.ts`. Provide `postAudit(req)`, `listPatterns()`, `getPattern(id)`, `postCompare(body)` using `fetch` with relative URLs and default credentials (same-origin cookies), the way the solve call in `frontend/src/services/api.ts` does (about line 507 at baseline: `fetch('/api/v1/schedules/solve', { method: 'POST', ... })`). Read that call and the lines after it to copy its error handling; do not import from `api.ts`. Errors: parse the JSON `detail` field when present and throw an `Error` with a readable message; never swallow errors silently.
2. `auditParse.ts`: pure functions for input. `parseGrid(text, cycleDays)` accepts text pasted from a spreadsheet (tab-separated, comma-separated, or whitespace-separated) where the first column is the line label and the remaining columns are the day cells (`OFF`, `-`, `.` or blank all mean off). It returns `{ lines, errors }` where each error names the row and column in plain words (`Row 3, day 9: "XN" is not a shift you defined`). `parseShifts(rows)` builds `AuditShiftDef` from the shift table the user edits. Labels and cells are plain text; never use them as HTML. Limits: reject input over 11,200 cells before sending.
3. `RosterAuditView.tsx` layout, top to bottom, all with visible labels per Constitution Section 7:
   a. A heading `Audit an existing roster` and one plain sentence: `Paste the rotation you run today. ShiftFlow checks rest, streaks, night work and weekend exposure against the limits you set. It does not tell you whether the roster is legal.`
   b. A `Load an example` select with the three patterns from `listPatterns()` and a `Load` button (`type="button"`).
   c. A shifts table: rows with columns `Code`, `Name`, `Start (HH:MM)`, `Hours`, `Kind` (select). Add and remove row buttons with visible text.
   d. `Days in the cycle` (number 7 to 56) and `First day of the cycle is a` (select Monday to Sunday).
   e. A textarea labelled `Roster grid (one line per row)` with helper text showing the expected format.
   f. A thresholds fieldset using the defaults from WP-3.1, each field with a visible label and unit.
   g. An optional `Demand` section collapsed by default: a 7 by 24 grid is too big on a phone, so offer two inputs `Staff needed on every day shift hour` and `Staff needed on every night shift hour` only if cheap to do; otherwise omit the demand input in this WP and say so in the commit body.
   h. A `Run audit` button (`type="button"`), disabled while running, with an `aria-live="polite"` status region.
   i. Results: a summary strip (number of flags, smallest rest in hours, longest work run, highest 7-day hours); a findings table with columns `Rule`, `Line`, `Day`, `Value`, `Limit`, `What it means`, sorted as the API returns; a per-line metrics table; the disclaimer string from the API shown verbatim under the results.
   j. A `Compare with a ShiftFlow schedule` button, visible only after an audit succeeded, that calls `postCompare` using the current `solve_request` held in `App.tsx` state. To avoid threading new props through `App.tsx` beyond one, accept a single optional prop `solveRequest: SolveRequest | null` and disable the button with the text `Build a schedule in the setup first` when it is null.
4. `Header.tsx`: add `{ id: 'audit', label: 'Audit a Roster' }` to `navTabs` after `compliance`, with no badge. If the tab-number map at line 11 (`compliance: 6`) is used for shortcuts, add `audit: 7` and update `KeyboardShortcutsModal.tsx` line 38 area to list `7`.
5. `App.tsx`: import the view, add `{activeTab === 'audit' && <RosterAuditView solveRequest={...} />}` next to the other tab renders (line 824 area), and extend the keyboard handler (lines 490 to 500) with the `7` key only if the shortcut map was extended. Keep every other line unchanged. If `App.tsx` does not currently hold a single `SolveRequest` object, pass `null` and note the limitation in the commit body; do not refactor `App.tsx`.
6. Accessibility and layout: every input labelled; tables have `<caption>` or `aria-label`; the result tables scroll inside their own container (`overflow-x-auto`) so the page never scrolls horizontally at 375px; every `<button>` has an explicit `type`; error text linked with `aria-describedby`.
7. Claims policy: none of the banned words appear in any visible string. The claims test from WP-1.1 must pass.

Tests:
1. `auditParse.test.ts`: comma, tab and space separated input; blank cells as off; unknown code error names row and column; too many cells rejected; labels containing `<script>` and `=HYPERLINK(...)` are returned as plain strings unchanged (no evaluation).
2. `RosterAuditView.test.tsx`: renders labels; loads an example by mocking `fetch` for `listPatterns` and `getPattern`; running with a mocked 200 response shows findings and the disclaimer; a mocked 422 shows the readable error in a region with `role="alert"`; the compare button is disabled when `solveRequest` is null.
3. Add a Header test line or extend an existing one only if a Header test already exists.

Acceptance: build and tests exit 0; `git diff -U0 2e6ee18 -- frontend/src/types.ts` shows exactly the single added union member; at 375px no horizontal page scroll (state how you checked; a Playwright check is not required by this plan).

Commit message: `WP-3.4: add Audit a Roster tab`

### WP-3.5 Printable roster risk report

Preconditions: WP-3.4 merged.

Files (exactly): `frontend/src/components/AuditReport.tsx` (new), `frontend/src/components/RosterAuditView.tsx` (add a `Print report` button and render the report), `frontend/src/components/RosterAuditView.test.tsx` (extend), `frontend/src/index.css` (a `@media print` block only, if the existing `no-print` class is not sufficient; first check how `.no-print` is defined with `grep -n "no-print" frontend/src/index.css`).

Steps:
1. `AuditReport.tsx` takes the `AuditResponse`, the shift table, the cycle length, the start weekday and the thresholds, and renders a single-page-friendly document: title `Roster risk report`, the date generated, the inputs (shift table, thresholds), the summary strip, the findings table, the per-line metrics table, and the disclaimer string from the API verbatim, plus one extra line: `Generated from the pattern entered by the user. Not legal advice.`
2. The `Print report` button (`type="button"`) calls `window.print()`. Everything outside the report has the `no-print` class while printing.
3. A `Download findings as CSV` button builds a CSV with `csvSafeCell` from `frontend/src/csvSafety.ts` applied to every cell (labels are user text, so formula injection is a real risk). Import `csvSafeCell` from `../csvSafety`; it is not one of the frozen files. Columns: rule, severity, line, day, value, limit, message. Filename `roster_audit_findings.csv`.
4. Tests: the report renders the disclaimer; the CSV for a line label `=HYPERLINK("http://x","y")` comes out neutralized (the cell does not start with `=`, `+`, `-` or `@` after processing; follow what `csvSafeCell` documents).

Acceptance: build and tests exit 0.

Commit message: `WP-3.5: add printable audit report and CSV export`

---

## 12. Phase 4 — Reposition the repo to match what is true

### WP-4.1 Point presets and labels at 24/7 operations

Preconditions: WP-2.2 merged.

Files (exactly): `frontend/src/components/onboarding/presetLabels.ts`, `backend/app/api/archetype_routes.py` (descriptions only, never ids), `frontend/src/components/onboarding/lessons.ts` (only if a lesson names a store type; check first), tests that assert the changed strings.

Steps:
1. List current labels with `grep -n "" frontend/src/components/onboarding/presetLabels.ts`. Order them so 24/7 presets (continuous operations, healthcare 24/7, manufacturing 24/7, emergency services) appear before retail presets in the picker, if the picker's order comes from this file or the API order; if it comes from `ARCHETYPE_PRESETS` insertion order, reorder the dictionary entries (keys and values unchanged) and run the golden tests.
2. Remove store-specific text (Omaha, Downtown Foodmart, convenience, liquor, smoke shop) from user-visible descriptions in `archetype_routes.py`. Keep the ids (`downtown_foodmart_omaha`, `retail_grocery`) exactly; changing an id would break saved configurations, tests and the golden snapshots.
3. Do not delete the retail presets. The owner decides later whether to retire them.

Acceptance: suites exit 0; golden snapshots unchanged; `grep -rniE "omaha|foodmart|smoke|liquor" frontend/src backend/app --include=*.py --include=*.ts --include=*.tsx | grep -v test` returns only ids and test fixtures.

Commit message: `WP-4.1: lead with 24/7 presets and remove store-specific text`

### WP-4.2 Rename (only if the owner decides to rename)

Preconditions: the owner has chosen a new name, searched trademark and domain availability, and told the agent the exact new strings. If the owner decides to keep the name, skip this WP and close it as "not done".

Facts: there are 459 occurrences of "ShiftFlow", "shiftflow" or "SHIFTFLOW" in 81 files (research count). Environment variables use the prefix `SHIFTFLOW_` (for example `SHIFTFLOW_AUTH_DISABLED`, `SHIFTFLOW_SESSION_SECRET`, `SHIFTFLOW_ENABLE_*`, `SHIFTFLOW_MAX_CONCURRENT_SOLVES_PER_CALLER`); the database and temporary files use `shiftflow` in names; CI and Docker files may reference the name.

Approach (mechanical, per the Constitution's 2026-10-20 "Mechanical fixes applied without a Builder" rule):
1. Produce a replacement list: for each file, the exact old string, the exact new string and the expected match count, generated by `grep -rnoE "ShiftFlow|shiftflow|SHIFTFLOW" .` and classified into four groups: (a) display text; (b) file and module names; (c) environment variable prefixes; (d) data names (SQLite file, cookies, localStorage keys).
2. Do group (a) in one commit. Do (b) only if the owner wants it, in another commit with `git mv`. For (c), keep reading the old `SHIFTFLOW_` names as fallbacks for at least one release by adding a small helper in `config.py`; this is a behavior change and needs its own tests. For (d), never rename a localStorage key or cookie name without a migration: users would lose saved setups.
3. Do not touch `docs/CONSTITUTION.md` historical amendments; they record history.

Acceptance: suites exit 0; replacement list reviewed by the owner before application; every changed file is in the list.

Commit message: `WP-4.2: rename display text to <new name>`

### WP-4.3 README rewrite

Preconditions: WP-3.4 merged.

Files (exactly): `README.md`.

Steps: rewrite the README so that its first screen answers, in plain language: what the tool does today (audit a rotating roster for rest, streaks, nights and weekends; generate and compare alternatives), who it is for (people who run or redesign 24/7 rosters, and consultants), what it does not do (it is not a legal compliance tool, it does not do shift swapping, time clocks or payroll, it is not validated against published benchmarks), how to run it (copy the real commands from `docker-compose.yml`, `.env.example` and the CI workflows; verify each command runs before writing it), how to run tests (the three commands in Section 6), and where the rules and thresholds are defined (`docs/audit_rules.md`). Keep the architecture and math section but remove or soften anything WP-1.2 did not already remove, and add a "Known limitations" section that lists, with links to the forensics and benchmark documents, the coverage fidelity result from WP-2.3 and the benchmark status from WP-2.5. No pricing, no savings numbers, no "how it's sold" paragraph; those move to `gtm/` in WP-4.4.

Acceptance: every command in the README was run by the agent on a clean checkout (state results in the commit body); claims test patterns (the A6 word list) find nothing in the README (`grep -niE "guarantee|compliant|certified|safe harbor|fewer accidents"` returns nothing).

Commit message: `WP-4.3: rewrite README around the audit use case`

### WP-4.4 Restructure gtm and add a discovery kit

Preconditions: the owner has decided to keep going after reading Section 14.

Files (exactly): move the existing 15 gtm markdown files and `target_prospect_database.csv` to `gtm/archive_smb_hypothesis/` (use `git mv`); add `gtm/discovery/interview_guide.md`, `gtm/discovery/interview_log_template.csv`, `gtm/discovery/pilot_offer.md`, `gtm/discovery/sample_audit_walkthrough.md`; add `gtm/README.md`. Update any relative link that breaks (search for `gtm/` in the repo).

Content rules:
1. `interview_guide.md`: opens with the goal (find a real roster-redesign event with a budget), the target interviewees (shift-schedule consultants, plant and utility operations managers, hospital unit managers, dispatch supervisors, union or safety committee members), and a 30-minute script. The script asks about the last time they changed a rotation, who decided, what it cost, what tools they used, what fatigue or overtime problems drove it, what they would pay for, and whether they would hand over a sample roster for a free audit. It lists questions NOT to ask (leading questions about ShiftFlow). Do not invent quotes or data.
2. `interview_log_template.csv`: columns `date, name, role, org_type, shift_pattern_in_use, last_redesign_date, redesign_driver, budget_owner, tools_used, would_share_roster (y/n), would_pay (amount or n), notes, follow_up`.
3. `pilot_offer.md`: one page, plain language: free audit of one roster in exchange for feedback and permission to describe the result without naming the customer; then a paid second-step offer (range $500 to $1,500 is the owner's hypothesis, label it as such). Include the no-legal-advice disclaimer.
4. `sample_audit_walkthrough.md`: walk through auditing the DuPont 28-day pattern from the library, showing the 72-hour peak week the audit finds; include only numbers produced by the repo's audit engine (run it and paste the output).
5. `gtm/README.md`: one paragraph: what is archived and why (research did not support the SMB pitch), what is active.

Acceptance: `git status` shows renames, not deletions plus additions, for the archived files; no broken relative links (`grep -rn "gtm/" .`); the claims scan finds nothing in the new files.

Commit message: `WP-4.4: archive SMB gtm docs and add discovery kit`

### WP-4.5 Scope note for dormant modules

Preconditions: WP-4.3 merged.

Files (exactly): `docs/SCOPE.md` (new).

Content: a table of modules with status: active (solver, ergonomics, pareto, audit, archetypes, schedules, auth, facility config, employees, owners), flagged off by default (POS integration, emergency workflows, shift handover; flags in `backend/app/config.py`), stub or mostly 501 (emergency routes, handover routes, billing). Say that no marketing or README claim may mention flagged-off modules until they are implemented and tested. Do not delete code in this WP.

Acceptance: file exists; every module named in it exists in the repo (agent checks with `ls`).

Commit message: `WP-4.5: document active, flagged and stub modules`

---

## 13. Things this plan deliberately does not do

1. It does not add a new optimizer, a solver rewrite, machine learning, a mobile app, payments, new integrations, or multi-tenant features.
2. It does not turn on or build out emergency workflows, shift handover, POS import, or payroll export.
3. It does not claim legal compliance anywhere and does not add jurisdiction-specific rest rules. Adding a jurisdiction table is possible later, but each row would need a primary-source citation checked by the owner and review by counsel; agents must leave `source_url` and `verified_on` empty and must never fill them from memory.
4. It does not rename the product (that is the owner's decision, WP-4.2).
5. It does not delete the retail presets or the old gtm documents.
6. It does not change `fair_workweek_compliant`; it stays `None`.

---

## 14. Phase 5 — Owner-only gates (Freddy; agents cannot do these)

These are the steps that decide whether the engineering above is worth finishing. They are listed after the build steps for convenience, but the first two should start in week one, in parallel with Phase 1, because they cost nothing and decide everything.

### 5.1 Adopt the amendments (this week)

Read Section 3, edit any wording you disagree with, add dates, and tell the first Builder agent to run WP-0.1. Nothing else can start until this is done.

### 5.2 Run about 20 discovery conversations (start now; finish before building WP-3.4)

Who: shift-schedule consultants; operations or HR managers at plants, utilities and water or power operators; nurse managers and staffing coordinators on 24/7 hospital units; 911 and dispatch supervisors; safety or union committee members. How to find them: your Werner and WVU supply-chain network (distribution centers, manufacturing plants, and carriers run 24/7 shifts), LinkedIn searches by title, and shift-work consultants who publish online. What to ask: use `gtm/discovery/interview_guide.md` after WP-4.4, or run the script from Section 12 now; record every call in the log template. What to offer: a free audit of one real roster (with names removed) in exchange for 30 minutes and permission to describe the result anonymously.

### 5.3 The kill or continue gate (decide after about 20 conversations or 6 weeks, whichever is first)

Continue to build only if both are true:
1. At least 3 interviewees describe a specific roster redesign that happened or is planned within the last two years, name who controlled the budget, and say they would try the audit on a real roster.
2. At least 1 pays (any amount from the $500 to $1,500 hypothesis range) for a pilot, or signs a written purchase intent with a date.

If only the first is true, keep going for 4 more weeks on the pilot offer and nothing else. If neither is true, stop adding features. Keep the repo as a portfolio piece: it is a strong demonstration of optimization, API design, test discipline and a governance process, which is relevant to supply-chain and operations roles.

### 5.4 Legal and naming checks (before any public launch)

1. Name: check trademark and domain availability against the existing product that uses the name shiftflow.app; decide to keep or rename; if renaming, give the agent the exact new strings and run WP-4.2.
2. Counsel: before publishing any page that describes rest rules, fatigue or "compliance", have a lawyer review the wording, even though the plan keeps all language to rule-based checks with disclaimers.
3. Privacy: the audit endpoint stores nothing, but the app has accounts. Before a pilot with a real customer roster, decide whether the customer's data ever enters the database; the audit route in WP-3.2 does not persist it.
4. Re-verify the cited reference points in `docs/audit_rules.md` and any outside statistic you intend to quote (the Finnish scheduling precedent, vendor consolidation, legal rest minimums by jurisdiction) against primary sources.

### 5.5 Benchmark data (optional but valuable)

Obtain the published rotating-workforce benchmark instances and the numbers from the primary paper; fill `backend/benchmarks/published_results.template.json` yourself; then ask an agent to extend `runner.py` to load them. Until then the README says the engine is not validated against the paper, and that sentence must stay.

---

## 15. Risks and what to do about them

| Risk | Likelihood | Effect | Mitigation in this plan |
|---|---|---|---|
| Lowering the rest default changes existing customers' schedules | Low (default stays 16) | Surprise | WP-2.0 golden snapshots must stay identical in WP-2.1 |
| Rotation-offset placement improves coverage but worsens weekend strain | Medium | Worse ergonomics score | WP-2.3b requires a before/after table and owner review; no preset may get worse silently |
| Saved browser configurations break when a guardrail field is added | Medium | Users lose their setup | A3(f): `readGuardrails` adds the default instead of extending the whitelists |
| An agent edits a frozen file beyond the exception | Medium | Art. 4 violation | Hunk-level check in Section 6 item 5 |
| An agent tool adds a model attribution trailer | High | Art. 8 violation | Section 2.3, Amendment A4, Police grep in Appendix D |
| The audit's defaults get mistaken for legal limits | Medium | Reputation, legal | Disclaimer constant in every response and report; A6 banned words; docs/audit_rules.md wording |
| Time spent on features before any customer conversation | High | Wasted effort | Phase 5 gates; Section 14.3 |
| Pattern library entries carry names the owner cannot source | Low | Credibility | Only three patterns, checked by script; others require an owner-supplied source |
| Flaky tests hide regressions | Low to medium | False confidence | WP-0.2 runs each module twice and reports flaky tests |

---

## 16. Prompts to give each role (copy, then fill the braces)

### Builder

```
You are the Builder for work package {WP id} in docs/PLAN_V2.md of the repo at {path}. Read docs/CONSTITUTION.md completely, then Sections 0 to 7 of docs/PLAN_V2.md, then only your WP. Touch only the files your WP lists. Follow every step in order. Run the baseline commands before and after. Do not add dependencies. Do not edit tests you did not write unless the WP names them. Strip any automatic commit trailers (Art. 8). If anything in the plan contradicts the code, stop and report. When finished, output: the list of changed files, the exact commands you ran with their exit codes, and any deviations or open questions. Commit as one commit with the message given in the WP.
```

### Lawman

```
You are the Lawman (Constitution Section 4) for {WP id}. Inspect the whole repo, not only the diff. Report each defect as: file:line, the article violated, severity (BLOCKER, MAJOR, MINOR). Check specifically: files changed versus the WP file list; frozen-file hunks versus the adopted amendment; no new dependencies; Section 7 quality floor (labels, button types, no new inline any, 375px); claims policy word list; golden snapshots unchanged unless the WP says otherwise; tests added match the WP's test list; commit message has no trailers. Do not fix anything.
```

### Judge

```
You are the Judge (Constitution Section 5). Rule only on the Lawman's findings for {WP id}. Each ruling is exactly one of ORDER-FIX (state the exact fix), DISMISS (state why the finding is wrong), or REMAND (name the gap). Do not add findings.
```

### Police

```
You are the Police (Constitution Section 6). Verify the Builder's fix against each Judge ruling for {WP id}, line by line, and check nothing else. Verdict per ruling: COMPLIANT or NONCOMPLIANT with file:line evidence. Also run: git log --format=%B {range} | grep -iE 'co-authored-by|claude|anthropic|generated with|session_'  — any output is NONCOMPLIANT under Art. 8.
```

---

## 17. Definition of done for the whole plan

1. Every WP in Section 4 either merged or explicitly closed by the owner.
2. All three suites exit 0 on the final commit, locally and in CI.
3. `grep -rniE "8\.37|27\.34|39\.46|becker_theoretical|never schedules less than 16|checks this one rule" .` returns nothing outside `docs/CONSTITUTION.md` history and `docs/PLAN_V2.md`.
4. The 12-hour continuous preset solves; the audit tab runs end to end on the three library patterns; a printed report exists.
5. The README's first screen matches what the code does today.
6. The owner has either passed or failed the Section 14.3 gate and written the decision down in `docs/DECISIONS.md` (the owner creates this; agents do not).

---

## Appendix A. Pattern fixtures and the coverage checker (verified by script on 2026-10-22)

Pattern strings (one character per day; `D` day shift 07:00 to 19:00, `N` night shift 19:00 to 07:00, `-` off):

1. Pitman 2-2-3, 14-day cycle, one crew: `DD--DDD--DD---`. Four crews: day crews at offsets 0 and 7; night crews use the same string with `N` for `D`, offsets 0 and 7. Result: exactly one day crew and one night crew every day. Average 42.0 hours per week. Longest work run 3. Maximum shifts in any 7 days: 5 (60 hours).
2. 4-on-4-off, 8-day cycle: day crew `DDDD----`, night crew `NNNN----`. Four crews: day crews at offsets 0 and 4; night crews at offsets 0 and 4. Result: exactly one day crew and one night crew every day. Average 42.0 hours per week. Maximum shifts in any 7 days: 4 (48 hours). Longest night run: 4.
3. DuPont 28-day cycle: `NNNN---DDD-NNN---DDDD-------` (4 nights, 3 off, 3 days, 1 off, 3 nights, 3 off, 4 days, 7 off). Four crews at offsets 0, 7, 14 and 21. Result: exactly one day crew and one night crew every day (a brute-force search over offsets also finds this set first). 14 worked shifts per 28 days: average 42.0 hours per week. Longest work run 4. Maximum shifts in any 7 days: 6 (72 hours). Rest runs between work blocks: 1, 3 and 7 days.

Checker (the repo version must be a function in `rotation_patterns.py`; this is the reference logic):

```python
def rollout(crews, horizon):
    """crews: list of (pattern, offset). Returns a list over days of {'D':n,'N':n,'-':n}."""
    days = []
    for day in range(horizon):
        counts = {"D": 0, "N": 0, "-": 0}
        for pat, off in crews:
            counts[pat[(day + off) % len(pat)]] += 1
        days.append(counts)
    return days

def days_without_exact_coverage(crews, cycle_days, want_day=1, want_night=1):
    r = rollout(crews, cycle_days)
    return [i for i, c in enumerate(r) if c["D"] != want_day or c["N"] != want_night]
```

Note: this checker only works when every crew pattern has length equal to the cycle. Rotating a string left by `offset` is equivalent to reading index `(day + offset) % len`.

## Appendix B. Facts to keep in mind when reading the solver

1. `ISDRWSPSolver` is in `backend/app/engine/isd_rwsp_solver.py` (1105 lines). Method order: `_build_shift_types` (line 210), `_solve_daily_shift_counts` (254), `_partition_into_alternating_sequences` (311), `_assign_forward_rotating_shifts_to_work_sequences` (389), `solve` (618). Module-level helpers: `verify_multigraph_eulerian_conditions` (45) and `extract_eulerian_cycle_hierholzer` (107).
2. `solve()` raises `SolverInfeasibleError` when total work shifts are under 14 (line 635).
3. Template codes and rotation order come from `TEMPLATE_ORDER = {"M":0,"D":1,"E":2,"N":3}` in `config.py`.
4. The generator uses backtracking with a cap of 2000 per block.
5. `evaluate_ergonomics_audit` takes `(shift_types, multigraph_arcs, roster_lines, guardrails, baseline_audit)` and returns `ErgonomicsAuditSchema`; the baseline is the real zero-leeway solve.
6. The Eulerian cycle step is a validity check on the multigraph, not an optimizer. Do not describe it as optimization.
7. Soft guardrail penalty constants (12.0, 4.0, 15.0, 3.0, 8.0) exist in the sequence assignment; none is sourced. Do not describe them as from the paper.

## Appendix C. Persistence and compatibility notes

1. The frontend saves the whole solve configuration in `localStorage` with `SOLVE_CONFIG_VERSION = 1` (api.ts line 225); `readGuardrails` rejects the whole saved guardrails object if any numeric or flag field is missing. That is why Amendment A3(f) adds the default in `readGuardrails` rather than extending the field lists.
2. `DEFAULT_GUARDRAILS` appears five times in `api.ts` (the lines with `enforce_zero_clopening: true` at 78, 108, 138, 168, 198). Because `min_rest_hours` is optional in `ErgonomicGuardrails`, none of those need to change.
3. The server stores facility solve configuration as opaque JSON (`facility_config_routes.py`, 200 KB cap), so adding a field does not need a migration.
4. Idempotency keys hash the request body (`IdempotencyStore`); a new optional field changes the hash only for requests that include it.

## Appendix D. Police checks (run these exact commands)

1. Commit trailers: `git log --format=%B plan-v2 ^main | grep -iE 'co-authored-by|claude|anthropic|generated with|session_'` returns nothing.
2. Frozen files: `git diff -U0 2e6ee18 -- frontend/src/services/api.ts frontend/src/types.ts` shows only the hunks in Amendment A3 for the WPs merged so far.
3. Solver hunks: `git diff -U0 main -- backend/app/engine/isd_rwsp_solver.py` shows only hunks named in WP-2.1, WP-2.3b and WP-2.4.
4. Lone-E guard untouched: `git diff main -- backend/app/engine/isd_rwsp_solver.py | grep -n 'cand == "E"'` returns nothing.
5. No new dependencies: `git diff main -- frontend/package.json frontend/package-lock.json backend` shows no changes to dependency files (there is no backend requirements change in this plan).
6. File scope: `git diff --stat` for the commit lists only the WP's files.
7. Claims words: the A6 grep in WP-4.3 acceptance returns nothing on files changed by the WP.

## Appendix E. Reproducing the measurements in Section 1.1

Run these from a scratch directory outside the repo with a virtual environment that has `pydantic`, `fastapi`, `uvicorn`, `python-multipart` and `httpx` installed (the app package imports `fastapi` at import time). Set `SHIFTFLOW_AUTH_DISABLED=1`, put `backend` on `sys.path`, and use `python -I` to avoid picking up stray modules.

1. Rest arithmetic: the helper is `max(0, 24 + curr_start - (prev_start + prev_dur))`. `compute_rest_hours_between("D", 7, 12, "D", 7)` returns 12 for a 12-hour day shift repeated at the same time next day, and a repeated 12-hour night shift (start 19) also returns 12. An 8-hour morning shift repeated (start 6) returns 16. A 16-hour minimum therefore rejects both 12-hour patterns when the same shift repeats on consecutive days and accepts the 8-hour one exactly at the limit.
2. Template feasibility: build `SolveRequestSchema` with `_build_24_7_demand(4, 4, 4, 4, 0)`, default guardrails, leeway 5.0, and the template sets from WP-2.1's tests; expect 422 for 12-hour D/N, 10-hour M/E and 9-hour M/E/N at the default, and success for 8-hour M/E/N.
3. Lowering the constant in memory (`settings.min_rest_hours_between_shifts = 11`) shows 12-hour D/N and 9-hour M/E/N solving and 10-hour M/E still failing with the message "The rotation has a closing shift followed by an opening shift, which zero-clopening forbids." That is the evidence for the hour-based wrap check in WP-2.1.
4. Coverage gap: sum `understaffing` and `overstaffing` over `solution.interval_coverage`.
5. Pareto flatness: run `ISDRWSPSolver(req, include_pareto_frontier=True).solve()` on a preset with no employees and print `estimated_weekly_payroll` for each point; all are 0.

## Appendix F. Questions only the owner can answer (agents: do not guess)

1. Which name will the product use, and does it need to change? (WP-4.2)
2. Which minimum-rest default should the audit and generator ship with: 11 hours (the audit's default in this plan) or 16 (the generator's current default)? This plan keeps 16 for the generator so existing results do not change and uses 11 for the audit; the owner may unify them.
3. Should the retail presets be kept, hidden or deleted?
4. Does the owner want the audit hosted for customers (accounts, data handling) or only run locally and delivered as a report in the pilot phase?
5. Which published benchmark instances and numbers are authoritative, and where are they? (WP-2.5)
6. Who is the counsel who will review the wording? (Section 14.4)
