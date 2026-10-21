# ShiftFlow Studio

ShiftFlow Studio generates **rotating weekly staff schedules**. You give it how many
people you need on the floor each hour of the week, plus the shift templates you are
willing to run. It gives you back a set of roster lines that repeat: each line is one
person's week, and the lines rotate so that over a full cycle everyone works the same mix
of mornings, days, evenings and nights.

It is aimed at shift supervisors, not at operations researchers.

---

## 1. What the engine actually does

This section is deliberately plain about which parts are exact and which parts are
approximate, because the two are easy to confuse.

### Step 1 — How many of each shift run each day (heuristic)

For each day and each shift template, the engine looks at the hourly staffing
requirements the shift would cover and takes the **0.65 quantile** of them as a starting
count. That quantile is a hand-picked constant; **no source for it is recorded in this
repository**, and it is not derived from any published model. It is a seed that happened
to behave reasonably on the sample presets.

It then runs **two passes of ±1 coordinate descent**: for every (day, shift type) count in
turn, it tries one more and one fewer, keeps whichever lowers a weighted
over/under-staffing deviation score, and moves on.

This is a **greedy local-search heuristic, not an optimizer**. It does not solve a linear
or integer program, it has no bound on how far its answer is from the best possible one,
and it can stop at a local minimum. Nothing in this repository computes an optimality gap,
and no claim of optimality should be read into its output.

Concretely, on the bundled Omaha retail preset at 0% leeway the result leaves
**102 understaffed and 122 overstaffed person-hours** across the 168-hour week. At 10%
leeway those fall to 60 and 80. Those gaps are real, and are reported back in the coverage
heatmap rather than hidden.

### Step 2 — Work and rest blocks (arithmetic split, soft-scored)

Total weekly shifts are divided by a target work-day ratio to get the number of roster
lines `e`. The cycle is then split into alternating work blocks and rest blocks by simple
integer division, and candidate splits are scored against the ergonomic preferences
(ideal 3–5 day work stretches, no isolated single days off). Those preferences are **soft
penalties** — the engine prefers to satisfy them but will return a schedule that does not.

### Step 3 — Which shift code lands on which day (greedy, with hard constraints)

Each day of each work block is filled by walking the templates in forward-rotation order
(M → D → E → N) and picking the highest-scoring legal code. The following are **hard**: a
shift may not start before 16 hours of rest have elapsed, rotation may not run backwards,
and if zero-clopening is on, an evening shift may not be followed by a morning shift. If
no legal code exists, the solve fails with an explanation rather than quietly breaking a
rule.

Because this chooser is greedy and has no backtracking, it can paint itself into a corner
on a tight instance and report infeasibility for a schedule a smarter search would have
found. The bundled presets are tested to be solvable at both 0% leeway and their own
default leeway; see `backend/app/tests/test_solver.py`.

### Step 4 — The rotation cycle (this part is exact)

The work and rest blocks are turned into arcs of a **directed multigraph**: 14 nodes, one
`work` and one `rest` node per day of the week. A work block beginning on day `g1` and
ending the day before `g2` becomes an arc from `(g1, work)` to `(g2, rest)`; a rest block
is the mirror image. A set of blocks forms a valid repeating rotation exactly when those
arcs admit an **Eulerian cycle**.

This is implemented properly and genuinely checked:

- `verify_multigraph_eulerian_conditions` verifies in-degree equals out-degree at every
  active node, that every arc runs work→rest or rest→work, and that the active nodes are
  reachable from one another. Failure aborts the solve.
- `extract_eulerian_cycle_hierholzer` is a real **Hierholzer** implementation, linear in
  the number of arcs, splicing subtours into one closed alternating tour.
- The tour is then checked to cover every arc and to unroll into exactly `e × 7` day
  slots. A short or padded cycle aborts the solve instead of being silently filled in.

So the rotation *structure* is verified. The staffing *numbers* feeding it are a
heuristic. Do not read the rigour of step 4 as applying to step 1.

### Step 5 — Cost, rest and the leeway slider

The leeway percentage lowers the target work-day ratio, which raises headcount for the
same total shifts: more people, shorter work stretches, more rest. The cost-vs-rest
frontier is built by **actually re-solving** the request at each anchor leeway value
(0, 1, 5, 10, 20, 50, 75%) and reading the real headcount, coverage, payroll and workload
score off each resulting schedule. No point on that frontier is extrapolated, and a
leeway level that turns out to be infeasible is dropped from the frontier rather than
guessed at.

**Neither cost nor strain moves monotonically with leeway**, and the frontier does not
pretend they do. Adding a person changes the shape of the work/rest partition, which can
fit the week's demand curve more evenly (lowering cost outright) or chop up more weekends
(raising strain). On the retail preset the real strain scores run 43 at 0% leeway, 36 at
5%, 5 at 50% and back up to 19 at 75% - where the schedule is also cheaper than at 50%
and gives fewer full weekends off despite one more person on the books. The trend is
downward; individual steps are not. Read the frontier, do not assume the rightmost point
is the kindest.

