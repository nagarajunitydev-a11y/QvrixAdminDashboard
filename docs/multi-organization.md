# Crewtraxa Workforce organization rollout

For the current two-migration deployment procedure and verification gates, see [organization backend deployment](organization-deployment.md).

Product names: **Crewtraxa Workforce**, **Crewtraxa Console**, **Crewtraxa Employee**.
Tagline: **Every Team. Every Site. In Sync.**

## Current verification status

The console and incremental migrations are implemented in this repository. The local PostgreSQL tests execute the real SQL migrations, roles, constraints, RLS policies, and RPCs against isolated organizations. Local browser tests use intercepted responses to verify UI behavior; separate live Playwright tests call the real configured API. Local results do not prove live database security.

**This is not a completed production rollout.** No live migration has been applied. The current workspace has public Supabase client configuration, not a privileged migration connection or an approved initial Super Admin UUID. On 2026-10-23, read-only REST probes against eqyycmmbcesrtxuawyyb.supabase.co returned HTTP 404 / PGRST205 for both organizations and organization_memberships. This confirms neither relation is available in the API schema; an owner-level catalog check is still required to distinguish missing tables from stale cache or schema exposure. The actual live schema and policies, live REST isolation tests, and employee-device/offline end-to-end tests remain release gates.

## Schema and authority

Apply `supabase/migrations/20261023000000_organizations.sql` and then `supabase/migrations/20261023010000_organization_management.sql` after the two existing migrations. They add organizations, memberships, site scopes, invitations, and a private platform administrator table, then validate account assignment. Existing business tables are extended in place:

- employees, departments, designations, shifts;
- sites and employee_sites;
- presence_sessions and location_logs;
- audit_logs.

Attendance uses presence_sessions. Alerts/reports are derived views of scoped records. The current device screen represents account links and location reporting, not a separate device inventory. There are no duplicate attendance, alerts, device, or report tables. If the live project has additional profiles, attendance, alerts, devices, reports, or site_visits tables, the migration stops transactionally so their actual relationships and authorization can be incorporated first.

Each business row has a non-null organization_id. Composite foreign keys prevent linking an employee, department, designation, shift, site, assignment, or tracking packet to another organization's referenced record. Name/email uniqueness is scoped to the organization. Record organization IDs are immutable after insertion.

All existing business policies are replaced. A restrictive tenant policy plus operation-specific policies enforce membership and scope. Anonymous table access is removed. No policy uses user_metadata, a local-storage selection, or a client-supplied role as authority. Security-definer helpers have a fixed empty search_path, qualified relations, and explicit execution grants. Platform administrator membership is stored outside the exposed public schema.

## Permission matrix

| Role | Permissions |
| --- | --- |
| Platform Super Admin | Create/edit/activate/suspend organizations, configure active organizations, manage memberships. Business access is blocked while an organization is suspended. |
| Organization Admin | Own active organization's business records, memberships, invitations, scopes, branding, timezone, configuration. Cannot create platform administrators or change organization lifecycle. |
| Manager | Read/update/delete employees and sites within explicitly permitted sites; manage their assignments and organization shifts/departments/designations. Creating employee profiles/sites and linking login accounts requires an organization administrator. |
| Supervisor | Monitor employees, sites, and tracking within explicitly permitted sites. No business mutations. |
| Employee | Own profile, assigned sites, own attendance and tracking, organization reference configuration. Own tracking uploads require active membership and authorized site assignment. |

Organization members and site scopes can be administered through Users & Roles. Last active organization administrators cannot be demoted/suspended through the RPC. Audit history is administrator-only. Existing identity fields in tracking records cannot be moved to a different user, site, or organization.

## Existing data and initial administrators

The designated backfill organization is:

- UUID: `00000000-0000-4000-8000-000000000001`
- Name: `Existing organization`
- Time zone: `Asia/Kolkata`

Original IDs, tracking timestamps, session durations, and relationships are retained. Rename/configure this organization after bootstrap, or change its designated values before the initial application if the operator supplies different values.

