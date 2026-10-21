"""Tests for CORS origins, the durable database path, account login, and login hardening."""

import contextlib
import os
import unittest
import uuid
from unittest import mock

from fastapi.testclient import TestClient

from app import auth
from app.database import get_db_connection
from app.main import app


@contextlib.contextmanager
def env(**changes):
    """Sets (str) or removes (None) environment variables for the block, then restores them."""
    with mock.patch.dict(os.environ):
        for name, value in changes.items():
            if value is None:
                os.environ.pop(name, None)
            else:
                os.environ[name] = value
        yield


def unique_email(label: str) -> str:
    return f"{label}-{uuid.uuid4().hex[:8]}@example.com"


class AuthTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.client = TestClient(app)

    def test_read_routes_stay_open(self):
        response = self.client.get("/health")
        self.assertEqual(response.status_code, 200)

    def test_cors_allows_only_configured_origin(self):
        allowed = self.client.options(
            "/api/v1/archetypes",
            headers={"Origin": "http://localhost:5173", "Access-Control-Request-Method": "GET"},
        )
        self.assertEqual(allowed.headers.get("access-control-allow-origin"), "http://localhost:5173")
        other = self.client.options(
            "/api/v1/archetypes",
            headers={"Origin": "https://evil.example", "Access-Control-Request-Method": "GET"},
        )
        self.assertIsNone(other.headers.get("access-control-allow-origin"))


class AccountLoginTests(unittest.TestCase):
    """SHIFTFLOW_SESSION_SECRET signs real email/password accounts (see app/auth.py)."""

    @classmethod
    def setUpClass(cls):
        cls._previous_secret = os.environ.get("SHIFTFLOW_SESSION_SECRET")
        os.environ["SHIFTFLOW_SESSION_SECRET"] = "test-session-secret"
        # Cookies are marked Secure, so the test client must look like an https origin
        # for them to be stored and replayed, same as a real browser would require.
        cls.client = TestClient(app, base_url="https://testserver")

    @classmethod
    def tearDownClass(cls):
        if cls._previous_secret is not None:
            os.environ["SHIFTFLOW_SESSION_SECRET"] = cls._previous_secret
        else:
            os.environ.pop("SHIFTFLOW_SESSION_SECRET", None)

    def test_protected_route_blocked_when_logged_out(self):
        response = self.client.post("/api/v1/schedules/solve", json={})
        self.assertEqual(response.status_code, 401)

    def test_status_route_itself_is_never_blocked(self):
        """The frontend must always be able to ask whether it's logged in."""
        response = self.client.get("/api/auth/status")
        self.assertEqual(response.status_code, 200)
        self.assertEqual(
            response.json(),
            {"login_required": True, "logged_in": False, "email": None, "signup_allowed": True},
        )

    def test_signup_login_logout_roundtrip(self):
        client = TestClient(app, base_url="https://testserver")
        email = unique_email("owner")

        signup = client.post("/api/auth/signup", json={"email": email, "password": "correcthorse"})
        self.assertEqual(signup.status_code, 200)
        self.assertEqual(client.get("/api/auth/status").json()["logged_in"], True)

        dup = client.post("/api/auth/signup", json={"email": email, "password": "correcthorse"})
        self.assertEqual(dup.status_code, 409)

        client.post("/api/auth/logout")
        self.assertEqual(client.get("/api/auth/status").json()["logged_in"], False)

        bad_login = client.post("/api/auth/login", json={"email": email, "password": "wrong"})
        self.assertEqual(bad_login.status_code, 401)

        good_login = client.post("/api/auth/login", json={"email": email, "password": "correcthorse"})
        self.assertEqual(good_login.status_code, 200)
        status = client.get("/api/auth/status").json()
        self.assertEqual(
            status,
            {"login_required": True, "logged_in": True, "email": email, "signup_allowed": True},
        )


