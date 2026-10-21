"""Tests for callout cover: storing a roster, then ranking who can pick up a shift.

callout-replacement used to return 501 because nothing stored each assignment's shift
times or rest intervals. assignment_shifts stores them, and these tests cover both the
storage (including that it is owner-scoped) and the ranking computed from it.

The adjacency under test is the real one: a candidate covering their own line's Monday
takes its rest from the PREVIOUS line's Sunday, and covering a Sunday hands off to the
NEXT line's Monday, wrapping at the ends of the cycle.
"""

import unittest
from fastapi.testclient import TestClient

from app.database import ShiftFlowRepository, get_db_connection
from app.main import app

FACILITY = "FAC-CALLOUT-01"

WINDOWS = {
    "M": (6.0, 8.0),    # 06:00-14:00, opening
    "D": (10.0, 8.0),   # 10:00-18:00
    "E": (16.0, 8.0),   # 16:00-24:00, closing
    "N": (22.0, 8.0),   # 22:00-06:00
}


def shift(line_number, day_index, code, employee_id=None):
    start, duration = (0.0, 0.0) if code == "OFF" else WINDOWS[code]
    return {
        "line_number": line_number,
        "cycle_week": line_number,
        "day_index": day_index,
        "shift_code": code,
        "employee_id": employee_id,
        "start_hour": start,
        "duration_hours": duration,
        "rest_hours_before": 24.0,
    }


def week(line_number, codes, employee_id=None):
    return [shift(line_number, d, c, employee_id) for d, c in enumerate(codes)]