**Legacy user_metadata roles are not promoted.** Existing auth users initially receive employee membership. Verify every existing manager/admin out of band and restore their intended organization role/site permissions before releasing the new console. This deliberate bootstrap step prevents a self-assigned legacy metadata role from becoming a tenant/platform administrator.

1. Inventory the live schema and policies using an owner-level connection to the existing Supabase project:

   ```powershell
   # Set CREWTRAXA_DATABASE_URL securely in your execution environment.
   npm run db:preflight
   ```

2. Reconcile any differences with the checked-in schema. Confirm a restorable database snapshot and coordinate the database/client rollout. Do not re-run the old base migrations over an already migrated organization database; they recreate legacy policies.
3. Apply both organization migrations using your migration pipeline or `npm run db:migrate-organizations`. The helper validates the project, requires reconciled base migration history, refuses unrecorded partial organization objects, verifies grants/RPCs/RLS, and atomically records migration history with the SQL changes. It uses certificate verification and never changes the frontend project configuration. See the current deployment guide linked above.
4. Verify the initial administrator's auth.users UUID and confirmed email in the Supabase dashboard. As the database owner, run:

   ```sql
   SET crewtraxa.bootstrap_user_id = 'VERIFIED-AUTH-USER-UUID';
   -- Execute the contents of supabase/bootstrap-super-admin.sql next.
   ```

   This grants private platform administration and organization administration in the backfill organization. Do not grant this authority through user metadata or a public signup request.
5. Sign in as that administrator. Verify existing managers, grant their memberships, and explicitly assign their permitted sites. For pre-release operator-controlled bulk setup, use owner SQL with an independently approved UUID/role list, never a list selected from raw_user_meta_data.
6. Run the live access tests and actual employee-device scenarios below before releasing the console. Deploy the database before the new console. Without verified schema/membership access, the new console fails closed rather than falling back to unscoped data.

## Invitations and user provisioning

Users & Roles creates single-use, seven-day invitation links. Only a hash of a random token is stored in the database. Links use a URL fragment, not a query parameter. Share links securely; automatic invitation emails are not sent by this implementation.

The invited user signs in or creates a normal Supabase account on the acceptance screen. Existing Supabase email verification settings remain unchanged; confirm that email confirmations are enabled before enabling production invitation-based account provisioning, since email_confirmed_at assumes the project actually verifies mailbox ownership; acceptance always requires a verified matching auth email. The server locks and validates the invitation, organization status, expiry, revocation, and recipient before granting membership. A matching unlinked employee profile can be linked server-side. Invitations cannot replace an existing membership's role or reactivate a suspended member. Tokens cannot be accepted twice.

Platform administration is never an invitation role. Existing member status and site access can be revoked by authorized administrators. Account deletion and Supabase-wide identity administration are not exposed in the browser.

## Switching, queries, branding and time zones

The switcher calls a server RPC to verify active membership/status. Each selected organization/role receives a separate React Query client and remounted business-page state. Old queries are cancelled, and each service instance captures its organization ID, so delayed responses or in-flight mutations cannot change which organization a request belongs to. Refreshes use the existing query invalidation logic without a document reload.

Local storage is only a per-user selection preference. Membership/status is revalidated on load, focus, and every minute. Database RLS enforces current permissions on every request regardless of cached UI state. Switching clears table filters, search dialogs, and edit dialogs. Global search, map data, reports and metrics all use organization-bound services.

Organization settings store a display name, accent color, timezone and JSON configuration. Selected organization context appears in navigation and the dashboard. Attendance filters/report boundaries and chart days use the organization timezone, including daylight-saving days. CSV timestamps remain explicit ISO instants.

## Employee tracking and offline compatibility

The existing Android source was inspected read-only. Its narrow upload DTOs carry stable user/site IDs and generated server bigint IDs remain unchanged. Start Shift inserts a presence_sessions record and End Shift updates that same authorized record.

