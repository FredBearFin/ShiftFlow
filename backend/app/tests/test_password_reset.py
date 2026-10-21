"""A locked-out self-serve manager must be able to get back into their own account with
no support team involved (see app/api/auth_routes.py's /password-reset/request and
/password-reset/confirm). No email service is configured in this environment, so the
reset link is returned directly in the response - same pattern as the owner-invite flow
in app/api/owner_routes.py (see test_facility_owners.py).

Covers: a valid reset works end to end, an expired token is rejected, a used token
cannot be reused, a bad token is rejected, the request-reset response does not reveal
whether the email exists, and the new password goes through the same validation signup
does.
"""

import os
import unittest
import uuid

from fastapi.testclient import TestClient

from app.database import ShiftFlowRepository, get_db_connection, init_db
from app.main import app


def unique_email(label: str) -> str:
    return f"{label}-{uuid.uuid4().hex[:8]}@example.com"


class PasswordResetTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        init_db()
        cls._previous_secret = os.environ.get("SHIFTFLOW_SESSION_SECRET")
        os.environ["SHIFTFLOW_SESSION_SECRET"] = "p" * 48

    @classmethod
    def tearDownClass(cls):
        if cls._previous_secret is not None:
            os.environ["SHIFTFLOW_SESSION_SECRET"] = cls._previous_secret
        else:
            os.environ.pop("SHIFTFLOW_SESSION_SECRET", None)

    def _signup(self, label: str) -> tuple:
        client = TestClient(app, base_url="https://testserver")
        email = unique_email(label)
        resp = client.post("/api/auth/signup", json={"email": email, "password": "correcthorse"})
        self.assertEqual(resp.status_code, 200, resp.text)
        return client, email

    def _request_reset(self, email: str) -> dict:
        anon = TestClient(app, base_url="https://testserver")
        resp = anon.post("/api/auth/password-reset/request", json={"email": email})
        self.assertEqual(resp.status_code, 200, resp.text)
        return resp.json()

    def test_valid_reset_works_end_to_end(self):
        _owner_client, email = self._signup("resetme")
        result = self._request_reset(email)
        token = result["reset_token"]

        anon = TestClient(app, base_url="https://testserver")
        confirm = anon.post(
            "/api/auth/password-reset/confirm", json={"token": token, "password": "brandnewpassword1"}
        )
        self.assertEqual(confirm.status_code, 200, confirm.text)
        self.assertEqual(confirm.json()["status"], "ok")

        # Old password no longer works; the new one signs in.
        old_login = anon.post("/api/auth/login", json={"email": email, "password": "correcthorse"})
        self.assertEqual(old_login.status_code, 401)
        new_login = anon.post("/api/auth/login", json={"email": email, "password": "brandnewpassword1"})
        self.assertEqual(new_login.status_code, 200)

    def test_expired_token_is_rejected(self):
        _owner_client, email = self._signup("expired")
        conn = get_db_connection()
        try:
            repo = ShiftFlowRepository(conn)
            user = repo.get_user_by_email(email)
            # A negative ttl backdates expires_at into the past, exercising the exact
            # same expiry check a real token would hit an hour after being issued.
            expired = repo.create_password_reset_token(user["id"], ttl_seconds=-10)
        finally:
            conn.close()

        anon = TestClient(app, base_url="https://testserver")
        confirm = anon.post(
            "/api/auth/password-reset/confirm",
            json={"token": expired["token"], "password": "brandnewpassword1"},
        )
        self.assertEqual(confirm.status_code, 400)
        self.assertIn("invalid or has expired", confirm.json()["detail"])

        # Nothing changed - the original password still works.
        login = anon.post("/api/auth/login", json={"email": email, "password": "correcthorse"})
        self.assertEqual(login.status_code, 200)

    def test_used_token_cannot_be_reused(self):
        _owner_client, email = self._signup("usedtoken")
        token = self._request_reset(email)["reset_token"]

        anon = TestClient(app, base_url="https://testserver")
        first = anon.post(
            "/api/auth/password-reset/confirm", json={"token": token, "password": "firstnewpassword1"}
        )
        self.assertEqual(first.status_code, 200, first.text)

        second = anon.post(
            "/api/auth/password-reset/confirm", json={"token": token, "password": "secondnewpassword1"}
        )
        self.assertEqual(second.status_code, 400)
        self.assertIn("invalid or has expired", second.json()["detail"])

        # The first reset's password is the one that actually took effect.
        login = anon.post("/api/auth/login", json={"email": email, "password": "firstnewpassword1"})
        self.assertEqual(login.status_code, 200)

    def test_bad_token_is_rejected(self):
        anon = TestClient(app, base_url="https://testserver")
        confirm = anon.post(
            "/api/auth/password-reset/confirm",
            json={"token": "not-a-real-token-at-all", "password": "brandnewpassword1"},
        )
        self.assertEqual(confirm.status_code, 400)
        self.assertIn("invalid or has expired", confirm.json()["detail"])

    def test_request_reset_does_not_reveal_whether_the_email_exists(self):
        _owner_client, real_email = self._signup("exists")
        unknown_email = unique_email("doesnotexist")

        known = self._request_reset(real_email)
        unknown = self._request_reset(unknown_email)

        # Identical shape and generic message either way - no "no such account" branch.
        self.assertEqual(set(known.keys()), set(unknown.keys()))
        self.assertEqual(known["message"], unknown["message"])
        self.assertEqual(known["status"], unknown["status"])
        self.assertTrue(known["reset_token"])
        self.assertTrue(unknown["reset_token"])
        self.assertNotEqual(known["reset_token"], unknown["reset_token"])

        # But only the real account's token actually works - the other was never stored,
        # so using it fails exactly like any other invalid token (never a distinct message).
        anon = TestClient(app, base_url="https://testserver")
        fake_confirm = anon.post(
            "/api/auth/password-reset/confirm",
            json={"token": unknown["reset_token"], "password": "brandnewpassword1"},
        )
        self.assertEqual(fake_confirm.status_code, 400)
        self.assertIn("invalid or has expired", fake_confirm.json()["detail"])

        real_confirm = anon.post(
            "/api/auth/password-reset/confirm",
            json={"token": known["reset_token"], "password": "brandnewpassword1"},
        )
        self.assertEqual(real_confirm.status_code, 200, real_confirm.text)

    def test_request_reset_works_while_logged_out_and_needs_no_login(self):
        anon = TestClient(app, base_url="https://testserver")
        resp = anon.post("/api/auth/password-reset/request", json={"email": unique_email("anon")})
        self.assertEqual(resp.status_code, 200)

    def test_new_password_must_pass_the_same_validation_as_signup(self):
        _owner_client, email = self._signup("weakpw")
        token = self._request_reset(email)["reset_token"]

        anon = TestClient(app, base_url="https://testserver")
        too_short = anon.post(
            "/api/auth/password-reset/confirm", json={"token": token, "password": "short"}
        )
        self.assertEqual(too_short.status_code, 422)

        # The rejected attempt did not consume the token - a real retry still works.
        ok = anon.post(
            "/api/auth/password-reset/confirm", json={"token": token, "password": "longenoughpassword1"}
        )
        self.assertEqual(ok.status_code, 200, ok.text)


if __name__ == "__main__":
    unittest.main()
