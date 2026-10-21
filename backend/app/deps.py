"""Shared FastAPI dependencies."""

import sqlite3
from typing import Dict, List, Optional

from fastapi import Depends, Request

from app.auth import get_owner_id
from app.database import ShiftFlowRepository, get_db


def get_repo(request: Request, db: sqlite3.Connection = Depends(get_db)) -> ShiftFlowRepository:
    """A repository scoped to every facility this request's signed-in user may touch.

    That is always the user's own data (owner_id), and - additively - any facility they
    have *accepted* a business-owner invite for (see facility_owners / app/api/owner_routes.py
    and claim_legacy_data.py for the prior art this follows): the manager who set that
    facility up keeps their own full access completely unchanged, and the accepted owner
    gains the same read/act access alongside them, scoped to that facility only - not to
    every other facility that manager happens to own. A plain manager session (the common
    case) has no linked facilities and behaves exactly as before. With login explicitly
    disabled (local development) the repository is unscoped.

    This is the one place that resolves "which facility ids can this session touch", so
    routes (employee_routes, schedule_routes, pos_payroll_routes, ...) that depend on this
    need no per-endpoint owner/owner-link checks of their own.
    """
    owner_id: Optional[str] = get_owner_id(request)
    linked_facility_ids: Dict[str, List[str]] = {}
    if owner_id:
        linked_facility_ids = ShiftFlowRepository(db).list_linked_facility_ids(owner_id)
    return ShiftFlowRepository(db, owner_id=owner_id, linked_facility_ids=linked_facility_ids)
