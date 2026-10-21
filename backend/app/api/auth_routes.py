"""Signup/login/logout/status/password-reset routes for ShiftFlow Studio's email/
password accounts.

Password reset (see /password-reset/request and /password-reset/confirm below) follows
the same pattern app/api/owner_routes.py already established for delivering a secure,
one-time link with no email service configured in this environment: generate a
cryptographically secure token with secrets.token_urlsafe and store it with an expiry.
Unlike the owner-invite link, this one is never returned in the response or shown to the
caller - only logged server-side - since /password-reset/request is unauthenticated and
callable against any email, not sent by someone already signed in and choosing their own
invitee (see request_password_reset's docstring below for why that distinction matters).
"""

import re
import sqlite3
import time

from fastapi import APIRouter, Depends, HTTPException, Request, Response
from pydantic import BaseModel, field_validator

from app.auth import (
    LOGIN_MAX_FAILURES,
    LOGIN_WINDOW_SECONDS,
    SESSION_COOKIE,
    SESSION_MAX_AGE_SECONDS,
    cookie_secure,
    create_session_cookie_value,
    current_user_id,
    dummy_password_hash,
    ensure_auth_configured,
    hash_password,
    login_enabled,
    needs_rehash,
    signup_allowed,
    verify_password,
)
from app.database import ShiftFlowRepository, get_db

router = APIRouter(prefix="/api/auth", tags=["Auth"])

_EMAIL_RE = re.compile(r"^[^@\s]+@[^@\s]+\.[^@\s]+$")

# How long a password-reset link stays usable. Short enough that a link sitting in an
# inbox (or, here, printed to a server log - see request_password_reset below) for days
# is not a standing way into the account, long enough that someone does not have to
# finish the whole flow in one sitting.
PASSWORD_RESET_TTL_SECONDS = 60 * 60

# How many account-creation attempts one client IP may make before further attempts get
# 429 - signup has no email/account yet to key a throttle on the way login does, and
# demonstrated during this session's pentest that it had no limit at all (15 real
# accounts created in ~4 seconds from one source). Generous enough that a shared office
# connection signing up several real managers in a day is never affected.
SIGNUP_MAX_ATTEMPTS_PER_IP = 10
SIGNUP_WINDOW_SECONDS = 60 * 60

# Same idea for /password-reset/request, keyed by email instead of IP (reusing the
# login_failures table/methods under a distinct "pwreset:" key prefix, rather than a
# second near-identical table) - also had no limit at all (15 reset requests in 0.23s for
# the same email during the same pentest).
PASSWORD_RESET_MAX_ATTEMPTS = 5
PASSWORD_RESET_WINDOW_SECONDS = 15 * 60


def _client_ip(request: Request) -> str:
    return request.client.host if request.client else "unknown"


# A placeholder user id for the decoy reset token request_password_reset below stores when
# the requested email has no account - see that function for why. Real ids are always
# "USR-" followed by 8 uppercase hex characters (see ShiftFlowRepository.create_user), so
# this can never collide with one, and no user ever has this id for confirm_password_reset
# to act on.
_DECOY_RESET_USER_ID = "DECOY-NO-SUCH-USER"


def _validate_password(v: str) -> str:
    """Shared by SignupRequest and PasswordResetConfirmRequest - a reset must not let
    someone set a weaker password than sign-up would ever have allowed."""
    if len(v) < 8:
        raise ValueError("Password must be at least 8 characters.")
    return v


def _normalize_email(v: str) -> str:
    if not _EMAIL_RE.match(v):
        raise ValueError("Enter a valid email address.")
    return v.strip().lower()


class SignupRequest(BaseModel):
    email: str
    password: str

    @field_validator("email")
    @classmethod
    def email_looks_valid(cls, v: str) -> str:
        return _normalize_email(v)

    @field_validator("password")
    @classmethod
    def password_min_length(cls, v: str) -> str:
        return _validate_password(v)


class LoginRequest(BaseModel):
    email: str
    password: str


class PasswordResetRequestInput(BaseModel):
    email: str

    @field_validator("email")
    @classmethod
    def email_looks_valid(cls, v: str) -> str:
        return _normalize_email(v)


class PasswordResetConfirmRequest(BaseModel):
    token: str
    password: str

    @field_validator("password")
    @classmethod
    def password_min_length(cls, v: str) -> str:
        return _validate_password(v)


def _set_session(response: Response, user_id: str, password_hash: str) -> None:
    response.set_cookie(
        SESSION_COOKIE,
        create_session_cookie_value(user_id, password_hash),
        max_age=SESSION_MAX_AGE_SECONDS,
        httponly=True,
        secure=cookie_secure(),
        samesite="lax",
    )