The database derives missing organization_id for old queued packets from their existing site ID; it never derives a tenant from the console selection. Site-less legacy packets are accepted only when there is exactly one active membership. Ambiguous packets are rejected instead of being attached to an arbitrary organization. New clients should capture an explicit organization_id when the event is recorded, not when its queue is uploaded.

RLS still checks the authenticated user, active membership, and site assignment. Revoked access or a suspended organization fails closed. Rejected uploads must remain queued for reconciliation. Authorized employees can close their own existing sessions after site reassignment; a pending new entry for a no-longer-authorized site requires operator reconciliation. Existing unlinked legacy tracking accounts must be reconciled to employee profiles/assignments before rollout.

**The Android Room cache/queue has not been migrated to store a separate organization context.** Do not enable ambiguous multi-organization employee use on a device until the Android client persists organization_id with each site/profile/event and performs a real Room migration preserving unsynced rows. Console managers/admins can have multiple memberships; legacy single-organization and site-bound upload compatibility is covered by database tests. Android compilation, device GPS/geofence behavior, offline queue replay, and full Start/End Shift end-to-end verification have not been performed here.

## Repeatable verification

```powershell
npm run test:tenancy
npm run typecheck
npm run lint
npm run build
npx playwright install chromium
npm run test:ui
# On this Windows workstation, installed Chrome can be used with:
# $env:CREWTRAXA_BROWSER_CHANNEL = 'chrome'
```

`test:tenancy` uses PGlite's PostgreSQL engine, not mocked authorization. It applies the existing migrations and the tenant migration to legacy seeded records, then exercises two organizations, five roles, RLS reads/writes, site scope, composite keys, metadata spoofing, invitation acceptance, suspension, backfill, and legacy offline packet/session operations. Separate date tests cover organization boundaries and 23/25-hour DST days.

Playwright uses isolated HTTP fixtures and never writes to the live Supabase project. It checks switching without reload/cache leaks, delayed old responses, all business routes, metadata spoofing, employee/supervisor UI access, migration failure, invitations, and mobile switching.

For direct **live Supabase REST/RPC** tests, create dedicated organizations whose names begin `Crewtraxa isolation test ` and provision test users through the secured membership flow. Give A manager/supervisor the A site, link the A employee to the A site, and keep every A test user out of B. Seed distinct employee/site/shift/attendance/tracking data in each. Provide these Node-only environment variables securely:

- CREWTRAXA_TEST_ORG_A, CREWTRAXA_TEST_ORG_B, CREWTRAXA_TEST_SITE_B;
- CREWTRAXA_TEST_A_ADMIN_TOKEN, CREWTRAXA_TEST_B_ADMIN_TOKEN;
- CREWTRAXA_TEST_A_MANAGER_TOKEN, CREWTRAXA_TEST_A_SUPERVISOR_TOKEN, CREWTRAXA_TEST_A_EMPLOYEE_TOKEN.

Run `npm run test:tenancy:live`. The runner checks dedicated test organization names before attempts at cross-organization access. It verifies read isolation for all applicable tables, no-op cross-tenant updates, rejected inserts, and rejected membership RPCs. It requires authenticated test-user JWTs, not service-role keys. A failing isolation policy can create a test-only record, so use dedicated fixtures and reconcile them after a failed test. Do not configure these tokens with a VITE_ prefix or commit them.

Finally, validate each role in the deployed UI and direct API, a user with two memberships switching both directions, employee/site/shift assignment, Start Shift, End Shift, inside/outside GPS reporting, offline capture/reconnect, revoked memberships, suspended organizations, and stale queued packets. Multi-organization support is not production-complete until these live and device checks pass.

## Repairing organization access

Run `supabase/diagnose-organization-access.sql` in the **existing project's** SQL Editor (project ref `eqyycmmbcesrtxuawyyb`), or use the secure `CREWTRAXA_DATABASE_URL` with `npm run db:preflight`. The diagnostic is read-only and lists required relations, functions, grants, and RLS policies.

