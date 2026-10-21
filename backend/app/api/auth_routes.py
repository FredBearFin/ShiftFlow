"""Signup/login/logout/status routes for ShiftFlow Studio's email/password accounts."""

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


class SignupRequest(BaseModel):
    email: str
    password: str

    @field_validator("email")
    @classmethod
    def email_looks_valid(cls, v: str) -> str:
        if not _EMAIL_RE.match(v):
            raise ValueError("Enter a valid email address.")
        return v.lower()

    @field_validator("password")
    @classmethod
    def password_min_length(cls, v: str) -> str:
        if len(v) < 8:
            raise ValueError("Password must be at least 8 characters.")
        return v


class LoginRequest(BaseModel):
    email: str
    password: str


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
