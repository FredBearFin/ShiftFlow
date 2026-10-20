# CONSTITUTION: New-Facility Setup Wizard Overhaul

Repo: /home/user/ShiftFlow. Branch: claude/gifted-allen-7ezngw. Scope: `frontend/` only.
Governing plan: /root/.claude/plans/okay-i-want-you-encapsulated-pike.md (the "Plan").

## 1. Supremacy

This Constitution and the approved Plan are the only sources of law. Anything not expressly allowed by either is forbidden. If they conflict, this Constitution governs until the King amends it.

## 2. Articles for every PR

- **Art. 1 (one PR, one commit).** One PR is one commit. Changes are limited to the files the PR lists. Any other file is a violation.
- **Art. 2 (build).** `cd frontend && npm install && npm run build` exits 0.
- **Art. 3 (tests).** From PR 1 onward, `cd frontend && npm test` exits 0.
- **Art. 4 (frozen files).** `frontend/src/services/api.ts` and `frontend/src/types.ts` are untouched from baseline commit `2e6ee18` (amended 2026-10-19; see Amendments). Check: `git diff --quiet 2e6ee18 -- frontend/src/services/api.ts frontend/src/types.ts`. The only permitted use is a read-only import of `interpolateBeckerTable7` in PR 14. The solver is never modified.
- **Art. 5 (frozen props).** The 16-prop interface of `OnboardingWizard` is frozen unless the PR explicitly says otherwise.
- **Art. 6 (dependencies).** No runtime dependencies beyond the Plan. Dev dependencies are limited to vitest, jsdom, @testing-library/react and Playwright, plus @testing-library/dom as the required peer of @testing-library/react 16 only (amended 2026-10-19). @testing-library/jest-dom is forbidden.
- **Art. 7 (lockfile).** `package-lock.json` is committed in PR 1 only.
- **Art. 8 (commit hygiene).** Commit messages contain no secrets, no model names, and no attribution lines naming a model.
- **Art. 9 (PR identifiers).** PRs are numbered as in the Plan. The draft-persistence PR is **7A** and the guide PR is **15A**. There are 23 PRs in total (see Amendments).

## 3. Conduct rules for Builder

- Do only the PR's listed scope. No drive-by refactors, renames or cleanups.
- Change user-facing copy only where the PR says so.
- Keep existing behavior unless the PR is a behavior PR. Behavior PRs are 7A, 9 to 19, and 15A. All others must leave app behavior unchanged.
- Leave the app building after every PR.
- Do not start PR 15A until the user confirms the guide dialogue tone.

## 4. Rules for Lawman

- Inspect the whole `frontend/` base, not only the diff.
- Report each defect as: `file:line`, the article violated, and severity.
- Severity: **BLOCKER** breaks build or tests, changes a frozen file or interface, or breaks keyboard or screen-reader access. **MAJOR** violates an article without breaking the app. **MINOR** is a style or hygiene issue.

## 5. Rules for Judge

- Rule only on Lawman findings. Do not add new findings.
- Each ruling is exactly one of:
  - **ORDER-FIX**: states the exact required fix.
  - **DISMISS**: states why the finding is wrong.
  - **REMAND**: returns the item to Builder with the named gap.
- BLOCKERs are fixed before merge. MAJORs are fixed before the next PR begins. MINORs may be deferred with a recorded note. A BLOCKER may be carried to a named Plan PR only under the 2026-10-19 amendment in Amendments (merge gate).

## 6. Rules for Police

- Verify the Builder's fix line by line against the Judge's ruling. Check nothing else.
- Verdict per ruling: **COMPLIANT** or **NONCOMPLIANT**, with evidence as `file:line`.
- NONCOMPLIANT verdicts return to the Judge.

## 7. Accessibility and quality floor

- Every input has a visible label, via FormField or a `<label>`.
- Every `<button>` has an explicit `type`.
- No new inline `any`.
- No new console errors or warnings.
- Layout works at 375px width with no horizontal page scroll (Plan Q1, adopted).
- From PR 19 onward, error text is linked to its field with `aria-describedby`.