- If organization tables are absent and the existing base schema matches, apply `supabase/migrations/20261023000000_organizations.sql` through the migration workflow described above (`npm run db:migrate-organizations`). Do not reapply the old base migrations over existing data.
- If some organization objects already exist, stop and reconcile the catalog with the migration. Do not create duplicate tables or rerun this migration over a partial installation.
- If objects exist, verify `public` is exposed in Supabase Data API settings and authenticated grants/RLS match the version-controlled migration. Reload the cache with `NOTIFY pgrst, 'reload schema';` using the SQL Editor or owner connection. This is the [supported Supabase procedure](https://supabase.com/kb/troubleshooting/refresh-postgrest-schema).
- Bootstrap a verified administrator using `supabase/bootstrap-super-admin.sql`, as documented above. No client metadata or first-login promotion is used.
- Click **Retry access check**. It reruns the organization list, current-user memberships, platform check, and selected-organization authorization without reloading the document. Missing objects, session failures, permissions, and connectivity failures have distinct messages; none grants fallback access.

The frontend's initial failing query is `organizations.select('*').order('name')`, issued alongside `organization_memberships.select('*').eq('user_id', authenticatedUserId)` and `rpc('is_platform_admin')`. Once those succeed, selection calls `rpc('validate_organization_selection', {org})`. Empty successful membership results are handled as no available organization, not a missing schema.

Completion requires the live authenticated access check to succeed and the documented live isolation suite to pass. Public client keys cannot inspect the PostgreSQL catalog, run migrations, or bootstrap administrators.

## Confirmed RPC failure and application status (2026-10-23)

The local Vite configuration matches the reported project, `eqyycmmbcesrtxuawyyb.supabase.co`. Read-only diagnostic requests with the configured public client key reproduce:

| Method and path under `/rest/v1/` | Result |
| --- | --- |
| GET `organizations?select=id&limit=0` | 404, PGRST205 |
| GET `organization_memberships?select=user_id&limit=0` | 404, PGRST205 |
| POST `rpc/is_platform_admin`, body `{}` | 404, PGRST202 |
| POST `rpc/validate_organization_selection`, body containing `org` | 404, PGRST202 |

`src/api/organizations.ts` is the application source of these calls. `index.mjs` is the Supabase library transport, not an alternate authorization implementation. No endpoint changes are needed based on the checked-in schema. These public-key probes establish API visibility failure; they do not verify authenticated access or prove whether the underlying catalog objects are absent.

**Required migrations remain unapplied by this workspace:** `20261023000000_organizations.sql` and `20261023010000_organization_management.sql`, after the existing `20260820000000_admin_schema.sql` and `20260821000000_employee_sites_fixes.sql` prerequisites have been confirmed in the live schema. Do not reapply prerequisites blindly. The organization migration includes all ten frontend RPCs, not only the organizations table. `is_platform_admin()` has no arguments, returns boolean, uses `auth.uid()` to look up `crewtraxa_private.platform_admins`, fixes its SECURITY DEFINER search_path to empty, and grants EXECUTE to authenticated users while revoking PUBLIC/anon execution. Organization administrators are not automatically platform administrators.

The migration is transactional and intended to be recorded and applied once. It is **not a standalone rerunnable repair script**: existing organization objects cause the runner to stop for catalog reconciliation. An idempotent repair for a partially deployed schema cannot be safely selected until that schema and its migration history are inspected. Repeated bootstrap is supported using unique keys and ON CONFLICT; local tests execute the actual bootstrap twice and verify one admin and one membership remain.

To finish, an operator must supply an owner migration connection securely as `CREWTRAXA_DATABASE_URL` to this process, or run the diagnostic and approved migration in the existing project's SQL Editor. Run `npm run db:preflight` first and reconcile any drift. After migration, run the diagnostic again, then set `crewtraxa.bootstrap_user_id` to an independently verified, email-confirmed `auth.users.id` and execute `supabase/bootstrap-super-admin.sql` in that same SQL session. The setting is an owner-side bootstrap input, never a browser parameter. The SQL Editor procedure is an alternative to the connection; no service-role key belongs in Vite configuration.

No privileged connection, management token, verified bootstrap UUID, or authenticated test sessions were available during this investigation. The preflight command therefore exits without modifying the database. Live migration history, catalog verification, cache reload, administrator provisioning, authenticated access checks, two-organization API isolation, and browser confirmation against the real project are still pending. Local tests are not substitutes for these gates.

## Membership 404: Playwright verification (2026-10-23)

`npm run test:ui:live` with `CREWTRAXA_BROWSER_CHANNEL=chrome` opened the local Console at `http://127.0.0.1:4175/employees`, verified the unauthenticated redirect to `/login`, and made real browser fetches to `eqyycmmbcesrtxuawyyb.supabase.co`. No network responses were intercepted. The membership probe used the exact `select=*&user_id=eq.<uuid>` shape with a nil UUID filter, since no authenticated session was available. That filter does not authenticate or impersonate a user.

Both table endpoints returned 404/PGRST205; both access RPC endpoints returned 404/PGRST202. The browser console recorded four corresponding failed-resource errors. The live readiness test fails on those responses. Its authenticated organization-access test is explicitly skipped without `CREWTRAXA_TEST_A_ADMIN_TOKEN`, `CREWTRAXA_TEST_ORG_A`, and `CREWTRAXA_TEST_ORG_B`. It validates the real JWT with the configured Auth server, checks the caller's memberships, opens the Employees UI, and requires cross-organization reads to return no rows and selection to return 403. It never fabricates a live login or uses a service-role token. Live traces/screenshots/video are disabled to keep sessions out of artifacts.

The query name matches the migration. These results are consistent with an undeployed organization migration, but do **not** distinguish missing catalog objects from cache or schema exposure problems. The expanded read-only `supabase/diagnose-organization-access.sql` reports similarly named relations across schemas, membership columns/constraints, public schema usage, Data API role/database configuration overrides, table privileges, migration history, and RLS policies. Run it as the owner in the confirmed project before choosing a deployment action.

Remaining deployment steps:

1. Confirm the SQL Editor or secure owner connection belongs to project `eqyycmmbcesrtxuawyyb`. Run the diagnostic and reconcile live migration history with the two base migrations. `npm run db:preflight` requires `CREWTRAXA_DATABASE_URL`; it currently stops because that variable is absent.
2. If organization objects are absent and the legacy schema matches, apply `20261023000000_organizations.sql`, followed by `20261023010000_organization_management.sql`, through the existing migration workflow. The direct owner runner `npm run db:migrate-organizations` now records both migrations in the Supabase registry atomically with their SQL changes, after requiring reconciled base history. The migrations preserve legacy data and enforce authorization. Do not rerun base migrations or create a second membership table.
3. If the catalog already has the objects, inspect names, columns, grants, policies, and exposed schemas against the migration. Repair confirmed drift with a separate versioned migration; refresh the PostgREST schema cache after catalog corrections. Do not rerun the full organization migration over a partial installation.
4. Bootstrap only an independently verified administrator using `supabase/bootstrap-super-admin.sql`. Existing accounts are backfilled as employees; editable Auth metadata does not grant administrator access. Re-run the owner diagnostic to verify columns, grants, policies, and function definitions.
5. Supply dedicated authenticated test-user JWTs and IDs securely, then run `npm run test:ui:live` and `npm run test:tenancy:live`. Require the live browser member/denial test and API isolation suite to pass before declaring the production issue fixed.

Local verification now includes 100 PostgreSQL checks, organization date tests, deployment transaction/history tests, and fixture-backed Playwright regressions for lifecycle CRUD, assignment, refresh, the exact membership PGRST205 response, retry recovery, and unauthorized selection. These local results do not establish that the remote database has been repaired.
