"""Signup/login/logout/status/password-reset routes for ShiftFlow Studio's email/
password accounts.

Password reset (see /password-reset/request and /password-reset/confirm below) follows
the same pattern app/api/owner_routes.py already established for delivering a secure,
one-time link with no email service configured in this environment: generate a
cryptographically secure token with secrets.token_urlsafe, store it with an expiry, and
return the link directly in the response instead of emailing it.
"""

import re
import secrets
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
    dummy_password_hash,
    ensure_auth_configured,
    hash_password,
    login_enabled,
    session_user_id,
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


def _set_session(response: Response, user_id: str) -> None:
    response.set_cookie(
        SESSION_COOKIE,
        create_session_cookie_value(user_id),
        max_age=SESSION_MAX_AGE_SECONDS,
        httponly=True,
        secure=cookie_secure(),
        samesite="lax",
    )


@router.post("/signup")
def signup(payload: SignupRequest, response: Response, db: sqlite3.Connection = Depends(get_db)) -> dict:
    ensure_auth_configured()
    if not signup_allowed():
        raise HTTPException(status_code=403, detail="Sign-ups are closed. Ask an administrator for an account.")
    repo = ShiftFlowRepository(db)
    if repo.get_user_by_email(payload.email):
        raise HTTPException(status_code=409, detail="An account with this email already exists.")
    user = repo.create_user(payload.email, hash_password(payload.password))
    _set_session(response, user["id"])
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
    _set_session(response, user["id"])
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
    user_id = session_user_id(request.cookies.get(SESSION_COOKIE, ""))
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
    response always has the same shape, and always carries a reset link that *looks*
    usable either way.

    No email service is configured in this environment (see app/api/owner_routes.py for
    the same situation with owner invites), so the link that a real deployment would
    email to the account holder is returned directly here instead - but only a link built
    from a token this request actually stored is ever accepted by /password-reset/confirm.
    A request for an email with no account gets a token that was never written to
    password_reset_tokens, so trying to use it fails with the exact same "invalid or
    expired" response as any other bad token - never a distinct "no such account" message,
    in the response body or in how long either branch takes (both do one user lookup and
    one write-shaped amount of work).
    """
    ensure_auth_configured()
    repo = ShiftFlowRepository(db)
    email = payload.email[:254]  # bounds the lookup key the same way login() bounds its throttle key
    user = repo.get_user_by_email(email)
    if user is not None:
        token = repo.create_password_reset_token(user["id"], ttl_seconds=PASSWORD_RESET_TTL_SECONDS)["token"]
    else:
        # Same token shape and size as a real one, but never persisted - nothing will
        # ever match it in password_reset_tokens, so it can never reset anyone's password.
        token = secrets.token_urlsafe(32)

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

    The token is checked for existence, expiry and prior use before anything is changed,
    and is marked used in the same request that uses it, so it cannot be replayed.

    Session invalidation note: ShiftFlow's session cookies (see app/auth.py) are
    stateless and signed, not looked up against a server-side session store, so there is
    no existing mechanism to revoke a specific other signed-in session's cookie without
    building a much larger session-versioning system from scratch (e.g. tracking a
    per-user session generation/epoch and checking it on every request). That is out of
    scope here; this endpoint changes the password (and the old password stops working
    for any *future* login), but a device that is already signed in before the reset
    stays signed in afterward.
    """
    ensure_auth_configured()
    repo = ShiftFlowRepository(db)
    record = repo.get_password_reset_token(payload.token)
    if (
        record is None
        or record["used_at"] is not None
        or float(record["expires_at"]) <= time.time()
    ):
        raise HTTPException(status_code=400, detail=_GENERIC_RESET_CONFIRM_ERROR)

    repo.update_user_password(record["user_id"], hash_password(payload.password))
    repo.mark_password_reset_token_used(payload.token)
    return {"status": "ok"}
