# Phase 2: organizations, employee identity and devices

Status on 2026-10-30 (13:30 UTC): applied to the live project (`eqyycmmbcesrtxuawyyb`) as
`20261030000000` plus the follow-up `20261030000001`. A JSON export of every public table was taken
first. The Android part has not started.

`20261030000001` removes the original single-column foreign keys that the new composite keys duplicate.
With both present, PostgREST found two relationships per pair and failed every embed such as
`employees?select=*,departments(name)` with `PGRST201` (HTTP 300), which broke the Employees, Shifts,
Attendance and Assignments pages for about 13 minutes. `npm run test:db` now checks that every table
pair has exactly one relationship.

## Why organizations come first

Every later phase (geofencing, rosters, dashboards, payroll) adds tables and access rules. Making the
database organization-aware now means those rules are written once, scoped correctly from the start.

## Data model

| Change | Detail |
| --- | --- |
| `organizations` | Name, slug, IANA time zone (validated), active flag. Existing data moves to one default organization, `Qvrix`. |
| `organization_members` | Console roles per organization: `org_admin`, `manager`, `supervisor`. Field employees stay in `employees`. |
| `platform_admins` | Platform super admins. Granted only in SQL; no API writes it. |
| `organization_id` | Added (NOT NULL, indexed) to sites, shifts, departments, designations, employees, assignments, attendance, location logs, site visits and audit logs. Composite foreign keys prove both sides of every reference share an organization. |
| `devices`, `device_assignments`, `device_events` | Device registry with holder history and review events. Written only through RPCs. |
| `presence_sessions.closed_by` | `employee`, `auto_stale` or `manager`. |

Department, designation and employee email (ignoring case) are unique per organization. One sign-in account
belongs to at most one employee profile.

## Roles (enforced by RLS, mirrored in the Console)

| Role | Can |
| --- | --- |
| Platform admin | Everything in every organization; create organizations |
| Organization admin | Everything a manager can, plus grant Console roles and edit organization settings |
| Manager | Manage employees, sites, shifts, assignments; invite employees; review devices; read audit logs |
| Supervisor | Read workforce data; change nothing |
| Employee | Own attendance and location only (unchanged) |

Existing managers (trusted `app_metadata.role = 'manager'`) become organization admins of the default
organization. The Console no longer reads `user_metadata.role`, which users can edit themselves.

## Integrity rules

- Clients never choose a row's organization. Triggers derive it from the employee profile, else the site
  (field data), or from the caller's only organization (Console records). Rows cannot move between organizations.
- Employees can close their own open attendance but cannot change who, where or when a check-in happened, or
  rewrite a completed check-out. A real check-out may replace an automatic stale-session closure. Hours are
  always computed by the database, never taken from the client.
- An employee profile is an invitation. `employees.user_id` is set only with proof that does not come from
  the inviting organization: the account holder accepts it while signed in with the same confirmed email
  (`my_employee_invitations`, `accept_employee_invitation`), or server-controlled `app_metadata` names both
  `role: employee` and this `organization_id`, or a platform admin links it (`link_employee_account`).
  Organization managers cannot attach an existing account to their organization; otherwise one tenant could
  pull another tenant's worker or manager in and read their location history. Employee email is unique per
  organization, so no tenant can reserve an address platform-wide. The old behaviour of creating placeholder
  profiles from any email is removed.
- Audit rows are written only by triggers (the API insert policy is removed) and now cover sites,
  assignments, attendance updates, memberships, organizations and devices.

## Compatibility during rollout

Installed Android builds and the currently deployed Console keep working after the migration: they never
send `organization_id`, and the triggers fill it in. Two deliberate behaviour changes:

- Signed-in accounts read only their own organization's sites (previously every site was readable).
- An account with no employee profile can still upload attendance at a site, but site-less location points
  are refused with a retryable error (`42501`) until the account is linked. The Android outbox keeps them.

## Rollout order

1. Done: backed up (JSON export of all public tables). There is no down migration.
2. Done: recorded the already-applied data repair `20261029000000` (re-running it would have auto-linked
   accounts without consent), then `supabase db push` applied `20261030000000` and `20261030000001`.
3. Grant the first platform admin:
   `insert into public.platform_admins (user_id) select id from auth.users where email = '<email>';`
4. Deploy the Console. The new Console requires the migration; the old one works with or without it
   (verified on the deployed site after both migrations). Browsers that loaded the deployed Console
   between the two migrations may hold cached `300` responses: a hard refresh clears them. The new
   Console requests API data with `cache: 'no-store'`, so it cannot replay a cached error.
5. Android: accept invitations after sign-in (`my_employee_invitations` / `accept_employee_invitation`) and
   register the device (`register_device`) after sign-in and on each sync. Until then, new employees are linked
   by a platform admin or by setting `app_metadata` `{ "role": "employee", "organization_id": "<uuid>" }`.

## Verification done

- `npm run test:db`: the migration applied to a PGlite replica of the live schema (read from the catalog,
  no data), seeded with production-shaped data. 130 checks pass: backfill without row loss, isolation
  between two organizations for every table and view, role limits, consent-based linking (including
  cross-organization takeover attempts), attendance guards, device review flow, maintenance RPC scoping
  and audit coverage.
- `node --test tests/*.test.mjs`: 49 pass, including new organization-scoping tests.
- `npm run build` and the TypeScript check pass.
- Browser smoke test with every Supabase request intercepted (no live calls): Console access gate, no-access
  screen, organization switching (all requests re-scoped, cache cleared), Devices, Users & Roles, and Live
  Tracking labels.

## Open items

- `fetchEmployeeLocations` in `services.ts` is unused and its embed hint `employee_sites_sites` never
  matched a constraint; it fails with `PGRST200` (also before Phase 2).
- Android: device registration, and showing "waiting for approval" / "revoked" in the app.
- Revoking a device is recorded, but uploads are not yet blocked per device; uploads carry no device ID
  until the Phase 5 sync changes.
- Supervisors see the whole organization. Site-scoped supervisors need a supervisor–site table (Phase 4).
- `mutationErrors` maps every `42501` to a generic permission message, which hides specific reasons such
  as cross-organization site use.
- Resolved: Console roles by invitation (`20261030000002`, applied 2026-10-30 at 14:53 UTC after a JSON
  backup; verified with the organization admin account on every page). `set_organization_member` attached any confirmed account by email without consent,
  revealed whether the email had an account, and exposed its last sign-in time. It is replaced by
  `invite_organization_member`, which stores an email-keyed invitation, never consults `auth.users`
  and returns the same response for every email. Membership starts only when the signed-in holder of that
  confirmed email accepts (`respond_to_console_invitation`); the Console shows open invitations at sign-in.
  Role changes (`set_organization_member_role`) apply only to existing members. Invitations expire after
  14 days and are audited. Invitees still need a Supabase Auth account to sign in.
