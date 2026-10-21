"""Pricing-page checkout stub for ShiftFlow Studio's Personal / Business plans.

This is the signup path reached from the pricing page (see frontend/src/components/
PricingView.tsx and gtm/commercial_pricing.md for the two tiers' names, prices and
framing). It reuses the exact same account-creation machinery as the plain sign-up
form in app.api.auth_routes (SignupRequest's validation, ShiftFlowRepository.create_user,
hash_password, and the session cookie helper) so picking a plan on the pricing page
creates the same kind of account a direct "Create Account" sign-up does - this module
adds a billing record on top, it does not parallel or replace the account system.

No Stripe account or API key exists in this environment, so nothing here calls a real
payment processor. See the "STRIPE INTEGRATION POINT" comment on _start_stub_plan below
for exactly where that would go; everywhere else in this file (routing, validation,
account creation, session cookie) is meant to survive that swap unchanged.
"""

import sqlite3
import uuid
from typing import Literal, Optional

from fastapi import APIRouter, Depends, HTTPException, Response
from pydantic import field_validator

from app.api.auth_routes import SignupRequest, _set_session
from app.auth import ensure_auth_configured, hash_password, signup_allowed
from app.database import ShiftFlowRepository, get_db

router = APIRouter(prefix="/api/billing", tags=["Billing"])

# Billing status written by the stub below. Real Stripe integration would instead write
# something like "trialing" / "active" once a checkout.session.completed webhook (or an
# equivalent synchronous confirmation) actually confirms the subscription with Stripe.
STUB_BILLING_STATUS = "stub_trial"

PlanId = Literal["personal", "business"]


class BillingSignupRequest(SignupRequest):
    """Everything the pricing-page checkout form collects: plan, email, password, and
    (for the Business tier) a business name. Email/password validation is inherited
    unchanged from SignupRequest, the same rules the plain sign-up form enforces."""

    plan: PlanId
    business_name: Optional[str] = None

    @field_validator("business_name")
    @classmethod
    def business_name_trimmed(cls, v: Optional[str]) -> Optional[str]:
        if v is None:
            return None
        v = v.strip()
        return v or None


def _ensure_billing_schema(conn: sqlite3.Connection) -> None:
    """Creates the billing_signups table if it doesn't exist yet.

    This is additive only - a brand-new table, never a change to an existing one - and is
    deliberately kept out of app/database.py's init_db so this feature's schema lives
    entirely in this file. Safe to call on every request: CREATE TABLE IF NOT EXISTS is a
    no-op once the table exists.
    """
    conn.execute(
        """
        CREATE TABLE IF NOT EXISTS billing_signups (
            id TEXT PRIMARY KEY,
            user_id TEXT NOT NULL,
            email TEXT NOT NULL,
            business_name TEXT,
            plan TEXT NOT NULL,
            billing_status TEXT NOT NULL,
            created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
            FOREIGN KEY (user_id) REFERENCES users(id)
        );
        """
    )
    conn.commit()


def _start_stub_plan(
    conn: sqlite3.Connection,
    user_id: str,
    email: str,
    plan: PlanId,
    business_name: Optional[str],
) -> dict:
    """Records the chosen plan against the just-created account.

    # --- STRIPE INTEGRATION POINT ------------------------------------------------
    # This whole function body is the placeholder for real Stripe Checkout. In
    # production, this is where we would:
    #   1. Create (or look up) a Stripe Customer for `email` / `business_name`.
    #   2. Create a Stripe Checkout Session for the Price ID matching `plan`
    #      (Personal vs. Business - see gtm/commercial_pricing.md for the tiers).
    #   3. Return the Checkout Session URL instead of a finished billing record, and
    #      only write billing_status="active" once Stripe confirms the subscription
    #      (typically via a checkout.session.completed webhook), not synchronously
    #      here. The caller (signup_and_start_plan) would redirect the browser to
    #      that URL instead of landing straight in the app.
    # No Stripe account/API key is available in this environment, so instead this
    # just writes a locally-generated "stub_trial" row and returns immediately -
    # it starts a trial record, it does not process any payment.
    # ------------------------------------------------------------------------------
    """
    signup_id = f"BILL-{uuid.uuid4().hex[:8].upper()}"
    conn.execute(
        """
        INSERT INTO billing_signups (id, user_id, email, business_name, plan, billing_status)
        VALUES (?, ?, ?, ?, ?, ?);
        """,
        (signup_id, user_id, email, business_name, plan, STUB_BILLING_STATUS),
    )
    conn.commit()
    return {"id": signup_id, "plan": plan, "billing_status": STUB_BILLING_STATUS}


def get_billing_signup_for_user(conn: sqlite3.Connection, user_id: str) -> Optional[dict]:
    """The most recent billing_signups row for a user, or None if they signed up the plain way."""
    _ensure_billing_schema(conn)
    cursor = conn.cursor()
    cursor.execute(
        "SELECT * FROM billing_signups WHERE user_id = ? ORDER BY created_at DESC LIMIT 1",
        (user_id,),
    )
    row = cursor.fetchone()
    return dict(row) if row else None


@router.post("/signup")
def signup_and_start_plan(
    payload: BillingSignupRequest, response: Response, db: sqlite3.Connection = Depends(get_db)
) -> dict:
    """Pricing-page checkout: create the account, then start the chosen plan as a stub trial.

    This is the endpoint PricingView's "Start my plan" button calls. It is listed in
    app.auth._EXEMPT_PATH_PREFIXES (alongside /api/auth/signup) so a brand-new visitor who
    is not signed in yet can reach it.
    """
    ensure_auth_configured()
    if not signup_allowed():
        raise HTTPException(status_code=403, detail="Sign-ups are closed. Ask an administrator for an account.")

    repo = ShiftFlowRepository(db)
    if repo.get_user_by_email(payload.email):
        raise HTTPException(status_code=409, detail="An account with this email already exists.")

    _ensure_billing_schema(db)
    user = repo.create_user(payload.email, hash_password(payload.password))
    billing = _start_stub_plan(db, user["id"], user["email"], payload.plan, payload.business_name)
    _set_session(response, user["id"])

    return {
        "status": "ok",
        "email": user["email"],
        "plan": billing["plan"],
        "billing_status": billing["billing_status"],
    }
