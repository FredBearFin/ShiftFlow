"""Contract tests: coverage arithmetic and idempotency conflict handling."""

import hashlib
import json
import unittest

from fastapi.testclient import TestClient

from app.api.archetype_routes import ARCHETYPE_PRESETS
from app.database import get_db_connection, init_db
from app.main import app
from app.middleware import IdempotencyStore
from app.schemas import SolveRequestSchema
from app.engine.isd_rwsp_solver import ISDRWSPSolver, SolverInfeasibleError
from app.tests import TEST_HEADERS


class SolverContractTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        init_db()
        cls.client = TestClient(app, headers=TEST_HEADERS)
        preset = ARCHETYPE_PRESETS["downtown_foodmart_omaha"]
        req = SolveRequestSchema(
            archetype_id=preset.id,
            facility_name=preset.name,
            demand_matrix=preset.demand_matrix,
            templates=preset.templates,
            guardrails=preset.guardrails,
            pareto_leeway_pct=preset.default_leeway_pct,
        )
        cls.solution = ISDRWSPSolver(req).solve()

    def test_unassigned_line_has_no_wage(self):
        unassigned = [line for line in self.solution.roster_lines if line.assigned_person is None]
        self.assertTrue(unassigned, "precondition: the preset with no staff must yield unassigned lines")
        for line in unassigned:
            with self.subTest(line=line.line_number):
                self.assertIsNone(line.hourly_wage)
                self.assertIsNone(line.estimated_weekly_payroll)

    def test_coverage_difference_matches_over_and_under_staffing(self):
        self.assertEqual(len(self.solution.interval_coverage), 168)
        for cell in self.solution.interval_coverage:
            with self.subTest(day=cell.day_index, hour=cell.hour):
                self.assertEqual(
                    cell.scheduled_staff - cell.required_staff,
                    cell.overstaffing - cell.understaffing,
                )

    def test_demand_giving_fewer_than_14_work_shifts_raises_infeasible(self):
        preset = ARCHETYPE_PRESETS["downtown_foodmart_omaha"]
        req = SolveRequestSchema(
            archetype_id=preset.id,
            facility_name=preset.name,
            demand_matrix=[[0] * 24 for _ in range(7)],
            templates=preset.templates,
            guardrails=preset.guardrails,
            pareto_leeway_pct=preset.default_leeway_pct,
        )
        with self.assertRaises(SolverInfeasibleError) as ctx:
            ISDRWSPSolver(req).solve()
        self.assertIn("fewer than 14 work shifts", str(ctx.exception))

    def test_demand_needing_more_hours_than_scheduled_reports_ratio_above_100(self):
        preset = ARCHETYPE_PRESETS["downtown_foodmart_omaha"]
        req = SolveRequestSchema(
            archetype_id=preset.id,
            facility_name=preset.name,
            demand_matrix=[[1] * 24 for _ in range(7)],
            templates=preset.templates,
            guardrails=preset.guardrails,
            pareto_leeway_pct=preset.default_leeway_pct,
        )
        solution = ISDRWSPSolver(req).solve()
        self.assertLess(
            solution.labor_analysis.total_scheduled_hours, 168,
            "precondition: schedule must fall short of the 168 required hours",
        )
        self.assertGreater(solution.labor_analysis.labor_efficiency_pct, 100.0)

    def test_concurrent_request_with_same_key_returns_409(self):
        body = json.dumps({"demand_matrix": [[1] * 24 for _ in range(7)], "templates": [
            {"code": "M", "name": "Morning", "earliest_start": 6, "latest_end": 15,
             "min_duration": 7, "max_duration": 9, "preferred_start": 6, "preferred_duration": 8}]}).encode()
        key = "contract-409-key"
        body_hash = hashlib.sha256(body).hexdigest()
        conn = get_db_connection()
        try:
            conn.execute("DELETE FROM idempotency_records WHERE key = ?", (key,))
            conn.commit()
        finally:
            conn.close()
        self.assertTrue(
            IdempotencyStore.start_request(key=key, method="POST",
                                           path="/api/v1/schedules/solve", request_hash=body_hash)
        )
        response = self.client.post(
            "/api/v1/schedules/solve",
            content=body,
            headers={"Content-Type": "application/json", "Idempotency-Key": key},
        )
        self.assertEqual(response.status_code, 409)
        self.assertEqual(response.headers.get("retry-after"), "2")

    def test_employee_record_requires_hourly_wage(self):
        from pydantic import ValidationError
        from app.schemas import EmployeeRecord

        with self.assertRaises(ValidationError):
            EmployeeRecord(employee_id="E-NOWAGE", name="No Wage")

    def test_closed_days_are_never_staffed(self):
        """A day with zero demand across every hour is a day the business is closed -
        nobody should ever be scheduled on it, regardless of rotation position."""
        matrix = []
        for day in range(7):
            if day in (0, 1, 2):
                matrix.append([0] * 6 + [5, 7, 8, 7, 5, 4, 2, 2, 0] + [0] * 9)
            else:
                matrix.append([0] * 24)

        templates = [
            {"code": "M", "name": "Morning", "earliest_start": 6, "latest_end": 16,
             "min_duration": 6, "max_duration": 9, "preferred_start": 6,
             "preferred_duration": 8, "enabled": True},
            {"code": "D", "name": "Midday", "earliest_start": 8, "latest_end": 16,
             "min_duration": 6, "max_duration": 9, "preferred_start": 10,
             "preferred_duration": 6, "enabled": True},
        ]
        guardrails = {
            "min_consecutive_work_days": 3, "max_consecutive_work_days": 5,
            "min_consecutive_rest_days": 2, "max_consecutive_rest_days": 3,
            "max_consecutive_nights": 2, "max_consecutive_evenings": 3,
            "enforce_forward_rotation": True, "enforce_zero_clopening": True,
            "avoid_single_rest_days": True, "avoid_single_night_shifts": True,
            "prioritize_free_weekends": True,
        }
        req = SolveRequestSchema(
            archetype_id="custom", facility_name="Closed Thu-Sun Test",
            demand_matrix=matrix, templates=templates, guardrails=guardrails,
            pareto_leeway_pct=10.0,
        )
        solution = ISDRWSPSolver(req).solve()
        self.assertGreater(len(solution.roster_lines), 0)
        for line in solution.roster_lines:
            for day_idx, cell in enumerate(line.days):
                if day_idx in (3, 4, 5, 6):  # Thu, Fri, Sat, Sun
                    with self.subTest(line=line.line_number, day=day_idx):
                        self.assertEqual(cell.shift_code, "OFF")


    def test_leeway_genuinely_changes_the_schedule_and_cost(self):
        """Raising leeway must actually change the built schedule (more staff, different
        roster), not just a displayed percentage - and obj_shift must equal the real
        staff-count + shift-variety + over/understaffing cost of the schedule produced."""
        preset = ARCHETYPE_PRESETS["downtown_foodmart_omaha"]

        def solve_at(leeway):
            req = SolveRequestSchema(
                archetype_id=preset.id, facility_name=preset.name,
                demand_matrix=preset.demand_matrix, templates=preset.templates,
                guardrails=preset.guardrails, pareto_leeway_pct=leeway,
            )
            return ISDRWSPSolver(req).solve()

        sol0 = solve_at(0.0)
        sol50 = solve_at(50.0)
        self.assertNotEqual(sol0.employee_count, sol50.employee_count)
        roster0 = [[d.shift_code for d in l.days] for l in sol0.roster_lines]
        roster50 = [[d.shift_code for d in l.days] for l in sol50.roster_lines]
        self.assertNotEqual(roster0, roster50)

        from app.config import settings
        sw = settings.shift_weights
        manual_obj_shift = round(
            sw.w_employees * sol50.employee_count
            + sw.w_shift_types * sol50.active_shift_types_count
            + sw.w_understaffing * sum(c.understaffing for c in sol50.interval_coverage)
            + sw.w_overstaffing * sum(c.overstaffing for c in sol50.interval_coverage),
            2,
        )
        self.assertEqual(manual_obj_shift, sol50.obj_shift)


if __name__ == "__main__":
    unittest.main()
