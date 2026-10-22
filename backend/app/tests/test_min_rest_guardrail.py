"""Configurable minimum rest: schema bounds, generator behavior and audit reporting."""

import unittest

from fastapi.testclient import TestClient
from pydantic import ValidationError

from app.api.archetype_routes import _build_24_7_demand
from app.engine.isd_rwsp_solver import ISDRWSPSolver, SolverInfeasibleError
from app.main import app
from app.schemas import ErgonomicGuardrailsSchema, ShiftTemplateSchema, SolveRequestSchema


def _template(code, earliest_start, latest_end, duration, preferred_start):
    return ShiftTemplateSchema(
        code=code,
        name=code,
        earliest_start=earliest_start,
        latest_end=latest_end,
        min_duration=duration,
        max_duration=duration,
        preferred_start=preferred_start,
        preferred_duration=duration,
    )


DAY_NIGHT_12H = [_template("D", 6, 20, 12, 7), _template("N", 18, 31, 12, 19)]
MORNING_EVENING = [_template("M", 6, 14, 8, 6), _template("E", 12, 20, 6, 12)]


def _solve(templates, **guardrails):
    req = SolveRequestSchema(
        archetype_id="custom",
        facility_name="Min rest test",
        demand_matrix=_build_24_7_demand(4, 4, 4, 4, 0),
        templates=templates,
        guardrails=ErgonomicGuardrailsSchema(**guardrails),
        pareto_leeway_pct=0.0,
    )
    return ISDRWSPSolver(req, include_pareto_frontier=False).solve()


class MinRestGuardrailTests(unittest.TestCase):
    def test_default_guardrail_is_16_and_enabled(self):
        """A fresh guardrail object keeps the previous behavior: 16 hours, rule on."""
        g = ErgonomicGuardrailsSchema()
        self.assertEqual(g.min_rest_hours, 16)
        self.assertTrue(g.enforce_zero_clopening)

    def test_schema_bounds(self):
        """The minimum rest accepts 8 to 24 hours and nothing outside that range."""
        for bad in (7, 25):
            with self.subTest(value=bad), self.assertRaises(ValidationError):
                ErgonomicGuardrailsSchema(min_rest_hours=bad)
        for good in (8, 24):
            with self.subTest(value=good):
                self.assertEqual(ErgonomicGuardrailsSchema(min_rest_hours=good).min_rest_hours, good)

    def test_12h_day_night_infeasible_at_16(self):
        """Repeating a 12-hour shift gives 12 hours of rest, which a 16-hour minimum rejects."""
        with self.assertRaises(SolverInfeasibleError):
            _solve(DAY_NIGHT_12H)

    def test_12h_day_night_solves_at_11(self):
        """With an 11-hour minimum the 12-hour day/night pair solves with no short gaps."""
        sol = _solve(DAY_NIGHT_12H, min_rest_hours=11)
        self.assertEqual(sol.ergonomics_audit.clopening_violations, 0)
        self.assertGreaterEqual(sol.ergonomics_audit.min_rest_hours_observed, 11)

    def test_toggle_off_allows_short_rest_but_flags_it(self):
        """With the rule off and a 16-hour minimum, the 12-hour pair solves and the audit counts the short gaps."""
        sol = _solve(DAY_NIGHT_12H, min_rest_hours=16, enforce_zero_clopening=False)
        self.assertGreater(sol.ergonomics_audit.clopening_violations, 0)
        self.assertLess(sol.ergonomics_audit.min_rest_hours_observed, 16)

    def test_audit_reports_required_rest(self):
        """The audit echoes the minimum rest it was checked against."""
        sol = _solve(DAY_NIGHT_12H, min_rest_hours=11)
        self.assertEqual(sol.ergonomics_audit.min_rest_hours_required, 11)

    def test_wrap_check_is_hours_based(self):
        """An evening shift followed by a morning shift is allowed when the hours of rest are enough.

        E here runs 12:00 to 18:00 and M starts at 06:00, which is 12 hours of rest, so an
        11-hour minimum must not trigger the old "closing shift followed by an opening shift" error.
        """
        sol = _solve(MORNING_EVENING, min_rest_hours=11)
        self.assertEqual(sol.ergonomics_audit.clopening_violations, 0)
        self.assertGreaterEqual(sol.ergonomics_audit.min_rest_hours_observed, 11)

    def test_wrap_check_still_rejects_short_gaps(self):
        """Whatever the generator returns with the rule on never has a gap under the minimum."""
        for minimum in (8, 12, 16):
            with self.subTest(minimum=minimum):
                try:
                    sol = _solve(MORNING_EVENING, min_rest_hours=minimum)
                except SolverInfeasibleError:
                    continue
                self.assertGreaterEqual(sol.ergonomics_audit.min_rest_hours_observed, minimum)

    def test_health_endpoint_reports_default(self):
        """/health reports the default minimum rest as a default, not as a guarantee."""
        body = TestClient(app).get("/health").json()
        self.assertEqual(body["default_min_rest_hours"], 16.0)
        self.assertTrue(body["clopening_forbidden_by_default"])


if __name__ == "__main__":
    unittest.main()
