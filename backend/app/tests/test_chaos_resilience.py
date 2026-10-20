"""Chaos Engineering & Site Reliability (SRE) Failure Recovery Tests.

Tests:
1. Database Disconnects & Auto-Reconnect Retry with Exponential Backoff.
2. Circuit Breaker Protection against Database Pool Starvation.
3. Worker Node Crashes during Solver Runs & Graceful Eulerian Master-Cycle Fallback.
4. Orphan Mutation Lock Recovery after Unexpected Client/Worker Termination.
"""

import sqlite3
import unittest
from unittest.mock import MagicMock, patch

import app.resilience as resilience
from app.api.archetype_routes import ARCHETYPE_PRESETS
from app.engine.isd_rwsp_solver import ISDRWSPSolver
from app.middleware import IdempotencyStore
from app.resilience import (
    CircuitBreaker,
    CircuitBreakerOpenException,
    db_circuit_breaker,
    safe_solve_with_fallback,
    with_db_retry,
)
from app.schemas import SolveRequestSchema


class TestChaosResilience(unittest.TestCase):
    """Chaos and fault injection test suite verifying high-availability recovery."""

    def setUp(self):
        db_circuit_breaker.reset()
        IdempotencyStore.clear_all()

    def test_01_database_disconnect_and_exponential_retry(self):
        """Verify transient database disconnects/locks automatically retry and recover."""
        attempts = 0

        @with_db_retry(max_retries=3, initial_delay=0.01, backoff_factor=1.5)
        def flaky_db_query():
            nonlocal attempts
            attempts += 1
            if attempts < 3:
                # Simulate transient connection lock
                raise sqlite3.OperationalError("database is locked")
            return {"status": "recovered", "attempts": attempts}

        result = flaky_db_query()
        self.assertEqual(result["status"], "recovered")
        self.assertEqual(result["attempts"], 3)
        self.assertEqual(attempts, 3)

    def test_02_circuit_breaker_trips_and_recovers(self):
        """Verify circuit breaker opens under repeated failures and recovers after timeout."""
        # Injected clock: the breaker reads time only through resilience.time.time,
        # so the recovery window is advanced by a fixed step, not by sleeping.
        clock = {"now": 1000.0}
        fake_time = MagicMock()
        fake_time.time.side_effect = lambda: clock["now"]

        with patch.object(resilience, "time", fake_time):
            cb = CircuitBreaker(failure_threshold=3, recovery_timeout_sec=0.2)
            self.assertEqual(cb.state, "CLOSED")

            # 3 failures trip the breaker
            cb.record_failure()
            cb.record_failure()
            self.assertEqual(cb.state, "CLOSED")
            cb.record_failure()
            self.assertEqual(cb.state, "OPEN")
            self.assertFalse(cb.can_execute())
            self.assertEqual(cb.state, "OPEN")

            # Advance the injected clock past the recovery window to enter HALF_OPEN
            clock["now"] += 0.25
            self.assertTrue(cb.can_execute())
            self.assertEqual(cb.state, "HALF_OPEN")

            # Success resets to CLOSED
            cb.record_success()
            self.assertEqual(cb.state, "CLOSED")
            self.assertEqual(cb.failure_count, 0)

    def test_03_solver_crash_and_watchdog_master_cycle_fallback(self):
        """Verify worker crash mid-solve gracefully falls back to Eulerian master cycle."""
        preset = ARCHETYPE_PRESETS["downtown_foodmart_omaha"]
        req = SolveRequestSchema(
            archetype_id=preset.id,
            facility_name=preset.name,
            demand_matrix=preset.demand_matrix,
            templates=preset.templates,
            guardrails=preset.guardrails,
            pareto_leeway_pct=10.0,
        )

        def crashing_solver():
            # Simulate worker node out-of-memory or SIGKILL mid-solve
            raise RuntimeError("SIGKILL: Worker node memory limit exceeded during branch-and-cut")

        def eulerian_fallback():
            # Return pre-computed baseline schedule
            solver = ISDRWSPSolver(req)
            return solver.solve()

        sol, used_fallback = safe_solve_with_fallback(crashing_solver, eulerian_fallback)
        self.assertTrue(used_fallback)
        self.assertIsNotNone(sol)
        self.assertEqual(len(sol.roster_lines), 11)
        self.assertTrue(sol.eulerian_valid)

    def test_04_orphan_lock_cleanup_after_interrupted_mutation(self):
        """Verify orphan locks from interrupted mutations are cleanly cleared without deadlocks."""
        key = "IDEM-CHAOS-ORPHAN-001"
        started = IdempotencyStore.start_request(
            key=key,
            method="POST",
            path="/api/emergency/callout-replacement",
            request_hash="hash123",
        )
        self.assertTrue(started)

        # In-flight lock exists; concurrent request rejected
        record = IdempotencyStore.get_record(key)
        self.assertEqual(record["in_flight"], 1)

        # Simulate process crash: clear orphan lock
        IdempotencyStore.clear_failed_request(key)

        # Immediate retry should succeed without deadlocks
        re_started = IdempotencyStore.start_request(
            key=key,
            method="POST",
            path="/api/emergency/callout-replacement",
            request_hash="hash123",
        )
        self.assertTrue(re_started)


if __name__ == "__main__":
    unittest.main()
