"""Rotation pattern library: exact coverage, hours and routes."""

import unittest

from fastapi.testclient import TestClient

from app.audit_schemas import AuditRequest
from app.engine.roster_audit import audit_roster
from app.engine.rotation_patterns import PATTERNS, pattern_to_audit_request, verify_coverage
from app.main import app

BANNED = ("best", "safe", "compliant", "guarantee", "certified", "legal")


class RotationPatternTests(unittest.TestCase):
    def test_every_pattern_has_exact_coverage(self):
        """Each pattern puts exactly the stated crews on each shift every day of its cycle."""
        self.assertEqual(set(PATTERNS), {"pitman_2_2_3_12h", "four_on_four_off_12h", "dupont_28_12h"})
        for pattern_id, pattern in PATTERNS.items():
            with self.subTest(pattern=pattern_id):
                self.assertEqual(verify_coverage(pattern), [])

    def test_verify_coverage_reports_a_broken_pattern(self):
        """A pattern with a crew missing is reported, not accepted."""
        from dataclasses import replace

        broken = replace(PATTERNS["pitman_2_2_3_12h"], crews=PATTERNS["pitman_2_2_3_12h"].crews[:3])
        self.assertTrue(verify_coverage(broken))

    def test_average_weekly_hours_is_42_for_every_crew(self):
        """All three patterns average 42 hours a week per crew."""
        for pattern_id in PATTERNS:
            with self.subTest(pattern=pattern_id):
                response = audit_roster(pattern_to_audit_request(pattern_id))
                for metrics in response.lines:
                    self.assertEqual(metrics.avg_weekly_hours, 42.0)

    def test_requests_validate_and_cover_demand_of_one(self):
        """Each expanded request is valid and, against a demand of 1 per hour, has no gap."""
        for pattern_id in PATTERNS:
            with self.subTest(pattern=pattern_id):
                request = pattern_to_audit_request(pattern_id)
                request = AuditRequest(**{**request.model_dump(), "demand_matrix": [[1] * 24 for _ in range(7)]})
                coverage = audit_roster(request).coverage
                self.assertEqual(coverage.understaffed_hours_per_week, 0)
                self.assertEqual(coverage.overstaffed_hours_per_week, 0)

    def test_descriptions_make_no_claims(self):
        """Descriptions are factual: no ranking or safety words."""
        for pattern in PATTERNS.values():
            text = (pattern.name + " " + pattern.description).lower()
            for word in BANNED:
                with self.subTest(pattern=pattern.pattern_id, word=word):
                    self.assertNotIn(word, text)


class RotationPatternRouteTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.client = TestClient(app)

    def test_list_patterns(self):
        """The list route returns id, name, description and cycle length for each pattern."""
        body = self.client.get("/api/v1/schedules/audit/patterns").json()
        self.assertEqual({p["pattern_id"] for p in body}, set(PATTERNS))
        self.assertEqual({p["cycle_days"] for p in body}, {8, 14, 28})

    def test_get_pattern_returns_postable_request(self):
        """The single-pattern route returns a body that can be posted to the audit route unchanged."""
        body = self.client.get("/api/v1/schedules/audit/patterns/dupont_28_12h").json()
        response = self.client.post("/api/v1/schedules/audit", json=body)
        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.json()["summary"]["flags_by_rule"], {"WEEK_HOURS_HIGH": 4})

    def test_unknown_pattern_is_404(self):
        """An unknown id returns 404."""
        self.assertEqual(self.client.get("/api/v1/schedules/audit/patterns/nope").status_code, 404)


if __name__ == "__main__":
    unittest.main()
