"""FastAPI routes for Wage & Hour statutory compliance audits (29 C.F.R. Parts 516, 778, 785)."""

import datetime
from typing import Any, Dict, List, Optional
from fastapi import APIRouter, HTTPException
from pydantic import BaseModel, Field

from app.engine.timecard_audit import TimecardAuditor

router = APIRouter(prefix="/api/compliance", tags=["Wage & Hour Compliance Audit"])


class CustomPunchPair(BaseModel):
    clock_in: str = Field(..., description="ISO 8601 clock-in timestamp (e.g. 2026-10-19T05:56:00)")
    clock_out: str = Field(..., description="ISO 8601 clock-out timestamp (e.g. 2026-10-19T14:04:00)")


class RoundingTestRequest(BaseModel):
    interval_minutes: int = Field(15, ge=5, le=15)
    punch_pairs: List[CustomPunchPair]


NO_SOURCE_DETAIL = "not implemented: no source data"


def _require_stored_timecards(facility_id: str) -> None:
    """Stored punch, hours and earnings records do not exist in the schema yet.

    Until a timecard table is added, no compliance result can be computed from stored data,
    so every audit that depends on one returns 501 instead of a fabricated result.
    """
    raise HTTPException(status_code=501, detail=NO_SOURCE_DETAIL)


@router.get("/timecard-rounding-audit")
def get_timecard_rounding_audit(
    facility_id: str = "downtown_foodmart_omaha",
) -> Dict[str, Any]:
    """Audits stored timecard punches against 29 C.F.R. § 785.48(b) rounding rules. Returns 501 when no stored punches exist."""
    _require_stored_timecards(facility_id)


@router.get("/workweek-overtime-audit")
def get_workweek_overtime_audit(
    facility_id: str = "downtown_foodmart_omaha",
) -> Dict[str, Any]:
    """Audits stored workweek hours under 29 C.F.R. § 778.104. Returns 501 when no stored hours exist."""
    _require_stored_timecards(facility_id)


@router.get("/recordkeeping-certificate")
def get_recordkeeping_certificate(
    facility_id: str = "downtown_foodmart_omaha",
) -> Dict[str, Any]:
    """Audits stored payroll records under 29 C.F.R. §§ 516.5 and 516.6. Returns 501 when no stored records exist."""
    _require_stored_timecards(facility_id)


@router.post("/test-rounding-neutrality")
def test_custom_rounding_neutrality(req: RoundingTestRequest) -> Dict[str, Any]:
    """Allows auditors or managers to test custom punch lists for rounding bias in real time."""
    parsed_pairs = []
    for p in req.punch_pairs:
        try:
            cin = datetime.datetime.fromisoformat(p.clock_in)
            cout = datetime.datetime.fromisoformat(p.clock_out)
            parsed_pairs.append((cin, cout))
        except Exception as e:
            raise HTTPException(status_code=400, detail=f"Invalid timestamp format: {str(e)}")

    return TimecardAuditor.audit_rounding_neutrality(parsed_pairs, interval_minutes=req.interval_minutes)
