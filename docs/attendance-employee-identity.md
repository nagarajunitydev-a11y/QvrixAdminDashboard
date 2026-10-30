# Attendance employee identity repair — 2026-10-29

Attendance and presence use the same `PresenceSessionsPage` at `/attendance` and
`/presence`. In the live database, `presence_sessions.user_id` references
`auth.users.id`. The employee name belongs to the profile reached through
`employees.user_id`; it cannot be resolved through `employees.id` or a UUID prefix.
There is no separate device table in this database.

Two existing profiles had null `user_id` values despite having attendance from
their verified auth accounts. Both accounts have no role in either app or user
metadata. The live auth handler requires a trusted app role of `employee`, so it
did not link those profiles. Megha P's profile was also created after her auth
account. The existing auth trigger and role restrictions were preserved.

The repair matches existing profiles to confirmed auth accounts using exact email
equality, rejects ambiguous normalized email matches on either side, requires
recorded attendance, and refuses to overwrite an existing link. It creates no
profiles and infers no names. The idempotent data-only migration is
`supabase/migrations/20261029000000_repair_attendance_employee_links.sql`.

The two verified links were applied to the live database after a successful
transaction that was rolled back for validation. A separate post-commit read
confirmed these results under the existing authenticated manager RLS:

| Auth user prefix | Employee name | Attendance sessions |
| --- | --- | ---: |
| `39235d6e` | Megha P | 8 |
| `64df1596` | Sruthi N | 7 |
| `38f90c73` | NagarajUnity S — existing link | 14 |

All 29 sessions now resolve to employee names, with zero unresolved sessions and
zero remaining repair candidates. There are still six employee records and seven
site assignments. Complete attendance and assignment row fingerprints matched
before and after, and all employee fields except the two repaired `user_id`
values and their `updated_at` timestamps were preserved. No schema, policy,
auth role, trigger, site assignment, or attendance record was changed. The
existing employee audit trigger records the profile updates normally.

The page now waits for both sessions and employee data, handles failed lookups
with the existing error component and retry, and resolves names only from unique
non-null employee auth links. Names in the table and employee filter share this
resolver. Missing or ambiguous identities remain unavailable instead of receiving
a device label or guessed name. Existing layout and styling are unchanged.

Verification included 32 passing unit/regression tests, a successful production
build, and clean scoped lint. Browser checks replayed the actual post-repair
database snapshot read under manager RLS: all 29 records on each route showed
the expected names, filtering Megha P returned her eight records, delayed employee
loads showed no device-label flash, and failed employee reads recovered on retry.
These browser checks used the real record snapshot through an intercepted
transport; they did not create a live browser login or verify a deployment.
