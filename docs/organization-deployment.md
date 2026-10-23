# Crewtraxa organization backend deployment

Status on 2026-10-23: implemented and tested locally; **remote deployment remains pending**. The configured project is `eqyycmmbcesrtxuawyyb`. Only public client keys are available in this workspace. Both `npm run db:preflight` and `npm run db:migrate-organizations` exit without connecting because `CREWTRAXA_DATABASE_URL` is absent. The user chose implementation plus exact deployment steps instead of providing an owner connection.

Latest verification: 20 local Playwright tests passed; 100 PostgreSQL/PGlite authorization/schema checks, date tests, and deployment transaction/history tests passed; production build/typecheck passed; lint completed with three existing Fast Refresh warnings. The real Playwright readiness test still fails: both tables return 404/PGRST205 and both access RPCs return 404/PGRST202, with four matching browser console errors. The two authenticated live browser tests are skipped because their real sessions/fixture IDs are unavailable. The live API isolation command also stops for missing fixture credentials. No remote SQL, bootstrap, or data changes have been performed.

## Exact migrations

Apply in order, after verifying the existing base schema:

1. `supabase/migrations/20261023000000_organizations.sql`: organizations, memberships, private platform administrators, invitations, site scopes, preserved-data backfill, tenant relationships/indexes/constraints, RPCs, grants, RLS, and PostgREST cache reload.
2. `supabase/migrations/20261023010000_organization_management.sql`: validated existing-account assignment, verified email for new memberships, explicit role/status validation, last-administrator protection, authenticated schema usage and secured RPC execution, and cache reload.

The prerequisites are `20260820000000_admin_schema.sql` and `20260821000000_employee_sites_fixes.sql`. Do not replay them over an existing database. Both organization migrations are transactional and retain existing identities and business data. No runtime role comes from editable Auth metadata.

## Apply to the existing project

1. In the Supabase Dashboard, select project **eqyycmmbcesrtxuawyyb**. Run `supabase/diagnose-organization-access.sql` as owner. Confirm the existing tables/columns/constraints, any organization objects, function signatures, privileges, RLS policies, and migration history. Check that Data API exposes `public`; keep `crewtraxa_private` unexposed.
2. Obtain the direct connection or **session** pooler URL from that project's Connect dialog. Configure it securely as the Node-only environment variable `CREWTRAXA_DATABASE_URL`. Use port 5432. The runner checks the database hostname or pooler username against the frontend's project reference, verifies TLS certificates, and rejects another project or a transaction-pooler connection. If the project requires its downloaded CA certificate, set `CREWTRAXA_DATABASE_CA_FILE` to that trusted certificate's local path; URL SSL options cannot disable verification. Do not put this URL, database passwords, test JWTs, or service-role keys in `VITE_*` variables or chat.
3. Run `npm run db:preflight`. Inspect its catalog/policy output and migration history. The runner requires a reconciled `supabase_migrations.schema_migrations` registry containing both base versions. If the registry is absent or incomplete, compare the catalog to the base SQL before recording anything. Use the project's normal Supabase CLI workflow (`supabase link --project-ref eqyycmmbcesrtxuawyyb`, `supabase migration list --linked`). Only after independently verifying that a migration is already fully installed, use `supabase migration repair --linked --status applied <verified-version>` to reconcile its history. Repair changes history only; it does not install missing SQL. See [Supabase migration documentation](https://supabase.com/docs/guides/deployment/database-migrations).
4. Run `npm run db:migrate-organizations`. This applies only unrecorded organization migrations and records each version/name/SQL in the Supabase registry **in the same transaction as the DDL/backfill**. It locks the registry, checks required API tables and RPC grants before commit, and reloads the cache. Repeating the command skips recorded versions and verifies the resulting schema. An unrecorded partial organization schema causes a safe stop for reconciliation. A failed migration rolls back its DDL, data changes, and registry entries together. The CLI deployment pipeline may instead apply the same migration files after history is reconciled.
5. Run the diagnostic again. Require the six membership columns (`organization_id`, `user_id`, `role`, `status`, `created_at`, `updated_at`), tenant composite keys, user lookup index, SELECT-only direct access for authenticated users, no anonymous table access, enabled RLS, read policies, and authenticated-only RPC execution with fixed empty search paths. Business writes and membership changes remain server-authorized.
6. Bootstrap a verified Super Admin as described below, then perform the live checks. Deploy the Console build only against the verified database.

