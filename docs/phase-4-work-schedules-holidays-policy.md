# Phase 4: work schedules, holidays and the time-tracking policy

Status on 2026-10-31: migration `20261031000000` was applied to the live project (`eqyycmmbcesrtxuawyyb`)
at about 00:38 UTC, with approval, after a dry run and a JSON export of all 17 public tables (row counts
checked). The Console part is verified against live data and still needs deploying; it reads the new columns,
so it must not be deployed before the migration (now done). The Android part waits until the app repository's
uncommitted work is committed.

Benchmark: Jibble's work schedules, holiday calendars and time tracking policies (see
`jibble-benchmark-gap-analysis.md`, rows 1–5). Crewtraxa uses its own design and records.

## What changes

| Area | Change |
| --- | --- |
| Work Schedules (`/shifts`, sidebar "Work Schedules") | The Shifts screen becomes a schedule editor. Three types: **fixed** (start and end each working day, with different hours on chosen days, such as a Saturday half day), **flexible** (hours per day at any time) and **weekly flexible** (hours per week). Working days, up to 5 breaks (paid or unpaid, optional time window), an automatic unpaid break on long days, overtime rules (daily, daily double, weekly, rest day, public holiday, each with a pay multiplier), a day split time for night shifts, and one organization default. The list shows each schedule's days, hours, planned weekly hours, breaks, overtime and who uses it. Read-only roles see no edit controls |
| Holidays (`/holidays`) | Holiday calendars, one of them the organization default; holidays by year; add one, paste a list (dates as `YYYY-MM-DD` or `DD/MM/YYYY`, separated by comma, tab or spaces; problem lines are listed and skipped), or add India's three fixed-date national holidays for a year. Festival and state holidays change every year, so they come from the organization's official list. Use one calendar per state or office when holidays differ |
| Time Tracking Policy (`/time-policy`) | One organization policy, and optionally a full replacement policy per department: check in only inside the site geofence, only from the employee's registered phone, limit early check-ins, block check-ins outside scheduled hours, automatic check-out after a duration or at a time of day. Only organization admins edit it; other Console roles read it. The page states that the Android app applies these rules from its next update |
| Departments | Each department can choose a default schedule and a holiday calendar |
| Employees | The form's "Work schedule" and "Holiday calendar" fields can be left on "Department or organization default". The table's Schedule column shows the schedule that applies and where it comes from. Bulk edit can set the holiday calendar |
| Getting Started | The schedules step is renamed "Set work schedules"; a new optional "Add your holidays" step |

Which rule applies: the employee's own choice, otherwise the department's, otherwise the organization
default. The database (`work_rules_for_employee`) and the Console (`resolveRule` in
`src/lib/workSchedules.ts`) use the same order.

## Database (`20261031000000_work_schedules_holidays_policy.sql`)

- `shifts` gains the schedule columns, with check constraints and a validation trigger
  (`shifts_20_validate_schedule`) that gives readable messages for breaks and per-day hours. Existing schedules
  become **fixed, Monday to Friday**, with no breaks or overtime and no default; change them on the Work
  Schedules page if your teams work other days. `start_time` and `end_time` stay required, so the installed
  Android app keeps showing each employee's hours.
- One organization default per table (`shifts`, `holiday_calendars`): setting a new default hands the role over
  (`keep_single_default`, runs with the caller's own rights).
- Department defaults move to `departments.shift_id`, so one schedule can serve several departments. The old
  `shifts.department_id` link is copied there (earliest schedule per department) and its foreign key dropped,
  because PostgREST would otherwise see two relationships between the tables. The column itself stays, unused,
  so no stored value is lost.
- New tables `holiday_calendars`, `holidays` and `time_tracking_policies`, organization-scoped with composite
  foreign keys (a record can only point at records of its own organization), audit triggers and the usual
  organization-stamping triggers. A holiday takes its calendar's organization. Calendars and schedules in use
  cannot be deleted.
- RLS: Console viewers read; managers and admins write schedules and holidays; only admins write the policy.
  Employees read none of these tables directly.
- `my_work_rules()` returns the signed-in employee's schedule, policy, holiday calendar and holidays (the last
  month and the coming year, for offline use), each with its source. Archived and unlinked accounts get null.
  This is what the Android app will call.

## Tests

- `npm run test:db`: 253 passed (75 new for this phase): backfill of the existing shift and its department link,
  every schedule check (types, targets, weekdays, per-day hours, malformed and excess breaks, unpaid breaks
  longer than a day, overtime order and limits, automatic break), default handover per organization, one schedule
  for several departments, delete blocked while in use, cross-organization references refused, holiday
  stamping, duplicates and cross-organization writes, supervisor read-only, employees reading nothing directly,
  resolution order for schedules, calendars and policies, the holiday window, archived and unlinked accounts,
  anon and internal-function denial, admin-only policy, forged editor, audit.
- `node --test tests/`: 79 passed (new `work-schedules.test.mjs` and `holidays.test.mjs`; onboarding updated).
- `tsc -b`, `oxlint` (no warnings in the changed files) and `vite build` pass.
- Live verification after applying: row counts unchanged (6 employees, 30 sessions, 182 location logs,
  7 assignments, 3 departments, 1 schedule); the existing schedule is fixed Monday to Friday with no default;
  the Operations department now carries its link; the old foreign key is gone; the 3 new tables have RLS with
  12 policies; `my_work_rules()` is callable by signed-in users only and `work_rules_for_employee` by nobody.
  The Supabase security advisor reports nothing new beyond `my_work_rules()` being callable by signed-in
  users, which is intended.
- Live browser test (read-only, signed in as an organization admin): Work Schedules listed the schedule with its
  hours, planned weekly hours and "6 employees · Operations", and the edit dialog opened with the stored values
  (closed without saving); Holidays showed its empty state; Time Tracking Policy showed the unset organization
  policy; Departments showed Operations → General Shift; Employees showed each person's schedule. Every Supabase
  request returned 200, with no console errors. Nothing was written to production data.

## Rollout

1. Done: backup, apply `20261031000000`, live checks.
2. Deploy the Console. The Console currently on Vercel keeps working after the migration: its Shifts page
   shows no department name and still writes the old `shifts.department_id` column until the new build is live.

## Open items

- Live data to review: **General Shift runs 08:00–06:00**, which the schedule reads as a 22-hour overnight shift
  (110 planned hours a week). It may have been meant as 08:00–18:00. It also became Monday to Friday; add
  Saturday if your teams work it. No organization default schedule or holiday calendar is set yet.

- Android (blocked until the app repo is committed): call `my_work_rules()` after sign-in and store it in Room;
  show the schedule and today's holiday; enforce the policy (inside-site, registered phone, early limit,
  outside-hours block, automatic check-out) on the device so it also works offline; start and end breaks.
- Timesheets (Phase 5) use the schedule for planned hours, breaks, overtime, rest days and holidays, and flag
  entries that break the policy. Schedule changes are recorded in the audit log; Phase 5 decides whether past
  timesheets are recalculated or keep the schedule that applied at the time.
- Automatic check-out on the server (for phones that are off) needs a scheduled job; not part of this phase.
- Employee time zones: rules use the organization's time zone for now.
