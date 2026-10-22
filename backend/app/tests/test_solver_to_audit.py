"""Solver output audited by the roster audit engine, and the compare route."""

import unittest

from fastapi.testclient import TestClient

from app.api.archetype_routes import ARCHETYPE_PRESETS
from app.audit_schemas import AUDIT_DISCLAIMER
from app.engine.isd_rwsp_solver import ISDRWSPSolver
from app.engine.roster_audit import audit_roster
from app.engine.rotation_patterns import pattern_to_audit_request
from app.engine.solver_to_audit import PASTE_LIMIT_DAYS, solution_to_audit_request
from app.main import app
from app.schemas import SolveRequestSchema


def solve_request(key, leeway=5.0):
    preset = ARCHETYPE_PRESETS[key]
    return SolveRequestSchema(
        archetype_id=preset.id,
        facility_name=preset.name,
        demand_matrix=preset.demand_matrix,
        templates=preset.templates,
        guardrails=preset.guardrails,
        pareto_leeway_pct=leeway,
    )


def solve(key, leeway=5.0):
    return ISDRWSPSolver(solve_request(key, leeway), include_pareto_frontier=False).solve()


class SolverToAuditTests(unittest.TestCase):
    def test_audit_min_rest_matches_solver_for_every_preset(self):
        """The audit's smallest rest equals the solver's own observed minimum for each preset.

        Both measure the gap between consecutive worked days, and both pair line N day 6 with
        line N+1 day 0, so the two numbers agree.
        """
        for key in ARCHETYPE_PRESETS:
            with self.subTest(preset=key):
                solution = solve(key)
                request, _ = solution_to_audit_request(solution)
                response = audit_roster(request)
                self.assertEqual(
                    response.summary.overall_min_rest_hours,
                    solution.ergonomics_audit.min_rest_hours_observed,
                )

    def test_cycle_length_follows_line_count_and_is_reported(self):
        """The sequence is 7 days per line, and a note says so when it exceeds the pasted-roster limit."""
        for key in ("manufacturing_24_7", "continuous_ops_12h"):
            with self.subTest(preset=key):
                solution = solve(key)
                request, notes = solution_to_audit_request(solution)
                self.assertEqual(request.cycle_days, 7 * len(solution.roster_lines))
                self.assertEqual(len(request.lines), len(solution.roster_lines))
                if request.cycle_days > PASTE_LIMIT_DAYS:
                    self.assertTrue(any(str(PASTE_LIMIT_DAYS) in n for n in notes))

    def test_every_line_sees_the_same_cyclic_sequence(self):
        """People start a week apart on one sequence, so every line has the same rest, streak and hours."""
        request, _ = solution_to_audit_request(solve("manufacturing_24_7"))
        response = audit_roster(request)
        self.assertEqual(len({m.min_rest_hours for m in response.lines}), 1)
        self.assertEqual(len({m.shifts_per_cycle for m in response.lines}), 1)

    def test_generated_coverage_matches_solver_coverage(self):
        """Coverage computed from the adapted request equals the solver's own understaffed and overstaffed hours."""
        solution = solve("manufacturing_24_7")
        preset = ARCHETYPE_PRESETS["manufacturing_24_7"]
        request, _ = solution_to_audit_request(solution, demand_matrix=preset.demand_matrix)
        coverage = audit_roster(request).coverage
        self.assertEqual(
            coverage.understaffed_hours_per_week,
            sum(c.understaffing for c in solution.interval_coverage),
        )
        self.assertEqual(
            coverage.overstaffed_hours_per_week,
            sum(c.overstaffing for c in solution.interval_coverage),
        )


class CompareRouteTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.client = TestClient(app)

    def test_compare_pitman_with_continuous_ops_returns_both_audits(self):
        """Comparing the Pitman pattern with the continuous-operations preset returns two audits and the disclaimer."""
        body = {
            "solve_request": solve_request("continuous_ops_12h").model_dump(),
            "audit_request": pattern_to_audit_request("pitman_2_2_3_12h").model_dump(),
        }
        response = self.client.post("/api/v1/schedules/audit/compare", json=body)
        self.assertEqual(response.status_code, 200, response.text)
        data = response.json()
        self.assertEqual(data["generated"]["disclaimer"], AUDIT_DISCLAIMER)
        self.assertEqual(data["existing"]["disclaimer"], AUDIT_DISCLAIMER)
        self.assertEqual(data["existing"]["summary"]["flag_count"], 0)
        self.assertTrue(data["notes"])
        self.assertIsNotNone(data["existing"]["coverage"])
        self.assertIsNotNone(data["generated"]["coverage"])

    def test_bad_audit_body_is_422(self):
        """An audit request with an unknown shift code is rejected."""
        audit = pattern_to_audit_request("pitman_2_2_3_12h").model_dump()
        audit["lines"][0]["cells"][0] = "ZZ"
        body = {"solve_request": solve_request("continuous_ops_12h").model_dump(), "audit_request": audit}
        self.assertEqual(self.client.post("/api/v1/schedules/audit/compare", json=body).status_code, 422)


if __name__ == "__main__":
    unittest.main()
