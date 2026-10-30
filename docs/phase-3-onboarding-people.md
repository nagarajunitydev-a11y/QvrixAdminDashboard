# Phase 3: onboarding and people management

Status on 2026-10-30: migration `20261030000003` was applied to the live project (`eqyycmmbcesrtxuawyyb`)
at about 16:25 UTC, with approval, after a dry run and a JSON export of all 17 public tables (row counts
checked). The Console part is verified against live data. The Android part waits until the app
repository's uncommitted work is committed.

Benchmark: Jibble's setup wizard, people profiles, bulk edit and archive flow
(see `jibble-benchmark-gap-analysis.md`). Crewtraxa uses its own design and records.

## What changes

| Area | Change |
| --- | --- |
| Getting Started (`/getting-started`, sidebar, dashboard card) | Checklist computed from real records: sites, departments (optional), shifts, employees, site assignments, employees signed in to the app, and the Console team (organization admins only). It has no manual ticks; each step completes when its records exist. The dashboard card disappears once every required step is done |
| Employee profile | Optional **employee code** (1–32 letters, digits or `. _ / -`, unique per organization ignoring case) and **employment type** (full time, part time, contract, temporary, intern) |
| Archive instead of delete | The Delete button always failed because employees have no delete policy, which protects attendance history. **Archive** sets the profile inactive (ending app access through `my_employee_org_id()`), and the server stamps `archived_at` and `archived_by`. **Restore** reactivates. Archiving someone still checked in at a site is refused. Archived profiles keep their names in history and stop counting on the Dashboard |
| Bulk actions | Select rows (or all shown) to edit department, designation, shift, employment type or status in one statement (all or nothing), add a site assignment, archive, or restore |
| CSV import | Template download; header matching with common aliases; per-line validation against the organization (duplicate emails and codes, formats, unknown shifts, dates as `YYYY-MM-DD` or `DD/MM/YYYY`); missing departments and designations are created; valid rows are inserted in one request; rows with problems are listed and skipped. Limit 1,000 rows and 2 MB |
| CSV export | Exports the filtered employee list. Text that would start a spreadsheet formula (`= + - @`) is prefixed with `'`, which the importer strips again |
| Supervisors | Edit, archive, import and bulk controls are hidden for read-only roles, matching what RLS allows |

## Database (`20261030000003_people_onboarding.sql`)

- `employees`: `employee_code`, `employment_type`, `archived_at`, `archived_by`, with check constraints,
  a case-insensitive unique index on `(organization_id, lower(employee_code))`, and the rule that
  archived means inactive.
- Trigger `employees_10_archive` (runs before the identity guard and auto-linking): server time and
  actor on archive, a block while a site session is open, no reactivation without a restore, no
  forged `archived_by`, and no creating already-archived rows.
- No RLS changes. Archive and restore use the existing manager update policy; audit triggers record them.

## Tests

- `npm run test:db`: 178 passed (18 new for this phase: code uniqueness and format, employment type,
  archive stamping and forgery, open-session block, restore, archived access, cross-org and supervisor
  denial, audit).
- `node --test tests/*.test.mjs`: 64 passed (new `employee-import.test.mjs` and `onboarding.test.mjs`).
- `tsc -b`, `oxlint` (no new warnings in the changed files) and `vite build` pass.
- Live verification after applying: the new columns, 3 checks, code index and `employees_10_archive` trigger
  are present; data is unchanged (6 employees, 30 sessions, 0 archived).
- Live browser test (read-only, signed in as an organization admin): Getting Started showed real counts
  (5 sites, 3 departments, 1 shift, 6 employees, 7 assignments, 3 of 6 signed in, 3 Console members) and
  marked setup complete; the Dashboard hid the setup card and showed 6 employees; the Employees page showed
  the new Type and App columns; an import preview flagged an existing email (ignoring case), a bad date and an
  unknown shift, matched header aliases, and listed new departments and designations; the bulk bar, bulk edit
  and archive confirmations opened and were cancelled. Every Supabase request returned 200, scoped by
  organization. There were no console errors (only the existing React Router upgrade notices). Archive,
  restore, import and bulk writes were not exercised on production data; their database behaviour is covered
  by the replica tests.

## Open items

- Android: accepting the employee invitation after sign-in (`my_employee_invitations` /
  `accept_employee_invitation`), so imported employees can join from the app. Waiting on the app repo commit.
- Self-service organization sign-up is not offered; platform admins still create organizations.
- Already in the code before this phase: the Dashboard site cards show `Â·` where a `·` was meant
  (a double-encoded character in `DashboardPage.tsx`). Recent activity shows "Employee unavailable" for
  sessions whose account has no employee profile.
