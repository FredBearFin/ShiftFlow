"""Schedule solving, cost/rest comparison, and CSV export API routes."""

import csv
import io
from typing import List
from fastapi import APIRouter, Depends, HTTPException, Query
from fastapi.responses import StreamingResponse

from app.api.archetype_routes import ARCHETYPE_PRESETS
from app.config import DAYS_OF_WEEK
from app.database import ShiftFlowRepository
from app.deps import get_repo
from app.engine.isd_rwsp_solver import ISDRWSPSolver
from app.schemas import (
    ParetoPointSchema,
    SolveRequestSchema,
    SolveResponseSchema,
)

router = APIRouter(prefix="/schedules", tags=["Schedules & Optimization"])


@router.post("/solve", response_model=SolveResponseSchema)
def solve_schedule(request: SolveRequestSchema) -> SolveResponseSchema:
    """Build a rotating weekly schedule that covers demand with the fewest staff and shift types."""
    if len(request.demand_matrix) != 7 or any(
        len(row) != 24 for row in request.demand_matrix
    ):
        raise HTTPException(
            status_code=422,
            detail="demand_matrix must be a 7x24 matrix (7 days x 24 one-hour intervals).",
        )
    solver = ISDRWSPSolver(request)
    return solver.solve()


@router.get("/default-solution/{archetype_id}", response_model=SolveResponseSchema)
def solve_default_archetype(
    # archetype_id is a path parameter, so it is always supplied by the caller. It
    # previously carried a "healthcare_24_7" default that FastAPI could never use but
    # that read, in the generated API docs and in review, as a shipped default archetype.
    archetype_id: str,
    leeway_pct: float = 5.0,
    facility_id: str = Query(default="FAC-OMAHA-01", max_length=64),
    repo: ShiftFlowRepository = Depends(get_repo),
) -> SolveResponseSchema:
    """Solve and return the full schedule for a named industry archetype.

    The facility name comes from the facility record, not from the archetype preset.
    """
    preset = ARCHETYPE_PRESETS.get(archetype_id)
    if not preset:
        raise HTTPException(
            status_code=404, detail=f"Archetype '{archetype_id}' not found."
        )
    fac = repo.get_facility(facility_id)
    if not fac:
        raise HTTPException(
            status_code=404, detail=f"Facility '{facility_id}' not found."
        )
    req = SolveRequestSchema(
        archetype_id=preset.id,
        facility_name=fac["name"],
        demand_matrix=preset.demand_matrix,
        templates=preset.templates,
        guardrails=preset.guardrails,
        pareto_leeway_pct=leeway_pct,
    )
    return ISDRWSPSolver(req).solve()


@router.post("/pareto-frontier", response_model=List[ParetoPointSchema])
def compute_pareto_frontier(request: SolveRequestSchema) -> List[ParetoPointSchema]:
    """Compare cost and rest trade-offs by re-solving the schedule at several staffing leeway levels."""
    solution = ISDRWSPSolver(request).solve()
    return solution.pareto_frontier


@router.post("/export-csv")
def export_roster_csv(request: SolveRequestSchema) -> StreamingResponse:
    """Export the solved weekly schedule as a downloadable RFC-4180 CSV file."""
    solution = ISDRWSPSolver(request).solve()
    output = io.StringIO()
    writer = csv.writer(output)
    header = [
        "Shift Pattern",
        "Pattern ID",
        "Assigned Staff",
        "Qualification Tier",
        "Current Cycle Week",
        *DAYS_OF_WEEK,
        "Weekly Hours",
        "Work Days",
        "Rest Days",
        "Full Weekend Off",
    ]
    writer.writerow(header)

    for line in solution.roster_lines:
        day_cells = [
            f"{c.shift_code} ({c.time_window})" if c.shift_code != "OFF" else "OFF"
            for c in line.days
        ]
        writer.writerow(
            [
                f"Pattern {line.line_number}",
                line.cohort_id,
                line.assigned_person or "Unassigned shift pattern",
                line.qualification_tier,
                f"Week {line.current_cycle_week}",
                *day_cells,
                line.weekly_hours,
                line.work_days_count,
                line.rest_days_count,
                "Yes" if line.full_weekend_off else "No",
            ]
        )

    output.seek(0)
    return StreamingResponse(
        iter([output.getvalue()]),
        media_type="text/csv",
        headers={
            "Content-Disposition": "attachment; filename=shiftflow_weekly_schedule.csv"
        },
    )
