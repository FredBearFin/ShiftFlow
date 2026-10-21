"""Two signed-in accounts must never see, change or replay each other's data."""

import os
import unittest
import uuid

from fastapi.testclient import TestClient

from app.claim_legacy_data import claim_legacy_data
from app.database import ShiftFlowRepository, get_db_connection
from app.main import app

FACILITY = "FAC-OMAHA-01"


def new_account(label: str) -> TestClient:
    """A client with its own cookie jar, signed up as a brand-new user."""
    client = TestClient(app, base_url="https://testserver")
    email = f"{label}-{uuid.uuid4().hex[:8]}@example.com"
    response = client.post("/api/auth/signup", json={"email": email, "password": "correcthorse"})
    assert response.status_code == 200, response.text
    return client


class TenantIsolationTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls._previous_secret = os.environ.get("SHIFTFLOW_SESSION_SECRET")
        os.environ["SHIFTFLOW_SESSION_SECRET"] = "t" * 48

    @classmethod
    def tearDownClass(cls):
        if cls._previous_secret is not None:
            os.environ["SHIFTFLOW_SESSION_SECRET"] = cls._previous_secret
        else:
            os.environ.pop("SHIFTFLOW_SESSION_SECRET", None)

    def setUp(self):
        self.a = new_account("alice")
        self.b = new_account("bob")

    def _create(self, client: TestClient, name: str, **extra) -> dict:
        response = client.post("/api/employees", json={"name": name, **extra})
        self.assertEqual(response.status_code, 200, response.text)
        return response.json()

    def test_both_accounts_can_use_the_same_facility_id_privately(self):
        alice = self._create(self.a, "Alice Only")
        bob = self._create(self.b, "Bob Only")

        # Callers always see their own facility id, never the internal owner prefix.
        self.assertEqual(alice["facility_id"], FACILITY)
        self.assertEqual(bob["facility_id"], FACILITY)

        self.assertEqual([e["name"] for e in self.a.get("/api/employees").json()], ["Alice Only"])
        self.assertEqual([e["name"] for e in self.b.get("/api/employees").json()], ["Bob Only"])

    def test_another_accounts_employee_looks_like_it_does_not_exist(self):
        alice = self._create(self.a, "Alice Private", wage=22.0)
        emp_id = alice["id"]

        self.assertEqual(self.b.get(f"/api/employees/{emp_id}").status_code, 404)
        self.assertEqual(self.b.put(f"/api/employees/{emp_id}", json={"name": "Hijacked"}).status_code, 404)
        deactivate = self.b.post(
            f"/api/employees/{emp_id}/deactivate",
            json={
                "separation_category": "voluntary_resignation",
                "separation_reason": "not theirs to separate",
                "recorded_by": "Bob",
            },
        )
        self.assertEqual(deactivate.status_code, 404)
        self.assertEqual(self.b.delete(f"/api/employees/{emp_id}").status_code, 404)

        untouched = self.a.get(f"/api/employees/{emp_id}").json()
        self.assertEqual(untouched["name"], "Alice Private")
        self.assertEqual(untouched["wage"], 22.0)
        self.assertTrue(untouched["active"])

    def test_separation_audits_stay_with_their_account(self):
        alice = self._create(self.a, "Alice Leaving")
        separated = self.a.post(
            f"/api/employees/{alice['id']}/deactivate",
            json={
                "separation_category": "voluntary_resignation",
                "separation_reason": "moved away",
                "recorded_by": "Alice's manager",
            },
        )
        self.assertEqual(separated.status_code, 200, separated.text)

        audits = self.a.get("/api/employees/audits/separations").json()
        self.assertEqual(len(audits), 1)
        self.assertEqual(audits[0]["facility_id"], FACILITY)
        self.assertEqual(self.b.get("/api/employees/audits/separations").json(), [])

        # Another account gets the same 404 as for an employee that never existed, not a 409 that confirms it.
        self.assertEqual(self.b.delete(f"/api/employees/{alice['id']}").status_code, 404)
        self.assertEqual(self.a.delete(f"/api/employees/{alice['id']}").status_code, 409)

    def test_payroll_pos_and_default_solution_cannot_reach_another_accounts_facility(self):
        self._create(self.a, "Alice Payroll")
        csv_file = {"file": ("pos.csv", b"amount,day_of_week,hour_of_day\n10,0,9\n", "text/csv")}

        self.assertEqual(self.b.get("/api/payroll/export/gusto").status_code, 404)
        self.assertEqual(self.b.get("/api/payroll/export/adp").status_code, 404)
        self.assertEqual(self.b.post("/api/pos/upload-csv", files=csv_file).status_code, 404)
        default_solution = self.b.get("/api/v1/schedules/default-solution/downtown_foodmart_omaha")
        self.assertEqual(default_solution.status_code, 404)

        # The owner's own facility is reachable (a 422 means the solver ran on it, not that it was hidden).
        self.assertNotEqual(self.a.get("/api/payroll/export/gusto").status_code, 404)
        self.assertEqual(
            self.a.get("/api/v1/schedules/default-solution/downtown_foodmart_omaha").status_code, 200
        )

    def test_signed_out_requests_reach_nothing(self):
        anonymous = TestClient(app, base_url="https://testserver")
        for path in (
            "/api/employees",
            "/api/employees/audits/separations",
            "/api/payroll/export/gusto",
            "/api/emergency/stored-roster",
            "/api/v1/schedules/default-solution/downtown_foodmart_omaha",
        ):
            self.assertEqual(anonymous.get(path).status_code, 401, path)

    def test_a_stored_roster_and_its_callout_queue_stay_with_their_account(self):
        """assignment_shifts is owner-scoped like every other facility table."""
        self._create(self.a, "Alice Cover", assigned_line=2)
        shifts = [
            {
                "line_number": line_number,
                "cycle_week": line_number,
                "day_index": day,
                "shift_code": "D" if day < 5 else "OFF",
                "start_hour": 10.0 if day < 5 else 0.0,
                "duration_hours": 8.0 if day < 5 else 0.0,
                "rest_hours_before": 24.0,
            }
            for line_number in (1, 2)
            for day in range(7)
        ]

        stored = self.a.put(
            "/api/emergency/stored-roster", json={"facility_id": FACILITY, "shifts": shifts}
        )
        self.assertEqual(stored.status_code, 200, stored.text)
        self.assertEqual(stored.json()["slots_stored"], 14)
        self.assertEqual(stored.json()["facility_id"], FACILITY)

        # Bob uses the same facility id. He has no facility row of his own yet, so his
        # read and write of "FAC-OMAHA-01" reach nothing, and a 404 does not tell him
        # whether anyone else has one.
        self.assertEqual(self.b.get(f"/api/emergency/stored-roster?facility_id={FACILITY}").status_code, 404)
        self.assertEqual(
            self.b.put("/api/emergency/stored-roster", json={"facility_id": FACILITY, "shifts": shifts}).status_code,
            404,
        )
        self.assertEqual(
            self.b.post(
                "/api/emergency/callout-replacement",
                json={"facility_id": FACILITY, "target_day_index": 5, "target_shift_code": "D"},
            ).status_code,
            404,
        )

        # Once Bob has his own facility, his roster is empty: Alice's 14 slots are not his.
        self._create(self.b, "Bob Cover", assigned_line=2)
        self.assertEqual(
            self.b.get(f"/api/emergency/stored-roster?facility_id={FACILITY}").json()["slots_stored"], 0
        )
        self.assertEqual(
            self.a.get(f"/api/emergency/stored-roster?facility_id={FACILITY}").json()["slots_stored"], 14
        )

        # And Bob's callout is refused for having no roster, not answered from Alice's.
        bob_callout = self.b.post(
            "/api/emergency/callout-replacement",
            json={"facility_id": FACILITY, "target_day_index": 5, "target_shift_code": "D", "line_number": 1},
        )
        self.assertEqual(bob_callout.status_code, 409)
        self.assertIn("No roster is stored", bob_callout.json()["detail"])
        self.assertNotIn("Alice Cover", bob_callout.text)

    def test_idempotency_keys_are_private_per_account(self):
        key = f"shared-key-{uuid.uuid4().hex}"
        body = {"name": "Same Body"}

        first = self.a.post("/api/employees", json=body, headers={"Idempotency-Key": key})
        self.assertEqual(first.status_code, 200)
        self.assertEqual(first.headers.get("x-cache-lookup"), "MISS-STORED")

        # The same key and body from a different account must run for real, not replay Alice's response.
        second = self.b.post("/api/employees", json=body, headers={"Idempotency-Key": key})
        self.assertEqual(second.status_code, 200)
        self.assertEqual(second.headers.get("x-cache-lookup"), "MISS-STORED")
        self.assertNotEqual(second.json()["id"], first.json()["id"])
        self.assertEqual(len(self.b.get("/api/employees").json()), 1)

        # Within one account the replay still works.
        replay = self.a.post("/api/employees", json=body, headers={"Idempotency-Key": key})
        self.assertEqual(replay.headers.get("x-cache-lookup"), "HIT-IDEMPOTENT")
        self.assertEqual(replay.json()["id"], first.json()["id"])
        self.assertEqual(len(self.a.get("/api/employees").json()), 1)


