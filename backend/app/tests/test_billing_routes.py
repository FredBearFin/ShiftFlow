"""Tests for the pricing-page checkout stub (app/api/billing_routes.py).

Mirrors the setup used in test_auth.py: a real SHIFTFLOW_SESSION_SECRET and an
https base_url so the session cookie (marked Secure) is stored and replayed by
the test client exactly as a real browser would.
"""

import contextlib
import os
import unittest
import uuid
from unittest import mock

from fastapi.testclient import TestClient

from app.api.billing_routes import STUB_BILLING_STATUS, get_billing_signup_for_user
from app.database import get_db_connection, init_db
from app.main import app


@contextlib.contextmanager
def env(**changes):
    with mock.patch.dict(os.environ):
        for name, value in changes.items():
            if value is None:
                os.environ.pop(name, None)
            else:
                os.environ[name] = value
        yield


def unique_email(label: str) -> str:
    return f"{label}-{uuid.uuid4().hex[:8]}@example.com"


class BillingSignupTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        # Explicit, rather than relying on the app's startup event (whose timing races other
        # test modules' use of the same on-disk database - see test_auth.py's known flakiness).
        init_db()
        cls._previous_secret = os.environ.get("SHIFTFLOW_SESSION_SECRET")
        os.environ["SHIFTFLOW_SESSION_SECRET"] = "billing-test-session-secret"
        cls.client = TestClient(app, base_url="https://testserver")

    @classmethod
    def tearDownClass(cls):
        if cls._previous_secret is not None:
            os.environ["SHIFTFLOW_SESSION_SECRET"] = cls._previous_secret
        else:
            os.environ.pop("SHIFTFLOW_SESSION_SECRET", None)

    def test_personal_plan_signup_creates_account_logged_in_and_stub_billing_row(self):
        client = TestClient(app, base_url="https://testserver")
        email = unique_email("personal")

        response = client.post(
            "/api/billing/signup",
            json={"email": email, "password": "correcthorse", "plan": "personal"},
        )
        self.assertEqual(response.status_code, 200)
        body = response.json()
        self.assertEqual(body["email"], email)
        self.assertEqual(body["plan"], "personal")
        self.assertEqual(body["billing_status"], STUB_BILLING_STATUS)

        # The checkout stub signs the visitor in exactly like /api/auth/signup does.
        status = client.get("/api/auth/status").json()
        self.assertEqual(status["logged_in"], True)
        self.assertEqual(status["email"], email)

        # And a billing_signups row now exists for that user, marked as a stub trial.
        conn = get_db_connection()
        try:
            user_id = conn.execute("SELECT id FROM users WHERE email = ?", (email,)).fetchone()["id"]
            row = get_billing_signup_for_user(conn, user_id)
        finally:
            conn.close()
        self.assertIsNotNone(row)
        self.assertEqual(row["plan"], "personal")
        self.assertEqual(row["billing_status"], STUB_BILLING_STATUS)
        self.assertIsNone(row["business_name"])

    def test_business_plan_signup_records_business_name(self):
        client = TestClient(app, base_url="https://testserver")
        email = unique_email("business")

        response = client.post(
            "/api/billing/signup",
            json={
                "email": email,
                "password": "correcthorse",
                "plan": "business",
                "business_name": "  Omaha Foodmart  ",
            },
        )
        self.assertEqual(response.status_code, 200)
        body = response.json()
        self.assertEqual(body["plan"], "business")

        conn = get_db_connection()
        try:
            user_id = conn.execute("SELECT id FROM users WHERE email = ?", (email,)).fetchone()["id"]
            row = get_billing_signup_for_user(conn, user_id)
        finally:
            conn.close()
        self.assertEqual(row["business_name"], "Omaha Foodmart")

    def test_blank_business_name_is_stored_as_null(self):
        client = TestClient(app, base_url="https://testserver")
        email = unique_email("blankbiz")

        response = client.post(
            "/api/billing/signup",
            json={"email": email, "password": "correcthorse", "plan": "business", "business_name": "   "},
        )
        self.assertEqual(response.status_code, 200)

        conn = get_db_connection()
        try:
            user_id = conn.execute("SELECT id FROM users WHERE email = ?", (email,)).fetchone()["id"]
            row = get_billing_signup_for_user(conn, user_id)
        finally:
            conn.close()
        self.assertIsNone(row["business_name"])

    def test_rejects_an_unknown_plan(self):
        response = self.client.post(
            "/api/billing/signup",
            json={"email": unique_email("badplan"), "password": "correcthorse", "plan": "enterprise"},
        )
        self.assertEqual(response.status_code, 422)

    def test_duplicate_email_is_rejected_like_plain_signup(self):
        client = TestClient(app, base_url="https://testserver")
        email = unique_email("dupe")
        first = client.post(
            "/api/billing/signup", json={"email": email, "password": "correcthorse", "plan": "personal"}
        )
        self.assertEqual(first.status_code, 200)

        second = client.post(
            "/api/billing/signup", json={"email": email, "password": "correcthorse", "plan": "business"}
        )
        self.assertEqual(second.status_code, 409)

    def test_short_password_is_rejected_like_plain_signup(self):
        response = self.client.post(
            "/api/billing/signup",
            json={"email": unique_email("shortpw"), "password": "short", "plan": "personal"},
        )
        self.assertEqual(response.status_code, 422)

    def test_closed_signups_block_checkout_too(self):
        with env(SHIFTFLOW_ALLOW_SIGNUP="false"):
            response = self.client.post(
                "/api/billing/signup",
                json={"email": unique_email("closed"), "password": "correcthorse", "plan": "personal"},
            )
            self.assertEqual(response.status_code, 403)

    def test_checkout_route_is_reachable_while_logged_out(self):
        """Confirms /api/billing/signup is exempt from require_login, same as /api/auth/signup -
        otherwise a brand-new visitor could never reach it in the first place."""
        client = TestClient(app, base_url="https://testserver")
        # This client has never logged in, and a protected route proves that.
        self.assertEqual(client.get("/api/employees").status_code, 401)
        response = client.post(
            "/api/billing/signup",
            json={"email": unique_email("exempt"), "password": "correcthorse", "plan": "personal"},
        )
        self.assertEqual(response.status_code, 200)

    def test_no_session_secret_fails_closed(self):
        with env(SHIFTFLOW_SESSION_SECRET=None, SHIFTFLOW_AUTH_DISABLED=None):
            client = TestClient(app, base_url="https://testserver")
            response = client.post(
                "/api/billing/signup",
                json={"email": unique_email("nosecret"), "password": "correcthorse", "plan": "personal"},
            )
            self.assertEqual(response.status_code, 503)


if __name__ == "__main__":
    unittest.main()
