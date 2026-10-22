"""Runs a benchmark instance through the generator and prints a table.

Usage:  python backend/benchmarks/runner.py backend/benchmarks/instances/synthetic_flat1.json

Instance format: {"name": str, "demand_matrix": 7x24 ints, "templates": [...as in
SolveRequestSchema], "guardrails": {...}, "notes": str}. The instance is solved at leeway 0 and at
each anchor in LEEWAY_ANCHORS.
"""

import json
import os
import sys

_backend = os.path.abspath(os.path.join(os.path.dirname(os.path.abspath(__file__)), ".."))
if _backend not in sys.path:
    sys.path.insert(0, _backend)
os.environ.setdefault("SHIFTFLOW_AUTH_DISABLED", "1")

from app.engine.isd_rwsp_solver import ISDRWSPSolver, SolverInfeasibleError  # noqa: E402
from app.engine.pareto import LEEWAY_ANCHORS  # noqa: E402
from app.schemas import ErgonomicGuardrailsSchema, ShiftTemplateSchema, SolveRequestSchema  # noqa: E402


def load_instance(path):
    with open(path) as fh:
        return json.load(fh)


def build_request(instance, leeway):
    return SolveRequestSchema(
        archetype_id="custom",
        facility_name=instance["name"],
        demand_matrix=instance["demand_matrix"],
        templates=[ShiftTemplateSchema(**t) for t in instance["templates"]],
        guardrails=ErgonomicGuardrailsSchema(**instance.get("guardrails", {})),
        pareto_leeway_pct=leeway,
    )


def run_instance(instance):
    """One row per leeway: dict with leeway, and either an error or the measured figures."""
    rows = []
    for leeway in sorted({0.0, *LEEWAY_ANCHORS}):
        try:
            sol = ISDRWSPSolver(build_request(instance, leeway), include_pareto_frontier=False).solve()
        except SolverInfeasibleError as exc:
            rows.append({"leeway": leeway, "error": str(exc)})
            continue
        audit = sol.ergonomics_audit
        rows.append(
            {
                "leeway": leeway,
                "employees": sol.employee_count,
                "understaffed": sum(c.understaffing for c in sol.interval_coverage),
                "overstaffed": sum(c.overstaffing for c in sol.interval_coverage),
                "strain": audit.total_ergo_objective,
                "min_rest": audit.min_rest_hours_observed,
                "clopening": audit.clopening_violations,
            }
        )
    return rows


def format_table(name, rows):
    lines = [f"Instance: {name}", "leeway  employees  understaffed  overstaffed  strain  min_rest"]
    for r in rows:
        if "error" in r:
            lines.append(f"{r['leeway']:>6g}  infeasible: {r['error'][:60]}")
        else:
            lines.append(
                f"{r['leeway']:>6g}  {r['employees']:>9}  {r['understaffed']:>12}  {r['overstaffed']:>11}  "
                f"{r['strain']:>6g}  {r['min_rest']:>8g}"
            )
    return "\n".join(lines)


if __name__ == "__main__":
    if len(sys.argv) != 2:
        sys.exit(__doc__)
    inst = load_instance(sys.argv[1])
    print(format_table(inst["name"], run_instance(inst)))
    print("Notes:", inst.get("notes", ""))
