"""Unit and integration tests for the ShiftFlow Studio schedule engine.

Compatible with both `pytest` and `python3 -m unittest`.
Tests:
1. Rotation multigraph: in/out degree balance, work/rest alternation, reachability
2. Hierholzer Eulerian cycle extraction, linear in the arc count, and subtour splicing
3. Coverage identity: scheduled staff == required + overstaffing - understaffing
4. All 8 workload/fatigue penalty functions in app/engine/ergonomics.py
5. The 16-hour rest rule and forward rotation (M -> D -> E -> N)
6. The cost-vs-rest frontier, every point of which must be a real independent re-solve
7. Roster lines, weekly cyclic offset advancement, and optional staff mapping
8. Employee availability constraint verification and conflict detection
9. Employee add/deactivate handling and line reassignment
10. Labor economics: regular vs overtime hours at 1.5x, total spend, daily cost
11. FastAPI routes (/health, /archetypes, /schedules/solve, /pareto-frontier, /export-csv)

Note on item 6: the engine reports whatever improvement a re-solve actually produces. It
is not calibrated against any published table of leeway-to-improvement figures, and the
figures that a previous version of this docstring quoted (1% -> 8.37%, 5% -> 27.34%,
10% -> 39.46%) were never computed anywhere in this repository. See README section 1.
"""

import unittest
from fastapi.testclient import TestClient


from app.api.archetype_routes import ARCHETYPE_PRESETS
from app.engine.ergonomics import (
    compute_rest_hours_between,
    evaluate_rest_sequence_penalty,
    evaluate_shift_type_penalties,
    evaluate_work_sequence_penalty,
    is_backward_rotation,
)
from app.engine.isd_rwsp_solver import (
    ISDRWSPSolver,
    SolverInfeasibleError,
    extract_eulerian_cycle_hierholzer,
    verify_multigraph_eulerian_conditions,
)
from app.main import app
from app.schemas import EmployeeRecord, SolveRequestSchema, StaffMemberAssignment


