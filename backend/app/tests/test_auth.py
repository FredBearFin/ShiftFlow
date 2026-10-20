"""Tests for CORS origins, the durable database path, and account login."""

import os
import unittest

from fastapi.testclient import TestClient

from app.main import app


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
    """SHIFTFLOW_SESSION_SECRET turns on real email/password accounts (see app/auth.py)."""

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
        self.assertEqual(response.json(), {"login_required": True, "logged_in": False, "email": None})

    def test_signup_login_logout_roundtrip(self):
        client = TestClient(app, base_url="https://testserver")

        signup = client.post("/api/auth/signup", json={"email": "owner@example.com", "password": "correcthorse"})
        self.assertEqual(signup.status_code, 200)
        self.assertEqual(client.get("/api/auth/status").json()["logged_in"], True)

        dup = client.post("/api/auth/signup", json={"email": "owner@example.com", "password": "correcthorse"})
        self.assertEqual(dup.status_code, 409)

        client.post("/api/auth/logout")
        self.assertEqual(client.get("/api/auth/status").json()["logged_in"], False)

        bad_login = client.post("/api/auth/login", json={"email": "owner@example.com", "password": "wrong"})
        self.assertEqual(bad_login.status_code, 401)

        good_login = client.post("/api/auth/login", json={"email": "owner@example.com", "password": "correcthorse"})
        self.assertEqual(good_login.status_code, 200)
        status = client.get("/api/auth/status").json()
        self.assertEqual(status, {"login_required": True, "logged_in": True, "email": "owner@example.com"})


if __name__ == "__main__":
    unittest.main()
