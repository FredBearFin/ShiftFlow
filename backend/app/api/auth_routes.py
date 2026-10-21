"""Signup/login/logout/status routes for ShiftFlow Studio's email/password accounts."""

import re
import sqlite3

from fastapi import APIRouter, Depends, HTTPException, Request, Response
from pydantic import BaseModel, field_validator

from app.auth import (
    SESSION_COOKIE,
    SESSION_MAX_AGE_SECONDS,
    create_session_cookie_value,
    hash_password,
    login_enabled,
    session_user_id,
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
        secure=True,
        samesite="lax",
    )


@router.post("/signup")
def signup(payload: SignupRequest, response: Response, db: sqlite3.Connection = Depends(get_db)) -> dict:
    repo = ShiftFlowRepository(db)
    if repo.get_user_by_email(payload.email):
        raise HTTPException(status_code=409, detail="An account with this email already exists.")
    user = repo.create_user(payload.email, hash_password(payload.password))
    _set_session(response, user["id"])
    return {"status": "ok", "email": user["email"]}


@router.post("/login")
def login(payload: LoginRequest, response: Response, db: sqlite3.Connection = Depends(get_db)) -> dict:
    repo = ShiftFlowRepository(db)
    user = repo.get_user_by_email(payload.email.lower())
    if not user or not verify_password(payload.password, user["password_hash"]):
        raise HTTPException(status_code=401, detail="Incorrect email or password.")
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
        return {"login_required": False, "logged_in": True, "email": None}
    user_id = session_user_id(request.cookies.get(SESSION_COOKIE, ""))
    user = ShiftFlowRepository(db).get_user_by_id(user_id) if user_id else None
    return {
        "login_required": True,
        "logged_in": user is not None,
        "email": user["email"] if user else None,
    }
