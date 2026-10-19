"""
Automated Unit & Integration Tests: Shift Handover & Floor Operations Engine
----------------------------------------------------------------------------
Verifies Morning to Midday handover mechanics, 3.0-hour overlap buffers,
cash till reconciliation variance checks, custom turnover task input, and checklist state transitions.
"""

import unittest
from fastapi.testclient import TestClient

from app.main import app
from app.engine.shift_handover import ShiftHandoverEngine


class TestShiftHandover(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.client = TestClient(app)

    def test_01_checklist_categories_and_items(self):
        """Verifies standard checklists cover multiple industry archetypes."""
        # 1. General retail archetype
        checklists_gr = ShiftHandoverEngine.get_standard_handover_checklists("general_retail")
        self.assertIn("morning_to_midday", checklists_gr)
        self.assertIn("closing_to_opening", checklists_gr)
        gr_tasks = " ".join(item.task.lower() for item in checklists_gr["morning_to_midday"])
        self.assertIn("drawer", gr_tasks)
        self.assertIn("floor", gr_tasks)

        # 2. Cashless boutique archetype
        checklists_cb = ShiftHandoverEngine.get_standard_handover_checklists("cashless_boutique")
        cb_tasks = " ".join(item.task.lower() for item in checklists_cb["morning_to_midday"])
        self.assertIn("tablet", cb_tasks)
        self.assertIn("fitting room", cb_tasks)

        # 3. Convenience specialty archetype
        checklists_cs = ShiftHandoverEngine.get_standard_handover_checklists("convenience_specialty")
        cs_tasks = " ".join(item.task.lower() for item in checklists_cs["morning_to_midday"])
        self.assertIn("lottery", cs_tasks)

    def test_02_overlap_duration_and_friction_reduction(self):
        """Verifies 3.0-hour Morning-to-Midday overlap duration and low friction index."""
        metrics = ShiftHandoverEngine.calculate_overlap_metrics()
        self.assertEqual(len(metrics), 3)

        mm_metric = next(m for m in metrics if "Morning to Midday" in m.transition_name)
        self.assertEqual(mm_metric.overlap_duration_hours, 3.0)
        self.assertTrue(mm_metric.staggered_lunch_coverage)
        self.assertLess(mm_metric.friction_index_pct, 5.0)

    def test_03_till_audit_reconciliation_math(self):
        """Verifies cash till reconciliation variance and status detection."""
        till_audits = ShiftHandoverEngine.get_mock_till_audits()
        for audit in till_audits:
            self.assertEqual(audit.opening_float, 200.00)
            self.assertEqual(audit.retained_float, 200.00)
            self.assertEqual(audit.variance, 0.00)
            self.assertEqual(audit.status, "balanced")

    def test_04_fastapi_handover_endpoints(self):
        """Verifies all FastAPI shift handover REST endpoints return status 200."""
        # 1. Audit report endpoint
        resp1 = self.client.get("/api/handover/audit/FAC-OMAHA-01")
        self.assertEqual(resp1.status_code, 200)
        data1 = resp1.json()
        self.assertIn("overall_handover_health_score", data1)
        self.assertGreaterEqual(data1["overall_handover_health_score"], 90.0)

        # 2. Checklists endpoint
        resp2 = self.client.get("/api/handover/checklists/FAC-OMAHA-01")
        self.assertEqual(resp2.status_code, 200)
        data2 = resp2.json()
        self.assertIn("morning_to_midday", data2)

        # 3. Overlap analysis endpoint
        resp3 = self.client.get("/api/handover/overlap-analysis")
        self.assertEqual(resp3.status_code, 200)
        data3 = resp3.json()
        self.assertIn("overlap_metrics", data3)

        # 4. Checklist item toggle endpoint
        resp4 = self.client.post("/api/handover/checklist-toggle", json={
            "item_id": "CHK-GR-01",
            "facility_id": "FAC-OMAHA-01",
            "new_status": "completed",
            "verified_by": "Sarah Kowalski (Supervisor)"
        })
        self.assertEqual(resp4.status_code, 200)
        self.assertEqual(resp4.json()["status"], "updated")

        # 5. Till audit submission endpoint
        resp5 = self.client.post("/api/handover/till-audit", json={
            "register_id": "Register 01",
            "facility_id": "FAC-OMAHA-01",
            "opening_float": 200.00,
            "closing_cash_counted": 1045.00,
            "cash_dropped_to_safe": 845.00,
            "expected_system_cash": 1045.00,
            "audited_by": "Marcus Vance",
            "witnessed_by": "Devon Taylor"
        })
        self.assertEqual(resp5.status_code, 200)
        self.assertEqual(resp5.json()["reconciliation_status"], "balanced")
        self.assertEqual(resp5.json()["variance"], 0.0)

    def test_05_custom_turnover_task_input(self):
        """Verifies supervisors can dynamically input custom turnover tasks into checklists."""
        payload = {
            "checklist_type": "morning_to_midday",
            "category": "Facilities & Ice",
            "task": "Inspect outdoor ice merchandiser lock & restock 10lb bags",
            "responsible_shift": "Morning (06:00–14:00)",
            "verified_by_shift": "Midday (11:00–19:00)",
            "assigned_role": "Inventory Specialist",
            "notes": "Outdoor merchandiser padlock oiled and 20 ice bags restocked from walk-in."
        }
        resp = self.client.post("/api/handover/task", json=payload)
        self.assertEqual(resp.status_code, 200)
        task_data = resp.json()
        self.assertIn("CHK-CUST", task_data["id"])
        self.assertEqual(task_data["task"], payload["task"])
        self.assertEqual(task_data["status"], "pending")

        # Verify task is returned in the checklists endpoint
        resp2 = self.client.get("/api/handover/checklists/FAC-OMAHA-01")
        self.assertEqual(resp2.status_code, 200)
        mm_list = resp2.json()["morning_to_midday"]
        self.assertTrue(any("ice merchandiser" in item["task"].lower() for item in mm_list))


if __name__ == "__main__":
    unittest.main()
