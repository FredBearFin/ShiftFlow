"""Cyclic roster audit: rules, coverage and validation."""

import time
import unittest

from pydantic import ValidationError

from app.audit_schemas import AUDIT_DISCLAIMER, AuditLine, AuditRequest, AuditShiftDef, AuditThresholds
from app.engine.roster_audit import audit_roster

DAY = AuditShiftDef(code="D", name="Day", start_minute=7 * 60, duration_minutes=720, kind="day")
NIGHT = AuditShiftDef(code="N", name="Night", start_minute=19 * 60, duration_minutes=720, kind="night")
PITMAN = "DD--DDD--DD---"
FOUR_ON_FOUR_OFF_DAY = "DDDD----"
FOUR_ON_FOUR_OFF_NIGHT = "NNNN----"
DUPONT = "NNNN---DDD-NNN---DDDD-------"


def crew(pattern, offset, label):
    n = len(pattern)
    rotated = pattern[offset % n:] + pattern[: offset % n]
    return AuditLine(label=label, cells=["OFF" if ch == "-" else ch for ch in rotated])


def night_version(pattern):
    return pattern.replace("D", "N")


def flat_demand(level):
    return [[level] * 24 for _ in range(7)]


def pitman_request(**extra):
    lines = [
        crew(PITMAN, 0, "Day A"),
        crew(PITMAN, 7, "Day B"),
        crew(night_version(PITMAN), 0, "Night A"),
        crew(night_version(PITMAN), 7, "Night B"),
    ]
    return AuditRequest(cycle_days=14, shifts=[DAY, NIGHT], lines=lines, **extra)


def simple_request(cells, shifts, **extra):
    return AuditRequest(cycle_days=len(cells), shifts=shifts, lines=[AuditLine(label="L", cells=cells)], **extra)


def flags(response, rule=None):
    return [f for f in response.findings if f.severity == "flag" and (rule is None or f.rule_id == rule)]