class ClaimLegacyDataTests(unittest.TestCase):
    """Facility data written before accounts existed can be assigned to one user, once."""

    def _legacy_facility(self, facility_id: str) -> str:
        conn = get_db_connection()
        try:
            repo = ShiftFlowRepository(conn)  # unscoped: stores the plain id, exactly as old versions did
            repo.upsert_facility(facility_id, "Old Store", "", "", [[0] * 24 for _ in range(7)], [])
            emp = repo.create_employee(facility_id, "Old Hand", "Clerk", 18.0, [0, 1, 2])
            repo.deactivate_employee(emp["id"], "voluntary_resignation", "moved", "Old Manager")
            repo.save_roster_snapshot(facility_id, 1, 0, {"lines": []})
            repo.replace_assignment_shifts(
                facility_id,
                [
                    {
                        "line_number": 1,
                        "cycle_week": 1,
                        "day_index": d,
                        "shift_code": "D",
                        "employee_id": emp["id"],
                        "start_hour": 10.0,
                        "duration_hours": 8.0,
                        "rest_hours_before": 24.0,
                    }
                    for d in range(7)
                ],
            )
            return emp["id"]
        finally:
            conn.close()

    def test_claim_moves_old_data_to_the_chosen_account_only(self):
        facility_id = f"LEGACY-{uuid.uuid4().hex[:6].upper()}"
        emp_id = self._legacy_facility(facility_id)

        conn = get_db_connection()
        try:
            moved = claim_legacy_data(conn, "USR-CLAIMER1")
            self.assertGreaterEqual(moved["facilities"], 1)
            self.assertGreaterEqual(moved["employees"], 1)
            self.assertGreaterEqual(moved["separation_audits"], 1)
            self.assertGreaterEqual(moved["roster_snapshots"], 1)
            self.assertGreaterEqual(moved["assignment_shifts"], 7)
            self.assertEqual(conn.execute("PRAGMA foreign_key_check;").fetchall(), [])

            owner = ShiftFlowRepository(conn, owner_id="USR-CLAIMER1")
            self.assertEqual(owner.get_facility(facility_id)["name"], "Old Store")
            self.assertEqual([e["name"] for e in owner.list_employees(facility_id)], ["Old Hand"])
            self.assertEqual(len(owner.list_separation_audits(facility_id)), 1)
            self.assertEqual(len(owner.list_roster_snapshots(facility_id)), 1)
            self.assertEqual(len(owner.list_assignment_shifts(facility_id)), 7)
            self.assertEqual(owner.get_employee(emp_id)["facility_id"], facility_id)

            stranger = ShiftFlowRepository(conn, owner_id="USR-STRANGER9")
            self.assertIsNone(stranger.get_facility(facility_id))
            self.assertIsNone(stranger.get_employee(emp_id))
            self.assertEqual(stranger.list_assignment_shifts(facility_id), [])

            # Running it again finds nothing left to move, so it cannot re-assign claimed data.
            again = claim_legacy_data(conn, "USR-SOMEONE99")
            self.assertEqual(sum(again.values()), 0)
            self.assertIsNone(ShiftFlowRepository(conn, owner_id="USR-SOMEONE99").get_facility(facility_id))
        finally:
            conn.close()

    def test_foreign_keys_are_back_on_after_a_claim(self):
        conn = get_db_connection()
        try:
            claim_legacy_data(conn, "USR-CLAIMER2")
            self.assertEqual(conn.execute("PRAGMA foreign_keys;").fetchone()[0], 1)
        finally:
            conn.close()


if __name__ == "__main__":
    unittest.main()
