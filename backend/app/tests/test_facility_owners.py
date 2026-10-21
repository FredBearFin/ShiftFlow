"""A manager can invite a second, independent "owner" login onto their facility/account.

Covers what the feature exists for:
  - an invited owner can sign in separately and see a quick-glance labor-cost summary
  - once accepted, that owner also gets full read/act access to the *same* facility data
    the manager sees - the real roster, labor analysis, coverage, schedule solves, etc. -
    through the same endpoints the manager uses, not a separate read-only API surface
  - a non-linked account never reaches any of it, only ever its own (empty) data
  - the facility's data (and the owner's access to it) survives the manager's login
    being deleted - because facility/employee rows and facility_owners links are keyed
    by a plain string id, never by a foreign key to the `users` table.
"""

import os
import unittest
import uuid

from fastapi.testclient import TestClient

from app.database import ShiftFlowRepository, get_db_connection, init_db
from app.main import app

FACILITY = "FAC-OMAHA-01"


def new_account(label: str) -> TestClient:
    """A client with its own cookie jar, signed up as a brand-new user."""
    client = TestClient(app, base_url="https://testserver")
    email = f"{label}-{uuid.uuid4().hex[:8]}@example.com"
    response = client.post("/api/auth/signup", json={"email": email, "password": "correcthorse"})
    assert response.status_code == 200, response.text
    return client, email


class FacilityOwnerInviteTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        init_db()
        cls._previous_secret = os.environ.get("SHIFTFLOW_SESSION_SECRET")
        os.environ["SHIFTFLOW_SESSION_SECRET"] = "t" * 48

    @classmethod
    def tearDownClass(cls):
        if cls._previous_secret is not None:
            os.environ["SHIFTFLOW_SESSION_SECRET"] = cls._previous_secret
        else:
            os.environ.pop("SHIFTFLOW_SESSION_SECRET", None)

    def setUp(self):
        self.manager, self.manager_email = new_account("manager")
        # Creating an employee is what causes a facility row to exist (see employee_routes).
        created = self.manager.post(
            "/api/employees", json={"name": "Alex Associate", "wage": 20.0, "available_days": [0, 1, 2, 3, 4]}
        )
        self.assertEqual(created.status_code, 200, created.text)

    def _invite(self, owner_email: str) -> dict:
        resp = self.manager.post("/api/owners/invite", json={"facility_id": FACILITY, "owner_email": owner_email})
        self.assertEqual(resp.status_code, 200, resp.text)
        return resp.json()

    @staticmethod
    def _unique_owner_email(label: str) -> str:
        return f"{label}-{uuid.uuid4().hex[:8]}@example.com"

    def test_invite_requires_login(self):
        anon = TestClient(app, base_url="https://testserver")
        resp = anon.post(
            "/api/owners/invite",
            json={"facility_id": FACILITY, "owner_email": self._unique_owner_email("owner")},
        )
        self.assertEqual(resp.status_code, 401)

    def test_invite_refused_for_a_facility_the_caller_does_not_own(self):
        other_manager, _ = new_account("other-manager")
        resp = other_manager.post(
            "/api/owners/invite",
            json={"facility_id": FACILITY, "owner_email": self._unique_owner_email("owner")},
        )
        self.assertEqual(resp.status_code, 404)

    def test_invite_response_includes_a_shareable_link_not_a_sent_email(self):
        owner_email = self._unique_owner_email("owner")
        invite = self._invite(owner_email)
        self.assertEqual(invite["facility_id"], FACILITY)
        self.assertEqual(invite["owner_email"], owner_email)
        self.assertTrue(invite["accept_path"].startswith("/api/owners/accept/"))
        self.assertIn("would be emailed", invite["note"])

    def test_preview_invite_needs_no_login(self):
        owner_email = self._unique_owner_email("owner")
        invite = self._invite(owner_email)
        anon = TestClient(app, base_url="https://testserver")
        resp = anon.get(invite["accept_path"])
        self.assertEqual(resp.status_code, 200, resp.text)
        body = resp.json()
        self.assertEqual(body["owner_email"], owner_email)
        self.assertFalse(body["already_accepted"])

    def test_owner_can_accept_log_in_separately_and_read_the_summary(self):
        invite = self._invite(self._unique_owner_email("owner"))

        owner_client = TestClient(app, base_url="https://testserver")
        accept = owner_client.post(invite["accept_path"], json={"password": "ownerpassword1"})
        self.assertEqual(accept.status_code, 200, accept.text)
        self.assertEqual(accept.json()["status"], "created")

        summary = owner_client.get(f"/api/owners/facility/{FACILITY}/summary")
        self.assertEqual(summary.status_code, 200, summary.text)
        body = summary.json()
        self.assertEqual(body["facility_id"], FACILITY)
        self.assertEqual(body["active_employee_count"], 1)
        self.assertGreater(body["estimated_weekly_payroll"], 0)

        # Beyond the summary: the owner's session now also reaches the manager's normal,
        # previously manager-only employee endpoint for this facility, and sees the real
        # roster - not a separate, empty account of their own.
        full_access = owner_client.get("/api/employees")
        self.assertEqual(full_access.status_code, 200)
        self.assertEqual(len(full_access.json()), 1)
        self.assertEqual(full_access.json()[0]["name"], "Alex Associate")

        # The owner shows up in the manager's invite list as accepted.
        invites = self.manager.get(f"/api/owners/facility/{FACILITY}/invites").json()
        self.assertEqual(len(invites), 1)
        self.assertIsNotNone(invites[0]["accepted_at"])

        # my-links reports the facility back to the owner.
        links = owner_client.get("/api/owners/my-links").json()
        self.assertEqual([l["facility_id"] for l in links], [FACILITY])

    def test_accepted_owner_can_act_on_the_real_facility_not_just_read_it(self):
        """The owner doesn't just see the manager's data - they can change it, and the
        manager sees those changes too, because it is the same shared facility, not a
        separate copy under the owner's own account."""
        invite = self._invite(self._unique_owner_email("owner"))
        owner_client = TestClient(app, base_url="https://testserver")
        accept = owner_client.post(invite["accept_path"], json={"password": "ownerpassword1"})
        self.assertEqual(accept.status_code, 200, accept.text)

        existing_id = owner_client.get("/api/employees").json()[0]["id"]

        # Act 1: add a new hire through the previously manager-only create-employee route.
        created = owner_client.post(
            "/api/employees",
            json={"facility_id": FACILITY, "name": "Owner-Added Hire", "wage": 18.0, "available_days": [0, 1, 2]},
        )
        self.assertEqual(created.status_code, 200, created.text)
        manager_view = self.manager.get("/api/employees").json()
        self.assertEqual(len(manager_view), 2)
        self.assertIn("Owner-Added Hire", [e["name"] for e in manager_view])

        # Act 2: edit an existing employee's real record.
        updated = owner_client.put(f"/api/employees/{existing_id}", json={"wage": 22.5})
        self.assertEqual(updated.status_code, 200, updated.text)
        self.assertEqual(self.manager.get(f"/api/employees/{existing_id}").json()["wage"], 22.5)

        # Act 3: the owner can also trigger a fresh solve for this facility, not just read
        # a pre-computed number - the schedule-solving endpoint, not the summary endpoint.
        solved = owner_client.get(
            "/api/v1/schedules/default-solution/healthcare_24_7", params={"facility_id": FACILITY}
        )
        self.assertEqual(solved.status_code, 200, solved.text)
        self.assertGreater(len(solved.json()["roster_lines"]), 0)

    def test_a_stranger_cannot_act_on_the_facility_either(self):
        """A non-linked account stays fully isolated: it can create/act on data only under
        its own (different) account, and the manager's real facility never sees it."""
        self._invite(self._unique_owner_email("owner"))
        stranger, _ = new_account("stranger")

        self.assertEqual(stranger.get("/api/employees").json(), [])

        created = stranger.post(
            "/api/employees",
            json={"facility_id": FACILITY, "name": "Should Not Land Here", "wage": 10.0, "available_days": [0]},
        )
        self.assertEqual(created.status_code, 200, created.text)

        # The stranger's write landed in their own account's facility, not the manager's.
        self.assertEqual(len(stranger.get("/api/employees").json()), 1)
        manager_view = self.manager.get("/api/employees").json()
        self.assertEqual(len(manager_view), 1)
        self.assertNotIn("Should Not Land Here", [e["name"] for e in manager_view])

    def test_owner_link_to_one_manager_does_not_grant_access_to_another_managers_facility(self):
        """An accepted link is scoped to the facility/manager it was issued for - it must
        not widen into blanket access to every facility using that same plain id string."""
        other_manager, _ = new_account("other-manager")
        other_created = other_manager.post(
            "/api/employees",
            json={"name": "Other Manager's Hire", "wage": 15.0, "available_days": [0, 1]},
        )
        self.assertEqual(other_created.status_code, 200, other_created.text)

        invite = self._invite(self._unique_owner_email("owner"))
        owner_client = TestClient(app, base_url="https://testserver")
        accept = owner_client.post(invite["accept_path"], json={"password": "ownerpassword1"})
        self.assertEqual(accept.status_code, 200, accept.text)

        # The owner is linked only to self.manager's facility, so they still see exactly
        # that one employee - never other_manager's, despite the identical facility id.
        visible = owner_client.get("/api/employees").json()
        self.assertEqual(len(visible), 1)
        self.assertEqual(visible[0]["name"], "Alex Associate")

    def test_owner_invited_to_one_facility_cannot_reach_the_managers_other_facility(self):
        """An accepted invite grants access to the facility it named - not to every other
        facility the same manager happens to own. (Regression test: linked_manager_ids used
        to grant access manager-wide instead of being scoped per invited facility.)"""
        secret_created = self.manager.post(
            "/api/employees",
            json={
                "facility_id": "FAC-SECRET-TWO",
                "name": "Secret Employee",
                "wage": 99.0,
                "available_days": [0, 1, 2],
            },
        )
        self.assertEqual(secret_created.status_code, 200, secret_created.text)

        # Invite is for FACILITY ("FAC-OMAHA-01") only - never FAC-SECRET-TWO.
        invite = self._invite(self._unique_owner_email("owner"))
        owner_client = TestClient(app, base_url="https://testserver")
        accept = owner_client.post(invite["accept_path"], json={"password": "ownerpassword1"})
        self.assertEqual(accept.status_code, 200, accept.text)

        # The invited facility is reachable, as expected.
        own_facility = owner_client.get("/api/employees", params={"facility_id": FACILITY})
        self.assertEqual(own_facility.status_code, 200)
        self.assertEqual([e["name"] for e in own_facility.json()], ["Alex Associate"])

        # The manager's *other* facility must not be reachable through the same link -
        # the owner should see nothing (their own, separate, empty FAC-SECRET-TWO), never
        # the manager's "Secret Employee" row.
        other_facility = owner_client.get("/api/employees", params={"facility_id": "FAC-SECRET-TWO"})
        self.assertEqual(other_facility.status_code, 200)
        names = [e["name"] for e in other_facility.json()]
        self.assertNotIn("Secret Employee", names)
        self.assertEqual(names, [])

        # Nor can the owner read/act on it through the owner-summary endpoint either.
        summary = owner_client.get("/api/owners/facility/FAC-SECRET-TWO/summary")
        self.assertEqual(summary.status_code, 404)

    def test_accept_refused_when_an_account_with_that_email_already_exists(self):
        existing_owner, existing_email = new_account("existing-owner")
        invite = self._invite(existing_email)

        resp = TestClient(app, base_url="https://testserver").post(
            invite["accept_path"], json={"password": "whatever123"}
        )
        self.assertEqual(resp.status_code, 409)

        # The already-signed-in owner can instead link their existing account to the invite.
        link_resp = existing_owner.post(invite["accept_path"], json={})
        self.assertEqual(link_resp.status_code, 200, link_resp.text)
        self.assertEqual(link_resp.json()["status"], "linked")

        summary = existing_owner.get(f"/api/owners/facility/{FACILITY}/summary")
        self.assertEqual(summary.status_code, 200, summary.text)

    def test_a_stranger_cannot_read_the_summary(self):
        self._invite(self._unique_owner_email("owner"))
        stranger, _ = new_account("stranger")
        resp = stranger.get(f"/api/owners/facility/{FACILITY}/summary")
        self.assertEqual(resp.status_code, 404)

    def test_facility_and_employee_data_survive_deleting_the_managers_login(self):
        owner_email = self._unique_owner_email("owner")
        invite = self._invite(owner_email)
        owner_client = TestClient(app, base_url="https://testserver")
        accept = owner_client.post(invite["accept_path"], json={"password": "ownerpassword1"})
        self.assertEqual(accept.status_code, 200, accept.text)

        # Find the manager's user id the way the session cookie encodes it, then delete that login.
        conn = get_db_connection()
        try:
            manager_user = ShiftFlowRepository(conn).get_user_by_email(self.manager_email)
            manager_user_id = manager_user["id"]
            deleted = ShiftFlowRepository(conn).delete_user(manager_user_id)
            self.assertTrue(deleted)
            self.assertIsNone(ShiftFlowRepository(conn).get_user_by_email(self.manager_email))

            # The facility and its employee are untouched - still reachable under the same
            # manager_user_id string, even though no `users` row for it exists any more.
            repo = ShiftFlowRepository(conn, owner_id=manager_user_id)
            self.assertIsNotNone(repo.get_facility(FACILITY))
            self.assertEqual(len(repo.list_employees(FACILITY)), 1)
        finally:
            conn.close()

        # And the invited owner, who never had anything to do with that login, can still log
        # in separately and read the facility's labor-cost summary.
        still_owner_client = TestClient(app, base_url="https://testserver")
        login = still_owner_client.post(
            "/api/auth/login", json={"email": owner_email, "password": "ownerpassword1"}
        )
        self.assertEqual(login.status_code, 200, login.text)
        summary = still_owner_client.get(f"/api/owners/facility/{FACILITY}/summary")
        self.assertEqual(summary.status_code, 200, summary.text)
        self.assertEqual(summary.json()["active_employee_count"], 1)

        # The manager's own (deleted) session cookie no longer authenticates anything.
        self.assertEqual(self.manager.get("/api/employees").status_code, 401)


if __name__ == "__main__":
    unittest.main()
