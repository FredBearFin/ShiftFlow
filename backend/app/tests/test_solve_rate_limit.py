"""Unit tests for SolveConcurrencyLimitMiddleware (app/middleware.py).

Security audit background: a single authenticated account firing ~30
concurrent /solve requests was measured driving a normally ~0.1s solve up to
~3.6s each, and slowing an unrelated /health check (issued mid-storm) to
~3.7s versus ~3ms idle - i.e. one account could starve the shared solver
threadpool and degrade every other tenant, with nothing in app/middleware.py
or app/resilience.py previously bounding solver request concurrency.

These tests pin the caller identity (patching _caller_key) so the limiter's
own bookkeeping can be driven deterministically, without depending on how
fast the real solver happens to run or on TestClient's transport internals.
"""

import unittest
from unittest.mock import patch

from fastapi.testclient import TestClient

from app.api.archetype_routes import ARCHETYPE_PRESETS
from app.database import init_db
from app.main import app
from app.middleware import SolveConcurrencyLimitMiddleware


def _solve_payload() -> dict:
    preset = ARCHETYPE_PRESETS["downtown_foodmart_omaha"]
    return {
        "archetype_id": preset.id,
        "facility_name": preset.name,
        "demand_matrix": preset.demand_matrix,
        "templates": [t.model_dump() for t in preset.templates],
        "guardrails": preset.guardrails.model_dump(),
        "pareto_leeway_pct": 10.0,
    }


class TestSolveConcurrencyLimit(unittest.TestCase):
    """A caller already at the concurrent-solve limit gets 429, not a solve."""

    @classmethod
    def setUpClass(cls):
        init_db()
        cls.client = TestClient(app)
        cls._key_patch = patch.object(
            SolveConcurrencyLimitMiddleware, "_caller_key", classmethod(lambda cls, request: "test-caller")
        )
        cls._key_patch.start()

    @classmethod
    def tearDownClass(cls):
        cls._key_patch.stop()

    def setUp(self):
        SolveConcurrencyLimitMiddleware.clear_all()

    def tearDown(self):
        SolveConcurrencyLimitMiddleware.clear_all()

    def test_request_allowed_under_the_limit(self):
        """One in-flight slot free (limit is 2, 1 already counted) still solves."""
        SolveConcurrencyLimitMiddleware._in_flight["test-caller"] = 1
        resp = self.client.post("/api/v1/schedules/solve", json=_solve_payload())
        self.assertEqual(resp.status_code, 200)
        # Bookkeeping is released back to its pre-request count, not leaked.
        self.assertEqual(SolveConcurrencyLimitMiddleware._in_flight.get("test-caller", 0), 1)

    def test_request_blocked_at_the_limit(self):
        """Two already in flight (the default limit) gets a 429, no solve attempted."""
        SolveConcurrencyLimitMiddleware._in_flight["test-caller"] = 2
        resp = self.client.post("/api/v1/schedules/solve", json=_solve_payload())
        self.assertEqual(resp.status_code, 429)
        self.assertEqual(resp.json()["error"], "TooManyConcurrentSolveRequests")
        self.assertIn("Retry-After", resp.headers)
        # The blocked attempt must not have perturbed the counter it read.
        self.assertEqual(SolveConcurrencyLimitMiddleware._in_flight.get("test-caller"), 2)

    def test_limit_is_scoped_to_solver_paths_only(self):
        """An unrelated route is never throttled by this middleware, however high the count."""
        SolveConcurrencyLimitMiddleware._in_flight["test-caller"] = 999
        resp = self.client.get("/health")
        self.assertEqual(resp.status_code, 200)

    def test_default_solution_and_pareto_frontier_are_covered_too(self):
        """The limiter also applies to /default-solution/* and /pareto-frontier, not just /solve."""
        SolveConcurrencyLimitMiddleware._in_flight["test-caller"] = 2
        resp = self.client.post("/api/v1/schedules/pareto-frontier", json=_solve_payload())
        self.assertEqual(resp.status_code, 429)


class TestSecurityHeaders(unittest.TestCase):
    """Baseline security headers (see SecurityHeadersMiddleware) are present on real responses."""

    @classmethod
    def setUpClass(cls):
        init_db()
        cls.client = TestClient(app)

    def test_clickjacking_and_mime_sniffing_headers_present(self):
        resp = self.client.get("/health")
        self.assertEqual(resp.headers.get("x-frame-options"), "DENY")
        self.assertEqual(resp.headers.get("x-content-type-options"), "nosniff")
        self.assertIn("frame-ancestors 'none'", resp.headers.get("content-security-policy", ""))
        self.assertEqual(resp.headers.get("referrer-policy"), "strict-origin-when-cross-origin")


if __name__ == "__main__":
    unittest.main()