class RosterAuditRuleTests(unittest.TestCase):
    def test_pitman_four_crews_no_flags_at_defaults(self):
        """The 2-2-3 pattern at 12-hour shifts has no flags at the default limits."""
        response = audit_roster(pitman_request())
        self.assertEqual(flags(response), [])
        by_label = {m.label: m for m in response.lines}
        for label in ("Day A", "Day B", "Night A", "Night B"):
            self.assertEqual(by_label[label].min_rest_hours, 12.0)
            self.assertEqual(by_label[label].max_hours_in_7_days, 60.0)
            self.assertEqual(by_label[label].avg_weekly_hours, 42.0)
        self.assertIn("LONG_NIGHT_SHIFT", {f.rule_id for f in response.findings})

    def test_dupont_flags_72_hour_week(self):
        """The 28-day DuPont pattern peaks at 72 hours in one week, over the 60-hour default."""
        lines = [crew(DUPONT, off, f"Crew {i}") for i, off in enumerate((0, 7, 14, 21))]
        response = audit_roster(AuditRequest(cycle_days=28, shifts=[DAY, NIGHT], lines=lines))
        week_flags = flags(response, "WEEK_HOURS_HIGH")
        self.assertEqual(len(week_flags), 4)
        for f in week_flags:
            self.assertEqual((f.value, f.threshold), (72.0, 60.0))
        self.assertEqual(flags(response, "SHORT_REST"), [])
        for m in response.lines:
            self.assertEqual(m.avg_weekly_hours, 42.0)

    def test_four_on_four_off_night_streak_flag_only_when_threshold_lowered(self):
        """Four nights in a row is within the default limit of 4, and flagged at a limit of 3."""
        lines = [
            crew(FOUR_ON_FOUR_OFF_NIGHT, 0, "Night A"),
            crew(FOUR_ON_FOUR_OFF_NIGHT, 4, "Night B"),
        ]
        base = AuditRequest(cycle_days=8, shifts=[DAY, NIGHT], lines=lines)
        # A cycle of 8 days needs at least 7; 8 is allowed.
        self.assertEqual(flags(audit_roster(base), "NIGHT_STREAK"), [])
        strict = base.model_copy(update={"thresholds": AuditThresholds(max_consecutive_nights=3)})
        night_flags = flags(audit_roster(strict), "NIGHT_STREAK")
        self.assertEqual(len(night_flags), 2)
        self.assertTrue(all(f.value == 4 for f in night_flags))

    def test_short_rest_detected_inside_the_cycle(self):
        """An evening shift followed by a morning shift gives 8 hours of rest and is flagged."""
        evening = AuditShiftDef(code="E", start_minute=14 * 60, duration_minutes=480, kind="evening")
        morning = AuditShiftDef(code="M", start_minute=6 * 60, duration_minutes=480, kind="day")
        request = simple_request(["E", "M", "OFF", "OFF", "OFF", "OFF", "OFF"], [evening, morning])
        found = flags(audit_roster(request), "SHORT_REST")
        self.assertEqual(len(found), 1)
        self.assertEqual((found[0].value, found[0].day_index), (8.0, 0))

    def test_short_rest_detected_across_cycle_wrap(self):
        """The last day's evening shift is followed by the first day's morning shift of the next cycle."""
        evening = AuditShiftDef(code="E", start_minute=14 * 60, duration_minutes=480, kind="evening")
        morning = AuditShiftDef(code="M", start_minute=6 * 60, duration_minutes=480, kind="day")
        request = simple_request(["M", "OFF", "OFF", "OFF", "OFF", "OFF", "E"], [evening, morning])
        found = flags(audit_roster(request), "SHORT_REST")
        self.assertEqual(len(found), 1)
        self.assertEqual((found[0].value, found[0].day_index), (8.0, 6))

    def test_all_days_worked_is_a_streak(self):
        """Seven shifts in a seven-day cycle is a run of 7, over the default limit of 6."""
        morning = AuditShiftDef(code="M", start_minute=6 * 60, duration_minutes=480, kind="day")
        response = audit_roster(simple_request(["M"] * 7, [morning]))
        self.assertEqual(response.lines[0].longest_work_run_days, 7)
        self.assertEqual(len(flags(response, "LONG_WORK_STREAK")), 1)

    def test_empty_line_is_info_not_error(self):
        """A line with no shifts is reported as information and does not raise."""
        morning = AuditShiftDef(code="M", start_minute=6 * 60, duration_minutes=480, kind="day")
        response = audit_roster(simple_request(["OFF"] * 7, [morning]))
        self.assertIn("EMPTY_LINE", {f.rule_id for f in response.findings})
        self.assertEqual(flags(response), [])
        self.assertIsNone(response.lines[0].min_rest_hours)

    def test_weekend_exposure_uses_start_weekday(self):
        """The same pattern is fully off at a weekend only when its off days fall on Saturday and Sunday."""
        morning = AuditShiftDef(code="M", start_minute=6 * 60, duration_minutes=480, kind="day")
        cells = ["OFF", "OFF", "M", "M", "M", "M", "M"]
        monday_start = audit_roster(simple_request(cells, [morning], start_weekday=0))
        saturday_start = audit_roster(simple_request(cells, [morning], start_weekday=5))
        self.assertEqual(monday_start.lines[0].weekends_fully_off_pct, 0.0)
        self.assertEqual(saturday_start.lines[0].weekends_fully_off_pct, 100.0)
        self.assertIn("WEEKEND_EXPOSURE", {f.rule_id for f in monday_start.findings})

    def test_isolated_night_and_backward_rotation_are_counted(self):
        """A lone night, and night followed by day, are reported as information."""
        morning = AuditShiftDef(code="M", start_minute=6 * 60, duration_minutes=480, kind="day")
        night = AuditShiftDef(code="N", start_minute=22 * 60, duration_minutes=480, kind="night")
        response = audit_roster(simple_request(["OFF", "N", "M", "OFF", "OFF", "OFF", "OFF"], [morning, night]))
        metrics = response.lines[0]
        self.assertEqual(metrics.isolated_single_nights, 1)
        self.assertEqual(metrics.backward_rotation_events, 1)


class RosterAuditCoverageTests(unittest.TestCase):
    def test_coverage_perfect_for_pitman_with_demand_one(self):
        """Four Pitman crews put exactly one day crew and one night crew on every day."""
        response = audit_roster(pitman_request(demand_matrix=flat_demand(1)))
        self.assertEqual(response.coverage.understaffed_hours_per_week, 0)
        self.assertEqual(response.coverage.overstaffed_hours_per_week, 0)

    def test_coverage_counts_midnight_spill(self):
        """A night shift that runs past midnight is counted in the next day's early hours."""
        demand = [[1 if 19 <= h < 23 else 0 for h in range(24)] for _ in range(7)]
        request = simple_request(["N"] * 7, [NIGHT], demand_matrix=demand)
        coverage = audit_roster(request).coverage
        self.assertEqual(coverage.understaffed_hours_per_week, 0)
        # Hours 0 to 6 (spill from the previous night) and hour 23 are staffed but not needed: 8 a day.
        self.assertEqual(coverage.overstaffed_hours_per_week, 56)