## 8. Amendment

Only the King amends this document. Each amendment is recorded below with its date and reason.

## Amendments

- **2026-10-19. Numbering.** Draft persistence is PR 7A and the guide is PR 15A, for 23 PRs in total. Reason: the Plan's count of 22 left out the draft PR that the Plan's Decisions section approves.
- **2026-10-19. Plan open questions adopted as rules.** Minimum width is 375px. `npm test` runs on every PR after PR 1. Guide tone is light touch, pending user confirmation before PR 15A. Reason: the Plan lists these as assumed defaults, and the King makes them binding.
- **2026-10-19. Art. 4 baseline moved to 2e6ee18.** Reason: commit b674d79 (fixing TypeScript build errors that blocked the Vercel deploy) added DEFAULT_TEMPLATES, DEFAULT_GUARDRAILS, DEFAULT_DEMAND_MATRIX, INITIAL_STORE_EMPLOYEES and exportRosterToCsvString to `api.ts`, and NewEmployeeInput to `types.ts`. Reverting would undo the build fixes. b674d79 is not on origin/main, so the old check could never pass. Two later commits also edited `api.ts`: aebae44 (removed the unused rotationWeekOffset parameter from exportRosterToCsvString) and 2e6ee18 (quoted CSV fields containing carriage returns). Both are accepted as part of the baseline. This is not precedent: no further edits to these files are permitted. The baseline is 2e6ee18 because it is the last commit touching either file; d95da57 has the same content for both. This baseline supersedes the Plan's `origin/main` check.
- **2026-10-19. Art. 6 peer dependency.** Reason: @testing-library/react 16 requires @testing-library/dom as a peer. It is allowed as a dev dependency for that purpose only. @testing-library/jest-dom is not allowed, and the Judge's order to remove it stands.
- **2026-10-19. PR 0A added; PR count.** Reason: Lawman found unlabeled controls, icon-only buttons without accessible names, and buttons without `type` in MasterRosterView, StaffDirectoryView, CFODashboardView, LaborAnalysisView and POSIntegrationView. These are outside the wizard, so the fix is a separate PR placed after PR 21 so the numbering does not change. PR 0A is a markup-only sweep: no visual changes, and buttons inside a form keep their current submit behavior. For PR 0A only, the visible-label rule in Art. 7 is met by `aria-label` where no visible label exists, since PR 0A must not add visible text. The Plan now has 23 numbered PRs plus 0A, which makes 24 PRs in total. The "23" in Art. 9 is read as 24.
- **2026-10-19. BLOCKER carry-over and merge gate (King ruling on Judge remand, items D and E).** A BLOCKER may be carried to a named Plan PR, but only when that PR lands before the merge to main. Merge gate: the wizard branch claude/gifted-allen-7ezngw is not merged to main until every carried BLOCKER is closed. Main is not deployed from this branch yet, so the carry is a merge gate and not a live regression. Carried BLOCKERS and their named PRs: **D**, OnboardingWizard.tsx:322 (demand-matrix hour inputs), to PR 8. **E**, OnboardingWizard.tsx:665 (leeway range slider), to PR 11. Reason: the Judge found both under §4 as screen-reader access BLOCKERs, and the fix is taught in the same PRs.
- **2026-10-19. Visible label required for D and E (King ruling).** The fix for D and E must add a VISIBLE label associated with the control via `<label>` (or `htmlFor`/`id`). `aria-label` alone is not sufficient for these two items. D: each hour input gets a visible label of the form "Hour 00:00" (one per hour, 00:00 to 23:00 as displayed). E: the leeway slider gets a visible label "Extra cost allowed". Reason: §7 requires a visible label for every input. The PR 0A `aria-label` exception does not extend to PR 8 or PR 11.
- **2026-10-19. Label additions are not a behavior change (King clarification).** The visible labels required by the two amendments above are markup and text only. They do not change behavior under §3, so PR 8 and PR 11 may add them even though PR 8 is not in the behavior list. Reason: §3 would otherwise be read to forbid the fix the Judge ordered.
- **2026-10-19. Lesson-to-glossary check moved from PR 4 to PR 17 (King ruling on Judge remand).** The test that every term used in a lesson exists in the glossary is removed from PR 4 and added to PR 17. Option (a), a `terms: string[]` field on each Lesson in PR 3, is rejected. Reason: lessons.ts marks no glossary terms, and only 4 of 10 glossary terms appear verbatim in lesson text, so the rest are paraphrased and the test cannot be written as PR 4 specifies. PR 4 and PR 3 stay narrow, and PR 17 writes the check once the lessons are final and tagged.
- **2026-10-20. Judge remand G: wizard field labels carried to Plan PRs (King ruling).** Lawman found §4 screen-reader BLOCKERs at OnboardingWizard.tsx lines 179, 394, 414, 434, 454, 499, 517, 535 and 553, where the `<label>` elements are not associated with their inputs. Carried BLOCKERS and owners: **G1**, line 179 (step 1 facility name), to PR 7. **G2**, lines 394, 414, 434 and 454 (step 3 shift time fields), to PR 9. **G3**, lines 499, 517, 535 and 553 (step 4 rule fields), to PR 10. Each fix must add a VISIBLE label associated with its input via `htmlFor`/`id` or by wrapping the input in the `<label>`. `aria-label` alone is not sufficient. The merge gate in the 2026-10-19 carry-over amendment applies: the wizard branch is not merged to main until G1, G2 and G3 are closed. Label additions under G are markup and text only and are not a behavior change under §3, as in the 2026-10-19 clarification above; this extends that clarification to PR 7, which is not in the §3 behavior list. Reason: under §5, a BLOCKER may be carried only to a named Plan PR, and each owner above is the Plan PR whose scope covers that step. No new PR is created. The remand named PR 9 for step 1; the Plan assigns step 1 to PR 7, so PR 7 is the owner.
- **2026-10-20. Test files added to PR scope (King ruling on Judge PR 5 ruling).** The following test files are approved as part of their PR's scope under Art. 1: `frontend/src/components/onboarding/lessons.test.ts` (PR 3), `frontend/src/components/onboarding/glossary.test.ts` (PR 4), and `frontend/src/components/ui/Term.test.tsx` (PR 5). Reason: each PR's component needs its unit test, and the Plan's acceptance criteria (`npm test` passes) require it. Each test file is added to the PR's file list and to no other PR. Art. 1 is otherwise unchanged.
- **2026-10-20. BardPanel test added to PR 6 scope (King ruling).** `frontend/src/components/onboarding/BardPanel.test.tsx` is approved as part of PR 6's scope under Art. 1, the same way as the 2026-10-20 test-file amendment for PRs 3, 4 and 5. Reason: the bard panel's unit test belongs to the panel's PR so `npm test` covers it. The file is added to PR 6's file list and to no other PR.
- **2026-10-20. PR 0A scope extended to plain-English copy (King ruling).** PR 0A now also covers three copy changes outside the wizard. Visible text in `ParetoExplorerView.tsx` (around line 50), `CoverageHeatmapView.tsx` (around line 41) and `POSIntegrationView.tsx` (around line 30) uses "Pareto" or "R_gi" without explanation. Each term is explained in plain English in place, as Plan line 11 requires. PR 0A's files are the five listed in the 2026-10-19 PR 0A entry plus `ParetoExplorerView.tsx` and `CoverageHeatmapView.tsx`, which are added here. POSIntegrationView.tsx is already listed. Behavior does not change. This overrides the 2026-10-19 PR 0A rule that PR 0A adds no visible text, for these three copy changes only. The markup rules of that entry still apply to all of PR 0A. Reason: no Plan PR covers these three views, and the Plan requires such terms to be explained in place.
