# Sign-in and workspace access

Updated 2026-11-01. The Console separates authentication from workspace authorization. Successful
authentication keeps the session; `ProtectedRoute` resolves the next step from `my_console_access()`.
Database role checks and row-level security continue to protect all workforce data.

| Account state | Next step |
| --- | --- |
| Active Console membership | Open the workspace; organization admins resume unfinished setup |
| Console invitation without membership | Accept or decline the invitation; eligible accounts may create their own organization instead |
| Confirmed new account eligible for creation | Create organization → company → working hours → work settings → sites → team → dashboard |
| Platform admin without organizations | Open Organizations to create the first organization |
| Linked employee without Console membership | Use the Employee app, or ask an admin for a Console invitation to the same email |
| Email not confirmed | Confirm email, then refresh access |
| Previous organization creator without access | Ask a platform admin to restore the organization or membership |
| Older server without self-service support | Show database update guidance instead of assuming this is an employee |
| Other account without a role | Ask an admin for a Console invitation, then refresh access |
| Access request failed | Retry the request without entering credentials again |

Existing sessions use this same gate, including browser reloads and email confirmation returns.
No role is inferred from editable user metadata. Employee membership never automatically grants a
Console role. Accepting a Console invitation is still explicit and server-checked.

## Rollout

Deploy the current Console build and apply pending migrations in order, including
`20261031000003_self_service_organizations.sql` (organization creation and setup) and
`20261101000000_console_access_guidance.sql` (account-specific help).
The frontend works without the guidance migration, showing general role help when no reason is
returned. It detects older access responses that lack `can_create_organization`.

For an existing employee who should manage a team, an organization admin opens **Users & Roles**,
invites their email with the intended Console role, and the invitee refreshes access and accepts.
Creating a new account does not grant access to another organization's data.

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