class FailClosedTests(unittest.TestCase):
    """Login is on unless the operator explicitly opts out, and a bad secret never boots."""

    def setUp(self):
        self.client = TestClient(app, base_url="https://testserver")

    def test_no_secret_and_no_opt_out_refuses_protected_requests(self):
        with env(SHIFTFLOW_SESSION_SECRET=None, SHIFTFLOW_AUTH_DISABLED=None):
            self.assertEqual(self.client.get("/api/employees").status_code, 503)
            self.assertEqual(self.client.post("/api/employees", json={"name": "Anon"}).status_code, 503)
            signup = self.client.post(
                "/api/auth/signup", json={"email": unique_email("nosecret"), "password": "correcthorse"}
            )
            self.assertEqual(signup.status_code, 503)
            self.assertEqual(self.client.get("/health").status_code, 200)

    def test_no_secret_and_no_opt_out_refuses_to_start(self):
        with env(SHIFTFLOW_SESSION_SECRET=None, SHIFTFLOW_AUTH_DISABLED=None):
            with self.assertRaises(RuntimeError):
                auth.validate_auth_config()

    def test_explicit_opt_out_runs_without_login(self):
        with env(SHIFTFLOW_SESSION_SECRET=None, SHIFTFLOW_AUTH_DISABLED="1"):
            auth.validate_auth_config()
            self.assertEqual(self.client.get("/api/employees").status_code, 200)
            self.assertEqual(self.client.get("/api/auth/status").json()["login_required"], False)

    def test_opt_out_flag_set_to_false_does_not_opt_out(self):
        with env(SHIFTFLOW_SESSION_SECRET=None, SHIFTFLOW_AUTH_DISABLED="false"):
            self.assertTrue(auth.login_enabled())
            self.assertEqual(self.client.get("/api/employees").status_code, 503)

    def test_weak_secrets_are_refused_at_startup(self):
        for weak in ("short", "x" * 31, "change-me-to-a-long-random-value-at-least-32-chars"):
            with env(SHIFTFLOW_SESSION_SECRET=weak, SHIFTFLOW_AUTH_DISABLED=None):
                with self.assertRaises(RuntimeError, msg=weak):
                    auth.validate_auth_config()

    def test_strong_secret_is_accepted_at_startup(self):
        with env(SHIFTFLOW_SESSION_SECRET="k" * 48, SHIFTFLOW_AUTH_DISABLED=None):
            auth.validate_auth_config()

    def test_forged_cookie_with_empty_secret_is_not_accepted(self):
        """An empty signing key must never be usable to mint a valid session."""
        with env(SHIFTFLOW_SESSION_SECRET=None, SHIFTFLOW_AUTH_DISABLED=None):
            self.assertIsNone(auth.session_user_id("USR-FAKE.9999999999.deadbeef"))