The workload-strain score is the sum of eight weighted checks: long shifts, pre-06:00
starts, work stretches outside 3–5 days, three or more consecutive nights, four or more
consecutive evenings, isolated single nights, weekend duty, and isolated single days off.
The "improvement" figure compares a schedule against a real re-solve of the same request
at 0% leeway, not against an estimate.

Payroll is regular hours up to 40 plus overtime at 1.5×, computed per line from the
assigned employee's wage. An unassigned line carries no wage and contributes nothing.

### What this README used to claim, and why it no longer does

Earlier versions presented the engine as an implementation of an integrated ILP from the
operations-research literature, and stated a "Pareto Trade-Off Law" giving fixed ergonomic
gains per percent of extra cost: +1% → 8.37%, +5% → 27.34%, +10% → 39.46%.

**Nothing in this repository computes or verifies those numbers.** They were never
outputs; they appeared only in prose and in one test docstring. The real improvement
figure depends entirely on the instance — on the retail preset, 10% leeway yields about
16%, not 39%. The ILP framing and those figures are removed rather than restated. What is
genuinely implemented from the literature is the Eulerian-cycle formulation of a rotating
roster in step 4, and that is where the credit belongs.

---

## 2. Project structure

```text
shiftflow/
├── README.md
├── DEPLOYMENT_GUIDE.md
├── docker-compose.yml
├── vercel.json
├── .env.example
├── .github/workflows/          # backend-tests.yml, frontend-build.yml
├── docs/
│   ├── CONSTITUTION.md         # the project's working decision record
│   ├── SHIFT_HANDOVER_OPERATIONAL_AUDIT.md
│   └── gtm/                    # go-to-market and audit documents
├── backend/
│   ├── Dockerfile
│   ├── requirements.txt
│   ├── requirements-dev.txt
│   ├── run_all_tests.py        # the single backend test entry point
│   ├── seed_data.py
│   ├── benchmark_load.py
│   └── app/
│       ├── main.py             # FastAPI app, startup, /health
│       ├── config.py           # weights, the 16h rest rule, template order
│       ├── schemas.py          # every request and response model
│       ├── database.py         # SQLite schema and the per-owner repository
│       ├── auth.py             # session cookie signing and verification
│       ├── middleware.py       # idempotency keys and in-flight lock recovery
│       ├── deps.py             # per-user scoped repository dependency
│       ├── create_user.py      # CLI: create an account
│       ├── claim_legacy_data.py # CLI: assign pre-accounts data to an owner
│       ├── engine/
│       │   ├── isd_rwsp_solver.py   # steps 1-5 above
│       │   ├── ergonomics.py        # the 8 workload checks
│       │   ├── pareto.py            # cost-vs-rest frontier, by re-solving
│       │   ├── pos_sync.py          # POS sales history -> demand forecast
│       │   ├── payroll_export.py    # payroll provider CSV export
│       │   └── timecard_audit.py    # timecard vs schedule audit
│       ├── api/
│       │   ├── schedule_routes.py   # /solve, /default-solution, /export-csv
│       │   ├── archetype_routes.py  # the industry presets
│       │   ├── employee_routes.py
│       │   ├── auth_routes.py
│       │   ├── pos_payroll_routes.py
│       │   └── emergency_routes.py
│       └── tests/              # 11 modules, all run by run_all_tests.py
└── frontend/
    ├── Dockerfile
    ├── nginx.conf
    ├── package.json
    ├── vite.config.ts
    ├── vitest.config.ts
    ├── tailwind.config.js
    ├── index.html
    └── src/
        ├── main.tsx
        ├── App.tsx
        ├── index.css
        ├── types.ts
        ├── services/api.ts
        ├── test/setup.ts
        └── components/
            ├── Header.tsx
            ├── LoginView.tsx
            ├── OnboardingWizard.tsx
            ├── MasterRosterView.tsx
            ├── CoverageHeatmapView.tsx
            ├── ParetoExplorerView.tsx
            ├── LaborAnalysisView.tsx
            ├── ErgonomicsAuditView.tsx
            ├── StaffDirectoryView.tsx
            ├── DOLComplianceView.tsx
            ├── POSIntegrationView.tsx
            ├── KeyboardShortcutsModal.tsx
            ├── criteriaLabels.ts
            ├── ui/              # Button, Term, useDialogFocus
            ├── onboarding/      # wizard panels, glossary, lessons
            └── __tests__/
```

---

## 3. Quick start

### Backend tests

```bash
cd backend && python run_all_tests.py
```

Every test module runs against its own temporary SQLite file, so no module shares state
with another.

### Frontend build and tests

```bash
cd frontend && npm ci && npm run build && npm test
```

### Full stack with Docker Compose

```bash
cp .env.example .env
docker compose up --build
```

- Frontend: `http://localhost:5173`
- Backend and OpenAPI docs: `http://localhost:8000/docs`

`SHIFTFLOW_SESSION_SECRET` must be set to a strong value or the backend refuses to start.
See `.env.example` and `DEPLOYMENT_GUIDE.md`, which also documents the durability limits
of the default SQLite deployment.