If all objects already exist and the error persists, reconcile the migration registry and apply only the missing follow-up. Check names and exposed schemas, then execute `NOTIFY pgrst, 'reload schema';` as owner. [Supabase documents this cache-refresh action](https://supabase.com/kb/troubleshooting/refresh-postgrest-schema). Do not create duplicate tables, disable RLS, grant anonymous access, or blindly rerun the initial organization migration.

## Initial Super Admin

Independently verify an existing, email-confirmed `auth.users.id`. In one owner SQL Editor session:

```sql
SET crewtraxa.bootstrap_user_id = '<verified-auth-user-uuid>';
-- Execute the checked-in contents of supabase/bootstrap-super-admin.sql here.
```

That script checks the verified email, idempotently inserts the private platform administrator, and grants an active administrator membership in the preserved-data organization. No browser can promote itself. Existing accounts remain employees until explicitly assigned another role. Do not guess a bootstrap UUID or infer authority from `user_metadata`.

## UI behavior and verification

The Console uses real Supabase table queries and secured RPCs for organization listing, creation, editing, activation/suspension, existing-account assignment, member roles/status, invitations, site scope, switching, configuration, errors and retries. Organizations are suspended instead of deleted to retain users, data, and audit history. Missing organization objects prevent access; error handling does not substitute fallback membership or authorization.

Local checks:

```powershell
npm run test:tenancy
npm run typecheck
npm run lint
npm run build
$env:CREWTRAXA_BROWSER_CHANNEL = 'chrome' # or install Playwright Chromium
npm run test:ui
```

The SQL suite executes both migrations and bootstrap with PostgreSQL/PGlite: 100 authorization/schema/constraint/RPC checks, plus date boundaries and deployment-runner tests for target mismatch, missing/partial baseline history, atomic failure, repeated deployment, preserved data, and grant drift. UI fixtures verify lifecycle CRUD, errors/retry, membership assignment/edits, refresh persistence, permissions, switching, and isolation. These local checks do not prove the remote deployment.

Real browser/API checks:

```powershell
npm run test:ui:live
npm run test:tenancy:live
```

The live readiness probe opens the Console and calls the configured real Data API. It requires revoked anonymous access to return SQL error `42501` with HTTP 401/403, and rejects missing objects or invalid credentials. For the authenticated browser tests configure Node-only secrets/IDs:

- `CREWTRAXA_TEST_A_ADMIN_TOKEN`, `CREWTRAXA_TEST_ORG_A`, `CREWTRAXA_TEST_ORG_B`: a real A administrator with no B membership. The test verifies real Auth acceptance, own memberships, Employees UI, filtered B reads, and denied B selection.
- `CREWTRAXA_TEST_PLATFORM_ADMIN_TOKEN`, `CREWTRAXA_TEST_MEMBER_UUID`: a real platform administrator JWT and a separate, verified test account. The lifecycle test creates a uniquely named `Crewtraxa isolation test UI ...` organization, edits it, assigns the test member as administrator, verifies database membership after refresh, suspends/reactivates it, and suspends the dedicated organization in cleanup. It preserves that test record for inspection.

Live sessions must be unexpired JWTs for the `authenticated` role, never service-role credentials. Browser traces/screenshots/video are disabled for live sessions. Tests requiring absent sessions are explicitly skipped. The broader API isolation test's five-role/two-organization fixtures are documented in `docs/multi-organization.md`.

Require all authenticated live browser tests and the API isolation suite to pass before declaring the PGRST205 incident resolved. Without remote access, the exact remaining action is deployment of the two migrations above to the confirmed project, verified administrator bootstrap, and those live checks.
