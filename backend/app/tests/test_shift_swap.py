"""Tests for bilateral shift swap validation.

The verdict is computed from the per-line data a solved roster carries, which the
caller sends. The adjacency under test throughout is the real one: a roster is ONE
continuous cycle of day slots in line order, so line i's Sunday is followed by line
i+1's Monday and the cycle wraps. The guardrail in the solver used to compare a line's
Sunday against its own Monday - six days and a rest block apart - and these tests exist
partly so that bug cannot come back in through the swap path.
"""

import unittest
from fastapi.testclient import TestClient

from app.main import app

# Clock times matching the default retail templates.
WINDOWS = {
    "M": (6.0, 8.0),    # 06:00-14:00, opening
    "D": (10.0, 8.0),   # 10:00-18:00
    "E": (16.0, 8.0),   # 16:00-24:00, closing
    "N": (22.0, 8.0),   # 22:00-06:00
}


def cell(day_index, code):
    start, duration = (0.0, 0.0) if code == "OFF" else WINDOWS[code]
    return {
        "day_index": day_index,
        "shift_code": code,
        "start_hour": start,
        "duration_hours": duration,
    }


def line(line_number, codes, employee_id=None, person=None, wage=20.0):
    return {
        "line_number": line_number,
        "assigned_employee_id": employee_id or f"EMP-{line_number:02d}",
        "assigned_person": person or f"Associate {line_number}",
        "hourly_wage": wage,
        "days": [cell(d, c) for d, c in enumerate(codes)],
    }


