"""Roster audit API route: checks a repeating roster the user already runs.

Stateless: nothing is stored and no idempotency key is needed. The size limits on
AuditRequest bound the cost of a call.
"""

from fastapi import APIRouter

from app.audit_schemas import AuditRequest, AuditResponse
from app.engine.roster_audit import audit_roster

router = APIRouter(prefix="/schedules", tags=["Roster Audit"])


@router.post("/audit", response_model=AuditResponse)
def audit_existing_roster(request: AuditRequest) -> AuditResponse:
    """Check a repeating roster for rest, streaks, night work and weekend exposure."""
    return audit_roster(request)
