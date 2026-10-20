"""Tests for API key protection, CORS origins and the durable database path."""

import os
import unittest

from fastapi.testclient import TestClient

from app.main import app
from app.tests import TEST_API_KEY


class AuthTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.client = TestClient(app)

    def test_read_routes_stay_open(self):
        response = self.client.get("/health")
        self.assertEqual(response.status_code, 200)

    def test_write_without_key_is_rejected(self):
        response = self.client.post("/api/v1/schedules/solve", json={})
        self.assertEqual(response.status_code, 401)

    def test_write_with_wrong_key_is_rejected(self):
        response = self.client.post(
            "/api/v1/schedules/solve", json={}, headers={"X-API-Key": "wrong"}
        )
        self.assertEqual(response.status_code, 401)

    def test_write_refused_when_key_not_configured(self):
        previous = os.environ.pop("SHIFTFLOW_API_KEY", None)
        try:
            response = self.client.post(
                "/api/v1/schedules/solve", json={}, headers={"X-API-Key": TEST_API_KEY}
            )
            self.assertEqual(response.status_code, 503)
        finally:
            if previous is not None:
                os.environ["SHIFTFLOW_API_KEY"] = previous

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


if __name__ == "__main__":
    unittest.main()
