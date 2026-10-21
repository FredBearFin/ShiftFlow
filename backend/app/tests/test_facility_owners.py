"""A manager can invite a second, independent "owner" login onto their facility/account.

Covers the two things the feature exists for:
  - an invited owner can sign in separately and see a read-only labor-cost summary
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

        # Read-only: the owner cannot reach the manager's normal, non-owner-scoped data,
        # because their own session is scoped to their own (empty) account as usual.
        self.assertEqual(owner_client.get("/api/employees").status_code, 200)
        self.assertEqual(owner_client.get("/api/employees").json(), [])

        # The owner shows up in the manager's invite list as accepted.
        invites = self.manager.get(f"/api/owners/facility/{FACILITY}/invites").json()
        self.assertEqual(len(invites), 1)
        self.assertIsNotNone(invites[0]["accepted_at"])

        # my-links reports the facility back to the owner.
        links = owner_client.get("/api/owners/my-links").json()
        self.assertEqual([l["facility_id"] for l in links], [FACILITY])

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
