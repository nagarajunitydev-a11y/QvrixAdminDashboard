# Site deletion investigation — 2026-10-24

Project: `eqyycmmbcesrtxuawyyb`.
Site: `6b26ef6b-e69a-4246-a395-febb3d18dd23`.

## Confirmed live evidence

Read the live database through the Supabase Management API, including constraints,
RLS policies, site fields, references and triggers. The site has:

| Reference | Rows | Constraint |
| --- | ---: | --- |
| Location logs | 1 | `location_logs_site_id_fkey` |
| Attendance sessions | 1 | `presence_sessions_site_id_fkey` |
| Employee assignments | 0 | `employee_sites_site_id_fkey` |
| Site visits | 0 | `site_visits_site_id_fkey` |

These foreign keys reference `sites(id)` without cascading deletes. The existing
history therefore prevents deleting this site. Preserving these relationships
requires retaining the site. No automatic child deletion or unlinking is safe here.

The frontend previously sent DELETE directly, promised assignment removal in its
confirmation dialog, and discarded PostgREST error details because plain error
objects failed its `instanceof Error` checks. Other delete services also ignored
affected-row counts, so an RLS-filtered zero-row delete looked successful.

The live `sites_mutate` policy allows manager mutations. There is no unique site
name constraint and no user-defined site update trigger. Site creation uses INSERT;
editing uses UPDATE with the UUID. No upsert was involved in these code paths.
The live `employees` table has no DELETE/ALL policy, so its existing RLS does not
permit employee deletion. This policy has been preserved.

After the user provided six employee records, I checked those IDs against the live
database. All six records exist; some have employee-site assignments despite having
`user_id: null`. One linked employee has 34 location log records, 14 attendance
sessions and 3 site assignments. A missing auth-user link does not remove the
foreign key from `employee_sites.employee_id` to `employees.id`.

## Limit on the original error diagnosis

The original browser's request method and response JSON were not available. There
was no accessible browser debugging connection. Supabase log queries returned
backend errors. An unauthenticated read returned no visible site rows under RLS;
it was not used as evidence that the site was missing.

The historical references are confirmed deletion blockers, but the exact constraint
reported by the user's original 409 has **not** been captured. No DELETE was sent
against the live target to reproduce it. A 409 alone cannot distinguish a foreign
key violation (`23503`) from a unique violation (`23505`), as documented in the
[PostgREST error reference](https://docs.postgrest.org/en/stable/references/errors.html).
The original method and response JSON are still needed to close that distinction.

## Changes

- Check site assignments and history before deleting; report the dependencies and
  leave the site intact. Foreign keys still protect against a racing new reference.
- Delete unused records only through their existing UUID and verify an affected row
  was returned. Apply this check to sites, departments, designations, shifts and employees.
- Convert mutation error objects to `Error` instances with useful UI messages while
  retaining the database message, code, details and hint.
- Keep deletion errors visible in the site dialog and correct its confirmation text.
- Keep site edits as updates even if the selected site disappears during refresh.
  Compare the original editable fields atomically before updating to reject stale
  drafts without overwriting newer values. `updated_at` alone is insufficient here
  because this live table has no update trigger. Only name, coordinates and radius
  can be updated; UUIDs and relationships are untouched.

## Verification

- Production build passed. Targeted lint passed with existing SitesPage hook warnings.
- Live SQL checks under the existing authenticated manager RLS passed: creation,
  UUID-targeted update, refreshed reads, stale-update rejection, employee assignment
  and geofence linkage. All test writes were rolled back; no temporary test sites remain.
- Browser checks with mocked Supabase responses passed: referenced-site deletion
  sends no DELETE; persistent dependency errors; intended-field UUID update and
  refresh; stale drafts retained without inserts; simulated `409/23503` handling
  after preflight; zero-row/RLS failure; one INSERT for new sites; successful unused
  site deletion only after an affected row; shared delete error diagnostics.
- Before/after live snapshots matched for the target site's complete row, history
  and assignment counts, constraints, policies and site triggers.

No live target data, authentication, schema, constraints or RLS policies were changed.
The browser checks verify application behavior; they do not reproduce the user's
original network response or constitute a deployment check.
