"""Emergency Operations & Chaotic Store Management API Routes.

Implements real-world store manager tools:
1. Saturday Evening Emergency Callout Rebalancing (Safe Harbor Standby Queue)
2. Cashier Peer-to-Peer Shift Swap Validation (Zero-Clopening & FLSA Overtime Guardrails)

Swap validation reads the per-line shift, rest and hours data a solved roster already
carries, which the caller sends with the request. Callout replacement still needs each
associate's STORED shift times and rest intervals, which nothing persists, so it
returns HTTP 501 rather than a ranked queue nothing backs.
"""

from fastapi import APIRouter, HTTPException

from app.engine.ergonomics import SwapRefused, validate_shift_swap
from app.schemas import (
    EmergencyCalloutRequestSchema,
    ShiftSwapRequestSchema,
    ShiftSwapValidationResponseSchema,
)

router = APIRouter(prefix="/api/emergency", tags=["Store Manager Floor Emergency Operations"])

NO_SOURCE_DETAIL = "not implemented: no source data"


@router.post("/callout-replacement")
def find_callout_replacements(request: EmergencyCalloutRequestSchema):
    """Find compliant, zero-clopening replacements for a sudden frontline callout. Returns 501: no stored shift or rest data."""
    raise HTTPException(status_code=501, detail=NO_SOURCE_DETAIL)


@router.post("/validate-swap", response_model=ShiftSwapValidationResponseSchema)
def validate_shift_swap_route(request: ShiftSwapRequestSchema):
    """Validate a bilateral shift trade between two associates.

    The verdict comes from the roster the caller sends: no per-employee punch data
    exists, so there is nothing else it could honestly be computed from. A trade that
    would leave less than the required rest, create a closing-then-opening pair or push
    either week past the overtime boundary is refused, and the response names which rule
    and the figures behind it.

    A request that cannot be validated at all - an associate who holds no line, a day
    with no shift on it - is a 400 with the reason, not a verdict.
    """
    lines = [line.model_dump() if hasattr(line, "model_dump") else line.dict() for line in request.roster_lines]
    try:
        verdict = validate_shift_swap(
            lines,
            request.associate_a_id,
            request.day_a_index,
            request.associate_b_id,
            request.day_b_index,
        )
    except SwapRefused as exc:
        raise HTTPException(status_code=400, detail=str(exc))
    return ShiftSwapValidationResponseSchema(**verdict)
