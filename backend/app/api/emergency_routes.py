"""Emergency Operations & Chaotic Store Management API Routes.

Implements real-world store manager tools:
1. Saturday Evening Emergency Callout Rebalancing (Safe Harbor Standby Queue)
2. Cashier Peer-to-Peer Shift Swap Validation (Zero-Clopening & FLSA Overtime Guardrails)

Both endpoints are answered from real roster data rather than from nothing:

* Swap validation reads the per-line shift, rest and hours data a solved roster already
  carries, which the caller sends with the request.
* Callout cover reads the facility's STORED per-assignment shift times and rest
  intervals. That storage is what the 501 was waiting for; a facility with no stored
  roster still gets a refusal with the reason, not a ranked queue nothing backs.

Every stored-roster read and write goes through app.deps.get_repo, so it is scoped to
the signed-in account exactly like staff, audits and snapshots.
"""

from fastapi import APIRouter, Depends, HTTPException, Query

from app.database import ShiftFlowRepository
from app.deps import get_repo
from app.engine.ergonomics import (
    CalloutUnanswerable,
    SwapRefused,
    rank_callout_candidates,
    validate_shift_swap,
)
from app.schemas import (
    EmergencyCalloutRequestSchema,
    EmergencyCalloutResponseSchema,
    ShiftSwapRequestSchema,
    ShiftSwapValidationResponseSchema,
    StoredRosterSchema,
    StoredRosterWriteSchema,
)

router = APIRouter(prefix="/api/emergency", tags=["Store Manager Floor Emergency Operations"])

DEFAULT_FACILITY_ID = "FAC-OMAHA-01"


def _dump(model):
    return model.model_dump() if hasattr(model, "model_dump") else model.dict()


def _require_facility(repo: ShiftFlowRepository, facility_id: str) -> None:
    """A facility another account owns, or one that does not exist, is the same 404."""
    if repo.get_facility(facility_id) is None:
        raise HTTPException(status_code=404, detail=f"Facility {facility_id} not found")


@router.put("/stored-roster", response_model=StoredRosterSchema)
def store_roster(
    request: StoredRosterWriteSchema,
    repo: ShiftFlowRepository = Depends(get_repo),
):
    """Store this facility's roster: every day slot's shift times and the rest before it.

    This is the data callout cover needs. It is replaced whole on every write, because a
    roster is one rotation and a half-replaced one was never a real schedule.
    """
    _require_facility(repo, request.facility_id)
    shifts = [_dump(shift) for shift in request.shifts]
    stored = repo.replace_assignment_shifts(request.facility_id, shifts)
    return StoredRosterSchema(
        facility_id=request.facility_id,
        slots_stored=stored,
        shifts=repo.list_assignment_shifts(request.facility_id),
    )


@router.get("/stored-roster", response_model=StoredRosterSchema)
def read_stored_roster(
    facility_id: str = Query(default=DEFAULT_FACILITY_ID),
    repo: ShiftFlowRepository = Depends(get_repo),
):
    """This facility's stored roster, as the callout queue reads it."""
    _require_facility(repo, facility_id)
    shifts = repo.list_assignment_shifts(facility_id)
    return StoredRosterSchema(facility_id=facility_id, slots_stored=len(shifts), shifts=shifts)


@router.post("/callout-replacement", response_model=EmergencyCalloutResponseSchema)
def find_callout_replacements(
    request: EmergencyCalloutRequestSchema,
    repo: ShiftFlowRepository = Depends(get_repo),
):
    """Rank who could cover a shift somebody has called out of.

    Ranked on rest compliance first and overtime headroom second, from the stored shift
    times and rest intervals. Everyone checked is listed with the figures behind them;
    nobody already working that day, and nobody whose cover would break the rest rule,
    create a clopening or cross the overtime boundary, is recommended.

    A facility with no stored roster gets a 409 naming what is missing, because there is
    nothing to assess a replacement against.
    """
    facility_id = request.facility_id or DEFAULT_FACILITY_ID
    _require_facility(repo, facility_id)
    try:
        verdict = rank_callout_candidates(
            repo.list_assignment_shifts(facility_id),
            repo.list_employees(facility_id),
            request.target_day_index,
            request.target_shift_code,
            missing_line_number=request.line_number,
            missing_employee_id=request.missing_employee_id,
        )
    except CalloutUnanswerable as exc:
        raise HTTPException(status_code=409, detail=str(exc))
    return EmergencyCalloutResponseSchema(**verdict)


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
    lines = [_dump(line) for line in request.roster_lines]
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