class TestShiftSwapValidation(unittest.TestCase):
    """A swap is approved only when both resulting weeks pass rest, clopening and overtime."""

    @classmethod
    def setUpClass(cls):
        cls.client = TestClient(app)

    def post(self, payload):
        return self.client.post("/api/emergency/validate-swap", json=payload)

    # ---------------------------------------------------------------
    # A swap that is fine
    # ---------------------------------------------------------------
    def test_01_a_harmless_swap_is_approved_and_says_why(self):
        """Trading two midday shifts between two lines changes nothing any rule measures."""
        payload = {
            "associate_a_id": "EMP-01",
            "associate_b_id": "EMP-02",
            "day_a_index": 1,   # Tuesday
            "day_b_index": 2,   # Wednesday
            "roster_lines": [
                line(1, ["OFF", "D", "D", "D", "D", "OFF", "OFF"]),
                line(2, ["OFF", "D", "D", "D", "D", "OFF", "OFF"]),
            ],
        }
        res = self.post(payload)
        self.assertEqual(res.status_code, 200)
        body = res.json()
        self.assertTrue(body["is_approved"])
        self.assertFalse(body["clopening_violation_a"])
        self.assertFalse(body["clopening_violation_b"])
        self.assertEqual(body["overtime_hours_a"], 0.0)
        self.assertEqual(body["payroll_cost_delta"], 0.0)
        self.assertIn("Approved", body["validation_messages"][0])
        self.assertIn("16 hours", body["validation_messages"][0])
        self.assertIn("Associate 1", body["swap_summary"])
        self.assertIn("Tuesday", body["swap_summary"])

    # ---------------------------------------------------------------
    # Refused: clopening, within a week and across a line boundary
    # ---------------------------------------------------------------
    def test_02_swap_creating_a_clopening_within_a_week_is_refused_with_the_reason(self):
        """Moving a morning shift to the day after a closing evening shift is refused."""
        payload = {
            "associate_a_id": "EMP-01",
            "associate_b_id": "EMP-02",
            # Line 1 works E on Tuesday and D on Wednesday; line 2 works M on Wednesday.
            # Trading line 1's Wednesday D for line 2's Wednesday M puts M straight
            # after line 1's Tuesday E.
            "day_a_index": 2,
            "day_b_index": 2,
            "roster_lines": [
                line(1, ["OFF", "E", "D", "OFF", "OFF", "OFF", "OFF"]),
                line(2, ["OFF", "OFF", "M", "OFF", "OFF", "OFF", "OFF"]),
            ],
        }
        res = self.post(payload)
        self.assertEqual(res.status_code, 200)
        body = res.json()
        self.assertFalse(body["is_approved"])
        self.assertTrue(body["clopening_violation_a"])
        joined = " ".join(body["validation_messages"])
        self.assertIn("clopening", joined)
        self.assertIn("Tuesday", joined)
        self.assertIn("Wednesday", joined)
        self.assertIn("line 1", joined)

    def test_03_clopening_across_the_line_boundary_is_found(self):
        """Line 1's Sunday is followed by line 2's Monday, so that pair is a real close-then-open.

        A check that compared each line's Sunday against its OWN Monday would approve
        this swap. The flat cycle is the only adjacency that sees it.
        """
        payload = {
            "associate_a_id": "EMP-02",
            "associate_b_id": "EMP-03",
            # Line 2 works a midday on Monday; line 3 works an opening morning on
            # Monday. Trading them puts that morning on line 2's Monday, straight after
            # line 1's Sunday close.
            "day_a_index": 0,
            "day_b_index": 0,
            "roster_lines": [
                line(1, ["OFF", "OFF", "OFF", "OFF", "OFF", "OFF", "E"]),
                line(2, ["D", "OFF", "OFF", "OFF", "OFF", "OFF", "OFF"]),
                line(3, ["M", "OFF", "OFF", "OFF", "OFF", "OFF", "OFF"]),
            ],
        }
        res = self.post(payload)
        self.assertEqual(res.status_code, 200)
        body = res.json()
        self.assertFalse(body["is_approved"])
        joined = " ".join(body["validation_messages"])
        self.assertIn("clopening", joined)
        self.assertIn("Sunday on line 1", joined)
        self.assertIn("Monday on line 2", joined)
        self.assertIn("one line's Sunday is followed by the next line's", joined)

    def test_04_clopening_across_the_cycle_wrap_is_found(self):
        """The LAST line's Sunday is followed by the FIRST line's Monday."""
        payload = {
            "associate_a_id": "EMP-01",
            "associate_b_id": "EMP-02",
            # Line 2 closes on Sunday. The cycle wraps to line 1's Monday, which this
            # swap turns into an opening morning shift.
            "day_a_index": 0,
            "day_b_index": 1,
            "roster_lines": [
                line(1, ["D", "OFF", "OFF", "OFF", "OFF", "OFF", "OFF"]),
                line(2, ["OFF", "M", "OFF", "OFF", "OFF", "OFF", "E"]),
            ],
        }
        res = self.post(payload)
        self.assertEqual(res.status_code, 200)
        body = res.json()
        self.assertFalse(body["is_approved"])
        joined = " ".join(body["validation_messages"])
        self.assertIn("clopening", joined)
        self.assertIn("Sunday on line 2", joined)
        self.assertIn("Monday on line 1", joined)

    # ---------------------------------------------------------------
    # Refused: the 16-hour rest rule
    # ---------------------------------------------------------------
    def test_05_swap_leaving_under_16_hours_rest_is_refused_with_the_hours(self):
        """A night shift landing before a midday shift leaves 4 hours, and the message says 4."""
        payload = {
            "associate_a_id": "EMP-01",
            "associate_b_id": "EMP-02",
            # Line 1: Monday D, Tuesday D. Line 2: Monday N. Trading line 1's Monday D
            # for line 2's Monday N leaves N (ends 06:00 Tue) into D (starts 10:00 Tue).
            "day_a_index": 0,
            "day_b_index": 0,
            "roster_lines": [
                line(1, ["D", "D", "OFF", "OFF", "OFF", "OFF", "OFF"]),
                line(2, ["N", "OFF", "OFF", "OFF", "OFF", "OFF", "OFF"]),
            ],
        }
        res = self.post(payload)
        self.assertEqual(res.status_code, 200)
        body = res.json()
        self.assertFalse(body["is_approved"])
        joined = " ".join(body["validation_messages"])
        self.assertIn("rest", joined)
        self.assertIn("4 hours", joined)
        self.assertIn("The rule is 16 hours", joined)

    # ---------------------------------------------------------------
    # Refused: the 40-hour overtime boundary
    # ---------------------------------------------------------------
    def test_06_swap_pushing_a_week_past_40_hours_is_refused_with_the_figures(self):
        """Taking on a shift from a shorter week is refused when it crosses the boundary."""
        payload = {
            "associate_a_id": "EMP-01",
            "associate_b_id": "EMP-02",
            # Line 1 already works 40h over 5 days and is OFF Saturday. Line 2 works
            # Saturday. Trading line 1's Saturday OFF is not allowed, so instead trade
            # line 1's Monday (M, 8h) for line 2's Saturday D - line 1 keeps 5 shifts.
            # To cross the boundary line 1 must gain hours: give it a 12-hour shift.
            "day_a_index": 0,
            "day_b_index": 5,
            "roster_lines": [
                line(1, ["M", "D", "D", "D", "D", "OFF", "OFF"]),
                {
                    "line_number": 2,
                    "assigned_employee_id": "EMP-02",
                    "assigned_person": "Associate 2",
                    "hourly_wage": 20.0,
                    "days": [
                        cell(0, "OFF"),
                        cell(1, "OFF"),
                        cell(2, "OFF"),
                        cell(3, "OFF"),
                        cell(4, "OFF"),
                        {
                            "day_index": 5,
                            "shift_code": "D",
                            "start_hour": 10.0,
                            "duration_hours": 12.0,
                        },
                        cell(6, "OFF"),
                    ],
                },
            ],
        }
        res = self.post(payload)
        self.assertEqual(res.status_code, 200)
        body = res.json()
        self.assertFalse(body["is_approved"])
        joined = " ".join(body["validation_messages"])
        self.assertIn("overtime", joined)
        self.assertIn("Associate 1", joined)
        self.assertIn("40", joined)
        self.assertEqual(body["overtime_hours_a"], 4.0)
        # Four overtime hours at time and a half on a $20 wage, minus the four regular
        # hours the other line loses.
        self.assertGreater(body["payroll_cost_delta"], 0)

    def test_07_a_week_already_over_40_hours_is_not_refused_for_staying_there(self):
        """The boundary check is about what the swap does, not where the week already was."""
        payload = {
            "associate_a_id": "EMP-01",
            "associate_b_id": "EMP-02",
            "day_a_index": 1,
            "day_b_index": 2,
            "roster_lines": [
                line(1, ["D", "D", "D", "D", "D", "D", "OFF"]),   # 48h before and after
                line(2, ["OFF", "OFF", "D", "OFF", "OFF", "OFF", "OFF"]),
            ],
        }
        res = self.post(payload)
        self.assertEqual(res.status_code, 200)
        body = res.json()
        self.assertTrue(body["is_approved"])
        self.assertEqual(body["overtime_hours_a"], 8.0)

    # ---------------------------------------------------------------
    # Requests that cannot be validated at all
    # ---------------------------------------------------------------
    def test_08_swapping_a_day_nobody_works_is_a_400_naming_the_day(self):
        payload = {
            "associate_a_id": "EMP-01",
            "associate_b_id": "EMP-02",
            "day_a_index": 6,   # Sunday, OFF on line 1
            "day_b_index": 2,
            "roster_lines": [
                line(1, ["D", "D", "D", "D", "D", "OFF", "OFF"]),
                line(2, ["OFF", "OFF", "D", "OFF", "OFF", "OFF", "OFF"]),
            ],
        }
        res = self.post(payload)
        self.assertEqual(res.status_code, 400)
        self.assertIn("Sunday", res.json()["detail"])
        self.assertIn("no assigned shift to trade", res.json()["detail"])

    def test_09_an_associate_with_no_line_is_a_400_naming_them(self):
        payload = {
            "associate_a_id": "EMP-99",
            "associate_b_id": "EMP-02",
            "day_a_index": 2,
            "day_b_index": 2,
            "roster_lines": [
                line(1, ["OFF", "OFF", "D", "OFF", "OFF", "OFF", "OFF"]),
                line(2, ["OFF", "OFF", "D", "OFF", "OFF", "OFF", "OFF"]),
            ],
        }
        res = self.post(payload)
        self.assertEqual(res.status_code, 400)
        self.assertIn("EMP-99", res.json()["detail"])
        self.assertIn("does not hold a line", res.json()["detail"])

    def test_10_a_request_with_no_roster_is_refused_rather_than_answered(self):
        """Without the roster there is no source for a verdict, so the request is rejected."""
        res = self.post(
            {
                "associate_a_id": "EMP-01",
                "associate_b_id": "EMP-02",
                "day_a_index": 2,
                "day_b_index": 3,
            }
        )
        self.assertEqual(res.status_code, 422)
        self.assertIn("roster_lines", res.text)

    def test_11_a_shift_cannot_be_traded_with_itself(self):
        payload = {
            "associate_a_id": "EMP-01",
            "associate_b_id": "EMP-01",
            "day_a_index": 2,
            "day_b_index": 2,
            "roster_lines": [line(1, ["OFF", "OFF", "D", "OFF", "OFF", "OFF", "OFF"])],
        }
        res = self.post(payload)
        self.assertEqual(res.status_code, 400)
        self.assertIn("cannot be traded with itself", res.json()["detail"])

    # ---------------------------------------------------------------
    # The swap does not touch anything it was not asked to
    # ---------------------------------------------------------------
    def test_12_the_verdict_reports_the_rotation_effect_without_reshuffling(self):
        payload = {
            "associate_a_id": "EMP-01",
            "associate_b_id": "EMP-02",
            "day_a_index": 1,
            "day_b_index": 2,
            "roster_lines": [
                line(1, ["OFF", "D", "D", "D", "D", "OFF", "OFF"]),
                line(2, ["OFF", "D", "D", "D", "D", "OFF", "OFF"]),
            ],
        }
        body = self.post(payload).json()
        self.assertIn("advances one row", body["next_monday_rotation_impact"])
        self.assertIn("line 1 becomes line 2", body["next_monday_rotation_impact"])
        self.assertIn("line 2 becomes line 1", body["next_monday_rotation_impact"])


if __name__ == "__main__":
    unittest.main()
