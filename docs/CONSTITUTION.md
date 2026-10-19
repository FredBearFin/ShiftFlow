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
