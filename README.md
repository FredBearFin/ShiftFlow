# ShiftFlow

**ShiftFlow** builds your weekly staff schedule for you, in minutes instead of hours. It's built for the shift manager at a convenience store, liquor store, smoke shop, bar, or restaurant — the kind of independent, single-location business that's open long or odd hours and still schedules with a spreadsheet or a notepad. Punch in your hours, your crew, and your coverage needs, and ShiftFlow hands back a fair, workable schedule — one that spreads the late nights and weekends around instead of burning out the same two people every week.

Under the hood, ShiftFlow runs on the same rigorous scheduling math used in large-scale workforce systems — detailed below for anyone curious how the sausage is made — but you never have to see any of it. You just get a schedule.

**How it's actually sold:** self-serve, no sales process. A manager signs up on the pricing page and pays personally (Personal tier, $9-15/mo). Once the schedule is showing real savings, that manager can invite the business owner, who gets their own login with full access to the same facility — real continuity if the manager ever leaves, not just a read-only summary. A separate, higher Business tier exists for when the owner takes over paying, but it's priced the same way today, not yet a different account structure — see `gtm/commercial_pricing.md` for the honest version of what's built versus intended, and `gtm/demo_script.md` for the exact click-by-click walkthrough.

---

## 1. Mathematical Architecture (Becker, EJOR 2026)

Traditional workforce systems decompose **Shift Design (SDP)** and **Rotating Workforce Scheduling (RWSP)** into separate sequential stages, frequently resulting in suboptimal ergonomics or infeasible rosters. ShiftFlow Studio solves the **Integrated Shift Design and Rotating Workforce Scheduling Problem (I-SD-RWSP)** jointly:

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
   - **Zero-Clopening Hard Guardrail**: Enforces $\ge 16$ hours rest between consecutive shifts and strict circadian forward rotation ($M \to D \to E \to N$).
3. **Pareto Trade-Off Law (Becker 2026, Table 7)**:
   - **+1% leeway** in $obj^{\text{shift}}$ yields an **8.37%** ergonomic improvement.
   - **+5% leeway** yields a **27.34%** ergonomic improvement (**Critical Knee Point**).
   - **+10% leeway** captures **39.46%** of all ergonomic gains with **$0 extra payroll**.

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
│       │   └── pareto.py             # Epsilon-constraint Pareto frontier generator
│       ├── api/
│       │   ├── __init__.py
│       │   ├── schedule_routes.py
│       │   ├── archetype_routes.py
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
        │   ├── OwnerAccessPanel.tsx   # manager invites an owner
        │   ├── OwnerAcceptView.tsx    # owner accepts the invite
        │   └── OwnerSummaryView.tsx   # owner's view of the facility
        └── services/
            └── api.ts
```

---

## 3. Quick Start & Verification

### Run Automated Unit & Integration Tests
```bash
cd backend && python run_all_tests.py
```

### Launch Full Stack with Docker Compose
```bash
cp .env.example .env
docker compose up --build
```
- **Frontend Web UI**: `http://localhost:5173`
- **FastAPI Backend & OpenAPI Docs**: `http://localhost:8000/docs`
