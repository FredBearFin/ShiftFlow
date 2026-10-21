"""Golden-master harness for the solver.

Captures the complete SolveResponse for every bundled preset at every flexibility
level and hashes it. Any refactor of the engine must reproduce these hashes exactly;
a single changed hour, hour count, penalty or payroll figure shows up as a diff.

    python tools/solver_golden.py write    # record the baseline
    python tools/solver_golden.py check    # fail if anything moved

This exists because the solver's correctness is load-bearing and hard-won: the
zero-clopening adjacency fix, the backtracking code assigner and the unconditional
evening guardrail are all recent, and none of them are obvious from reading a diff.
"""

import hashlib
import json
import os
import pathlib
import sys
import tempfile

sys.path.insert(0, str(pathlib.Path(__file__).resolve().parents[1]))

GOLDEN = pathlib.Path(__file__).with_name("solver_golden.json")
LEEWAY_LEVELS = (0.0, 1.0, 5.0, 10.0, 20.0, 50.0, 75.0)


def _capture() -> dict:
    fd, db = tempfile.mkstemp(suffix=".db")
    os.close(fd)
    os.environ["SHIFTFLOW_DB_PATH"] = db
    os.environ["SHIFTFLOW_AUTH_DISABLED"] = "1"
    import app.database as database

    database.DB_FILE = db
    from app.api.archetype_routes import ARCHETYPE_PRESETS
    from app.engine.isd_rwsp_solver import ISDRWSPSolver, SolverInfeasibleError
    from app.schemas import SolveRequestSchema

    out: dict = {}
    try:
        for preset_id, preset in sorted(ARCHETYPE_PRESETS.items()):
            for leeway in LEEWAY_LEVELS:
                key = f"{preset_id}@{leeway}"
                request = SolveRequestSchema(
                    archetype_id=preset.id,
                    facility_name=preset.name,
                    demand_matrix=preset.demand_matrix,
                    templates=preset.templates,
                    guardrails=preset.guardrails,
                    pareto_leeway_pct=leeway,
                )
                try:
                    solution = ISDRWSPSolver(request).solve()
                except SolverInfeasibleError as exc:
                    out[key] = {"infeasible": str(exc)}
                    continue

                payload = json.loads(solution.model_dump_json())
                # solve_time_ms is wall clock: it differs every run and says nothing
                # about correctness. Everything else is pinned.
                payload.pop("solve_time_ms", None)
                for point in payload.get("pareto_frontier", []):
                    point.pop("solve_time_ms", None)

                blob = json.dumps(payload, sort_keys=True, separators=(",", ":"))
                out[key] = {
                    "sha256": hashlib.sha256(blob.encode()).hexdigest(),
                    # A few figures in clear text, so a diff says what moved rather
                    # than only that something did.
                    "employee_count": solution.employee_count,
                    "obj_shift": solution.obj_shift,
                    "obj_ergo": solution.obj_ergo,
                    "health_index": solution.ergonomics_audit.health_index_score,
                    "total_payroll": solution.labor_analysis.total_payroll_cost,
                    "understaffing": sum(c.understaffing for c in solution.interval_coverage),
                    "overstaffing": sum(c.overstaffing for c in solution.interval_coverage),
                    "shift_codes": "".join(
                        cell.shift_code[0] if cell.shift_code != "OFF" else "-"
                        for line in solution.roster_lines
                        for cell in line.days
                    ),
                }
    finally:
        os.remove(db)
    return out


def main(argv: list) -> int:
    mode = argv[1] if len(argv) > 1 else "check"
    current = _capture()

    if mode == "write":
        GOLDEN.write_text(json.dumps(current, indent=2, sort_keys=True) + "\n")
        print(f"wrote {len(current)} cases to {GOLDEN.name}")
        return 0

    if not GOLDEN.exists():
        print(f"no baseline at {GOLDEN}; run: python tools/solver_golden.py write", file=sys.stderr)
        return 2

    baseline = json.loads(GOLDEN.read_text())
    drifted = []
    for key in sorted(set(baseline) | set(current)):
        was, now = baseline.get(key), current.get(key)
        if was != now:
            drifted.append((key, was, now))

    if not drifted:
        print(f"solver output unchanged across all {len(current)} cases")
        return 0

    print(f"SOLVER OUTPUT MOVED in {len(drifted)} of {len(current)} cases:", file=sys.stderr)
    for key, was, now in drifted[:10]:
        print(f"\n  {key}", file=sys.stderr)
        for field in sorted(set(was or {}) | set(now or {})):
            a, b = (was or {}).get(field), (now or {}).get(field)
            if a != b:
                shown_a = str(a)[:70]
                shown_b = str(b)[:70]
                print(f"    {field}: {shown_a}  ->  {shown_b}", file=sys.stderr)
    return 1


if __name__ == "__main__":
    sys.exit(main(sys.argv))
