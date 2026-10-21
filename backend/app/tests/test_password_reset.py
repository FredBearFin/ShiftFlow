"""A locked-out self-serve manager must be able to get back into their own account with
no support team involved (see app/api/auth_routes.py's /password-reset/request and
/password-reset/confirm). Unlike the owner-invite flow in app/api/owner_routes.py, the
actual reset token is never returned in the HTTP response or shown to the caller - this
endpoint is unauthenticated and callable against any email, so handing the live link
back to whoever asked (rather than only to the account's real inbox) would let anyone
who knows or guesses an email take over that account. It is only written to the server
log for now (no email service configured), so these tests read it straight out of the
database, the way an operator checking the log would, not out of the API response.

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

    def _latest_token_for_email(self, email: str) -> str:
        """Reads the token straight out of the database - standing in for the operator
        checking the server log, since the API response never carries it (see module
        docstring)."""
        conn = get_db_connection()
        try:
            repo = ShiftFlowRepository(conn)
            user = repo.get_user_by_email(email)
            cursor = conn.cursor()
            cursor.execute(
                "SELECT token FROM password_reset_tokens WHERE user_id = ? "
                "ORDER BY expires_at DESC LIMIT 1",
                (user["id"],),
            )
            row = cursor.fetchone()
            self.assertIsNotNone(row, f"no reset token was stored for {email}")
            return row["token"]
        finally:
            conn.close()

    def test_valid_reset_works_end_to_end(self):
        _owner_client, email = self._signup("resetme")
        self._request_reset(email)
        token = self._latest_token_for_email(email)

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
        self._request_reset(email)
        token = self._latest_token_for_email(email)

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

        # Identical shape and generic message either way - no "no such account" branch,
        # and critically, neither response carries the actual token (see module
        # docstring for why that matters: this endpoint is unauthenticated).
        self.assertEqual(set(known.keys()), set(unknown.keys()))
        self.assertEqual(known["message"], unknown["message"])
        self.assertEqual(known["status"], unknown["status"])
        self.assertNotIn("reset_token", known)
        self.assertNotIn("reset_path", known)

        # The real account really did get a token stored; a made-up token standing in
        # for "whatever a snooper might guess for the unknown email" was never stored,
        # and fails exactly like any other invalid token - never a distinct message.
        real_token = self._latest_token_for_email(real_email)
        anon = TestClient(app, base_url="https://testserver")
        fake_confirm = anon.post(
            "/api/auth/password-reset/confirm",
            json={"token": "guessed-token-nobody-actually-issued", "password": "brandnewpassword1"},
        )
        self.assertEqual(fake_confirm.status_code, 400)
        self.assertIn("invalid or has expired", fake_confirm.json()["detail"])

        real_confirm = anon.post(
            "/api/auth/password-reset/confirm",
            json={"token": real_token, "password": "brandnewpassword1"},
        )
        self.assertEqual(real_confirm.status_code, 200, real_confirm.text)

    def test_request_reset_writes_a_decoy_token_for_an_unknown_email(self):
        """An unknown email must still make request_password_reset perform a real
        database write, not just hand back a throwaway in-memory token - otherwise the
        branch for an unknown email is measurably faster than the real one, and an
        attacker can tell the two apart by timing alone even though the response bodies
        are identical (see request_password_reset's module-level docstring)."""
        conn = get_db_connection()
        try:
            before = conn.execute("SELECT COUNT(*) FROM password_reset_tokens").fetchone()[0]
        finally:
            conn.close()

        self._request_reset(unique_email("timing-decoy"))

        conn = get_db_connection()
        try:
            after = conn.execute("SELECT COUNT(*) FROM password_reset_tokens").fetchone()[0]
        finally:
            conn.close()
        self.assertEqual(after, before + 1)

    def test_decoy_token_can_never_be_confirmed(self):
        """Defense in depth for the decoy row above: even though its token is an
        unguessable 32-byte random value nobody will ever actually present, confirming
        it must still fail rather than silently reporting success for no real user."""
        from app.api.auth_routes import _DECOY_RESET_USER_ID

        conn = get_db_connection()
        try:
            repo = ShiftFlowRepository(conn)
            decoy = repo.create_password_reset_token(_DECOY_RESET_USER_ID, ttl_seconds=3600)
        finally:
            conn.close()

        anon = TestClient(app, base_url="https://testserver")
        confirm = anon.post(
            "/api/auth/password-reset/confirm",
            json={"token": decoy["token"], "password": "brandnewpassword1"},
        )
        self.assertEqual(confirm.status_code, 400)
        self.assertIn("invalid or has expired", confirm.json()["detail"])

    def test_request_reset_works_while_logged_out_and_needs_no_login(self):
        anon = TestClient(app, base_url="https://testserver")
        resp = anon.post("/api/auth/password-reset/request", json={"email": unique_email("anon")})
        self.assertEqual(resp.status_code, 200)

    def test_reset_invalidates_a_session_cookie_issued_before_it(self):
        """Concrete account-takeover scenario: an attacker steals a signed-in victim's
        session cookie. The victim notices and resets their password, believing that
        locks the attacker out. The stolen cookie must stop working on the very next
        request - it must not go on working for the rest of its 30-day life just
        because the session layer is stateless (see app.auth._password_fingerprint)."""
        client, email = self._signup("stolencookie")
        stolen_cookie = client.cookies.get("shiftflow_session")
        self.assertIsNotNone(stolen_cookie)

        # The stolen cookie works, same as the victim's own browser would.
        self.assertEqual(client.get("/api/auth/status").json()["logged_in"], True)

        self._request_reset(email)
        token = self._latest_token_for_email(email)
        anon = TestClient(app, base_url="https://testserver")
        confirm = anon.post(
            "/api/auth/password-reset/confirm", json={"token": token, "password": "brandnewpassword1"}
        )
        self.assertEqual(confirm.status_code, 200, confirm.text)

        # The attacker's stolen cookie (never touched by the reset) must now be dead.
        attacker = TestClient(app, base_url="https://testserver")
        attacker.cookies.set("shiftflow_session", stolen_cookie)
        self.assertEqual(attacker.get("/api/employees").status_code, 401)
        status = attacker.get("/api/auth/status").json()
        self.assertEqual(status["logged_in"], False)

    def test_new_password_must_pass_the_same_validation_as_signup(self):
        _owner_client, email = self._signup("weakpw")
        self._request_reset(email)
        token = self._latest_token_for_email(email)

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


class PasswordResetThrottleTests(unittest.TestCase):
    """/password-reset/request had no limit at all until this session's pentest found it
    could be spammed 15x in 0.23s for one email - see PASSWORD_RESET_MAX_ATTEMPTS in
    app/api/auth_routes.py."""

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

    def test_repeated_requests_for_one_email_are_throttled(self):
        from app.api.auth_routes import PASSWORD_RESET_MAX_ATTEMPTS, PASSWORD_RESET_WINDOW_SECONDS

        email = unique_email("spammed")
        anon = TestClient(app, base_url="https://testserver")
        for _ in range(PASSWORD_RESET_MAX_ATTEMPTS):
            resp = anon.post("/api/auth/password-reset/request", json={"email": email})
            self.assertEqual(resp.status_code, 200, resp.text)

        locked = anon.post("/api/auth/password-reset/request", json={"email": email})
        self.assertEqual(locked.status_code, 429, locked.text)
        self.assertEqual(locked.headers.get("retry-after"), str(PASSWORD_RESET_WINDOW_SECONDS))

    def test_throttle_is_per_email_not_global(self):
        from app.api.auth_routes import PASSWORD_RESET_MAX_ATTEMPTS

        locked_email = unique_email("locked")
        other_email = unique_email("other")
        anon = TestClient(app, base_url="https://testserver")
        for _ in range(PASSWORD_RESET_MAX_ATTEMPTS):
            anon.post("/api/auth/password-reset/request", json={"email": locked_email})

        other = anon.post("/api/auth/password-reset/request", json={"email": other_email})
        self.assertEqual(other.status_code, 200, other.text)

    def test_throttle_applies_the_same_way_to_an_email_with_no_account(self):
        """The throttle itself must not become a new way to tell real accounts apart from
        made-up ones - see request_password_reset's decoy-token docstring."""
        from app.api.auth_routes import PASSWORD_RESET_MAX_ATTEMPTS

        ghost_email = unique_email("ghost")
        anon = TestClient(app, base_url="https://testserver")
        for _ in range(PASSWORD_RESET_MAX_ATTEMPTS):
            resp = anon.post("/api/auth/password-reset/request", json={"email": ghost_email})
            self.assertEqual(resp.status_code, 200, resp.text)

        locked = anon.post("/api/auth/password-reset/request", json={"email": ghost_email})
        self.assertEqual(locked.status_code, 429, locked.text)


if __name__ == "__main__":
    unittest.main()
