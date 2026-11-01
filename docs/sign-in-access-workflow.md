# Sign-in and workspace access

Updated 2026-11-01. The Console separates authentication from workspace authorization. Successful
authentication keeps the session; `ProtectedRoute` resolves the next step from `my_console_access()`.
Database role checks and row-level security continue to protect all workforce data.

| Account state | Next step |
| --- | --- |
| Active Console membership | Open the workspace; organization admins resume unfinished setup |
| Console invitation without membership | Accept or decline the invitation; eligible accounts may create their own organization instead |
| Confirmed new account eligible for creation | My account → choose Create an organization or Join an organization; creation continues through the setup wizard |
| Platform admin without organizations | Open Organizations to create the first organization |
| Linked employee without Console membership | Open My workspace at `/me`: personal web time clock, timesheets and entries; no Console role required |
| Employee invitation | Accept it on `/account` using the confirmed matching email, then open the personal workspace |
| Email not confirmed | Confirm email, then refresh access |
| Previous organization creator without access | Ask a platform admin to restore the organization or membership |
| Older server without self-service support | Show database update guidance instead of assuming this is an employee |
| Other account without a role | Ask the employer to invite the email under Employees, then accept; a member does not need a Console role |
| Access request failed | Retry the request without entering credentials again |

Existing sessions use this same gate, including browser reloads and email confirmation returns.
No role is inferred from editable user metadata. Employee membership never automatically grants a
Console role. Accepting a Console invitation is still explicit and server-checked.

## Rollout

Deploy the current Console build and apply pending migrations in order, including
`20261031000003_self_service_organizations.sql` (organization creation and setup) and
`20261101000000_console_access_guidance.sql` (account-specific help).
Apply `20261101000001_member_web_workflow.sql` to let employees create their own separate organization
and to enable the web clock. Each confirmed account may create one self-service organization;
platform admins continue using their organization management page. Creation never grants access
to another team's Console or changes an existing employee profile.
The frontend works without the guidance migration, showing general role help when no reason is
returned. It detects older access responses that lack `can_create_organization`.

For an existing employee who should manage a team, an organization admin opens **Users & Roles**,
invites their email with the intended Console role, and the invitee refreshes access and accepts.
Creating a new account does not grant access to another organization's data.

The member profile and employee invitations use existing RLS-protected APIs. They do not depend on
the new web-clock migration. Timesheets call `my_timesheet` and `my_timesheet_entries`, which
derive the employee from the caller, rather than the Console's active organization selection.

Web clock-in uses an assigned site, current browser GPS and a server timestamp. The server checks
active membership, organization status, geofence requirements, work schedules, and registered-device
restrictions. It rejects duplicate open shifts. Clock-out ends the caller's open shift even after
a site assignment or device rule changes. Browser GPS is not protection against location spoofing.
An open personal workspace sends a server-timed heartbeat once per minute to keep its active shift
from being marked stale. Keep the page open during work; use the Employee app for background and
offline tracking. Background browser suspension and closed tabs cannot provide reliable heartbeats.
Break start/stop, leave and approval workflows are not implemented by this change.

## Jibble reference and scope

The workflow follows Jibble's publicly documented pattern of organization setup, time-tracking
rules, work locations, and team invitations:

- [Team onboarding](https://www.jibble.io/help/onboarding-to-jibble-set-up-your-team)
- [Add or invite members](https://www.jibble.io/help/add-or-invite-team-members)
- [Member workflow](https://www.jibble.io/help/using-jibble-as-a-member)

Crewtraxa already implements setup, invitations, schedules, policies, geofences, attendance,
timesheets, and reports. This change fixes the entry and recovery flow for those features.
It does not establish Jibble's internal technology or implement full feature parity.
See `jibble-benchmark-gap-analysis.md` for the broader roadmap, including leave, approvals and kiosks.

## Verification

Run `node --test tests/*.test.mjs`, `npm run test:db`, `npm run test:access`, and `npm run build`.
The browser check uses Chromium (`npx playwright install chromium` if needed), starts its own Vite
server, and intercepts all backend requests with synthetic accounts. It never signs in to or writes
to the live Supabase project. Screenshots are written to the OS temporary directory.
