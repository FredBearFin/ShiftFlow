"""Shared FastAPI dependencies."""

import sqlite3
from typing import Optional

from fastapi import Depends, Request

from app.auth import get_owner_id
from app.database import ShiftFlowRepository, get_db


def get_repo(request: Request, db: sqlite3.Connection = Depends(get_db)) -> ShiftFlowRepository:
    """A repository scoped to the signed-in user, so a request can only reach that user's own data.

    With login explicitly disabled (local development) the repository is unscoped.
    """
    owner_id: Optional[str] = get_owner_id(request)
    return ShiftFlowRepository(db, owner_id=owner_id)
