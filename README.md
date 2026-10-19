# ShiftFlow Studio Enterprise (I-SD-RWSP Workforce OS)

**ShiftFlow Studio** is a production-grade enterprise SaaS workforce optimization platform implementing the unified mathematical framework of **Tristan Becker (2026)**, *"A unifying approach to shift design and rotating workforce scheduling"*, published in the *European Journal of Operational Research* (EJOR).

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
│       │   └── archetype_routes.py
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
        │   ├── OnboardingWizard.tsx
        │   ├── MasterRosterView.tsx
        │   ├── CoverageHeatmapView.tsx
        │   ├── ParetoExplorerView.tsx
        │   └── ErgonomicsAuditView.tsx
        └── services/
            └── api.ts
```

---

## 3. Quick Start & Verification

### Run Automated Unit & Integration Tests
```bash
cd backend
PYTHONPATH=. python3 -m unittest discover -s app/tests -v
```

### Launch Full Stack with Docker Compose
```bash
cp .env.example .env
docker compose up --build
```
- **Frontend Web UI**: `http://localhost:5173`
- **FastAPI Backend & OpenAPI Docs**: `http://localhost:8000/docs`
