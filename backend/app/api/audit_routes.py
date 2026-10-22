"""Roster audit API route: checks a repeating roster the user already runs.

Stateless: nothing is stored and no idempotency key is needed. The size limits on
AuditRequest bound the cost of a call.
"""

from typing import Dict, List

from fastapi import APIRouter, HTTPException

from app.audit_schemas import AuditRequest, AuditResponse
from app.engine.roster_audit import audit_roster
from app.engine.rotation_patterns import PATTERNS, pattern_to_audit_request

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