class RosterAuditValidationTests(unittest.TestCase):
    def _lines(self, cells, label="L"):
        return [AuditLine(label=label, cells=cells)]

    def test_validation_errors(self):
        """Unknown codes, wrong lengths, duplicate labels, too many lines and bad cycles are rejected."""
        cases = {
            "unknown code": dict(cycle_days=7, shifts=[DAY], lines=self._lines(["D"] * 6 + ["X"])),
            "wrong cell count": dict(cycle_days=7, shifts=[DAY], lines=self._lines(["D"] * 6)),
            "duplicate labels": dict(
                cycle_days=7, shifts=[DAY], lines=self._lines(["D"] * 7) + self._lines(["OFF"] * 7)
            ),
            "201 lines": dict(
                cycle_days=7,
                shifts=[DAY],
                lines=[AuditLine(label=f"L{i}", cells=["D"] * 7) for i in range(201)],
            ),
            "cycle 6": dict(cycle_days=6, shifts=[DAY], lines=self._lines(["D"] * 6)),
            "cycle 57": dict(cycle_days=57, shifts=[DAY], lines=self._lines(["D"] * 57)),
        }
        for name, kwargs in cases.items():
            with self.subTest(case=name), self.assertRaises(ValidationError):
                AuditRequest(**kwargs)

    def test_unknown_code_message_names_line_and_day(self):
        """The error text says which line and which day holds the unknown code."""
        with self.assertRaises(ValidationError) as ctx:
            AuditRequest(cycle_days=7, shifts=[DAY], lines=self._lines(["D"] * 6 + ["X"], "Crew 9"))
        self.assertIn('Line "Crew 9", day 7', str(ctx.exception))

    def test_shift_code_rules(self):
        """OFF cannot be a shift code and codes are unique ignoring case."""
        with self.assertRaises(ValidationError):
            AuditShiftDef(code="off", start_minute=0, duration_minutes=60)
        with self.assertRaises(ValidationError):
            AuditRequest(
                cycle_days=7,
                shifts=[DAY, AuditShiftDef(code="d", start_minute=0, duration_minutes=60)],
                lines=self._lines(["D"] * 7),
            )

    def test_performance_bound(self):
        """200 lines over 56 days finish in under 2 seconds."""
        shifts = [DAY, NIGHT]
        lines = [
            AuditLine(label=f"L{i}", cells=["D" if (d + i) % 3 else "N" if d % 5 == 0 else "OFF" for d in range(56)])
            for i in range(200)
        ]
        request = AuditRequest(cycle_days=56, shifts=shifts, lines=lines, demand_matrix=flat_demand(50))
        started = time.perf_counter()
        audit_roster(request)
        self.assertLess(time.perf_counter() - started, 2.0)

    def test_no_banned_words_in_messages(self):
        """Findings never say compliant, guarantee or certified, and 'legal advice' appears only in the disclaimer."""
        lines = [crew(DUPONT, off, f"Crew {i}") for i, off in enumerate((0, 7, 14, 21))]
        responses = [
            audit_roster(pitman_request()),
            audit_roster(AuditRequest(cycle_days=28, shifts=[DAY, NIGHT], lines=lines)),
            audit_roster(
                simple_request(
                    ["E", "M", "OFF", "OFF", "OFF", "OFF", "OFF"],
                    [
                        AuditShiftDef(code="E", start_minute=840, duration_minutes=480, kind="evening"),
                        AuditShiftDef(code="M", start_minute=360, duration_minutes=480, kind="day"),
                    ],
                )
            ),
        ]
        for response in responses:
            self.assertEqual(response.disclaimer, AUDIT_DISCLAIMER)
            for text in [f.message for f in response.findings] + [response.disclaimer]:
                lowered = text.lower()
                for word in ("compliant", "guarantee", "certified"):
                    self.assertNotIn(word, lowered)
            for f in response.findings:
                self.assertNotIn("legal advice", f.message.lower())


if __name__ == "__main__":
    unittest.main()
