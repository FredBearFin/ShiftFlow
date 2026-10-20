"""API key check for state-changing requests to ShiftFlow Studio.

Safe methods (GET, HEAD, OPTIONS) stay open. Every other method needs the
X-API-Key header to match SHIFTFLOW_API_KEY. If the variable is not set, those
requests are refused, so a missing deployment setting cannot leave writes open.
"""

import hmac
import os

from fastapi import HTTPException, Request

SAFE_METHODS = {"GET", "HEAD", "OPTIONS"}
API_KEY_HEADER = "X-API-Key"


def require_api_key(request: Request) -> None:
    """FastAPI dependency that guards every non-safe method."""
    if request.method in SAFE_METHODS:
        return
    expected = os.environ.get("SHIFTFLOW_API_KEY", "")
    if not expected:
        raise HTTPException(status_code=503, detail="API key not configured")
    supplied = request.headers.get(API_KEY_HEADER, "")
    if not hmac.compare_digest(supplied.encode(), expected.encode()):
        raise HTTPException(status_code=401, detail="Missing or invalid API key")