@router.post("/signup")
def signup(payload: SignupRequest, request: Request, response: Response, db: sqlite3.Connection = Depends(get_db)) -> dict:
    ensure_auth_configured()
    if not signup_allowed():
        raise HTTPException(status_code=403, detail="Sign-ups are closed. Ask an administrator for an account.")
    repo = ShiftFlowRepository(db)

    client_ip = _client_ip(request)
    now = time.time()
    if repo.count_signup_attempts(client_ip, since=now - SIGNUP_WINDOW_SECONDS) >= SIGNUP_MAX_ATTEMPTS_PER_IP:
        raise HTTPException(
            status_code=429,
            detail="Too many accounts created from this network recently. Try again later.",
            headers={"Retry-After": str(SIGNUP_WINDOW_SECONDS)},
        )
    repo.record_signup_attempt(client_ip, now=now, prune_before=now - SIGNUP_WINDOW_SECONDS)

    if repo.get_user_by_email(payload.email):
        raise HTTPException(status_code=409, detail="An account with this email already exists.")
    user = repo.create_user(payload.email, hash_password(payload.password))
    _set_session(response, user["id"], user["password_hash"])
    return {"status": "ok", "email": user["email"]}


@router.post("/login")
def login(payload: LoginRequest, response: Response, db: sqlite3.Connection = Depends(get_db)) -> dict:
    ensure_auth_configured()
    repo = ShiftFlowRepository(db)
    email = payload.email.strip().lower()[:254]  # 254 is the longest valid email; bounds the throttle key too

    now = time.time()
    if repo.count_login_failures(email, since=now - LOGIN_WINDOW_SECONDS) >= LOGIN_MAX_FAILURES:
        raise HTTPException(
            status_code=429,
            detail="Too many failed sign-in attempts. Try again in 15 minutes.",
            headers={"Retry-After": str(LOGIN_WINDOW_SECONDS)},
        )

    user = repo.get_user_by_email(email)
    # Always run one password check, so an unknown email takes as long to reject as a wrong password.
    password_ok = verify_password(payload.password, user["password_hash"] if user else dummy_password_hash())
    if not user or not password_ok:
        repo.record_login_failure(email, now=now, prune_before=now - LOGIN_WINDOW_SECONDS)
        raise HTTPException(status_code=401, detail="Incorrect email or password.")

    repo.clear_login_failures(email)

    password_hash = user["password_hash"]
    if needs_rehash(password_hash):
        # Only reachable here, right after verify_password above proved this request
        # carried the real plaintext password - a stored hash is never rehashed from
        # anywhere else. Upgrades a hash written under an old, weaker PBKDF2 iteration
        # count (see app/auth.py's _PBKDF2_ITERATIONS) without forcing every existing
        # account through a reset. Uses the freshly rehashed value for this request's
        # session fingerprint so the cookie just issued isn't immediately invalidated by
        # app.auth._password_fingerprint comparing it against the old stored hash.
        password_hash = hash_password(payload.password)
        repo.update_user_password(user["id"], password_hash)

    _set_session(response, user["id"], password_hash)
    return {"status": "ok", "email": user["email"]}


@router.post("/logout")
def logout(response: Response) -> dict:
    response.delete_cookie(SESSION_COOKIE)
    return {"status": "ok"}


@router.get("/status")
def status(request: Request, db: sqlite3.Connection = Depends(get_db)) -> dict:
    """Tells the frontend whether a login screen is needed, and who (if anyone) is signed in."""
    if not login_enabled():
        return {"login_required": False, "logged_in": True, "email": None, "signup_allowed": False}
    user_id = current_user_id(request)
    user = ShiftFlowRepository(db).get_user_by_id(user_id) if user_id else None
    return {
        "login_required": True,
        "logged_in": user is not None,
        "email": user["email"] if user else None,
        "signup_allowed": signup_allowed(),
    }


_GENERIC_RESET_REQUEST_MESSAGE = "If an account exists for that email, a password reset link has been generated."
# Deliberately identical for a bad token, an expired one and an already-used one, so the
# response never tells an attacker which of those three is true - same spirit as login()
# above giving one generic "Incorrect email or password" for both a wrong password and an
# unknown email.
_GENERIC_RESET_CONFIRM_ERROR = "This password reset link is invalid or has expired."


