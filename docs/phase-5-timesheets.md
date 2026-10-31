# Phase 5: timesheets and manager corrections

Status on 2026-10-31: migrations `20261031000001` and `20261031000002` were applied to the live project
(`eqyycmmbcesrtxuawyyb`), with approval, each after a dry run and a JSON export of all public tables.
The Console part is verified against live data and still needs deploying (after the migrations, which is now done).
The Android part ("My Timesheet") waits until the app repository's uncommitted work is committed; the
functions it needs (`my_timesheet`, `my_timesheet_entries`) are part of this migration.

Benchmark: Jibble's timesheets (daily view, tracked vs payroll hours, first in and last out, overtime by
type, change history). Crewtraxa uses its own design and records.

## What changes

| Area | Change |
| --- | --- |
| Timesheets (`/timesheets`, sidebar under Operations) | Week (Monday to Sunday) or month. **Team view**: per employee, payroll hours against planned hours, overtime, breaks, days worked, absences, late days and days to review, with search and a department filter. **Employee view**: one row per day with first in, last out, tracked time, unpaid breaks, payroll time, overtime and notes (absent, late, left early, no check-out, automatic check-out, overlap, early check-in, outside hours, edited). Totals, and a CSV export in decimal hours for payroll |
| Day detail | The day's figures, every time entry (what the app recorded, corrected, added or removed), the change history with reasons, authors and times, and the location trail on a map with the sites used |
| Corrections (managers and admins) | Add an entry (with or without a site), correct an entry's times (including adding a missing check-out), remove an entry, restore what the app recorded. A reason is required for every change. Times are entered in the organization's time zone. Supervisors see everything but cannot change it |
| Work Schedules | The breaks section now explains how timesheets deduct breaks |

## How a day is calculated

1. **Entries**: the sessions the app recorded, with any correction applied, plus entries managers added.
   A session belongs to the workday on which it starts, in the organization's time zone; the schedule's day
   split time moves that boundary (so a 22:00–06:00 night shift with a 12:00 split stays on the day it began).
2. **End of each entry**: its check-out, or the policy's automatic check-out if that comes first (after a
   duration or at a time of day; applied to what the app recorded, not to a manager's times). A session still
   open counts up to now for up to a day; after that, with no automatic check-out, it is reported as
   "No check-out" and not counted until a manager adds the check-out.
3. **Tracked time**: the entries merged, so overlapping entries (for example two sites at once) count once.
4. **Unpaid breaks**: worked time inside each unpaid break's time window, up to the break's length; then the
   automatic break if the day passes its threshold. Breaks without a window are deducted once the app
   records breaks. **Payroll time** = tracked time minus these breaks.
5. **Planned time**: fixed schedules, the day's hours minus unpaid breaks; flexible, the daily hours; rest
   days and holidays, zero; weekly flexible, no daily figure.
6. **Overtime**: on a holiday or rest day, all payroll time at that day's rate if the schedule has one;
   otherwise daily overtime past its threshold and double overtime past the second; weekly overtime takes the
   regular time past the weekly threshold on the days that cross it (weeks start on Monday).
7. **Notes**: late and left early (fixed schedules), absent (a working day with planned hours and nothing
   recorded, once the day is over), and the policy rules the app will enforce: early check-in beyond the
   limit and check-in outside scheduled hours.
8. **Employment period**: days before the later of the hire date and the day the profile was added, and days
   after an employee was archived, are left out unless time was recorded on them.

Timesheets use each employee's current schedule, holiday calendar and policy, so changing a schedule
recalculates past days. Approved pay periods (Phase 6) will keep their totals.

## Database (`20261031000001_timesheets_corrections.sql`)

- `time_entry_corrections`: kind (add, replace, remove), the session it applies to, site, start and end,
  reason, author, and the correction it took over from. Rows are never deleted; a newer correction voids the
  previous one (time, user and reason kept). At most one correction in force per session. Composite foreign
  keys keep the employee and site in the same organization. Read access follows the organization's Console
  roles; writes only through the functions below. Audited.
- App sessions (`presence_sessions`) are never changed: the app re-uploads sessions keyed on their check-in
  time, so editing one would create a duplicate.
- Functions: `timesheet_days` and `timesheet_entries` (Console roles of the organization),
  `my_timesheet` and `my_timesheet_entries` (the signed-in employee), `add_time_entry`, `edit_time_entry`,
  `remove_time_entry` and `restore_time_entry` (managers and admins). The calculation itself
  (`compute_timesheet`, `timesheet_entry_rows`, `timesheet_scope`) is not callable from the API.
  Ranges are limited to 63 days.
- New index on `presence_sessions (organization_id, entry_timestamp)`.
- `20261031000002_timesheet_employment_start.sql` replaces only `compute_timesheet`, adding the employment
  period. The live browser test showed every employee marked absent on all October working days, including days
  before their profile existed.

## Tests

- `npm run test:db`: 298 passed (45 new): a fixed week with an exact expected result for every day (early
  check-in, late arrival capped by the automatic check-out with daily and double overtime, overlapping sites,
  holiday and rest-day rates, an absence, a Saturday half day with an added entry, weekly overtime), a night
  shift across midnight with its meal window, an open session closed by the policy, a corrected, a removed
  and a restored session, the automatic break, the correction history and its versions, input checks,
  supervisor and cross-organization denial, direct writes refused, the employee's own timesheet, archived
  employees, an open session with no automatic check-out, and a session in progress.
- `node --test tests/`: 87 passed (new `timesheets.test.mjs`: periods, labels, time zone formatting, totals,
  export).
- `tsc -b`, `oxlint` (no warnings in the changed files) and `vite build` pass.
- 301 database checks after the employment-period fix (3 more: an employee added today, a hire date mid-week,
  and time recorded before the hire date).
- Live verification: row counts unchanged; the corrections table has RLS and no direct-write grant; the internal
  calculation is not callable from the API; the calculation runs over a month of real data (6 employees,
  263 payroll minutes in October, 115 absences after the fix, down from 131). The Supabase advisor flags only
  the eight intended API functions, each of which checks the caller's role.
- Live browser test (read-only, organization admin): month and week team views, an employee's daily view, and
  a day's detail with its two app entries, figures and a 133-point location trail. Every request returned 200,
  with no console errors. No correction was saved.

## Open items

- Live data: most October working days show as absent because few employees check in, and the 22-hour
  "General Shift" (08:00–06:00) makes planned hours 22 a day. Review that schedule on the Work Schedules page.

- Android: "My Timesheet" (day and week) from `my_timesheet`; break start and end in the app, so breaks
  without a window can be deducted; employee requests for corrections (managers approve them).
- Phase 6: pay periods, approval and locking; approved periods keep their totals and block corrections.
- Phase 9: attendance insights and alerts built on these figures.
