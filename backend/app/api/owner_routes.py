"""A second, independent "owner" login per facility/account.

Deliberately lightweight: this is not a role-based-access-control system. It gives a
manager one way to invite a business owner by email, lets that owner sign in under their
own login, and gives the owner a read-only labor-cost summary for the facility - so the
account (and the manager's work setting it up) survives the manager leaving the job. See
app/claim_legacy_data.py for the prior art this follows: facility data is keyed by a
string owner id, never by a foreign key to the `users` table, so it is unaffected by
which login created it or whether that login still exists.

No email-sending service is configured in this environment (or assumed in production
here). POST /invite returns the invite link/token directly instead of emailing it; a real
deployment would send it by email and never display it in an API response.
"""

import re
from typing import Optional

from fastapi import APIRouter, Depends, HTTPException, Request, Response
from pydantic import BaseModel, field_validator

from app.auth import (
    SESSION_COOKIE,
    SESSION_MAX_AGE_SECONDS,
    cookie_secure,
    create_session_cookie_value,
    current_user_id,
    hash_password,
    login_enabled,
)
from app.database import ShiftFlowRepository, get_db

router = APIRouter(prefix="/api/owners", tags=["Facility Owners"])

_EMAIL_RE = re.compile(r"^[^@\s]+@[^@\s]+\.[^@\s]+$")


def _require_manager_id(request: Request) -> str:
    """The signed-in manager's user id. Owner invites only make sense with login on."""
    if not login_enabled():
        raise HTTPException(status_code=400, detail="Owner invites require login to be enabled on this server.")
    user_id = getattr(request.state, "user_id", None)
    if user_id is None:
        raise HTTPException(status_code=401, detail="Not logged in")
    return user_id


class CreateInviteRequest(BaseModel):
    facility_id: str
    owner_email: str

    @field_validator("owner_email")
    @classmethod
    def email_looks_valid(cls, v: str) -> str:
        if not _EMAIL_RE.match(v):
            raise ValueError("Enter a valid email address.")
        return v.strip().lower()


class AcceptInviteRequest(BaseModel):
    password: Optional[str] = None


def _set_session(response: Response, user_id: str, password_hash: str) -> None:
    response.set_cookie(
        SESSION_COOKIE,
        create_session_cookie_value(user_id, password_hash),
        max_age=SESSION_MAX_AGE_SECONDS,
        httponly=True,
        secure=cookie_secure(),
        samesite="lax",
    )


@router.post("/invite", summary="Invite a business owner to a facility")
def create_invite(
    payload: CreateInviteRequest,
    request: Request,
    db=Depends(get_db),
):
    manager_user_id = _require_manager_id(request)
    manager_repo = ShiftFlowRepository(db, owner_id=manager_user_id)
    if manager_repo.get_facility(payload.facility_id) is None:
        raise HTTPException(status_code=404, detail=f"Facility '{payload.facility_id}' not found.")

    repo = ShiftFlowRepository(db)
    invite = repo.create_owner_invite(manager_user_id, payload.facility_id, payload.owner_email)
    accept_path = f"/api/owners/accept/{invite['invite_token']}"
    # Stands in for the email a real deployment would send. Logged clearly so it is never
    # mistaken for something that was actually delivered.
    print(
        f"[owner-invite] No email service is configured - this would be emailed to "
        f"{invite['owner_email']} in production. Accept link: {accept_path}"
    )
    return {
        "invite_token": invite["invite_token"],
        "accept_path": accept_path,
        "owner_email": invite["owner_email"],
        "facility_id": invite["facility_id"],
        "note": (
            "No email service is configured here. In a real deployment this link would be "
            "emailed to the owner; for now, share it with them yourself."
        ),
    }


@router.get("/facility/{facility_id}/invites", summary="List owner invites for a facility")
def list_invites(
    facility_id: str,
    request: Request,
    db=Depends(get_db),
):
    manager_user_id = _require_manager_id(request)
    manager_repo = ShiftFlowRepository(db, owner_id=manager_user_id)
    if manager_repo.get_facility(facility_id) is None:
        raise HTTPException(status_code=404, detail=f"Facility '{facility_id}' not found.")

    repo = ShiftFlowRepository(db)
    invites = repo.list_owner_invites(manager_user_id, facility_id)
    return [
        {
            "id": inv["id"],
            "owner_email": inv["owner_email"],
            "invite_token": inv["invite_token"],
            "accept_path": f"/api/owners/accept/{inv['invite_token']}",
            "invited_at": inv["invited_at"],
            "accepted_at": inv["accepted_at"],
        }
        for inv in invites
    ]


@router.get("/my-links", summary="Facilities the signed-in user has accepted owner access to")
def my_links(request: Request, db=Depends(get_db)):
    if not login_enabled():
        return []
    owner_user_id = getattr(request.state, "user_id", None)
    if owner_user_id is None:
        raise HTTPException(status_code=401, detail="Not logged in")

    repo = ShiftFlowRepository(db)
    links = repo.list_owner_links_for_user(owner_user_id)
    result = []
    for link in links:
        fac = ShiftFlowRepository(db, owner_id=link["manager_user_id"]).get_facility(link["facility_id"])
        result.append(
            {
                "facility_id": link["facility_id"],
                "facility_name": fac["name"] if fac else link["facility_id"],
            }
        )
    return result


