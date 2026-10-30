# Phase 2: organizations, employee identity and devices

Status on 2026-10-30: the code and migration are ready and tested locally. The migration has
**not** been applied to the live project (`eqyycmmbcesrtxuawyyb`), and the Android part has not started.

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

1. Back up the database (Supabase dashboard → Database → Backups). There is no down migration.
2. Mark the already-applied data repair as recorded, then push:
   `supabase migration repair --status applied 20261029000000` and `supabase db push`.
   The migration runs in one transaction: it either applies fully or not at all.
3. Grant the first platform admin:
   `insert into public.platform_admins (user_id) select id from auth.users where email = '<email>';`
4. Deploy the Console. The new Console requires the migration; the old one works with or without it.
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

- Not yet run against the live database. PGlite is Postgres 18; production is 17.6.
- Android: device registration, and showing "waiting for approval" / "revoked" in the app.
- Revoking a device is recorded, but uploads are not yet blocked per device; uploads carry no device ID
  until the Phase 5 sync changes.
- Supervisors see the whole organization. Site-scoped supervisors need a supervisor–site table (Phase 4).
- `mutationErrors` maps every `42501` to a generic permission message, which hides specific reasons such
  as cross-organization site use.
- `set_organization_member` grants a Console role to any confirmed account by email, and its error reveals
  whether that email has an account. Granting only gives the account access to the granting organization,
  but an accept-to-join step for Console roles would close the email probe.
