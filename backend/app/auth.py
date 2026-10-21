"""Email/password account login for ShiftFlow Studio.

Real per-user accounts (see the users table in app/database.py), passwords
hashed with salted PBKDF2, and a signed session cookie that carries the
user id. Every request re-checks that the user still exists.

The app fails closed. Login is ON unless the operator explicitly sets
SHIFTFLOW_AUTH_DISABLED=1 for local development, and a server that has login
on but no usable SHIFTFLOW_SESSION_SECRET refuses to start (see
validate_auth_config) and answers every protected request with 503.
SHIFTFLOW_SESSION_SECRET is unrelated to any user's password; it only signs
session cookies, so rotating it just logs everyone out.

Each signed-in user only sees their own facilities, staff, audits and
rosters: see ShiftFlowRepository(owner_id=...) in app/database.py and
get_owner_id below.

Deployment limit. The session cookie needs no server-side session store, but
login is NOT stateless: create_session_cookie_value signs a user id, and every
request then checks that user still exists in the database (_user_exists). So
login is only as shared as the database is. On a serverless platform using the
default SQLite file under /tmp, each function instance has its own copy, an
account created on one instance is unknown to another, and that user's valid,
correctly signed cookie is rejected there. Running this way needs a shared
database, not a change here; see DEPLOYMENT_GUIDE.md section 5.

Other settings:
  SHIFTFLOW_ALLOW_SIGNUP   "false" closes public sign-up (default: open).
  SHIFTFLOW_COOKIE_SECURE  "false" lets the session cookie travel over plain
                           http (default: true, https only).
"""

import functools
import hashlib
import hmac
import os
import secrets
import time
from typing import Optional

from fastapi import HTTPException, Request

from app.database import get_db_connection

SESSION_COOKIE = "shiftflow_session"
SESSION_MAX_AGE_SECONDS = 30 * 24 * 60 * 60
_EXEMPT_PATH_PREFIXES = ("/health", "/api/auth/login", "/api/auth/signup", "/api/auth/logout", "/api/auth/status")
_PBKDF2_ITERATIONS = 390_000

MIN_SECRET_LENGTH = 32
_PLACEHOLDER_SECRET_PREFIX = "change-me"

# Failed sign-ins allowed per email inside the window before further attempts get 429.
LOGIN_MAX_FAILURES = 5
LOGIN_WINDOW_SECONDS = 15 * 60

_FALSE_WORDS = ("0", "false", "no", "off")


def _env_flag(name: str, default: bool) -> bool:
    raw = os.environ.get(name)
    if raw is None or not raw.strip():
        return default
    return raw.strip().lower() not in _FALSE_WORDS


def auth_disabled() -> bool:
    """True only when the operator explicitly opted out of login (local development)."""
    raw = os.environ.get("SHIFTFLOW_AUTH_DISABLED", "").strip().lower()
    return bool(raw) and raw not in _FALSE_WORDS


def login_enabled() -> bool:
    """Login is on unless explicitly disabled. A configured secret always turns it on."""
    return bool(os.environ.get("SHIFTFLOW_SESSION_SECRET")) or not auth_disabled()


def signup_allowed() -> bool:
    return _env_flag("SHIFTFLOW_ALLOW_SIGNUP", True)


def cookie_secure() -> bool:
    return _env_flag("SHIFTFLOW_COOKIE_SECURE", True)


def validate_auth_config() -> None:
    """Refuses to boot a deployment whose login would be open or whose cookies could be forged."""
    if not login_enabled():
        return
    secret = os.environ.get("SHIFTFLOW_SESSION_SECRET", "")
    if len(secret) < MIN_SECRET_LENGTH or secret.lower().startswith(_PLACEHOLDER_SECRET_PREFIX):
        raise RuntimeError(
            "SHIFTFLOW_SESSION_SECRET must be set to a random value of at least "
            f"{MIN_SECRET_LENGTH} characters (not the .env.example placeholder). "
            "Generate one with: python -c \"import secrets; print(secrets.token_urlsafe(48))\". "
            "For local development only, set SHIFTFLOW_AUTH_DISABLED=1 to run without login."
        )


def ensure_auth_configured() -> None:
    """Raises 503 when login is on but no signing secret exists, so nothing can be signed or forged."""
    if login_enabled() and not os.environ.get("SHIFTFLOW_SESSION_SECRET"):
        raise HTTPException(status_code=503, detail="Login is not configured on this server.")


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


@functools.lru_cache(maxsize=1)
def dummy_password_hash() -> str:
    """A throwaway hash checked when the email is unknown, so unknown and known emails take equally long."""
    return hash_password(secrets.token_hex(16))


def _sign(payload: str) -> str:
    secret = os.environ.get("SHIFTFLOW_SESSION_SECRET", "")
    if not secret:
        raise RuntimeError("SHIFTFLOW_SESSION_SECRET is not set")
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
    try:
        expected = _sign(f"{user_id}.{expiry}")
    except RuntimeError:
        return None
    if not hmac.compare_digest(sig, expected):
        return None
    try:
        if int(expiry) <= time.time():
            return None
    except ValueError:
        return None
    return user_id


def _user_exists(user_id: str) -> bool:
    conn = get_db_connection()
    try:
        return conn.execute("SELECT 1 FROM users WHERE id = ?", (user_id,)).fetchone() is not None
    finally:
        conn.close()


def current_user_id(request: Request) -> Optional[str]:
    """The signed-in user's id, or None when the session is missing, forged, expired or its user was deleted."""
    user_id = session_user_id(request.cookies.get(SESSION_COOKIE, ""))
    if user_id is None or not _user_exists(user_id):
        return None
    return user_id


def require_login(request: Request) -> None:
    """FastAPI dependency gating every route while login is on. Records the user id on request.state."""
    if not login_enabled():
        return
    if any(request.url.path.startswith(p) for p in _EXEMPT_PATH_PREFIXES):
        return
    ensure_auth_configured()
    user_id = current_user_id(request)
    if user_id is None:
        raise HTTPException(status_code=401, detail="Not logged in")
    request.state.user_id = user_id


def get_owner_id(request: Request) -> Optional[str]:
    """The id that scopes this request's data: the signed-in user, or None when login is explicitly disabled."""
    if not login_enabled():
        return None
    user_id = getattr(request.state, "user_id", None)
    if user_id is None:
        require_login(request)
        user_id = getattr(request.state, "user_id", None)
    if user_id is None:
        # Never fall back to unscoped data access while login is on, even on a path exempt from login.
        raise HTTPException(status_code=401, detail="Not logged in")
    return user_id