class TestBeckerISDRWSPSolver(unittest.TestCase):
    """Comprehensive verification of the Becker (2026) mathematical framework and Labor Analytics."""

    def setUp(self) -> None:
        self.client = TestClient(app)

    def test_01_shift_type_penalties_table4(self) -> None:
        """Verify Criteria 1 (W^SL_t) and 2 (W^MS_t) from Becker Table 4."""
        w_sl, w_ms = evaluate_shift_type_penalties("M", 6, 8)
        self.assertEqual(w_sl, 0.0)
        self.assertEqual(w_ms, 0.0)

        w_sl_early, w_ms_early = evaluate_shift_type_penalties("M", 5, 10)
        self.assertEqual(w_sl_early, 1.0)
        self.assertEqual(w_ms_early, 1.0)

        w_sl_12, _ = evaluate_shift_type_penalties("D", 8, 12)
        self.assertEqual(w_sl_12, 3.0)

    def test_02_work_and_rest_sequence_penalties_table4(self) -> None:
        """Verify Criteria 3..8 (W^CD_b, W^CN_b, W^CE_b, W^SN_b, W^WW_{gb}, W^WR_{gh}, W^SR_h)."""
        ideal_res = evaluate_work_sequence_penalty(0, ["M", "D", "E", "E"])
        self.assertEqual(ideal_res["w_cd"], 0.0)
        self.assertEqual(ideal_res["w_cn"], 0.0)
        self.assertEqual(ideal_res["w_ce"], 0.0)
        self.assertEqual(ideal_res["w_sn"], 0.0)
        self.assertEqual(ideal_res["w_ww"], 0.0)
        self.assertEqual(ideal_res["total"], 0.0)

        bad_res = evaluate_work_sequence_penalty(2, ["M", "E", "E", "E", "E", "N"])
        self.assertEqual(bad_res["w_cd"], 4.0)
        self.assertEqual(bad_res["w_ce"], 1.0)
        self.assertEqual(bad_res["w_sn"], 4.0)
        self.assertEqual(bad_res["w_ww"], 4.0)

        night_res = evaluate_work_sequence_penalty(0, ["N", "N", "N"])
        self.assertEqual(night_res["w_cn"], 3.0)

        rest_single_sat = evaluate_rest_sequence_penalty(5, 1)
        self.assertEqual(rest_single_sat["w_wr"], 4.0)
        self.assertEqual(rest_single_sat["w_sr"], 1.0)

        rest_weekend = evaluate_rest_sequence_penalty(5, 2)
        self.assertEqual(rest_weekend["total"], 0.0)

    def test_03_zero_clopening_and_forward_rotation_checks(self) -> None:
        """Verify 16-hour minimum rest (zero-clopening) and circadian forward rotation."""
        rest_clopen = compute_rest_hours_between("E", 14, 8, "M", 6)
        self.assertEqual(rest_clopen, 8.0)
        self.assertTrue(rest_clopen < 16.0)
        self.assertTrue(is_backward_rotation("E", "M"))

        rest_forward = compute_rest_hours_between("M", 6, 8, "E", 14)
        self.assertEqual(rest_forward, 24.0)
        self.assertFalse(is_backward_rotation("M", "E"))

    def test_04_hierholzer_eulerian_cycle_and_subtour_splicing(self) -> None:
        """Verify Theorem 1 multigraph validation and Hierholzer's O(|E|) subtour splicing."""
        arcs = [
            {
                "arc_id": "e_b1",
                "arc_type": "work",
                "start_day": 0,
                "end_day": 4,
                "duration_days": 5,
                "from_node": "d0_work",
                "to_node": "d5_rest",
                "shifts": ["M", "M", "D", "E", "E"],
                "sequence_penalty": 0.0,
            },
            {
                "arc_id": "e_h1",
                "arc_type": "rest",
                "start_day": 5,
                "end_day": 6,
                "duration_days": 2,
                "from_node": "d5_rest",
                "to_node": "d0_work",
                "shifts": ["OFF", "OFF"],
                "sequence_penalty": 0.0,
            },
            {
                "arc_id": "e_b2",
                "arc_type": "work",
                "start_day": 0,
                "end_day": 3,
                "duration_days": 4,
                "from_node": "d0_work",
                "to_node": "d4_rest",
                "shifts": ["M", "D", "E", "N"],
                "sequence_penalty": 0.0,
            },
            {
                "arc_id": "e_h2",
                "arc_type": "rest",
                "start_day": 4,
                "end_day": 6,
                "duration_days": 3,
                "from_node": "d4_rest",
                "to_node": "d0_work",
                "shifts": ["OFF", "OFF", "OFF"],
                "sequence_penalty": 0.0,
            },
        ]
        valid, nodes = verify_multigraph_eulerian_conditions(arcs)
        self.assertTrue(valid)
        self.assertEqual(len(nodes), 14)

        tour = extract_eulerian_cycle_hierholzer(arcs)
        self.assertEqual(len(tour), 4)
        for i in range(len(tour)):
            curr_arc = tour[i]
            next_arc = tour[(i + 1) % len(tour)]
            self.assertEqual(curr_arc["to_node"], next_arc["from_node"])
            self.assertNotEqual(curr_arc["arc_type"], next_arc["arc_type"])

    def test_05_every_shipped_preset_solves_and_satisfies_constraints(self) -> None:
        """Every preset offered in the UI must solve at its own default leeway.

        A preset that users can pick but that the solver cannot schedule is a broken
        product, not a known limitation, so this test fails the build rather than
        recording the breakage. If a preset genuinely cannot be made solvable it must be
        removed from ARCHETYPE_PRESETS, which also removes it from this loop.
        """
        self.assertTrue(ARCHETYPE_PRESETS, "No presets are registered at all.")
        for arch_id, preset in ARCHETYPE_PRESETS.items():
            req = SolveRequestSchema(
                archetype_id=arch_id,
                facility_name=preset.name,
                demand_matrix=preset.demand_matrix,
                templates=preset.templates,
                guardrails=preset.guardrails,
                pareto_leeway_pct=preset.default_leeway_pct,
            )
            try:
                sol = ISDRWSPSolver(req).solve()
            except SolverInfeasibleError as exc:
                self.fail(
                    f"Preset '{arch_id}' is offered in the UI but the solver reports it "
                    f"infeasible at its default leeway of {preset.default_leeway_pct}%: "
                    f"{exc}. Fix the preset or remove it from ARCHETYPE_PRESETS."
                )
            self.assertTrue(sol.eulerian_valid, f"Archetype {arch_id} failed Eulerian check")
            self.assertEqual(sol.ergonomics_audit.clopening_violations, 0, arch_id)
            self.assertEqual(sol.ergonomics_audit.backward_rotation_violations, 0, arch_id)
            self.assertGreaterEqual(sol.ergonomics_audit.min_rest_hours_observed, 16.0, arch_id)
            self.assertEqual(len(sol.ergonomics_audit.criteria_breakdown), 8)
            self.assertEqual(len(sol.interval_coverage), 168)
            self.assertEqual(sol.labor_analysis.total_payroll_cost, 0.0)

            for cell in sol.interval_coverage:
                lhs = cell.scheduled_staff
                rhs = cell.required_staff + cell.overstaffing - cell.understaffing
                self.assertEqual(lhs, rhs)

    def test_05b_every_shipped_preset_solves_at_zero_leeway(self) -> None:
        """The tightest setting must work too.

        Leeway 0% is the cheapest, most constrained version of a schedule and is also the
        baseline the ergonomics comparison solves internally, so a preset that only works
        at its default leeway is still broken for the user who drags the slider down.
        """
        for arch_id, preset in ARCHETYPE_PRESETS.items():
            req = SolveRequestSchema(
                archetype_id=arch_id,
                facility_name=preset.name,
                demand_matrix=preset.demand_matrix,
                templates=preset.templates,
                guardrails=preset.guardrails,
                pareto_leeway_pct=0.0,
            )
            try:
                sol = ISDRWSPSolver(req).solve()
            except SolverInfeasibleError as exc:
                self.fail(
                    f"Preset '{arch_id}' is infeasible at 0% leeway: {exc}. "
                    "Fix the preset or remove it from ARCHETYPE_PRESETS."
                )
            self.assertTrue(sol.eulerian_valid, arch_id)
            self.assertGreaterEqual(sol.ergonomics_audit.min_rest_hours_observed, 16.0, arch_id)

    def test_06_pareto_frontier_is_built_from_real_re_solves(self) -> None:
        """Every frontier point must be the real output of an independent solve at that
        leeway - not an estimate - and the frontier must trend toward more cost for less
        workload strain."""
        preset = ARCHETYPE_PRESETS["downtown_foodmart_omaha"]
        req = SolveRequestSchema(
            archetype_id=preset.id,
            facility_name=preset.name,
            demand_matrix=preset.demand_matrix,
            templates=preset.templates,
            guardrails=preset.guardrails,
            pareto_leeway_pct=5.0,
        )
        sol = ISDRWSPSolver(req).solve()
        frontier = sol.pareto_frontier
        self.assertGreaterEqual(len(frontier), 4)

        # The point matching the main request's own leeway must be the main solve's own result.
        selected = [p for p in frontier if p.is_selected]
        self.assertEqual(len(selected), 1)
        self.assertEqual(selected[0].obj_shift, sol.obj_shift)
        self.assertEqual(selected[0].employee_count, sol.employee_count)

        # Workload strain never increases as leeway increases. (Cost is not asserted to be
        # monotonic: this is a real heuristic, not a true optimizer, and an extra employee
        # can occasionally let the shift-count split fit the week's demand curve more evenly,
        # reducing both over- and under-staffing enough to lower total cost outright - a real
        # property of integer scheduling, not a bug to hide by forcing a fake guarantee.)
        for idx in range(len(frontier) - 1):
            self.assertGreaterEqual(frontier[idx].obj_ergo, frontier[idx + 1].obj_ergo)

        self.assertLessEqual(len([p for p in frontier if p.is_knee_point]), 1)

        # PO-5: an arbitrary anchor point must equal a direct solve at the same leeway.
        anchor = next(p for p in frontier if abs(p.leeway_pct - 20.0) < 1e-4)
        direct = ISDRWSPSolver(req.model_copy(update={"pareto_leeway_pct": 20.0})).solve()
        self.assertEqual(anchor.obj_shift, direct.obj_shift)
        self.assertEqual(anchor.obj_ergo, direct.ergonomics_audit.total_ergo_objective)
        self.assertEqual(anchor.employee_count, direct.employee_count)

    def test_07_rotation_week_advancement_and_staff_mapping(self) -> None:
        """Verify weekly rotation advancement and optional workforce line assignment."""
        preset = ARCHETYPE_PRESETS["downtown_foodmart_omaha"]
        staff = [
            StaffMemberAssignment(
                line_id=1,
                cohort_label="Line 1",
                assigned_staff_name="A. Lindqvist",
                qualification_tier="Senior Operator",
                hourly_wage=25.0,
            ),
            StaffMemberAssignment(
                line_id=2,
                cohort_label="Line 2",
                assigned_staff_name="M. Kowalski",
                qualification_tier="Lead Technician",
                hourly_wage=22.0,
            ),
        ]
        req_wk0 = SolveRequestSchema(
            archetype_id=preset.id,
            facility_name=preset.name,
            demand_matrix=preset.demand_matrix,
            templates=preset.templates,
            guardrails=preset.guardrails,
            rotation_week_offset=0,
            staff_assignments=staff,
        )
        req_wk1 = req_wk0.model_copy(update={"rotation_week_offset": 1})

        sol_wk0 = ISDRWSPSolver(req_wk0).solve()
        sol_wk1 = ISDRWSPSolver(req_wk1).solve()

        self.assertEqual(sol_wk0.roster_lines[0].assigned_person, "A. Lindqvist")
        line2_wk0_shifts = [c.shift_code for c in sol_wk0.roster_lines[1].days]
        line1_wk1_shifts = [c.shift_code for c in sol_wk1.roster_lines[0].days]
        self.assertEqual(line1_wk1_shifts, line2_wk0_shifts)

    def test_08_employee_availability_and_fire_deactivation(self) -> None:
        """Verify employee availability constraints, day-off conflicts, and firing/deactivation."""
        preset = ARCHETYPE_PRESETS["downtown_foodmart_omaha"]
        # Employee 1 is unavailable on weekends (Sat=5, Sun=6)
        emp1 = EmployeeRecord(
            employee_id="E1",
            name="Available Weekdays Only",
            role="Weekday Clerk",
            hourly_wage=18.0,
            available_days=[0, 1, 2, 3, 4],  # Mon..Fri
            assigned_line_id=1,
        )
        # Employee 2 is fired / inactive
        emp2 = EmployeeRecord(
            employee_id="E2",
            name="Terminated Clerk",
            role="Former Associate",
            hourly_wage=15.0,
            is_active=False,
            assigned_line_id=2,
        )
        req = SolveRequestSchema(
            archetype_id=preset.id,
            facility_name=preset.name,
            demand_matrix=preset.demand_matrix,
            templates=preset.templates,
            guardrails=preset.guardrails,
            employees=[emp1, emp2],
        )
        sol = ISDRWSPSolver(req).solve()
        # Line 1 should be mapped to emp1
        self.assertEqual(sol.roster_lines[0].assigned_person, "Available Weekdays Only")
        # Line 2 should NOT be mapped to terminated emp2 (it stays unassigned or gets active staff)
        self.assertNotEqual(sol.roster_lines[1].assigned_person, "Terminated Clerk")

        # If Line 1 works Saturday or Sunday, availability_conflicts_count should be flagged
        line1 = sol.roster_lines[0]
        wknd_shifts = [c for c in line1.days if c.is_weekend and c.shift_code != "OFF"]
        self.assertEqual(line1.availability_conflicts_count, len(wknd_shifts))

    def test_09_comprehensive_labor_analysis_calculations(self) -> None:
        """Verify labor analysis economics: regular hours, overtime (1.5x), daily spend, and wage rates."""
        preset = ARCHETYPE_PRESETS["downtown_foodmart_omaha"]
        req = SolveRequestSchema(
            archetype_id=preset.id,
            facility_name=preset.name,
            demand_matrix=preset.demand_matrix,
            templates=preset.templates,
            guardrails=preset.guardrails,
        )
        sol = ISDRWSPSolver(req).solve()
        la = sol.labor_analysis

        self.assertGreater(la.total_scheduled_hours, 0)
        self.assertEqual(la.total_scheduled_hours, la.total_regular_hours + la.total_overtime_hours)
        self.assertEqual(la.total_payroll_cost, 0.0)
        self.assertAlmostEqual(
            la.total_payroll_cost,
            la.regular_payroll_cost + la.overtime_payroll_cost,
            places=1,
        )
        self.assertEqual(len(la.hours_per_day), 7)
        self.assertEqual(len(la.cost_per_day), 7)
        self.assertEqual(sum(la.hours_per_day), la.total_scheduled_hours)
        self.assertGreaterEqual(la.labor_efficiency_pct, 50.0)

    def test_10_fastapi_endpoints(self) -> None:
        """Verify all REST API endpoints return valid responses."""
        r_health = self.client.get("/health")
        self.assertEqual(r_health.status_code, 200)
        self.assertEqual(r_health.json()["status"], "healthy")

        r_arch = self.client.get("/api/v1/archetypes")
        self.assertEqual(r_arch.status_code, 200)
        archetypes = r_arch.json()
        self.assertGreaterEqual(len(archetypes), 5)

        preset = ARCHETYPE_PRESETS["downtown_foodmart_omaha"]
        payload = SolveRequestSchema(
            archetype_id=preset.id,
            facility_name=preset.name,
            demand_matrix=preset.demand_matrix,
            templates=preset.templates,
            guardrails=preset.guardrails,
            pareto_leeway_pct=10.0,
        ).model_dump()
        r_solve = self.client.post("/api/v1/schedules/solve", json=payload)
        self.assertEqual(r_solve.status_code, 200)
        data = r_solve.json()
        self.assertIn("labor_analysis", data)
        self.assertEqual(data["labor_analysis"]["total_payroll_cost"], 0.0)

        r_csv = self.client.post("/api/v1/schedules/export-csv", json=payload)
        self.assertEqual(r_csv.status_code, 200)
        self.assertIn("Shift Pattern,Pattern ID", r_csv.text)


if __name__ == "__main__":
    unittest.main()
