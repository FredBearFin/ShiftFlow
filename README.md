# ShiftFlow

> Status: research prototype. Nothing here has been validated against published benchmarks or reviewed by counsel.

**What it does today.** ShiftFlow has two parts that share one set of rules:

1. **Audit a roster you already run.** Paste a repeating rotation (7 to 56 days, for example a 2-2-3, a 4-on-4-off or a 28-day pattern with 12-hour shifts). It reports short rest between shifts, long runs of work days, nights and long shifts, hours in any 7 days, weekend exposure and uneven load, against limits you set. You can print the result as a one-page report or download the findings as CSV, and compare the roster with a schedule ShiftFlow generates for the same demand.
2. **Generate and compare schedules.** From hourly demand, shift templates and fairness rules, it builds a weekly rotating schedule and shows how strain changes as you allow more staffing.

**Who it is for.** People who run or redesign rosters for 24/7 operations (plants, utilities, control rooms, hospital units, dispatch), and consultants who do that work for them.

**What it does not do.** It is not a legal compliance tool and does not assess any statute: the default limits are house settings, not legal limits. It does not do time clocks, shift swapping or payroll. The generator has not been validated against the benchmark instances in the cited paper, and its coverage is imperfect (see Known limitations).

**Where the rules are defined.** The audit rules, their definitions and default thresholds are in [`docs/audit_rules.md`](docs/audit_rules.md). The audit stores nothing.

---

## 1. Mathematical Architecture (Becker, EJOR 2026)

Traditional workforce systems decompose **Shift Design (SDP)** and **Rotating Workforce Scheduling (RWSP)** into separate sequential stages, frequently resulting in suboptimal ergonomics or infeasible rosters. ShiftFlow Studio follows the structure of the **Integrated Shift Design and Rotating Workforce Scheduling Problem (I-SD-RWSP)** from that paper. The generator is a greedy, backtracking heuristic, not an exact solver, and its results have not been compared with the paper's:

### A. Shift Design & Interval Coverage (Constraints 3–5)
Given a cyclic 7-day planning horizon $g \in G = \{0, \dots, 6\}$ and 24 hourly intervals $i \in I = \{0, \dots, 23\}$ per day with staffing requirements $R_{gi}$, the engine selects concrete shift types $t \in T$ derived from shift templates $s \in S = \{M, D, E, N\}$:

