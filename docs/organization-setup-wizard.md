# Self-service sign-up and organization setup wizard

Update 2026-11-01: sign-in now opens an account chooser for new accounts and a personal workspace
for linked members. Employees and Console members may create one separate self-service organization
after `20261101000001_member_web_workflow.sql`; joining an employer no longer requires a Console role.
See `sign-in-access-workflow.md` for the current flow. The original implementation notes below
describe the initial eligibility restrictions and tests before that update.

Prepared 2026-10-31. Request: a Jibble-style organization setup after sign-in. Jibble's own setup page
(`web.jibble.io/getting-started`) needs a Jibble account, so it was not opened. The flow follows the step order
in Jibble's public help article on onboarding (work schedule, clock-in rules, automatic clock-out, locations,
inviting members), adapted to Crewtraxa's records, with Crewtraxa's own design and wording. No Jibble code,
text or images are used.

Decisions (user, 2026-10-31): any account with a confirmed email and no Console role may create one
organization; the Console gets an account sign-up page; the full flow is tested live with a test organization
that is deactivated afterwards.

## Flow

1. **Create account** (`/signup`, linked from the sign-in page): email and password (8+ characters). Supabase
   Auth sends a confirmation link; the message is the same whether or not the address already has an account.
2. **Sign in.** An account may now enter the Console if it belongs to an organization, has an open Console
   invitation, or may create an organization. Accounts with none of these keep their authenticated session
   and receive access guidance, with a refresh action and an account switch. See `sign-in-access-workflow.md`.
3. **Setup wizard** (`/setup`), one step per page, with a progress rail, Back, step links for steps already
   reached, and "Skip setup":

| Step | Saves to |
| --- | --- |
| Organization: name, country, time zone | `create_my_organization`: new organization, the account becomes its admin |
| Company: industry, team size | `organizations.industry`, `team_size` |
| Working hours: fixed or flexible, working days, hours, unpaid lunch window, name | The organization's default work schedule (`shifts`, `is_default`) |
| Work settings: automatic check-out (on, 12 h, by default), inside-site check-in, registered phone, early check-in limit, outside-hours block | The organization's time-tracking policy |
| Sites (optional): address search or map click, name, geofence radius (300 m default) | `sites` |
| Team (optional): employees (name, email, phone) and Console users (email, role); optionally assign the new employees to the sites added | `employees` (they accept in the app), `employee_sites`, Console invitations |
| Done: summary and next steps | `onboarding_completed_at`; opens the dashboard |

Each step saves when the admin continues, and the organization records the furthest step reached
(`onboarding_step`). Signing out and back in resumes there. Until setup is finished or skipped, the
organization's admins are taken to the wizard; managers and supervisors are not. Organizations that already
existed are marked as set up and keep the Getting Started checklist. An organization created by a platform
admin starts the wizard when its invited admin first signs in.

If the account was added as an employee somewhere, the first step says so, because employees use the app
rather than an organization of their own.

## Database (`20261031000003_self_service_organizations.sql`)

- `organizations`: `country_code`, `industry`, `team_size`, `created_by`, `onboarding_step`,
  `onboarding_completed_at`, with checks. Admins may update the setup columns; `created_by` is set by the server
  only. A unique index allows one self-service organization per account.
- `can_create_organization()` (internal): a confirmed email, not a platform admin, no active Console role, no
  active employee profile, and no organization created before.
- `create_my_organization(name, time zone, country)`: checks the above, makes a unique readable slug, creates the
  organization and the admin membership. Audited.
- `my_console_access()` also returns `can_create_organization` and each organization's setup progress.

## Tests

- `npm run test:db`: 325 passed (24 new): existing organizations marked set up, platform-created ones starting
  setup, unconfirmed accounts refused, members, active employees and platform admins not offered creation while a
  former employee is, name and time zone checks, the creator becoming admin, one organization per account, unique
  slugs, setup fields and their checks, the creator column protected, other organizations unable to read or change
  it, setup records landing in the new organization, the invited employee seeing it by name, audit, anon refused.
- `node --test tests/`: 95 passed (new `setup-wizard.test.mjs`; access rules in `console-access.test.mjs`).
- `tsc -b`, `oxlint` (no new warnings) and `vite build` pass.

## Rollout notes

- The deployed Console still rejects accounts without an organization, so self-service needs the new Console
  deployed after the migration.
- Supabase Auth settings: sign-ups must be allowed, and the Console's address (and `http://localhost:5179` for
  testing) should be in the allowed redirect URLs, so the confirmation link returns to the Console sign-in page.
