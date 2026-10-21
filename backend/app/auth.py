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

Each session cookie also carries a fingerprint of the password hash that was current
when it was issued (see _password_fingerprint/create_session_cookie_value below), so
changing a user's password - whether via self-serve reset or any other path - invalidates
every session cookie issued before the change on its very next request, including one an
attacker stole before the change.

Each signed-in user only sees their own facilities, staff, audits and
rosters: see ShiftFlowRepository(owner_id=...) in app/database.py and
get_owner_id below.

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
_EXEMPT_PATH_PREFIXES = (
    "/health",
    "/api/auth/login",
    "/api/auth/signup",
    "/api/auth/logout",
    "/api/auth/status",
    # Preview and acceptance of an owner invite happen before the invited owner has (or is
    # signed into) an account, so this one path must work without a session - see
    # app/api/owner_routes.py. Every other /api/owners/* route stays behind login.
    "/api/owners/accept/",
    # The pricing-page checkout stub (app.api.billing_routes) creates its own account,
    # so a visitor who is not signed in yet must be able to reach it, same as /api/auth/signup.
    "/api/billing/signup",
    # A locked-out user has no session to reach either of these with - that is the whole
    # point of password reset (see app/api/auth_routes.py) - so, like /api/owners/accept/
    # above, both must work while logged out.
    "/api/auth/password-reset/request",
    "/api/auth/password-reset/confirm",
)
# OWASP currently recommends >= 600,000 iterations for PBKDF2-HMAC-SHA256. This was raised
# from the original 390_000 after this session's pentest flagged it as below guidance.
# Existing hashes keep working - see the hash format note on hash_password/verify_password
# below - and get quietly upgraded to the new count the next time their owner logs in
# (see needs_rehash and its call site in app/api/auth_routes.py's login()).
_PBKDF2_ITERATIONS = 600_000
_LEGACY_PBKDF2_ITERATIONS = 390_000

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
    """Hash format is "{iterations}$salt$digest" - the iteration count travels with the
    hash so a later bump to _PBKDF2_ITERATIONS (as happened once already - see its comment
    above) never breaks verifying a hash written under the old count. New hashes always use
    the current _PBKDF2_ITERATIONS."""
    salt = secrets.token_hex(16)
    digest = hashlib.pbkdf2_hmac("sha256", password.encode(), bytes.fromhex(salt), _PBKDF2_ITERATIONS)
    return f"{_PBKDF2_ITERATIONS}${salt}${digest.hex()}"


def _parse_password_hash(stored_hash: str) -> Optional[tuple]:
    """Returns (iterations, salt, digest_hex), or None if stored_hash is malformed.

    Accepts both the current 3-field format and the original 2-field one ("salt$digest",
    with no iteration count, always _LEGACY_PBKDF2_ITERATIONS) written before hash_password
    started embedding the count - so every password ever hashed by this app still verifies,
    without a one-time migration of the users table.
    """
    parts = stored_hash.split("$")
    if len(parts) == 3:
        iterations_str, salt, digest_hex = parts
        try:
            return int(iterations_str), salt, digest_hex
        except ValueError:
            return None
    if len(parts) == 2:
        salt, digest_hex = parts
        return _LEGACY_PBKDF2_ITERATIONS, salt, digest_hex
    return None


def verify_password(password: str, stored_hash: str) -> bool:
    parsed = _parse_password_hash(stored_hash)
    if parsed is None:
        return False
    iterations, salt, digest_hex = parsed
    try:
        salt_bytes = bytes.fromhex(salt)
    except ValueError:
        return False
    candidate = hashlib.pbkdf2_hmac("sha256", password.encode(), salt_bytes, iterations)
    return hmac.compare_digest(candidate.hex(), digest_hex)


