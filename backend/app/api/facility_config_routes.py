"""Server-side storage for the onboarding wizard's solve configuration.

The demand matrix, shift templates and ergonomic guardrails a manager sets up in the
wizard used to live only in that browser's localStorage (see frontend/src/services/
api.ts's saveSolveConfig/loadSolveConfig). That meant an accepted business-owner
(see app/api/owner_routes.py) who already has full access to the facility's real
employees/schedules through app/deps.py's get_repo would still see default setup
values on their own device, because nothing server-side remembered what the manager
configured.

This router is the additive fix: a small JSON blob, keyed to the facility, reachable
through the exact same get_repo scoping every other facility-scoped route already uses
(employee_routes, schedule_routes, ...). No new access-control logic is introduced here.
"""

import json
from typing import Any, Dict

from fastapi import APIRouter, Depends, HTTPException, Query
from pydantic import BaseModel, Field

from app.database import ShiftFlowRepository
from app.deps import get_repo

router = APIRouter(prefix="/api/facility-config", tags=["Facility Solve Configuration"])

# This blob is intentionally opaque (see FacilityConfigSchema below) - the server does not
# know or enforce the shape of the demand matrix/templates/guardrails it carries, so it
# cannot bound it field-by-field the way a typed schema would. Bounding its overall
# serialized size is the one guard that still applies regardless of shape, so a request
# cannot grow one facility's stored config without limit.
MAX_FACILITY_CONFIG_BYTES = 200_000


class FacilityConfigSchema(BaseModel):
    """The config is stored and returned as an opaque JSON object - this endpoint does
    not need to know the shape of the demand matrix/templates/guardrails blob, only that
    it is a JSON object. frontend/src/services/api.ts validates the contents on read."""

    config: Dict[str, Any] = Field(
        ...,
        description="Opaque solve-configuration blob (demand matrix, shift templates, guardrails, ...)",
    )


@router.get("", summary="Get the facility's saved solve configuration")
def get_facility_config(
    facility_id: str = Query(..., description="Facility id, as the caller's own account sees it"),
    repo: ShiftFlowRepository = Depends(get_repo),
):
    stored = repo.get_solve_config(facility_id)
    if stored is None:
        raise HTTPException(
            status_code=404,
            detail=f"No saved solve configuration for facility {facility_id}",
        )
    return stored


@router.put("", summary="Save the facility's solve configuration")
def put_facility_config(
    payload: FacilityConfigSchema,
    facility_id: str = Query(..., description="Facility id, as the caller's own account sees it"),
    repo: ShiftFlowRepository = Depends(get_repo),
):
    config_size = len(json.dumps(payload.config))
    if config_size > MAX_FACILITY_CONFIG_BYTES:
        raise HTTPException(
            status_code=413,
            detail=f"Facility configuration must be {MAX_FACILITY_CONFIG_BYTES} bytes or smaller "
            f"(got {config_size}).",
        )
    return repo.save_solve_config(facility_id, payload.config)