@router.post("/password-reset/request")
def request_password_reset(payload: PasswordResetRequestInput, db: sqlite3.Connection = Depends(get_db)) -> dict:
    """Starts a password reset. Never reveals whether the email has an account: the
    response always has the same shape and the same generic message either way, and
    never carries the actual reset token/link - this endpoint is unauthenticated and
    callable against any email in the system, so handing the live link back to whoever
    asked (rather than only to the account's real inbox) would let anyone who knows or
    guesses an email take over that account. No email service is configured in this
    environment, so the link a real deployment would email to the account holder is only
    ever written to the server log here, readable by the operator, not the requester.

    A request for an email with no account still writes a token to
    password_reset_tokens - keyed to a decoy id no user ever has (_DECOY_RESET_USER_ID)
    rather than skipped outright - so trying to use it fails with the exact same "invalid
    or expired" response as any other bad token (see confirm_password_reset), and, just as
    importantly, so this branch pays for the same database write the real branch does:
    an email enumeration attack doesn't need the response body to say "no such account" if
    that branch is measurably faster, and it was, before this decoy write (same idea as
    dummy_password_hash in app/auth.py for login).

    Throttled per email (reusing login()'s login_failures table/methods under a distinct
    "pwreset:" key prefix, not a second near-identical table) - this had no limit at all
    before, demonstrated during this session's pentest as a real spam vector (15 requests
    for one email in 0.23s). The check runs before the email lookup and costs the same
    regardless of whether the email has an account, so it doesn't reopen the timing leak
    this function already closes elsewhere.
    """
    ensure_auth_configured()
    repo = ShiftFlowRepository(db)
    email = payload.email[:254]  # bounds the lookup key the same way login() bounds its throttle key

    throttle_key = f"pwreset:{email}"
    now = time.time()
    if repo.count_login_failures(throttle_key, since=now - PASSWORD_RESET_WINDOW_SECONDS) >= PASSWORD_RESET_MAX_ATTEMPTS:
        raise HTTPException(
            status_code=429,
            detail="Too many reset requests for this email. Try again later.",
            headers={"Retry-After": str(PASSWORD_RESET_WINDOW_SECONDS)},
        )
    repo.record_login_failure(throttle_key, now=now, prune_before=now - PASSWORD_RESET_WINDOW_SECONDS)

    user = repo.get_user_by_email(email)
    target_user_id = user["id"] if user is not None else _DECOY_RESET_USER_ID
    token = repo.create_password_reset_token(target_user_id, ttl_seconds=PASSWORD_RESET_TTL_SECONDS)["token"]

    reset_path = f"/?password_reset={token}"
    # Deliberately not returned in the HTTP response: this endpoint is unauthenticated and
    # callable against any email in the system, so handing the live reset link back to
    # whoever asked - rather than only to the account's real inbox - would let anyone who
    # knows or guesses a manager's email take over that account with no access to their
    # email at all. A real deployment emails this link to the account holder; since no
    # email service is configured here, it is only ever written to the server log, which
    # only the operator (not the requester) can read.
    print(
        f"[password-reset] No email service is configured - if an account exists for "
        f"{email}, this link would be emailed to them in production. Reset link: {reset_path}"
    )
    return {
        "status": "ok",
        "message": _GENERIC_RESET_REQUEST_MESSAGE,
        "note": (
            "No email service is configured here yet. If an account exists for that "
            "email, a reset link has been generated and logged server-side - ask the "
            "site operator for it for now, rather than it being emailed automatically."
        ),
    }


@router.post("/password-reset/confirm")
def confirm_password_reset(payload: PasswordResetConfirmRequest, db: sqlite3.Connection = Depends(get_db)) -> dict:
    """Completes a password reset: a valid, unexpired, unused token sets a new password.

    The token is checked for existence, expiry, prior use, and a real user to apply to
    before anything is changed, and is marked used in the same request that uses it, so
    it cannot be replayed. The "real user" check is what keeps a decoy token (see
    request_password_reset's _DECOY_RESET_USER_ID) from ever reporting success - it is
    deliberately unguessable (32 random bytes), so this is defense in depth, not the
    primary reason it's safe.

    Session invalidation: changing the password here also invalidates every session
    cookie issued before the change, including one an attacker stole before it - see
    app.auth._password_fingerprint for how. A device that was already signed in before
    the reset does not stay signed in afterward; its next request gets a 401 (or, for the
    frontend's own polling, /api/auth/status reports logged_in: false) just like a cookie
    for a deleted user does.
    """
    ensure_auth_configured()
    repo = ShiftFlowRepository(db)
    record = repo.get_password_reset_token(payload.token)
    if (
        record is None
        or record["used_at"] is not None
        or float(record["expires_at"]) <= time.time()
        or repo.get_user_by_id(record["user_id"]) is None
    ):
        raise HTTPException(status_code=400, detail=_GENERIC_RESET_CONFIRM_ERROR)

    repo.update_user_password(record["user_id"], hash_password(payload.password))
    repo.mark_password_reset_token_used(payload.token)
    return {"status": "ok"}
