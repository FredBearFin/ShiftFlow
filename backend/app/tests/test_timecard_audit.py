"""Unit tests for Wage and Hour regulatory compliance engine and REST API routes."""

import datetime
import unittest
from fastapi.testclient import TestClient

from app.engine.timecard_audit import TimecardAuditor
from app.main import app


class TestTimecardAuditor(unittest.TestCase):
    """Verifies FLSA Part 785, Part 778, and Part 516 statutory compliance."""

    def setUp(self):
        self.client = TestClient(app)

    def test_01_seven_minute_rounding_rules_29_cfr_785_48(self):
        """Verifies 29 C.F.R. § 785.48(b) 15-minute / 7-minute boundary rounding."""
        base = datetime.datetime(2026, 10, 19, 8, 0, 0)

        # 08:00:00 -> 08:00
        self.assertEqual(TimecardAuditor.round_punch(base), base)

        # 08:07:00 (7 min) -> rounds DOWN to 08:00
        p_down = base + datetime.timedelta(minutes=7)
        self.assertEqual(TimecardAuditor.round_punch(p_down), base)

        # 08:08:00 (8 min) -> rounds UP to 08:15
        p_up = base + datetime.timedelta(minutes=8)
        expected_15 = base + datetime.timedelta(minutes=15)
        self.assertEqual(TimecardAuditor.round_punch(p_up), expected_15)

        # 08:22:00 (22 min = 15 + 7) -> rounds DOWN to 08:15
        p_22 = base + datetime.timedelta(minutes=22)
        self.assertEqual(TimecardAuditor.round_punch(p_22), expected_15)

        # 08:23:00 (23 min = 15 + 8) -> rounds UP to 08:30
        p_23 = base + datetime.timedelta(minutes=23)
        expected_30 = base + datetime.timedelta(minutes=30)
        self.assertEqual(TimecardAuditor.round_punch(p_23), expected_30)

        # 08:53:00 (53 min = 45 + 8) -> rounds UP to 09:00
        p_53 = base + datetime.timedelta(minutes=53)
        expected_next_hr = base + datetime.timedelta(hours=1)
        self.assertEqual(TimecardAuditor.round_punch(p_53), expected_next_hr)

    def test_02_statistical_neutrality_audit(self):
        """Verifies that timecard rounding averages out neutrals over typical retail punch cycles."""
        punches = [
            (datetime.datetime(2026, 10, 19, 5, 56), datetime.datetime(2026, 10, 19, 14, 4)),
            (datetime.datetime(2026, 10, 20, 6, 3), datetime.datetime(2026, 10, 20, 13, 58)),
            (datetime.datetime(2026, 10, 21, 5, 52), datetime.datetime(2026, 10, 21, 14, 1)),
            (datetime.datetime(2026, 10, 22, 6, 7), datetime.datetime(2026, 10, 22, 14, 8)),
        ]

        audit = TimecardAuditor.audit_rounding_neutrality(punches)
        self.assertTrue(audit["flsa_785_48_compliant"])
        self.assertFalse(audit["employer_favorable_bias"])
        self.assertTrue(audit["statutorily_neutral"])

    def test_03_standalone_workweek_overtime_29_cfr_778_104(self):
        """Verifies single standalone workweek overtime calculation and zero cross-week averaging."""
        daily_w1 = [8.0, 8.0, 8.0, 8.0, 12.0, 0.0, 0.0]
        res_w1 = TimecardAuditor.calculate_standalone_workweek(daily_w1, hourly_wage=20.0)

        self.assertEqual(res_w1["workweek_hours_total"], 44.0)
        self.assertEqual(res_w1["regular_hours"], 40.0)
        self.assertEqual(res_w1["overtime_hours"], 4.0)
        self.assertEqual(res_w1["regular_pay"], 800.0)
        self.assertEqual(res_w1["overtime_pay"], 120.0)
        self.assertEqual(res_w1["total_gross_pay"], 920.0)

        daily_w2 = [8.0, 8.0, 8.0, 8.0, 4.0, 0.0, 0.0]
        res_w2 = TimecardAuditor.calculate_standalone_workweek(daily_w2, hourly_wage=20.0)
        self.assertEqual(res_w2["regular_hours"], 36.0)
        self.assertEqual(res_w2["overtime_hours"], 0.0)
        self.assertEqual(res_w2["total_gross_pay"], 720.0)

        combined_gross = res_w1["total_gross_pay"] + res_w2["total_gross_pay"]
        self.assertEqual(combined_gross, 1640.0)

    def test_04_recordkeeping_retention_audit_29_cfr_516_5(self):
        """Verifies 29 C.F.R. § 516.5 mandatory record schema completeness."""
        compliant_records = [
            {
                "employee_id": "EMP-01",
                "workweek_start": "Monday 00:00",
                "hourly_wage": 22.0,
                "daily_hours": [8.0, 8.0, 8.0, 8.0, 0.0, 0.0, 0.0],
                "weekly_regular_hours": 32.0,
                "weekly_overtime_hours": 0.0,
                "straight_time_earnings": 704.0,
                "overtime_earnings": 0.0,
                "total_gross_pay": 704.0,
                "timestamp": "2026-10-19T00:00:00Z",
            },
        ]

        audit = TimecardAuditor.audit_recordkeeping_compliance(compliant_records)
        self.assertTrue(audit["cfr_516_5_compliant"])
        self.assertEqual(audit["deficiency_count"], 0)
        self.assertEqual(audit["retention_policy_years"], 3)
        self.assertIn("PASS", audit["audit_readiness_verdict"])

    def test_05_fastapi_compliance_endpoints(self):
        """Verifies all FastAPI wage and hour compliance REST endpoints respond with status 200."""
        # 1. Timecard Rounding Audit
        res1 = self.client.get("/api/compliance/timecard-rounding-audit?sample_size=100")
        self.assertEqual(res1.status_code, 200)
        data1 = res1.json()
        self.assertTrue(data1["flsa_785_48_compliant"])
        self.assertEqual(data1["total_shifts_audited"], 100)

        # 2. Standalone Workweek Overtime Audit
        res2 = self.client.get("/api/compliance/workweek-overtime-audit?hourly_wage=18.00")
        self.assertEqual(res2.status_code, 200)
        data2 = res2.json()
        self.assertTrue(data2["prohibition_of_averaging"]["is_enforced"])

        # 3. Recordkeeping Certificate
        res3 = self.client.get("/api/compliance/recordkeeping-certificate")
        self.assertEqual(res3.status_code, 200)
        data3 = res3.json()
        self.assertIn("CERT-FLSA-516", data3["certificate_id"])

        # 4. Custom Rounding Neutrality Test POST
        payload = {
            "interval_minutes": 15,
            "punch_pairs": [
                {"clock_in": "2026-10-19T05:58:00", "clock_out": "2026-10-19T14:02:00"},
                {"clock_in": "2026-10-20T10:55:00", "clock_out": "2026-10-20T19:04:00"},
            ],
        }
        res4 = self.client.post("/api/compliance/test-rounding-neutrality", json=payload)
        self.assertEqual(res4.status_code, 200)
        data4 = res4.json()
        self.assertEqual(data4["total_shifts_audited"], 2)


if __name__ == "__main__":
    unittest.main()
