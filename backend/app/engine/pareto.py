"""Builds the cost-vs-rest frontier by actually re-solving at each staffing leeway level.

Every point on the frontier is a real, independently solved schedule - not an estimate
scaled from a single solve. generate_pareto_frontier takes the base request and solves it
again at each anchor leeway value, reading the real cost, workload-strain score, headcount,
coverage, and weekends-off directly from each resulting schedule.
"""

from typing import List

from app.config import settings
from app.schemas import ParetoPointSchema, SolveRequestSchema

LEEWAY_ANCHORS = [0.0, 1.0, 5.0, 10.0, 20.0, 50.0, 75.0]


def mark_dominance(points: List[ParetoPointSchema]) -> None:
    """Flags points that another point beats or ties on every axis and strictly beats on one.

    Axes, all lower-is-better: staffing level, strain score, and total coverage gap (understaffed
    plus overstaffed hours). Points are flagged, not removed. Identical points are both kept.
    """

    def axes(p: ParetoPointSchema):
        return (p.employee_count, p.obj_ergo, p.total_understaffing_hours + p.total_overstaffing_hours)

    for q in points:
        q.non_dominated = True
        for p in points:
            if p is q:
                continue
            a, b = axes(p), axes(q)
            if all(x <= y for x, y in zip(a, b)) and any(x < y for x, y in zip(a, b)):
                q.non_dominated = False
                break


def generate_pareto_frontier(
    base_request: SolveRequestSchema,
    selected_leeway_pct: float,
) -> List[ParetoPointSchema]:
    """Re-solves base_request at each anchor leeway value and reports each real result."""
    # Local import: pareto.py and isd_rwsp_solver.py depend on each other, so this import
    # is deferred to call time to avoid a circular import at module load.
    from app.engine.isd_rwsp_solver import ISDRWSPSolver, SolverInfeasibleError

    leeway_grid = list(LEEWAY_ANCHORS)
    if all(abs(selected_leeway_pct - pt) > 1e-4 for pt in leeway_grid):
        leeway_grid.append(round(selected_leeway_pct, 2))
        leeway_grid.sort()

    points: List[ParetoPointSchema] = []
    for leeway in leeway_grid:
        req_i = base_request.model_copy(update={"pareto_leeway_pct": leeway})
        try:
            sol_i = ISDRWSPSolver(req_i, include_baseline=True, include_pareto_frontier=False).solve()
        except SolverInfeasibleError:
            # This particular cost level isn't achievable under the current scheduling rules -
            # leave it off the frontier rather than failing the whole request over one option.
            continue

        total_under = sum(c.understaffing for c in sol_i.interval_coverage)
        total_over = sum(c.overstaffing for c in sol_i.interval_coverage)
        is_sel = abs(leeway - selected_leeway_pct) < 1e-4

        if abs(leeway - 0.0) < 1e-3:
            label = "No extra cost"
        else:
            label = f"+{leeway:g}% cost"

        points.append(
            ParetoPointSchema(
                point_index=0,
                leeway_pct=leeway,
                obj_shift=sol_i.obj_shift,
                obj_ergo=sol_i.ergonomics_audit.total_ergo_objective,
                ergo_improvement_pct=sol_i.ergonomics_audit.ergo_improvement_pct,
                employee_count=sol_i.employee_count,
                active_shift_types_count=sol_i.active_shift_types_count,
                total_understaffing_hours=int(total_under),
                total_overstaffing_hours=int(total_over),
                full_weekends_off_pct=sol_i.ergonomics_audit.full_weekends_off_pct,
                estimated_weekly_payroll=sol_i.labor_analysis.total_payroll_cost,
                scheduled_hours=sol_i.labor_analysis.total_scheduled_hours,
                is_knee_point=False,
                is_selected=is_sel,
                label=label,
            )
        )

    # The real "best value" point: among the options that cost more than the cheapest,
    # whichever buys the most workload-strain reduction per percent of extra cost spent.
    if points:
        baseline = min(points, key=lambda p: p.leeway_pct)
        for p in points:
            p.coverage_comparable = (
                p.total_understaffing_hours
                <= baseline.total_understaffing_hours + settings.coverage_tolerance_hours
            )
    mark_dominance(points)

    # Only points that are not beaten on every axis and keep comparable coverage can be the best value.
    paid_points = [
        p for p in points if p.leeway_pct > 0 and p.non_dominated and p.coverage_comparable
    ]
    if paid_points:
        best = max(paid_points, key=lambda p: p.ergo_improvement_pct / p.leeway_pct)
        best.is_knee_point = True
        best.label = "Best value" if not best.is_selected else best.label

    for idx, p in enumerate(points):
        p.point_index = idx

    return points
