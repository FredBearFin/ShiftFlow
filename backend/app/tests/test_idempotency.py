"""Unit tests for Idempotency-Key replay and request-hash comparison.

Verifies:
1. Same Idempotency-Key and same body replays the stored response.
2. Same Idempotency-Key with a different body is rejected with 422.
"""

import unittest
from fastapi.testclient import TestClient


from app.database import init_db
from app.main import app
from app.middleware import IdempotencyStore


class TestIdempotency(unittest.TestCase):
    """Replay and mismatch behaviour of the idempotency middleware."""

    @classmethod
    def setUpClass(cls):
        init_db()
        cls.client = TestClient(app)

    def setUp(self):
        IdempotencyStore.clear_all()

    def _payload(self, task: str) -> dict:
        return {
            "checklist_type": "morning_to_midday",
            "category": "Safety",
            "task": task,
            "responsible_shift": "Morning Shift",
        }

    def test_01_same_key_same_body_replays_response(self):
        """A retry with the same key and body returns the stored response."""
        key = "IDEM-PR1-REPLAY-001"
        headers = {"Idempotency-Key": key}
        payload = self._payload("Check ice merchandiser")

        resp1 = self.client.post("/api/handover/task", json=payload, headers=headers)
        self.assertEqual(resp1.status_code, 200)
        self.assertEqual(resp1.headers.get("X-Cache-Lookup"), "MISS-STORED")

        resp2 = self.client.post("/api/handover/task", json=payload, headers=headers)
        self.assertEqual(resp2.status_code, 200)
        self.assertEqual(resp2.headers.get("X-Cache-Lookup"), "HIT-IDEMPOTENT")
        self.assertEqual(resp2.json(), resp1.json())

    def test_02_same_key_different_body_returns_422(self):
        """Reusing a key with a different body is rejected instead of replayed."""
        key = "IDEM-PR1-MISMATCH-001"
        headers = {"Idempotency-Key": key}

        resp1 = self.client.post("/api/handover/task", json=self._payload("Check ice merchandiser"), headers=headers)
        self.assertEqual(resp1.status_code, 200)

        resp2 = self.client.post("/api/handover/task", json=self._payload("Clean coffee carafes"), headers=headers)
        self.assertEqual(resp2.status_code, 422)
        self.assertEqual(resp2.json()["error"], "IdempotencyKeyReuseMismatch")
        self.assertIn(key, resp2.json()["detail"])


if __name__ == "__main__":
    unittest.main()
