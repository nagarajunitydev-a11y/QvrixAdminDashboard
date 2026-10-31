# Jibble benchmark: gap analysis and roadmap

Prepared 2026-10-30. Benchmark: [jibble.io](https://www.jibble.io/). Compares Jibble's published
product with Crewtraxa (this Console, the Android app in `EmployeeTrackApp`, shared Supabase project
`eqyycmmbcesrtxuawyyb`), then sets out the phases to close the gaps.

## How the benchmark was gathered

| Source | Method | Evidence |
| --- | --- | --- |
| jibble.io home page (feature pillars, navigation) | REA `capture_browser_scenario`, accessibility tree | `ev_d2c7f26bc2aa9a37c09fc463a94755daa0cde29b520507c940e0e74ed6073c5f` |
| Help Center index (19 module collections) | REA `capture_browser_scenario`, accessibility tree | `ev_979b0217be1d1828b2766d82e8c40b280d88ebdd9f5ebd6ab48db0d77f389fdd` |
| Help articles: onboarding wizard, time tracking policy, locations and geofences, work schedules, overtime rates, multi-level approvals, timesheet vs project approvals, report types, kiosk assignment, time off calendar, member experience, person profile | Read from public `jibble.io/help/*` pages | URLs under [Sources](#sources) |

**Not covered:** Jibble's signed-in web app (`web.jibble.io`) and its JavaScript bundle. Viewing the
app needs a Jibble account, and taking apart a vendor's proprietary code is usually against its terms.
Every Jibble behaviour below comes from Jibble's own public pages and documentation. None of Jibble's
code, text or images is reused; Crewtraxa builds its own versions.

## Jibble's product map

Navigation for owners and admins: Dashboard, Timesheets, Time Off, Work Schedules, Locations,
Activities & Projects, Reports, People (Members, Groups), Kiosks, Integrations, Settings
(Organization, Time Tracking Policies, Permissions). Members use a Time Clock, their own Timesheets,
Time Off and Account settings.

1. **Onboarding wizard** (after creating the organization): work schedule → clock-in rules
   (face, selfie, live location, geofence, required activity, edit rights) → auto clock-out →
   geofence auto clock-in and out (with rest-day, holiday and leave exclusions) → work locations →
   invite members by email, phone or name only (name-only members use the kiosk) → done.
2. **Time tracking policy** (organization default, overridable per group): allowed devices (mobile,
   kiosk, web, desktop, offline), required face, GPS or geofence, blocked manual edits, device lock
   (first device used becomes the only one), early clock-in limit, block clock-in outside schedule,
   clock-in and clock-out reminders with a second nudge, auto clock-out after N hours or at a set time.
3. **Work schedules**: fixed, flexible (daily total) or weekly flexible (weekly total); working days;
   hours per day; custom breaks (length, allowed window, paid or unpaid); automatic break deduction
   above a threshold; day split time for night shifts; overtime rules (daily, daily double, weekly,
   rest day, public holiday) with multipliers; holiday calendars; locations limited per schedule.
   One schedule per member, chosen individual > group > default. Saving recalculates timesheets.
4. **Locations**: search an address or drop a pin, set a radius (300 m suggested for auto clock-in),
   list view with bulk radius edit, archive, restore and delete. Past entries are not rewritten.
5. **Timesheets**: daily, weekly and monthly views; tracked vs payroll hours; first in and last out;
   breaks; overtime by type; change history; selfie and location per entry; bulk-add and duplicate.
6. **Pay periods and approvals**: weekly, biweekly, semi-monthly or monthly periods; managers approve a
   member's period; approved entries lock; reopen the period to edit.
7. **Time off**: policies in days (half days allowed) or hours; balances and accruals; requests with
   notes and attachments; up to 3 approval levels (direct manager, group manager, admin, owner, named
   people); statuses Pending (n/x), Approved, Rejected, Cancelled; owner override; history;
   calendar views for Organization, Managed by me and Personal; public holidays shown on the calendar.
8. **Pay rates**: billable rate per member; overtime multipliers per schedule; billable amounts shown
   in timesheet exports; payroll handled by integrations (Xero, QuickBooks, Deel, PayrollPanda).
9. **Reports**: Timesheet (payroll hours, regular, overtime by type, paid leave, amounts), Tracked Time
   (by activity, project and client), Attendance Insights (expected vs actual days, absences, late
   clock-ins, early clock-outs, exceeded breaks, time lost); raw timesheet and time-entry lists; XLS
   and CSV; export from mobile.
10. **People and groups**: profile with preferred name, role (Member, Project Lead, Manager, Admin),
    position, employment type, one group, direct managers, schedule, holiday calendar, member code,
    billable rate, join date, 4-digit kiosk PIN, member and timesheet time zones, face data, archive,
    restore and delete; bulk edit; group managers; per-role permission toggles.
11. **Kiosk**: shared device (Android app pinning, iOS Guided Access, desktop); PIN, QR, NFC or face;
    members and groups assigned per kiosk.
12. **Verification**: face recognition against enrolled face data, selfie on each entry, GPS stamp,
    NFC and PIN.
13. **Member app**: green clock-in button → activity, project and location → selfie or face if
    required; switch activity; start and end break; daily timesheet with change history;
    Who's in/out widget; reminders by push or email; offline clock-in with later sync.
14. **Account**: 2FA, switching organizations, push notification settings, account deletion on mobile.
15. **Outside Crewtraxa's scope**: activities, projects, clients and invoicing; desktop screenshots;
    Chrome extension; AI and MCP connectors. Crewtraxa is organized around sites, which play the role
    that projects play in Jibble.

## Crewtraxa today (2026-10-30)

| Layer | What exists |
| --- | --- |
| Console routes | Command Center dashboard, Live Tracking map, Employees, Departments, Designations, Shifts, Sites, Site Workers, Attendance & Presence, Location history, Alerts, Reports, Assignments, Users & Roles, Devices, Organizations (platform admin), Settings, Audit log |
| Data | `organizations`, `organization_members` (`org_admin`, `manager`, `supervisor`), invitations, `platform_admins`, `employees` (name, email, phone, department, designation, shift, active, hire date), `departments`, `designations`, `shifts` (name, start, end, department), `sites` (lat, lng, radius), `employee_sites`, `presence_sessions` (site entry and exit, total hours, `closed_by`), `location_logs`, devices with assignments and events, `audit_logs`. RLS for every org-scoped table |
| Android | Login, site selection, dashboard check-in and check-out at a site, background tracking, geofence entry and exit, offline-first Room store with outbox sync (Room schema v6). Accepting invitations and registering devices are not built yet |
| Reports | Hours logged, sessions, geofence compliance, site use, department mix, top employees, CSV export |

## Gap matrix

Priority: **P0** blocks other work, **P1** core parity, **P2** valuable, **P3** later or optional.
Layers: DB = Supabase migration with RLS, Web = Console, App = Android.

| # | Jibble capability | Crewtraxa today | Gap | Pri | Layers |
| --- | --- | --- | --- | --- | --- |
| 1 | Work schedules (3 types, working days, per-day hours) | `shifts`: one start and end time | Schedule types, working days, daily or weekly targets, per-day hours, default schedule, choose individual > department > default | P0 | DB Web App |
| 2 | Breaks (custom, paid or unpaid, auto deduction) | None | Break rules on schedules; break start and end in the app; deduction in timesheets | P0 | DB Web App |
| 3 | Overtime rules (5 types, multipliers) | None | Overtime rules on schedules, used by timesheets and payroll | P0 | DB Web |
| 4 | Holiday calendars | None | Calendars, holidays, default calendar, per-employee calendar | P0 | DB Web |
| 5 | Time tracking policy (verification, device lock, early clock-in, outside-hours block, auto clock-out, reminders) | Device registry, fixed 500 m geofence in the app, stale-session close | Policy per organization with department overrides; checks on both the server and the app | P0 | DB Web App |
| 6 | Timesheets (daily, weekly, monthly; tracked vs payroll; first in and last out; change history) | Raw session list | Daily timesheet built from sessions with schedule, breaks, overtime and holidays; views per employee and team; history | P1 | DB Web App |
| 7 | Manual entries and edits with permissions | Managers can close a session | Add or edit an entry with a required reason, audit history, block edits by policy | P1 | DB Web App |
| 8 | Pay periods and timesheet approval, lock and reopen | None | Period setup, approve or reject per employee per period, lock, reopen | P1 | DB Web App |
| 9 | Time off (policies, accrual, balances, requests, multi-level approval, calendar) | None | Whole module | P1 | DB Web App |
| 10 | Pay rates, overtime pay, payroll export | None | Pay rates with effective dates, overtime amounts, payroll run with configurable Indian deductions (PF, ESI, PT, TDS; from the original Crewtraxa spec, beyond Jibble), payslip and CSV or XLSX export | P1 | DB Web |
| 11 | Attendance insights (late, early out, absences, exceeded breaks, time lost) | Geofence compliance only | Insights computed against schedules; Timesheet and Payroll reports; XLSX | P1 | DB Web |
| 12 | Dashboard "who's in" plus today's exceptions | Command Center: on duty, outside site, checked out | Add late, absent, on break and on leave today once schedules exist | P2 | Web |
| 13 | Onboarding wizard | Org created by platform admin; invitations | Setup checklist: schedule → policy → sites → invite employees and Console users | P2 | Web |
| 14 | People: member code, direct manager, time zone, pay rate, archive and restore, bulk edit, CSV import | Basic employee form, delete or deactivate | Extra profile fields, archive flow, bulk actions, CSV import | P2 | DB Web |
| 15 | Group managers and team-scoped manager access | Managers see the whole organization | Department managers; optionally limit managers to their teams (an RLS change) | P2 | DB Web |
| 16 | Locations: bulk radius edit, archive and restore, address search | Sites with map and radius, roster and live map (ahead of Jibble on site operations) | Archive and restore instead of delete; bulk radius edit | P2 | DB Web |
| 17 | Selfie at clock-in | None | Camera capture, private Storage bucket with RLS, thumbnail on the timesheet entry | P2 | DB Web App |
| 18 | Reminders and notifications (push and email) | Alerts inside the Console only | Clock-in and clock-out reminders, auto clock-out notice, approval notices; push needs Firebase (FCM) | P2 | DB App |
| 19 | Kiosk (shared device, PIN or QR) | None | Kiosk mode in the Android app with employee PIN, kiosks assigned to sites | P3 | DB Web App |
| 20 | Face recognition | None | Needs a matching vendor or model; decision deferred | P3 | App |
| 21 | 2FA, account deletion on mobile | Password reset only | Supabase TOTP MFA for Console users; in-app account deletion request (a Google Play requirement for apps with accounts) | P2 | Web App |
| 22 | Offline clock-in with later sync | Android is offline-first with an outbox | At parity; every new app feature must follow the same Room and outbox pattern | ok | App |

## Roadmap

Each phase follows the pattern already used for Phase 2: a versioned migration tested against the
PGlite replica (`npm run test:db`, including org-isolation tests); a separate dry run and explicit
approval before anything touches the live database; then Console work with type check, unit tests,
build and a browser smoke test against real data; then Android work under the binding rules in its
`AGENTS.md` (Room migration with schema JSON, narrow DTOs, outbox sync). The phase closes with an
end-to-end run from the Console to the app and back, and a report of files, migrations, tests and
open issues.

Order chosen on 2026-10-30: onboarding first, then work schedules, then timesheets.

| Phase | Scope | Depends on |
| --- | --- | --- |
| **3. Onboarding and people management** (built; see `phase-3-onboarding-people.md`) | Getting Started checklist computed from real records; employee code and employment type; archive and restore in place of the delete that always failed; bulk edit, bulk site assignment, CSV import and export. Android invitation acceptance waits for the app repo to be committed | — |
| **4. Work schedules, holidays and time-tracking policy** (database applied live 2026-10-31 and Console built; see `phase-4-work-schedules-holidays-policy.md`) | Extend `shifts` in place into full work schedules (types, days, per-day hours, breaks, split time, early clock-in limit, auto clock-out) without breaking current shift data or Android's `ShiftEntity`; overtime rules; holiday calendars; organization policy with department overrides; schedule chosen employee > department > default. Console: Work Schedules, Holidays and Policy screens. App: read schedule and policy; enforce early clock-in, outside-hours block and auto clock-out; break start and end | 3 |
| **5. Timesheets and manual edits** (database applied live 2026-10-31 and Console built; see `phase-5-timesheets.md`) | Daily timesheets from sessions plus schedule (tracked, payroll, breaks, overtime by type, holiday and rest-day flags, first in and last out); manager add and edit with reason and change history; policy lock on edits. Console: Timesheets (team, employee, day detail with map points). App: My Timesheet (day, week) | 4 |
| **6. Pay periods and approvals** | Pay-period setup; approve or reject per employee per period; lock and reopen; approval history; Console approval queue; app shows period status | 5 |
| **7. Time off** | Policies (days or hours, half days, paid or unpaid, accrual, carry-over), balances, requests with attachments, up to 3 approval levels with override and history, calendar views, holidays on the calendar. App: request, see balances and status. Timesheets count approved leave | 4 (calendars), 6 |
| **8. Payroll** | Pay rates with effective dates; overtime pay from multipliers; payroll run per approved period; configurable Indian deductions (PF, ESI, PT, TDS); payslips; CSV and XLSX export | 6, 7 |
| **9. Reports, insights and alerts** | Attendance insights, Timesheet and Payroll reports, raw exports (CSV and XLSX), alert rules for late, absent, early-out, exceeded break and missed clock-out; dashboard tiles for today's exceptions | 5–8 |
| **10. Verification, kiosk and notifications** | Selfie at clock-in (private Storage); reminders and notices by push (FCM) and email; kiosk mode with PIN; Console 2FA; in-app account deletion request; department managers and optional team-scoped manager access | 4, 5 |
| **11. End-to-end hardening** | Full test pass across Console and app (offline, conflicts, time zones, night shifts, org isolation); performance and accessibility pass | all |

## Blockers and decisions

1. **The Android repo has 61 uncommitted changes** (32 modified, 10 deleted, 19 untracked). Android work
   should start only after those are committed, so Crewtraxa changes don't mix with work in progress.
2. **Live database changes** are applied only after a dry run and explicit approval, phase by phase.
3. **Push notifications** need a Firebase project linked to the Android app (an external service).
4. **Face recognition** needs a vendor or model choice; selfie capture covers fraud prevention until then.
5. **Work schedules data model (decided):** extend the existing `shifts` table in place, labelled
   "Work schedules" in the UI. No data move, and Android's narrow DTO keeps working.

## Sources

Public Jibble pages read on 2026-10-30:
`/help/onboarding-to-jibble-set-up-your-team`, `/help/configuring-your-time-tracking-policy`,
`/help/managing-locations-geofences`, `/help/manage-work-schedules`, `/help/setting-up-overtime-rates`,
`/help/how-multi-level-approvals-work`, `/help/difference-timesheet-approvals-project-approvals`,
`/help/what-are-the-different-types-of-reports-that-can-be-exported`,
`/help/how-to-assign-members-and-groups-to-kiosks-via-web`, `/help/using-time-off-calendar`,
`/help/using-jibble-as-a-member`, `/help/updating-a-persons-profile-information`.
