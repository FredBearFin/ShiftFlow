# Roster audit rules

The roster audit (`backend/app/engine/roster_audit.py`, `POST /api/v1/schedules/audit`) reads a repeating pattern of 7 to 56 days and reports facts and flags against thresholds the user can change. It does not optimize, it stores nothing, and it does not assess any statute. Every response carries this disclaimer: *Rule-based check of the pattern you entered. Not legal advice. Thresholds are the values shown, not statutory limits.*

Findings come in two kinds: `flag` (a limit the user set is exceeded) and `info` (a fact worth knowing). There is no pass or compliant wording.

**Time model.** Day `i` of the cycle starts at minute `i * 1440`. A shift on day `i` starts at `i * 1440 + start_minute` and lasts `duration_minutes`, so it can end after midnight. Each line is cyclic: the day after the last day is day 0 again. Weekday of day `d` is `(start_weekday + d) mod 7`, with 0 = Monday. A shift counts on the day it starts.

Default is a house setting chosen by the repo owner. It is not a statutory limit. This applies to every default below.

## SHORT_REST (flag)
Worked shifts are listed in time order, cyclically. For each consecutive pair, gap = next start minus previous end (the last shift to the first shift adds one cycle length). One finding per line reports the smallest gap and the day index of the earlier shift. A single worked shift is measured against itself one cycle later. Flag when the smallest gap is under `min_rest_hours` (default 11, range 4 to 24).
Reference: EU Working Time Directive 2003/88/EC, Article 3 (11 consecutive hours of rest per 24 hours). Owner to verify before quoting.
Source:

## LONG_WORK_STREAK (flag)
Longest cyclic run of consecutive worked days. Flag when it exceeds `max_consecutive_work_days` (default 6, range 2 to 14). A line worked on every day has a run equal to the cycle length.
Source:

## NIGHT_STREAK (flag)
Longest cyclic run of consecutive days whose shift has kind `night`. Flag when it exceeds `max_consecutive_nights` (default 4, range 1 to 14).
Source:

## LONG_SHIFT_STREAK (flag)
Longest cyclic run of consecutive days whose shift lasts `long_shift_hours` or more (default 10). Flag when it exceeds `max_consecutive_long_shifts` (default 4, range 1 to 14).
Source:

## WEEK_HOURS_HIGH (flag)
For every cyclic window of 7 consecutive days, add the full duration of each shift to the day it starts. The maximum over windows is `max_hours_in_7_days`. Flag when it exceeds `max_hours_any_7_days` (default 60, range 20 to 120). The finding reports the earliest start day of the worst window.
Source:

## AVG_WEEKLY_HOURS (info)
Total shift hours divided by cycle days, times 7. Reported only when above `reference_avg_weekly_hours` (default 48, range 20 to 120).
Reference: the 48-hour average weekly limit in the same Directive (Article 6, averaged over a reference period). Owner to verify before quoting. Not a rolling 7-day limit.
Source:

## ISOLATED_NIGHT (info)
A cyclic run of night shifts of length 1. One finding per line with the count.

## ISOLATED_REST_DAY (info)
A cyclic run of days off of length 1, between worked days. One finding per line with the count.

## BACKWARD_ROTATION (info)
For each pair of consecutive days (cyclic) that are both worked, one event when the kind order goes down, with order day, then evening, then night; kind `other` is ignored. For example night then evening, night then day, or evening then day.

## WEEKEND_EXPOSURE (info)
Over the super-period of `lcm(cycle days, 7)` days, count each Saturday and Sunday pair. `weekends_fully_off_pct` is the share where no shift starts on either day. A finding is added when a line with shifts has 0%. A Friday night shift that runs into Saturday counts on Friday.

## LONG_NIGHT_SHIFT (info)
A night-kind shift code in use that lasts 12 hours or more. One finding per shift code.

## FAIRNESS_SPREAD (info)
Across lines, the spread (largest minus smallest) of nights per cycle, or of weekend shifts per cycle, exceeds 2. The summary also carries the population standard deviation of both.

## EMPTY_LINE (info)
A line with no shifts. Rest and streak rules are skipped for it.

## Coverage (only when a demand matrix is supplied)
Super-period `D = lcm(cycle days, 7)`. For each hour of each of the `D` days, count the lines on shift. A shift counts toward an hour when it covers at least half of that hour. A shift that runs past midnight counts toward the next day, and the last day wraps into the first. Required staff come from `demand_matrix[(start_weekday + day) mod 7][hour]` (row 0 is Monday). Understaffed and overstaffed hours are summed and divided by `D / 7` to give hours per week. The 10 worst hours are those with the largest gap, ties broken by weekday, then hour, then day index.