$$\sum_{(g', t) \in C^D_{gi}} \xi_{g't} = R_{gi} + \tau_{gi} - \omega_{gi} \quad \forall g \in G, i \in I$$

where $\xi_{gt} \in \mathbb{Z}_{\ge 0}$ is the number of shifts of type $t$ starting on day $g$, $\tau_{gi} \ge 0$ is understaffing, and $\omega_{gi} \ge 0$ is overstaffing.

### B. Directed Multigraph $\mathcal{G} = (\mathcal{V}, \mathcal{E})$ & Eulerian Cycle Theorem
- **Node Set**: $\mathcal{V} = \{(g, n) \mid g \in G, n \in \{\text{work}, \text{rest}\}\}$ (14 nodes: 7 work nodes and 7 rest nodes).
- **Work Sequence Arcs**: A work sequence $b \in B$ starting on day $g_1$ and ending the day before $g_2$ traverses arc $e_b = ((g_1, \text{work}), (g_2, \text{rest}))$.
- **Rest Sequence Arcs**: A rest sequence $h \in H$ starting on day $g_2$ and ending the day before $g_3$ traverses arc $e_h = ((g_2, \text{rest}), (g_3, \text{work}))$.
- **Theorem 1 (Becker 2026)**: An alternating sequence of work and rest sequences $\mathcal{S} = \{(g_1, b_1), (g_2, h_2), \dots, (g_k, b_k), (g_l, h_l)\}$ forms a structurally valid rotating schedule if and only if the corresponding arcs form an **Eulerian cycle** on $\mathcal{G}$.
- **Hierholzer's Algorithm (1873)**: Extracts the complete cyclic schedule in linear $O(|\mathcal{E}|)$ time by splicing subtours into a closed alternating tour and unrolling it across $e$ standardized **Rotation Cohorts (`Line 1` to `Line e`)**.

### C. Bi-Objective Optimization & The 8 Nurmi/Becker Ergonomics Criteria
1. **Shift Design Objective ($obj^{\text{shift}}$, Eq. 1 & Table 3)**:
   $$obj^{\text{shift}} = W^E \cdot e + W^{NS} \sum_{t \in T} \phi_t + \sum_{g \in G} \sum_{i \in I} (W^O \omega_{gi} + W^U \tau_{gi})$$
   with weights $W^E = 5, W^{NS} = 60, W^O = 1, W^U = 1$.
2. **Ergonomics Penalty Objective ($obj^{\text{ergo}}$, Eq. 2 & Table 4 — Nurmi et al. 2024)**:
   - $W^{SL}_t$: Shift duration $> 9$ hours (Weight: $1 \times [0..3]$)
   - $W^{MS}_t$: Early morning shift starting before 06:00 (Weight: $1 \times [0..1]$)
   - $W^{CD}_b$: Consecutive working days outside ideal 3–5 day range (Weight: $4 \times [0..3]$)
   - $W^{CN}_b$: $\ge 3$ consecutive night shifts (Weight: $3 \times [0..3]$)
   - $W^{CE}_b$: $\ge 4$ consecutive evening shifts (Weight: $1 \times [0..4]$)
   - $W^{SN}_b$: Isolated single night shifts (Weight: $4 \times [0..1]$)
   - $W^{WW}_{gb}, W^{WR}_{gh}$: Weekend work duties / split weekends (Weight: $4 \times [0..1]$)
   - $W^{SR}_h$: Single-day split rest periods (Weight: $1 \times [0..1]$)
   - **Rest and rotation rules**: the generator keeps a fixed minimum rest between consecutive shifts (currently 16 hours; this is a house rule, not a legal standard) and rotates forward ($M \to D \to E \to N$). A configurable minimum is planned (WP-2.1).
3. **Cost versus strain trade-off.** For each facility the engine re-solves the schedule at several staffing-cost levels and reports the measured strain score at each level. These are results for your inputs, not published figures. The engine has not been validated against the benchmark instances in the cited paper; see the benchmark harness (WP-2.5) for status.

---

## 2. Project Structure

```text
shiftflow-enterprise/
├── docker-compose.yml
├── .env.example
├── README.md
├── backend/
│   ├── Dockerfile
│   ├── requirements.txt
│   └── app/
│       ├── __init__.py
│       ├── main.py
│       ├── config.py
│       ├── schemas.py
│       ├── engine/
│       │   ├── __init__.py
│       │   ├── isd_rwsp_solver.py    # Becker Eulerian multigraph & Hierholzer solver
│       │   ├── ergonomics.py         # Full 8 Nurmi/Becker ergonomics evaluation
│       │   ├── pareto.py             # Epsilon-constraint Pareto frontier generator
│       │   ├── roster_audit.py       # Rule-based audit of a repeating roster
│       │   ├── rotation_patterns.py  # Verified 12-hour rotation examples
│       │   └── solver_to_audit.py    # Solver output as an audit request
│       ├── api/
│       │   ├── __init__.py
│       │   ├── schedule_routes.py
│       │   ├── archetype_routes.py
│       │   ├── audit_routes.py       # POST /api/v1/schedules/audit and example patterns
│       │   ├── billing_routes.py     # self-serve signup/checkout (stub - no real Stripe call yet)
│       │   ├── owner_routes.py       # owner-invite: full facility access, not just a summary
│       │   └── facility_config_routes.py  # syncs wizard config server-side per facility
│       └── tests/
│           ├── __init__.py
│           └── test_solver.py
└── frontend/
    ├── Dockerfile
    ├── package.json
    ├── tsconfig.json
    ├── vite.config.ts
    ├── index.html
    └── src/
        ├── index.css
        ├── main.tsx
        ├── App.tsx
        ├── types.ts
        ├── components/
        │   ├── Header.tsx
        │   ├── PricingView.tsx       # self-serve signup/checkout page
        │   ├── OnboardingWizard.tsx
        │   ├── MasterRosterView.tsx
        │   ├── CoverageHeatmapView.tsx
        │   ├── ParetoExplorerView.tsx
        │   ├── ErgonomicsAuditView.tsx
        │   ├── RosterAuditView.tsx    # Audit a Roster tab
        │   ├── AuditReport.tsx        # printable report and CSV
        │   ├── OwnerAccessPanel.tsx   # manager invites an owner
        │   ├── OwnerAcceptView.tsx    # owner accepts the invite
        │   └── OwnerSummaryView.tsx   # owner's view of the facility
        └── services/
            └── api.ts
```

---

## 3. Running it

### Tests
```bash
cd backend && pip install -r requirements.txt && python run_all_tests.py
cd frontend && npm install && npm run build
cd frontend && npm test
```
Backend tests run each module against its own temporary SQLite file.

### Run locally (backend and frontend separately)
```bash
# terminal 1: API on http://localhost:8000
cd backend && pip install -r requirements.txt
SHIFTFLOW_AUTH_DISABLED=1 python -m uvicorn app.main:app --port 8000   # login off: local development only

# terminal 2: web app on http://localhost:5173 (proxies /api to port 8000)
cd frontend && npm install && npm run dev
```
`GET http://localhost:8000/health` reports the service state. The interactive API documentation is off by default.

### Run with Docker Compose
```bash
cp .env.example .env          # set SHIFTFLOW_SESSION_SECRET to a random value of 32+ characters
docker compose up --build
```
Frontend at `http://localhost:5173`, API at `http://localhost:8000`. See `DEPLOYMENT_GUIDE.md` for production notes.

## 4. Known limitations

- **Coverage is imperfect.** On flat demand the generator builds about the right number of shift patterns, but 20% to 24% of staff-hours land on the wrong hours, because work stretches start on the same weekday. See [`docs/forensics/coverage_20261022.md`](docs/forensics/coverage_20261022.md). A fix is proposed there and has not been applied.
- **Not validated against published benchmarks.** The benchmark harness described in the plan has not been built yet, and no published figures have been reproduced. Do not cite this engine as reproducing a paper's results.
- **The 0.65 quantile used to set daily shift counts** is a value the author chose; it has no source.
- **The health score** (0 to 100) is a display heuristic that stays between 55 and 99.5. It is not a medical or validated measure.
- **Cost axis.** With no wages entered, cost means staffing level (number of shift patterns).
- **Minimum rest** defaults to 16 hours in the generator and 11 hours in the audit. Both are editable house settings.
- **Modules that exist but are switched off by default** (POS import, emergency workflows, shift handover) are not part of the product described here.
