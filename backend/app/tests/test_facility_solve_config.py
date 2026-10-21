"""The onboarding wizard's solve configuration (demand matrix, shift templates,
ergonomic guardrails) is saved server-side, keyed to the facility, through the same
owner-aware get_repo scoping as every other facility-scoped route (see app/deps.py and
app/api/facility_config_routes.py):

  - a manager can save and read back their own configuration
  - an *accepted* business-owner (app/api/owner_routes.py) reads the exact same
    configuration the manager saved - not a default, not a separate copy
  - a non-linked account ("stranger") never sees it, only ever its own (absent) config
  - reading before anything was ever saved is a plain 404, not a default blob
"""

import os
import unittest
import uuid

from fastapi.testclient import TestClient

from app.database import init_db
from app.main import app

FACILITY = "FAC-OMAHA-01"

SAMPLE_CONFIG = {
    "archetype_id": "custom",
    "facility_name": "Riverside Pharmacy",
    "demand_matrix": [[5] * 24 for _ in range(7)],
    "templates": [
        {
            "code": "M",
            "name": "Morning",
            "earliest_start": 5,
            "latest_end": 15,
            "min_duration": 7,
            "max_duration": 9,
            "preferred_start": 6,
            "preferred_duration": 8,
            "enabled": True,
        }
    ],
    "guardrails": {
        "min_consecutive_work_days": 3,
        "max_consecutive_work_days": 5,
        "min_consecutive_rest_days": 2,
        "max_consecutive_rest_days": 3,
        "max_consecutive_nights": 2,
        "max_consecutive_evenings": 3,
        "enforce_forward_rotation": True,
        "enforce_zero_clopening": True,
        "avoid_single_rest_days": True,
        "avoid_single_night_shifts": True,
        "prioritize_free_weekends": True,
    },
    "pareto_leeway_pct": 22.5,
    "rotation_week_offset": 0,
}


def new_account(label: str) -> "tuple[TestClient, str]":
    """A client with its own cookie jar, signed up as a brand-new user."""
    client = TestClient(app, base_url="https://testserver")
    email = f"{label}-{uuid.uuid4().hex[:8]}@example.com"
    response = client.post("/api/auth/signup", json={"email": email, "password": "correcthorse"})
    assert response.status_code == 200, response.text
    return client, email


class FacilitySolveConfigTests(unittest.TestCase):
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
        # Creating an employee is what causes a facility row to exist (see employee_routes),
        # which is also what lets an owner invite's facility_id resolve at all.
        created = self.manager.post(
            "/api/employees", json={"name": "Alex Associate", "wage": 20.0, "available_days": [0, 1, 2, 3, 4]}
        )
        self.assertEqual(created.status_code, 200, created.text)

    @staticmethod
    def _unique_owner_email(label: str) -> str:
        return f"{label}-{uuid.uuid4().hex[:8]}@example.com"

    def _invite_and_accept(self) -> TestClient:
        invite = self.manager.post(
            "/api/owners/invite",
            json={"facility_id": FACILITY, "owner_email": self._unique_owner_email("owner")},
        )
        self.assertEqual(invite.status_code, 200, invite.text)
        owner_client = TestClient(app, base_url="https://testserver")
        accept = owner_client.post(invite.json()["accept_path"], json={"password": "ownerpassword1"})
        self.assertEqual(accept.status_code, 200, accept.text)
        return owner_client

    def test_reading_before_any_save_is_404(self):
        resp = self.manager.get("/api/facility-config", params={"facility_id": FACILITY})
        self.assertEqual(resp.status_code, 404)

    def test_manager_can_save_and_read_back_their_own_configuration(self):
        saved = self.manager.put(
            "/api/facility-config",
            params={"facility_id": FACILITY},
            json={"config": SAMPLE_CONFIG},
        )
        self.assertEqual(saved.status_code, 200, saved.text)
        self.assertEqual(saved.json()["config"], SAMPLE_CONFIG)
        self.assertEqual(saved.json()["facility_id"], FACILITY)

        fetched = self.manager.get("/api/facility-config", params={"facility_id": FACILITY})
        self.assertEqual(fetched.status_code, 200, fetched.text)
        self.assertEqual(fetched.json()["config"], SAMPLE_CONFIG)

    def test_saving_again_overwrites_rather_than_duplicates(self):
        self.manager.put("/api/facility-config", params={"facility_id": FACILITY}, json={"config": SAMPLE_CONFIG})
        updated_config = {**SAMPLE_CONFIG, "facility_name": "Riverside Pharmacy (Renamed)"}
        resp = self.manager.put("/api/facility-config", params={"facility_id": FACILITY}, json={"config": updated_config})
        self.assertEqual(resp.status_code, 200, resp.text)

        fetched = self.manager.get("/api/facility-config", params={"facility_id": FACILITY})
        self.assertEqual(fetched.json()["config"]["facility_name"], "Riverside Pharmacy (Renamed)")

    def test_accepted_owner_reads_the_managers_saved_configuration(self):
        """The whole point: an owner on their own device/browser, which never had the
        manager's localStorage, sees the manager's real setup through the server."""
        self.manager.put("/api/facility-config", params={"facility_id": FACILITY}, json={"config": SAMPLE_CONFIG})
        owner_client = self._invite_and_accept()

        fetched = owner_client.get("/api/facility-config", params={"facility_id": FACILITY})
        self.assertEqual(fetched.status_code, 200, fetched.text)
        self.assertEqual(fetched.json()["config"], SAMPLE_CONFIG)

    def test_accepted_owner_can_save_and_the_manager_sees_the_update(self):
        """Not just read access - the owner acts on the same shared row the manager
        reads, the same way owner_routes already lets the owner edit employees."""
        owner_client = self._invite_and_accept()
        owner_config = {**SAMPLE_CONFIG, "facility_name": "Set From Owner's Laptop"}
        saved = owner_client.put("/api/facility-config", params={"facility_id": FACILITY}, json={"config": owner_config})
        self.assertEqual(saved.status_code, 200, saved.text)

        manager_view = self.manager.get("/api/facility-config", params={"facility_id": FACILITY})
        self.assertEqual(manager_view.status_code, 200, manager_view.text)
        self.assertEqual(manager_view.json()["config"]["facility_name"], "Set From Owner's Laptop")

    def test_a_stranger_cannot_read_the_managers_configuration(self):
        self.manager.put("/api/facility-config", params={"facility_id": FACILITY}, json={"config": SAMPLE_CONFIG})
        stranger, _ = new_account("stranger")

        resp = stranger.get("/api/facility-config", params={"facility_id": FACILITY})
        self.assertEqual(resp.status_code, 404)

    def test_a_stranger_saving_lands_in_their_own_separate_config_not_the_managers(self):
        self.manager.put("/api/facility-config", params={"facility_id": FACILITY}, json={"config": SAMPLE_CONFIG})
        stranger, _ = new_account("stranger")

        stranger_config = {**SAMPLE_CONFIG, "facility_name": "Should Not Land Here"}
        saved = stranger.put("/api/facility-config", params={"facility_id": FACILITY}, json={"config": stranger_config})
        self.assertEqual(saved.status_code, 200, saved.text)

        manager_view = self.manager.get("/api/facility-config", params={"facility_id": FACILITY})
        self.assertEqual(manager_view.json()["config"], SAMPLE_CONFIG)

    def test_reading_requires_login(self):
        anon = TestClient(app, base_url="https://testserver")
        resp = anon.get("/api/facility-config", params={"facility_id": FACILITY})
        self.assertEqual(resp.status_code, 401)


if __name__ == "__main__":
    unittest.main()
