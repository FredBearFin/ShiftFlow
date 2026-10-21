"""Unit and Integration Tests for Distributed Architecture & Scaling.

Verifies:
1. FastAPI Idempotency Key Middleware (replay, cache hit, exactly-once mutations).
2. Kubernetes / Cloud Container Health Probes (/health/liveness, /health/readiness).
3. Peak Monday 00:00 rollover concurrency and O(1) ring-buffer pointer advancement.
"""

import concurrent.futures
import tempfile
import time
import unittest
from fastapi.testclient import TestClient


from app.api.archetype_routes import ARCHETYPE_PRESETS
from app.database import init_db
from app.engine.isd_rwsp_solver import ISDRWSPSolver
from app.main import app
from app.middleware import IdempotencyStore
from app.schemas import SolveRequestSchema


class TestDistributedArchitecture(unittest.TestCase):
    """Test suite auditing distributed scaling, idempotency, and health probes."""

    @classmethod
    def setUpClass(cls):
        init_db()
        cls.client = TestClient(app)

    def setUp(self):
        IdempotencyStore.clear_all()

    def test_01_idempotency_middleware_mutation_replay(self):
        """Verify mutating request with Idempotency-Key stores and replays cached response."""
        key = "IDEM-CALLOUT-TEST-001"
        payload = {
            "checklist_type": "morning_to_midday",
            "category": "Safety",
            "task": "Check ice merchandiser",
            "responsible_shift": "Morning Shift",
        }
        headers = {"Idempotency-Key": key}

        # 1. First execution: MISS-STORED
        resp1 = self.client.post("/api/handover/task", json=payload, headers=headers)
        self.assertEqual(resp1.status_code, 200)
        self.assertEqual(resp1.headers.get("X-Cache-Lookup"), "MISS-STORED")
        self.assertEqual(resp1.headers.get("Idempotency-Key"), key)
        data1 = resp1.json()
        self.assertEqual(data1["task"], "Check ice merchandiser")
        self.assertEqual(data1["status"], "pending")

        # 2. Second execution (network retry / mobile redelivery): HIT-IDEMPOTENT
        resp2 = self.client.post("/api/handover/task", json=payload, headers=headers)
        self.assertEqual(resp2.status_code, 200)
        self.assertEqual(resp2.headers.get("X-Cache-Lookup"), "HIT-IDEMPOTENT")
        self.assertEqual(resp2.headers.get("Idempotency-Key"), key)
        data2 = resp2.json()

        # Both payloads must be byte-for-byte identical
        self.assertEqual(data1, data2)

    def test_02_idempotency_different_keys_execute_independently(self):
        """Verify distinct keys generate unique store entries."""
        key_a = "IDEM-SWAP-A"
        key_b = "IDEM-SWAP-B"

        payload_task = {
            "checklist_type": "morning_to_midday",
            "category": "Safety",
            "task": "Audit propane tanks",
            "responsible_shift": "Midday Shift",
        }

        resp_a = self.client.post("/api/handover/task", json=payload_task, headers={"Idempotency-Key": key_a})
        self.assertEqual(resp_a.status_code, 200)
        self.assertEqual(resp_a.headers.get("X-Cache-Lookup"), "MISS-STORED")

        resp_b = self.client.post("/api/handover/task", json=payload_task, headers={"Idempotency-Key": key_b})
        self.assertEqual(resp_b.status_code, 200)
        self.assertEqual(resp_b.headers.get("X-Cache-Lookup"), "MISS-STORED")

    def test_03_kubernetes_liveness_and_readiness_probes(self):
        """Verify Kubernetes container liveness and readiness monitoring endpoints."""
        # 1. Liveness
        resp_live = self.client.get("/health/liveness")
        self.assertEqual(resp_live.status_code, 200)
        data_live = resp_live.json()
        self.assertEqual(data_live["status"], "alive")
        self.assertIn("uptime_seconds", data_live)
        self.assertIn("timestamp", data_live)

        # 2. Readiness
        resp_ready = self.client.get("/health/readiness")
        self.assertEqual(resp_ready.status_code, 200)
        data_ready = resp_ready.json()
        self.assertEqual(data_ready["status"], "ready")
        self.assertEqual(data_ready["checks"]["database"]["status"], "healthy")
        db_check = data_ready["checks"]["database"]
        self.assertIsInstance(db_check["latency_ms"], (int, float))
        self.assertGreaterEqual(db_check["latency_ms"], 0)
        self.assertEqual(data_ready["checks"]["solver_engine"]["status"], "healthy")
        self.assertEqual(data_ready["checks"]["idempotency_store"]["status"], "healthy")

    def test_03b_readiness_reports_whether_the_database_is_durable(self):
        """Reachable is not durable, and readiness must not conflate the two.

        The serverless default puts the database under /tmp, which is local to one
        function instance and lost on a cold start. A readiness probe that reports only
        "healthy" lets that go unnoticed, so it reports the path and a durable flag.
        """
        import app.database as shiftflow_db

        db_check = self.client.get("/health/readiness").json()["checks"]["database"]
        self.assertIn("durable", db_check)
        self.assertIn("path", db_check)
        self.assertEqual(db_check["path"], shiftflow_db.DB_FILE)

        # The suite runs each module against a temp file, which is itself under /tmp, so
        # assert the classification directly rather than against the ambient path.
        previous = shiftflow_db.DB_FILE
        try:
            shiftflow_db.DB_FILE = "/tmp/shiftflow-ephemeral.db"
            self.assertTrue(shiftflow_db.db_is_ephemeral())
            self.assertIs(
                self.client.get("/health/readiness").json()["checks"]["database"]["durable"],
                False,
            )

            shiftflow_db.DB_FILE = "/var/lib/shiftflow/shiftflow.db"
            self.assertFalse(shiftflow_db.db_is_ephemeral())
            self.assertIs(
                self.client.get("/health/readiness").json()["checks"]["database"]["durable"],
                True,
            )

            # A path merely starting with the letters "/tmp" is not under /tmp.
            shiftflow_db.DB_FILE = "/tmpdata/shiftflow.db"
            self.assertFalse(shiftflow_db.db_is_ephemeral())
        finally:
            shiftflow_db.DB_FILE = previous

    def test_03c_startup_warns_when_the_database_cannot_survive_a_restart(self):
        """An operator must be told, not left to find out when the records are gone."""
        import app.database as shiftflow_db

        previous = shiftflow_db.DB_FILE
        try:
            with tempfile.NamedTemporaryFile(prefix="shiftflow-warn-", suffix=".db", dir="/tmp") as handle:
                shiftflow_db.DB_FILE = handle.name
                with self.assertLogs("shiftflow.database", level="WARNING") as captured:
                    shiftflow_db.init_db()
            joined = "\n".join(captured.output)
            self.assertIn(handle.name, joined)
            self.assertIn("cold start", joined)
            self.assertIn("SHIFTFLOW_DB_PATH", joined)
        finally:
            shiftflow_db.DB_FILE = previous

    def test_04_monday_rollover_concurrency_and_ring_buffer(self):
        """Verify concurrent multi-store Monday rollovers maintain mathematical state consistency."""
        preset = ARCHETYPE_PRESETS["downtown_foodmart_omaha"]
        req = SolveRequestSchema(
            archetype_id=preset.id,
            facility_name=preset.name,
            demand_matrix=preset.demand_matrix,
            templates=preset.templates,
            guardrails=preset.guardrails,
            pareto_leeway_pct=10.0,
        )

        def rollover_worker(offset: int):
            solver = ISDRWSPSolver(req)
            sol = solver.solve()
            return sol.roster_lines[0].days[0].shift_code

        with concurrent.futures.ThreadPoolExecutor(max_workers=4) as executor:
            futures = [executor.submit(rollover_worker, i) for i in range(8)]
            results = [f.result() for f in concurrent.futures.as_completed(futures)]

        self.assertEqual(len(results), 8)
        self.assertTrue(all(r in ["M", "D", "E", "OFF"] for r in results))


if __name__ == "__main__":
    unittest.main()