def needs_rehash(stored_hash: str) -> bool:
    """True when a hash was written under a weaker iteration count than today's
    _PBKDF2_ITERATIONS (including every legacy 2-field hash) and should be upgraded the
    next time its owner proves they know the password - see login() in
    app/api/auth_routes.py, the only place this should ever trigger a rehash."""
    parsed = _parse_password_hash(stored_hash)
    if parsed is None:
        return False
    iterations, _salt, _digest_hex = parsed
    return iterations < _PBKDF2_ITERATIONS


@functools.lru_cache(maxsize=1)
def dummy_password_hash() -> str:
    """A throwaway hash checked when the email is unknown, so unknown and known emails take equally long."""
    return hash_password(secrets.token_hex(16))


def _sign(payload: str) -> str:
    secret = os.environ.get("SHIFTFLOW_SESSION_SECRET", "")
    if not secret:
        raise RuntimeError("SHIFTFLOW_SESSION_SECRET is not set")
    return hmac.new(secret.encode(), payload.encode(), hashlib.sha256).hexdigest()


def _password_fingerprint(password_hash: str) -> str:
    """A one-way tag of the account's *current* password hash, embedded in the signed
    session cookie below. It reveals nothing about the password (it is a hash of an
    already-salted hash) but lets every request cheaply confirm the cookie was minted
    against the password that is still active.

    This is what makes a password reset actually invalidate a stolen session cookie:
    resetting the password changes this fingerprint, so a cookie signed before the
    reset stops matching on the very next request - see current_user_id below. Without
    it, ShiftFlow's stateless signed cookies (see module docstring) would have no way to
    revoke a specific session, and an attacker who stole a cookie before the account
    holder reset their password would stay logged in after the reset, defeating the
    whole point of resetting it.
    """
    return hashlib.sha256(password_hash.encode()).hexdigest()[:16]


def create_session_cookie_value(user_id: str, password_hash: str) -> str:
    expiry = str(int(time.time()) + SESSION_MAX_AGE_SECONDS)
    fingerprint = _password_fingerprint(password_hash)
    payload = f"{user_id}.{expiry}.{fingerprint}"
    return f"{payload}.{_sign(payload)}"


def _decode_session_token(token: str) -> Optional[tuple]:
    """Verifies a session token's signature and expiry and, if valid, returns
    (user_id, password_fingerprint). The fingerprint still has to be checked against the
    user's *current* password hash (see current_user_id) - a valid signature only proves
    the token was minted by this server at some point, not that it is still current."""
    parts = token.split(".")
    if len(parts) != 4:
        return None
    user_id, expiry, fingerprint, sig = parts
    try:
        expected = _sign(f"{user_id}.{expiry}.{fingerprint}")
    except RuntimeError:
        return None
    if not hmac.compare_digest(sig, expected):
        return None
    try:
        if int(expiry) <= time.time():
            return None
    except ValueError:
        return None
    return user_id, fingerprint


def session_user_id(token: str) -> Optional[str]:
    """Returns the user id a validly signed, unexpired session token names, or None.

    This checks the signature and expiry only, not whether the token's password
    fingerprint still matches the user's current password - callers that gate access to
    data must use current_user_id, which checks both.
    """
    decoded = _decode_session_token(token)
    return decoded[0] if decoded else None


def _user_password_hash(user_id: str) -> Optional[str]:
    conn = get_db_connection()
    try:
        row = conn.execute("SELECT password_hash FROM users WHERE id = ?", (user_id,)).fetchone()
        return row[0] if row else None
    finally:
        conn.close()


def current_user_id(request: Request) -> Optional[str]:
    """The signed-in user's id, or None when the session is missing, forged, expired, its
    user was deleted, or its password fingerprint no longer matches the user's current
    password (i.e. the password was reset or changed since this cookie was issued)."""
    decoded = _decode_session_token(request.cookies.get(SESSION_COOKIE, ""))
    if decoded is None:
        return None
    user_id, fingerprint = decoded
    password_hash = _user_password_hash(user_id)
    if password_hash is None or not hmac.compare_digest(fingerprint, _password_fingerprint(password_hash)):
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
