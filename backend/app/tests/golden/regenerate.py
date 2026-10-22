"""Builds and writes the golden snapshot of preset solves (presets_v1.json).

Run by hand, never by the test suite:  cd backend && python app/tests/golden/regenerate.py
Regenerate only with owner approval, and only in a work package that states which
snapshot changes and why.
"""

import json
import os
import sys

_here = os.path.dirname(os.path.abspath(__file__))
_backend = os.path.abspath(os.path.join(_here, "..", "..", ".."))
if _backend not in sys.path:
    sys.path.insert(0, _backend)
os.environ.setdefault("SHIFTFLOW_AUTH_DISABLED", "1")

from app.api.archetype_routes import ARCHETYPE_PRESETS  # noqa: E402
from app.engine.isd_rwsp_solver import ISDRWSPSolver, SolverInfeasibleError  # noqa: E402
from app.engine.pareto import generate_pareto_frontier  # noqa: E402
from app.schemas import SolveRequestSchema  # noqa: E402

GOLDEN_PATH = os.path.join(_here, "presets_v1.json")
LEEWAYS = [0.0, 5.0, 20.0]
FRONTIER_PRESET = "manufacturing_24_7"
FRONTIER_SELECTED_LEEWAY = 5.0


def build_request(preset, leeway):
    return SolveRequestSchema(
        archetype_id=preset.id,
        facility_name=preset.name,
        demand_matrix=preset.demand_matrix,
        templates=preset.templates,
        guardrails=preset.guardrails,
        pareto_leeway_pct=leeway,
    )


def snapshot_solve(preset, leeway):
    """One solve reduced to the fields that must stay stable; infeasible cases record the message."""
    req = build_request(preset, leeway)
    try:
        sol = ISDRWSPSolver(req, include_pareto_frontier=False).solve()
    except SolverInfeasibleError as exc:
        return {"error": str(exc)}
    audit = sol.ergonomics_audit
    return {
        "employee_count": sol.employee_count,
        "active_shift_types_count": sol.active_shift_types_count,
        "obj_shift": sol.obj_shift,
        "roster": [[cell.shift_code for cell in line.days] for line in sol.roster_lines],
        "total_ergo_objective": audit.total_ergo_objective,
        "min_rest_hours_observed": audit.min_rest_hours_observed,
        "clopening_violations": audit.clopening_violations,
        "understaffing_hours": sum(c.understaffing for c in sol.interval_coverage),
        "overstaffing_hours": sum(c.overstaffing for c in sol.interval_coverage),
    }


def snapshot_frontier(preset, selected_leeway):
    req = build_request(preset, selected_leeway)
    points = generate_pareto_frontier(req, selected_leeway)
    return [
        [
            p.leeway_pct,
            p.employee_count,
            p.obj_ergo,
            p.total_understaffing_hours,
            p.total_overstaffing_hours,
        ]
        for p in points
    ]


def build_snapshot():
    data = {"solves": {}, "frontier": {}}
    for key, preset in ARCHETYPE_PRESETS.items():
        data["solves"][key] = {str(lw): snapshot_solve(preset, lw) for lw in LEEWAYS}
    data["frontier"][FRONTIER_PRESET] = snapshot_frontier(
        ARCHETYPE_PRESETS[FRONTIER_PRESET], FRONTIER_SELECTED_LEEWAY
    )
    return data


def to_json(data):
    return json.dumps(data, sort_keys=True, indent=2) + "\n"


if __name__ == "__main__":
    with open(GOLDEN_PATH, "w") as fh:
        fh.write(to_json(build_snapshot()))
    print(f"wrote {GOLDEN_PATH}")