class LoginHardeningTests(unittest.TestCase):
    def setUp(self):
        patcher = mock.patch.dict(os.environ, {"SHIFTFLOW_SESSION_SECRET": "h" * 48})
        patcher.start()
        self.addCleanup(patcher.stop)
        self.client = TestClient(app, base_url="https://testserver")

    def _signup(self, label="user"):
        email = unique_email(label)
        response = self.client.post("/api/auth/signup", json={"email": email, "password": "correcthorse"})
        self.assertEqual(response.status_code, 200)
        self.client.post("/api/auth/logout")
        return email

    def test_repeated_wrong_passwords_lock_the_email_even_for_the_right_password(self):
        email = self._signup("throttle")
        for _ in range(auth.LOGIN_MAX_FAILURES):
            bad = self.client.post("/api/auth/login", json={"email": email, "password": "wrong"})
            self.assertEqual(bad.status_code, 401)

        locked = self.client.post("/api/auth/login", json={"email": email, "password": "correcthorse"})
        self.assertEqual(locked.status_code, 429)
        self.assertEqual(locked.headers.get("retry-after"), str(auth.LOGIN_WINDOW_SECONDS))

    def test_throttle_is_per_email(self):
        locked_email = self._signup("locked")
        other_email = self._signup("other")
        for _ in range(auth.LOGIN_MAX_FAILURES):
            self.client.post("/api/auth/login", json={"email": locked_email, "password": "wrong"})

        other = self.client.post("/api/auth/login", json={"email": other_email, "password": "correcthorse"})
        self.assertEqual(other.status_code, 200)

    def test_successful_login_resets_the_failure_count(self):
        email = self._signup("reset")
        for _ in range(auth.LOGIN_MAX_FAILURES - 1):
            self.client.post("/api/auth/login", json={"email": email, "password": "wrong"})
        ok = self.client.post("/api/auth/login", json={"email": email, "password": "correcthorse"})
        self.assertEqual(ok.status_code, 200)
        self.client.post("/api/auth/logout")

        for _ in range(auth.LOGIN_MAX_FAILURES - 1):
            again = self.client.post("/api/auth/login", json={"email": email, "password": "wrong"})
            self.assertEqual(again.status_code, 401)

    def test_unknown_email_is_rejected_like_a_wrong_password(self):
        response = self.client.post(
            "/api/auth/login", json={"email": unique_email("ghost"), "password": "whatever1"}
        )
        self.assertEqual(response.status_code, 401)
        self.assertEqual(response.json()["detail"], "Incorrect email or password.")

    def test_session_of_a_deleted_user_stops_working(self):
        email = unique_email("deleted")
        self.client.post("/api/auth/signup", json={"email": email, "password": "correcthorse"})
        self.assertEqual(self.client.get("/api/employees").status_code, 200)

        conn = get_db_connection()
        try:
            conn.execute("DELETE FROM users WHERE email = ?", (email,))
            conn.commit()
        finally:
            conn.close()

        self.assertEqual(self.client.get("/api/employees").status_code, 401)
        self.assertEqual(self.client.get("/api/auth/status").json()["logged_in"], False)

    def test_tampered_cookie_signature_is_rejected(self):
        """Flipping one character of a real, valid session cookie's signature (or of
        anything else it signs) must not be accepted - the HMAC must not be forgeable
        or bypassable by partial tampering."""
        email = unique_email("tamper")
        client = TestClient(app, base_url="https://testserver")
        self.assertEqual(
            client.post("/api/auth/signup", json={"email": email, "password": "correcthorse"}).status_code, 200
        )
        real_cookie = client.cookies.get("shiftflow_session")
        self.assertIsNotNone(real_cookie)

        # Flip the last character of the signature.
        tampered = real_cookie[:-1] + ("0" if real_cookie[-1] != "0" else "1")
        attacker = TestClient(app, base_url="https://testserver")
        attacker.cookies.set("shiftflow_session", tampered)
        self.assertEqual(attacker.get("/api/employees").status_code, 401)

        # A cookie naming a user id that was never issued one, with a garbage signature.
        forged = "USR-DOESNOTEXIST.9999999999.0000000000000000.deadbeef" * 1
        attacker2 = TestClient(app, base_url="https://testserver")
        attacker2.cookies.set("shiftflow_session", forged)
        self.assertEqual(attacker2.get("/api/employees").status_code, 401)

        # The real cookie, untouched, still works.
        self.assertEqual(client.get("/api/employees").status_code, 200)

    def test_signup_can_be_closed(self):
        with env(SHIFTFLOW_ALLOW_SIGNUP="false"):
            closed = self.client.post(
                "/api/auth/signup", json={"email": unique_email("closed"), "password": "correcthorse"}
            )
            self.assertEqual(closed.status_code, 403)
            self.assertEqual(self.client.get("/api/auth/status").json()["signup_allowed"], False)

    def test_session_cookie_is_secure_unless_explicitly_relaxed(self):
        secure = self.client.post(
            "/api/auth/signup", json={"email": unique_email("secure"), "password": "correcthorse"}
        )
        self.assertIn("Secure", secure.headers["set-cookie"])
        self.assertIn("HttpOnly", secure.headers["set-cookie"])

        with env(SHIFTFLOW_COOKIE_SECURE="false"):
            relaxed = self.client.post(
                "/api/auth/signup", json={"email": unique_email("relaxed"), "password": "correcthorse"}
            )
            self.assertNotIn("Secure", relaxed.headers["set-cookie"])
            self.assertIn("HttpOnly", relaxed.headers["set-cookie"])

    def test_x_api_key_header_is_not_an_authentication_method(self):
        """The old X-API-Key scheme is gone: sending it grants nothing."""
        anonymous = TestClient(app, base_url="https://testserver")
        response = anonymous.get("/api/employees", headers={"X-API-Key": "anything"})
        self.assertEqual(response.status_code, 401)


if __name__ == "__main__":
    unittest.main()