class CalloutCoverTests(unittest.TestCase):
    """Cover is ranked from the stored roster, by rest compliance then overtime headroom."""

    @classmethod
    def setUpClass(cls):
        cls.client = TestClient(app)

    def setUp(self):
        self.conn = get_db_connection()
        self.repo = ShiftFlowRepository(self.conn)
        self.repo.upsert_facility(
            FACILITY, "Callout Store", "", "", [[2] * 24 for _ in range(7)], []
        )
        self.repo.clear_assignment_shifts(FACILITY)
        for existing in self.repo.list_employees(FACILITY):
            self.conn.execute("DELETE FROM employees WHERE id = ?", (existing["id"],))
        self.conn.commit()

    def tearDown(self):
        self.conn.close()

    def add_employee(self, name, line, days=None, wage=20.0):
        emp = self.repo.create_employee(
            FACILITY, name, "Frontline Clerk", wage, days if days is not None else [0, 1, 2, 3, 4, 5, 6]
        )
        self.repo.update_employee(emp["id"], assigned_line=line)
        return emp["id"]

    def store(self, shifts):
        res = self.client.put(
            "/api/emergency/stored-roster", json={"facility_id": FACILITY, "shifts": shifts}
        )
        self.assertEqual(res.status_code, 200, res.text)
        return res.json()

    def callout(self, **payload):
        body = {"facility_id": FACILITY}
        body.update(payload)
        return self.client.post("/api/emergency/callout-replacement", json=body)

    # ---------------------------------------------------------------
    # The storage itself
    # ---------------------------------------------------------------
    def test_01_a_stored_roster_comes_back_in_cycle_order(self):
        stored = self.store(week(1, ["M", "M", "M", "OFF", "OFF", "OFF", "OFF"]) + week(2, ["D"] * 5 + ["OFF", "OFF"]))
        self.assertEqual(stored["slots_stored"], 14)

        read = self.client.get(f"/api/emergency/stored-roster?facility_id={FACILITY}").json()
        self.assertEqual(read["slots_stored"], 14)
        self.assertEqual(
            [(s["line_number"], s["day_index"]) for s in read["shifts"][:3]],
            [(1, 0), (1, 1), (1, 2)],
        )
        self.assertEqual(read["shifts"][0]["start_hour"], 6.0)
        self.assertEqual(read["shifts"][0]["duration_hours"], 8.0)
        self.assertEqual(read["shifts"][3]["shift_code"], "OFF")

    def test_02_storing_again_replaces_the_roster_rather_than_adding_to_it(self):
        self.store(week(1, ["M"] * 5 + ["OFF", "OFF"]) + week(2, ["D"] * 5 + ["OFF", "OFF"]))
        second = self.store(week(1, ["E"] * 5 + ["OFF", "OFF"]))

        self.assertEqual(second["slots_stored"], 7)
        read = self.client.get(f"/api/emergency/stored-roster?facility_id={FACILITY}").json()
        self.assertEqual(read["slots_stored"], 7)
        self.assertEqual({s["line_number"] for s in read["shifts"]}, {1})
        self.assertEqual(read["shifts"][0]["shift_code"], "E")

    def test_03_a_callout_with_no_stored_roster_is_refused_with_the_reason(self):
        self.add_employee("Nobody Spare", 2)
        res = self.callout(target_day_index=5, target_shift_code="E", line_number=1)
        self.assertEqual(res.status_code, 409)
        self.assertIn("No roster is stored", res.json()["detail"])
        self.assertIn("Store the current roster first", res.json()["detail"])

    # ---------------------------------------------------------------
    # The ranking
    # ---------------------------------------------------------------
    def test_04_the_clear_cover_is_recommended_and_the_figures_are_stated(self):
        """Line 2 is off on Saturday and well under 40 hours, so it is the cover."""
        missing = self.add_employee("Dana Called Out", 1)
        spare = self.add_employee("Ray Spare", 2)
        self.store(
            week(1, ["OFF", "OFF", "OFF", "OFF", "OFF", "E", "OFF"], missing)
            + week(2, ["D", "D", "OFF", "OFF", "OFF", "OFF", "OFF"], spare)
        )

        res = self.callout(
            target_day_index=5, target_shift_code="E", line_number=1, missing_employee_id=missing
        )
        self.assertEqual(res.status_code, 200, res.text)
        body = res.json()

        self.assertEqual(body["target_day_name"], "Saturday")
        # Same convention as the solver's formatted_window: the end wraps at midnight.
        self.assertEqual(body["target_shift_window"], "16:00–00:00")
        self.assertEqual(body["missing_employee_name"], "Dana Called Out")
        self.assertEqual(body["recommended_candidate_id"], spare)
        self.assertEqual(body["candidates_count"], 1)

        candidate = body["candidates"][0]
        self.assertEqual(candidate["employee_name"], "Ray Spare")
        self.assertTrue(candidate["is_off_duty_target_day"])
        self.assertTrue(candidate["is_recommended"])
        self.assertFalse(candidate["overtime_risk"])
        self.assertFalse(candidate["clopening_risk"])
        self.assertEqual(candidate["current_scheduled_hours"], 16)
        self.assertEqual(candidate["hours_with_shift"], 24)
        self.assertEqual(candidate["estimated_added_payroll"], 160.0)
        self.assertIn("Clear", candidate["status_label"])
        self.assertIn("Ray Spare is the clear cover", body["operational_guidance"])

    def test_05_the_person_who_called_out_is_not_offered_as_their_own_cover(self):
        missing = self.add_employee("Dana Called Out", 1)
        self.add_employee("Ray Spare", 2)
        self.store(
            week(1, ["OFF"] * 5 + ["E", "OFF"], missing)
            + week(2, ["OFF"] * 7, None)
        )
        body = self.callout(
            target_day_index=5, target_shift_code="E", line_number=1, missing_employee_id=missing
        ).json()
        self.assertNotIn(missing, [c["employee_id"] for c in body["candidates"]])

    def test_06_cover_that_would_be_a_clopening_is_listed_but_never_recommended(self):
        """Line 1's Sunday is followed by line 2's Monday, so covering that Monday with an opening shift is a clopening."""
        missing = self.add_employee("Dana Called Out", 2)
        spare = self.add_employee("Ray Spare", 3)
        self.store(
            week(1, ["OFF", "OFF", "OFF", "OFF", "OFF", "OFF", "E"], None)
            + week(2, ["M", "OFF", "OFF", "OFF", "OFF", "OFF", "OFF"], missing)
            + week(3, ["OFF", "OFF", "OFF", "OFF", "OFF", "OFF", "OFF"], spare)
        )

        # Line 3's Monday is preceded by line 2's Sunday, which is OFF, so line 3 is
        # clear. Line 2 is the one that cannot be covered - and it is the missing line,
        # so the spare on line 3 is what is offered.
        body = self.callout(
            target_day_index=0, target_shift_code="M", line_number=2, missing_employee_id=missing
        ).json()
        self.assertEqual(body["recommended_candidate_id"], spare)

        # Now put the closing shift on line 2's Sunday instead: line 3's Monday then
        # follows a close, and the same cover becomes a clopening.
        self.store(
            week(1, ["OFF"] * 7, None)
            + week(2, ["M", "OFF", "OFF", "OFF", "OFF", "OFF", "E"], missing)
            + week(3, ["OFF"] * 7, spare)
        )
        body = self.callout(
            target_day_index=0, target_shift_code="M", line_number=2, missing_employee_id=missing
        ).json()
        candidate = body["candidates"][0]
        self.assertEqual(candidate["employee_id"], spare)
        self.assertFalse(candidate["is_recommended"])
        self.assertTrue(candidate["clopening_risk"])
        self.assertEqual(candidate["status_label"], "Clopening")
        self.assertTrue(any("zero-clopening forbids" in note for note in candidate["audit_notes"]))
        self.assertIsNone(body["recommended_candidate_id"])
        self.assertIn("without breaking a rule", body["operational_guidance"])

    def test_07_cover_leaving_under_16_hours_rest_is_listed_with_the_hours(self):
        """A night shift the day before leaves 4 hours before a midday cover."""
        missing = self.add_employee("Dana Called Out", 1)
        spare = self.add_employee("Ray Spare", 2)
        self.store(
            week(1, ["OFF", "OFF", "D", "OFF", "OFF", "OFF", "OFF"], missing)
            + week(2, ["OFF", "N", "OFF", "OFF", "OFF", "OFF", "OFF"], spare)
        )

        body = self.callout(
            target_day_index=2, target_shift_code="D", line_number=1, missing_employee_id=missing
        ).json()
        candidate = body["candidates"][0]
        self.assertFalse(candidate["is_recommended"])
        self.assertEqual(candidate["prior_rest_hours"], 4.0)
        self.assertEqual(candidate["status_label"], "Under the rest rule")
        self.assertTrue(any("under the 16h rule" in note for note in candidate["audit_notes"]))

    def test_08_cover_that_crosses_40_hours_is_listed_with_what_it_would_cost(self):
        missing = self.add_employee("Dana Called Out", 1)
        spare = self.add_employee("Ray Spare", 2, wage=20.0)
        self.store(
            week(1, ["OFF", "OFF", "OFF", "OFF", "OFF", "D", "OFF"], missing)
            + week(2, ["D", "D", "D", "D", "D", "OFF", "OFF"], spare)
        )

        body = self.callout(
            target_day_index=5, target_shift_code="D", line_number=1, missing_employee_id=missing
        ).json()
        candidate = body["candidates"][0]
        self.assertFalse(candidate["is_recommended"])
        self.assertTrue(candidate["overtime_risk"])
        self.assertEqual(candidate["current_scheduled_hours"], 40)
        self.assertEqual(candidate["hours_with_shift"], 48)
        self.assertEqual(candidate["status_label"], "Into overtime")
        # Eight overtime hours at time and a half on $20.
        self.assertEqual(candidate["estimated_added_payroll"], 240.0)
        self.assertTrue(any("past the 40h boundary" in note for note in candidate["audit_notes"]))

    def test_09_someone_already_working_that_day_is_listed_but_not_recommended(self):
        missing = self.add_employee("Dana Called Out", 1)
        self.add_employee("Busy Bea", 2)
        self.store(
            week(1, ["OFF", "OFF", "OFF", "OFF", "OFF", "E", "OFF"], missing)
            + week(2, ["OFF", "OFF", "OFF", "OFF", "OFF", "D", "OFF"], None)
        )

        candidate = self.callout(
            target_day_index=5, target_shift_code="E", line_number=1, missing_employee_id=missing
        ).json()["candidates"][0]
        self.assertFalse(candidate["is_off_duty_target_day"])
        self.assertFalse(candidate["is_recommended"])
        self.assertEqual(candidate["status_label"], "Already working that day")
        self.assertTrue(any("dropping it" in note for note in candidate["audit_notes"]))

    def test_10_someone_who_marked_the_day_unavailable_is_not_recommended(self):
        missing = self.add_employee("Dana Called Out", 1)
        self.add_employee("No Saturdays Nia", 2, days=[0, 1, 2, 3, 4])
        self.store(
            week(1, ["OFF", "OFF", "OFF", "OFF", "OFF", "E", "OFF"], missing)
            + week(2, ["OFF"] * 7, None)
        )

        candidate = self.callout(
            target_day_index=5, target_shift_code="E", line_number=1, missing_employee_id=missing
        ).json()["candidates"][0]
        self.assertFalse(candidate["is_recommended"])
        self.assertEqual(candidate["status_label"], "Marked unavailable")
        self.assertTrue(any("Saturday marked unavailable" in note for note in candidate["audit_notes"]))

    def test_11_candidates_are_ranked_by_rest_then_overtime_headroom(self):
        missing = self.add_employee("Dana Called Out", 1)
        clear = self.add_employee("Clear Cleo", 2)
        tight = self.add_employee("Nearly Full Ned", 3)
        broken = self.add_employee("Short Rest Sam", 4)
        self.store(
            week(1, ["OFF", "OFF", "OFF", "OFF", "OFF", "E", "OFF"], missing)
            + week(2, ["D", "OFF", "OFF", "OFF", "OFF", "OFF", "OFF"], clear)
            + week(3, ["D", "D", "D", "D", "OFF", "OFF", "OFF"], tight)
            + week(4, ["OFF", "OFF", "OFF", "OFF", "OFF", "OFF", "OFF"], broken)
        )
        # Line 4's Saturday is preceded by line 4's Friday (OFF) - give it a night shift
        # on Friday so its rest is short while everything else stays clear.
        shifts = (
            week(1, ["OFF", "OFF", "OFF", "OFF", "OFF", "E", "OFF"], missing)
            + week(2, ["D", "OFF", "OFF", "OFF", "OFF", "OFF", "OFF"], clear)
            + week(3, ["D", "D", "D", "D", "OFF", "OFF", "OFF"], tight)
            + week(4, ["OFF", "OFF", "OFF", "OFF", "N", "OFF", "OFF"], broken)
        )
        self.store(shifts)

        body = self.callout(
            target_day_index=5, target_shift_code="E", line_number=1, missing_employee_id=missing
        ).json()
        names = [c["employee_name"] for c in body["candidates"]]

        # Both compliant covers come before the one that breaks the rest rule, and of
        # the two compliant ones the roomier week is offered first.
        self.assertEqual(names.index("Clear Cleo"), 0)
        self.assertLess(names.index("Nearly Full Ned"), names.index("Short Rest Sam"))
        self.assertEqual(body["recommended_candidate_id"], clear)

    def test_12_a_shift_code_the_roster_does_not_contain_is_refused(self):
        missing = self.add_employee("Dana Called Out", 1)
        self.add_employee("Ray Spare", 2)
        self.store(week(1, ["D"] * 5 + ["OFF", "OFF"], missing) + week(2, ["OFF"] * 7, None))

        res = self.callout(
            target_day_index=5, target_shift_code="N", line_number=1, missing_employee_id=missing
        )
        self.assertEqual(res.status_code, 409)
        self.assertIn("no N shift in it", res.json()["detail"])

    def test_13_no_staff_on_other_lines_means_no_ranking_rather_than_a_guess(self):
        missing = self.add_employee("Dana Called Out", 1)
        self.store(week(1, ["OFF"] * 5 + ["E", "OFF"], missing) + week(2, ["OFF"] * 7, None))

        body = self.callout(
            target_day_index=5, target_shift_code="E", line_number=1, missing_employee_id=missing
        ).json()
        self.assertEqual(body["candidates"], [])
        self.assertIsNone(body["recommended_candidate_id"])
        self.assertIn("nobody to", body["operational_guidance"])


if __name__ == "__main__":
    unittest.main()
