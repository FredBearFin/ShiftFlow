"""Unit tests for Idempotency-Key replay, request-hash comparison, and lock recovery.

Verifies:
1. Same Idempotency-Key and same body replays the stored response.
2. Same Idempotency-Key with a different body is rejected with 422.
3. A key still held by a request that never finished is reclaimed once its in-flight
   lease runs out, instead of returning 409 until the 24-hour record TTL.
"""

import time
import unittest
from fastapi.testclient import TestClient


from app.database import get_db_connection, init_db
from app.main import app
from app.middleware import IN_FLIGHT_LEASE_SECONDS, IdempotencyStore


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


class TestOrphanedInFlightLockRecovery(unittest.TestCase):
    """A request killed mid-flight must not lock its key out for the record's whole TTL.

    Before this, start_request wrote in_flight = 1 with a 24-hour expiry and only
    complete_request or clear_failed_request ever cleared it. A process killed between
    those two points left the row in flight, so every retry of that key got 409 for a
    full day. These tests pin the lease that fixes it.
    """

    @classmethod
    def setUpClass(cls):
        init_db()
        cls.client = TestClient(app)

    def setUp(self):
        IdempotencyStore.clear_all()

    def _age_the_lock(self, key: str, seconds_ago: float) -> None:
        """Backdates the in-flight lease, standing in for a process killed that long ago."""
        conn = get_db_connection()
        try:
            conn.execute(
                "UPDATE idempotency_records SET in_flight_expires_at = ? WHERE key = ?",
                (time.time() - seconds_ago, key),
            )
            conn.commit()
        finally:
            conn.close()

    def _start(self, key: str) -> bool:
        return IdempotencyStore.start_request(
            key=key, method="POST", path="/api/handover/task", request_hash="hash-abc"
        )

    def test_01_a_live_in_flight_lock_is_still_respected(self):
        """The fix must not turn a genuine concurrent duplicate into a double mutation."""
        key = "IDEM-LEASE-LIVE-001"
        self.assertTrue(self._start(key))
        record = IdempotencyStore.get_record(key)
        self.assertEqual(record["in_flight"], 1)
        self.assertIsNotNone(record["in_flight_expires_at"])
        self.assertGreater(record["in_flight_expires_at"], time.time())
        self.assertFalse(self._start(key), "a live lock must still refuse a second holder")

    def test_02_an_expired_lease_is_reclaimed_on_lookup(self):
        """get_record must drop the orphan rather than report it as still executing."""
        key = "IDEM-LEASE-ORPHAN-002"
        self.assertTrue(self._start(key))
        self._age_the_lock(key, 1.0)
        self.assertIsNone(
            IdempotencyStore.get_record(key),
            "an orphaned lock must not be reported as an in-flight record",
        )

    def test_03_an_expired_lease_is_taken_over_by_a_retry(self):
        key = "IDEM-LEASE-ORPHAN-003"
        self.assertTrue(self._start(key))
        self._age_the_lock(key, 1.0)
        self.assertTrue(self._start(key), "a retry must be able to take over an orphaned lock")
        record = IdempotencyStore.get_record(key)
        self.assertEqual(record["in_flight"], 1)
        self.assertGreater(record["in_flight_expires_at"], time.time())

    def test_04_a_completed_key_is_never_reclaimed(self):
        """A stored response must stay replayable for its full TTL, lease or no lease."""
        key = "IDEM-LEASE-DONE-004"
        self.assertTrue(self._start(key))
        IdempotencyStore.complete_request(
            key=key, status_code=200, response_headers={}, response_body='{"ok":true}'
        )
        record = IdempotencyStore.get_record(key)
        self.assertEqual(record["in_flight"], 0)
        self.assertIsNone(record["in_flight_expires_at"], "completing must release the lease")

        self._age_the_lock(key, 10_000.0)
        record = IdempotencyStore.get_record(key)
        self.assertIsNotNone(record, "a completed record must not be reclaimed as an orphan")
        self.assertEqual(record["response_body"], '{"ok":true}')
        self.assertFalse(self._start(key), "a completed key is not available to take over")

    def test_05_a_row_predating_the_lease_column_is_still_recoverable(self):
        """An orphan written before in_flight_expires_at existed must not be stuck forever."""
        key = "IDEM-LEASE-LEGACY-005"
        self.assertTrue(self._start(key))
        conn = get_db_connection()
        try:
            # NULL lease, and a record start time well past the lease window: this is what
            # an upgraded database looks like.
            conn.execute(
                "UPDATE idempotency_records SET in_flight_expires_at = NULL, expires_at = ? WHERE key = ?",
                (time.time() + 86400 - (IN_FLIGHT_LEASE_SECONDS + 60), key),
            )
            conn.commit()
        finally:
            conn.close()
        self.assertIsNone(IdempotencyStore.get_record(key))
        self.assertTrue(self._start(key))

    def test_06_the_whole_cycle_through_the_http_middleware(self):
        """End to end: 409 while held, then the retry succeeds once the lease lapses."""
        key = "IDEM-LEASE-HTTP-006"
        headers = {"Idempotency-Key": key}
        payload = {
            "checklist_type": "morning_to_midday",
            "category": "Safety",
            "task": "Check ice merchandiser",
            "responsible_shift": "Morning Shift",
        }

        # Stand in for a request that got as far as taking the lock and then died.
        self.assertTrue(
            IdempotencyStore.start_request(
                key=key, method="POST", path="/api/handover/task", request_hash="does-not-match"
            )
        )
        held = self.client.post("/api/handover/task", json=payload, headers=headers)
        self.assertEqual(held.status_code, 422, "a live lock with a different body is a mismatch")

        self._age_the_lock(key, 1.0)
        recovered = self.client.post("/api/handover/task", json=payload, headers=headers)
        self.assertEqual(
            recovered.status_code,
            200,
            "once the lease lapses the retry must run, not keep getting 409/422",
        )
        self.assertEqual(recovered.headers.get("X-Cache-Lookup"), "MISS-STORED")

        replay = self.client.post("/api/handover/task", json=payload, headers=headers)
        self.assertEqual(replay.status_code, 200)
        self.assertEqual(replay.headers.get("X-Cache-Lookup"), "HIT-IDEMPOTENT")


if __name__ == "__main__":
    unittest.main()