@router.get("/facility/{facility_id}/summary", summary="Read-only labor-cost summary for an owner or manager")
def facility_summary(
    facility_id: str,
    request: Request,
    db=Depends(get_db),
):
    if not login_enabled():
        raise HTTPException(status_code=400, detail="Owner access requires login to be enabled on this server.")
    user_id = getattr(request.state, "user_id", None)
    if user_id is None:
        raise HTTPException(status_code=401, detail="Not logged in")

    plain_repo = ShiftFlowRepository(db)
    manager_user_id = user_id
    fac = ShiftFlowRepository(db, owner_id=manager_user_id).get_facility(facility_id)
    if fac is None:
        # Not the manager's own facility - maybe this user is a linked owner of someone else's.
        link = plain_repo.find_owner_link(owner_user_id=user_id, facility_id=facility_id)
        if link is None:
            raise HTTPException(status_code=404, detail=f"Facility '{facility_id}' not found.")
        manager_user_id = link["manager_user_id"]
        fac = ShiftFlowRepository(db, owner_id=manager_user_id).get_facility(facility_id)
        if fac is None:
            raise HTTPException(status_code=404, detail=f"Facility '{facility_id}' not found.")

    repo = ShiftFlowRepository(db, owner_id=manager_user_id)
    active_employees = repo.list_employees(facility_id, active_only=True)
    employee_count = len(active_employees)
    # A simple, transparent estimate - not the solver's optimized schedule - so this stays
    # usable even for a facility whose demand/shift setup was never saved server-side.
    STANDARD_HOURS_PER_AVAILABLE_DAY = 8.0
    estimated_weekly_hours = sum(
        len(e["available_days"]) * STANDARD_HOURS_PER_AVAILABLE_DAY for e in active_employees
    )
    estimated_weekly_payroll = sum(
        len(e["available_days"]) * STANDARD_HOURS_PER_AVAILABLE_DAY * e["wage"] for e in active_employees
    )
    average_hourly_wage = (
        sum(e["wage"] for e in active_employees) / employee_count if employee_count else None
    )

    return {
        "facility_id": fac["id"],
        "facility_name": fac["name"],
        "active_employee_count": employee_count,
        "estimated_weekly_hours": round(estimated_weekly_hours, 1),
        "estimated_weekly_payroll": round(estimated_weekly_payroll, 2),
        "average_hourly_wage": round(average_hourly_wage, 2) if average_hourly_wage is not None else None,
        "note": (
            "Estimated from active staff and a standard 8-hour day per available day, not "
            "the optimized schedule. Read-only owner view."
        ),
    }


@router.get("/accept/{token}", summary="Preview an owner invite (no login required)")
def preview_invite(token: str, db=Depends(get_db)):
    repo = ShiftFlowRepository(db)
    invite = repo.get_owner_invite_by_token(token)
    if invite is None:
        raise HTTPException(status_code=404, detail="Invite not found or no longer valid.")
    fac = ShiftFlowRepository(db, owner_id=invite["manager_user_id"]).get_facility(invite["facility_id"])
    return {
        "facility_id": invite["facility_id"],
        "facility_name": fac["name"] if fac else invite["facility_id"],
        "owner_email": invite["owner_email"],
        "already_accepted": invite["accepted_at"] is not None,
    }


@router.post("/accept/{token}", summary="Accept an owner invite (no login required to start)")
def accept_invite(
    token: str,
    payload: AcceptInviteRequest,
    request: Request,
    response: Response,
    db=Depends(get_db),
):
    repo = ShiftFlowRepository(db)
    invite = repo.get_owner_invite_by_token(token)
    if invite is None:
        raise HTTPException(status_code=404, detail="Invite not found or no longer valid.")

    signed_in_user_id = current_user_id(request)
    if signed_in_user_id is not None:
        signed_in_user = repo.get_user_by_id(signed_in_user_id)
        if signed_in_user and signed_in_user["email"].lower() == invite["owner_email"].lower():
            repo.accept_owner_invite(token, signed_in_user_id)
            return {"status": "linked", "email": signed_in_user["email"], "facility_id": invite["facility_id"]}
        raise HTTPException(
            status_code=403,
            detail="You're signed in with a different email than this invite was sent to. Log out and try again.",
        )

    existing = repo.get_user_by_email(invite["owner_email"])
    if existing:
        raise HTTPException(
            status_code=409,
            detail="An account with this email already exists. Log in, then open this invite link again.",
        )

    if not payload.password or len(payload.password) < 8:
        raise HTTPException(status_code=422, detail="Choose a password of at least 8 characters.")

    user = repo.create_user(invite["owner_email"], hash_password(payload.password))
    repo.accept_owner_invite(token, user["id"])
    _set_session(response, user["id"], user["password_hash"])
    return {"status": "created", "email": user["email"], "facility_id": invite["facility_id"]}
