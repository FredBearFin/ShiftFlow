"""Roster audit API route: checks a repeating roster the user already runs.

Stateless: nothing is stored and no idempotency key is needed. The size limits on
AuditRequest bound the cost of a call.
"""

from typing import Dict, List

from fastapi import APIRouter, HTTPException
from pydantic import BaseModel

from app.audit_schemas import AuditRequest, AuditResponse
from app.engine.isd_rwsp_solver import ISDRWSPSolver
from app.engine.roster_audit import audit_roster
from app.engine.rotation_patterns import PATTERNS, pattern_to_audit_request
from app.engine.solver_to_audit import solution_to_audit_request
from app.schemas import SolveRequestSchema

router = APIRouter(prefix="/schedules", tags=["Roster Audit"])


@router.post("/audit", response_model=AuditResponse)
def audit_existing_roster(request: AuditRequest) -> AuditResponse:
    """Check a repeating roster for rest, streaks, night work and weekend exposure."""
    return audit_roster(request)


@router.get("/audit/patterns")
def list_rotation_patterns() -> List[Dict[str, object]]:
    """Ids, names, descriptions and cycle lengths of the example rotations."""
    return [
        {
            "pattern_id": p.pattern_id,
            "name": p.name,
            "description": p.description,
            "cycle_days": p.cycle_days,
        }
        for p in PATTERNS.values()
    ]


@router.get("/audit/patterns/{pattern_id}", response_model=AuditRequest)
def get_rotation_pattern(pattern_id: str) -> AuditRequest:
    """A ready-to-post audit request for one example rotation."""
    if pattern_id not in PATTERNS:
        raise HTTPException(status_code=404, detail=f"Pattern '{pattern_id}' not found.")
    return pattern_to_audit_request(pattern_id)


class CompareRequest(BaseModel):
    solve_request: SolveRequestSchema
    audit_request: AuditRequest


class CompareResponse(BaseModel):
    generated: AuditResponse
    existing: AuditResponse
    notes: List[str]


@router.post("/audit/compare", response_model=CompareResponse)
def compare_with_generated_schedule(body: CompareRequest) -> CompareResponse:
    """Audit a roster the user runs next to the schedule the builder generates for the same demand.

    Both are checked with the existing roster's limits, and against the existing roster's demand
    matrix when it has one, otherwise the demand in the solve request.
    """
    solution = ISDRWSPSolver(body.solve_request, include_pareto_frontier=False).solve()
    existing = body.audit_request
    demand = existing.demand_matrix or body.solve_request.demand_matrix
    if existing.demand_matrix is None:
        existing = existing.model_copy(update={"demand_matrix": demand})
    generated_request, notes = solution_to_audit_request(
        solution, start_weekday=0, thresholds=existing.thresholds, demand_matrix=demand
    )
    return CompareResponse(
        generated=audit_roster(generated_request),
        existing=audit_roster(existing),
        notes=notes
        + [
            "The generated schedule's first day is a Monday.",
            "Both rosters are checked against the same limits and the same demand.",
        ],
    )
