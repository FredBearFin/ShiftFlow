"""Email/password account login for ShiftFlow Studio.

Real per-user accounts (see the users table in app/database.py), passwords
hashed with salted PBKDF2, and a signed session cookie that carries the
user id — no server-side session store needed, so this works across
Vercel's stateless function instances.

Set SHIFTFLOW_SESSION_SECRET to turn login on. Unset (local dev, tests),
the app stays open, since there is no such thing as an unconfigured public
deployment. SHIFTFLOW_SESSION_SECRET is unrelated to any user's password;
it is only used to sign session cookies, so losing it just logs everyone out.
"""

import hashlib
import hmac
import os
import secrets
import time
from typing import Optional

from fastapi import HTTPException, Request

SESSION_COOKIE = "shiftflow_session"
SESSION_MAX_AGE_SECONDS = 30 * 24 * 60 * 60
_EXEMPT_PATH_PREFIXES = ("/health", "/api/auth/login", "/api/auth/signup", "/api/auth/logout", "/api/auth/status")
_PBKDF2_ITERATIONS = 390_000


def login_enabled() -> bool:
    return bool(os.environ.get("SHIFTFLOW_SESSION_SECRET"))


def hash_password(password: str) -> str:
    salt = secrets.token_hex(16)
    digest = hashlib.pbkdf2_hmac("sha256", password.encode(), bytes.fromhex(salt), _PBKDF2_ITERATIONS)
    return f"{salt}${digest.hex()}"


def verify_password(password: str, stored_hash: str) -> bool:
    try:
        salt, digest_hex = stored_hash.split("$", 1)
    except ValueError:
        return False
    candidate = hashlib.pbkdf2_hmac("sha256", password.encode(), bytes.fromhex(salt), _PBKDF2_ITERATIONS)
    return hmac.compare_digest(candidate.hex(), digest_hex)


def _sign(payload: str) -> str:
    secret = os.environ.get("SHIFTFLOW_SESSION_SECRET", "")
    return hmac.new(secret.encode(), payload.encode(), hashlib.sha256).hexdigest()


def create_session_cookie_value(user_id: str) -> str:
    expiry = str(int(time.time()) + SESSION_MAX_AGE_SECONDS)
    payload = f"{user_id}.{expiry}"
    return f"{payload}.{_sign(payload)}"


def session_user_id(token: str) -> Optional[str]:
    """Returns the signed-in user's id from a valid session token, or None."""
    parts = token.split(".")
    if len(parts) != 3:
        return None
    user_id, expiry, sig = parts
    if not hmac.compare_digest(sig, _sign(f"{user_id}.{expiry}")):
        return None
    try:
        if int(expiry) <= time.time():
            return None
    except ValueError:
        return None
    return user_id


def require_login(request: Request) -> None:
    """FastAPI dependency gating every route while account login is configured."""
    if not login_enabled():
        return
    if any(request.url.path.startswith(p) for p in _EXEMPT_PATH_PREFIXES):
        return
    token = request.cookies.get(SESSION_COOKIE, "")
    if session_user_id(token) is None:
        raise HTTPException(status_code=401, detail="Not logged in")
