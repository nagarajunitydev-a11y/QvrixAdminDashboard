import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { test } from 'node:test'
import ts from 'typescript'

const source = ts.transpileModule(readFileSync(new URL('../src/lib/consoleAccess.ts', import.meta.url), 'utf8'), {
  compilerOptions: { target: ts.ScriptTarget.ES2023, module: ts.ModuleKind.ESNext },
}).outputText
const {
  canEnterConsole,
  consoleEntry,
  consoleAccessErrorMessage,
  consoleCapabilities,
  deviceHolderLabel,
  needsSetup,
  resolveActiveOrganization,
  unlinkedAccountLabel,
} = await import('data:text/javascript;base64,' + Buffer.from(source).toString('base64'))

test('a database without the organization upgrade is named instead of "something went wrong"', () => {
  // Exact PostgREST payload returned by the live project before the Phase 2 migration.
  const missing = { code: 'PGRST202', message: 'Could not find the function public.my_console_access without parameters in the schema cache', details: null, hint: null }
  assert.match(consoleAccessErrorMessage(missing), /database has not been upgraded/i)
})

test('database and network errors keep their own message even though they are not Error instances', () => {
  assert.equal(consoleAccessErrorMessage({ code: '42501', message: 'permission denied for function my_console_access' }), 'permission denied for function my_console_access')
  assert.equal(consoleAccessErrorMessage(new TypeError('Failed to fetch')), 'Failed to fetch')
  assert.match(consoleAccessErrorMessage(undefined), /could not be checked/i)
})

const org = (id, role, is_active = true) => ({ id, name: id, slug: id, timezone: 'Asia/Kolkata', is_active, role })

test('a stored organization is kept only while the account can still open it', () => {
  const access = { is_platform_admin: false, organizations: [org('a', 'manager'), org('b', 'supervisor')] }
  assert.equal(resolveActiveOrganization(access, 'b').id, 'b')
  assert.equal(resolveActiveOrganization(access, 'removed').id, 'a')
  assert.equal(resolveActiveOrganization(access, null).id, 'a')
})

test('the first active organization is preferred over an inactive one', () => {
  const access = { is_platform_admin: true, organizations: [org('closed', 'platform_admin', false), org('open', 'platform_admin')] }
  assert.equal(resolveActiveOrganization(access, null).id, 'open')
})

test('no organizations means no Console access', () => {
  assert.equal(resolveActiveOrganization({ is_platform_admin: false, organizations: [] }, 'a'), null)
  assert.equal(resolveActiveOrganization(undefined, null), null)
})

test('capabilities mirror the database role sets', () => {
  assert.deepEqual(consoleCapabilities('supervisor', false), { canManage: false, isOrgAdmin: false })
  assert.deepEqual(consoleCapabilities('manager', false), { canManage: true, isOrgAdmin: false })
  assert.deepEqual(consoleCapabilities('org_admin', false), { canManage: true, isOrgAdmin: true })
  assert.deepEqual(consoleCapabilities(null, false), { canManage: false, isOrgAdmin: false })
  // Platform admins can act in every organization, whatever their membership there.
  assert.deepEqual(consoleCapabilities('supervisor', true), { canManage: true, isOrgAdmin: true })
})

test('unlinked accounts are labelled by email, never by a device or ID prefix', () => {
  assert.equal(unlinkedAccountLabel('worker@site.test'), 'Unlinked account · worker@site.test')
  assert.equal(unlinkedAccountLabel(''), 'Unlinked account')
  assert.equal(unlinkedAccountLabel(null), 'Unlinked account')
})

test('a device names its holder only through a verified employee link', () => {
  const names = new Map([['employee-1', 'Megha P']])
  const emails = new Map([['user-2', 'new@site.test']])
  assert.deepEqual(deviceHolderLabel({ employee_id: 'employee-1', user_id: 'user-1' }, names, emails), { label: 'Megha P', verified: true })
  assert.deepEqual(deviceHolderLabel({ employee_id: null, user_id: 'user-2' }, names, emails), { label: 'Unlinked account · new@site.test', verified: false })
  assert.deepEqual(deviceHolderLabel({ employee_id: 'gone', user_id: '39235d6e-0000' }, names, emails), { label: 'Unlinked account', verified: false })
  assert.deepEqual(deviceHolderLabel({ employee_id: null, user_id: null }, names, emails), { label: 'No holder', verified: false })
})

test('only organization admins with unfinished setup are sent to the setup wizard', () => {
  const org = (changes) => ({ id: 'a', name: 'A', slug: 'a', timezone: 'Asia/Kolkata', is_active: true, role: 'org_admin',
    onboarding_step: 'schedule', onboarding_completed_at: null, ...changes })
  assert.equal(needsSetup(org()), true)
  assert.equal(needsSetup(org({ onboarding_completed_at: '2026-10-31T00:00:00Z', onboarding_step: 'done' })), false)
  assert.equal(needsSetup(org({ role: 'manager' })), false)
  assert.equal(needsSetup(org({ role: 'platform_admin' })), false)
  // A server without the setup fields never forces the wizard.
  assert.equal(needsSetup(org({ onboarding_step: undefined, onboarding_completed_at: undefined })), false)
  assert.equal(needsSetup(null), false)
})

test('accounts enter the Console to use, accept or create an organization', () => {
  assert.equal(canEnterConsole({ is_platform_admin: false, organizations: [], invitations: [], can_create_organization: true }), true)
  assert.equal(canEnterConsole({ is_platform_admin: false, organizations: [], invitations: [{ id: 'i' }] }), true)
  assert.equal(canEnterConsole({ is_platform_admin: false, organizations: [], invitations: [], can_create_organization: false }), false)
  assert.equal(canEnterConsole({ is_platform_admin: true, organizations: [] }), true)
  assert.equal(canEnterConsole(null), false)
})

test('sign-in routes new accounts to setup and existing accounts to their workspace', () => {
  const empty = { is_platform_admin: false, organizations: [], invitations: [] }
  assert.equal(consoleEntry({ ...empty, can_create_organization: true }), 'setup')
  assert.equal(consoleEntry({ ...empty, organizations: [org('a', 'org_admin')], access_block_reason: 'employee' }), 'workspace')
  assert.equal(consoleEntry({ ...empty, invitations: [{ id: 'i' }], can_create_organization: true }), 'invitations')
  assert.equal(consoleEntry({ ...empty, is_platform_admin: true }), 'platform')
})

test('a legacy access response requires an update and never implies employee status', () => {
  assert.equal(consoleEntry({ is_platform_admin: false, organizations: [] }), 'upgrade')
  // Self-service deployed, guidance not deployed yet: offer admin help without guessing.
  assert.equal(consoleEntry({ is_platform_admin: false, organizations: [], can_create_organization: false }), 'role_required')
})

test('blocked accounts get the server-provided next step while invitations take priority', () => {
  const empty = { is_platform_admin: false, organizations: [], can_create_organization: false }
  for (const reason of ['employee', 'confirm_email', 'organization_unavailable', 'role_required']) {
    assert.equal(consoleEntry({ ...empty, access_block_reason: reason }), reason)
  }
  assert.equal(consoleEntry({ ...empty, access_block_reason: 'employee', invitations: [{ id: 'i' }] }), 'invitations')
})

test('a member opens their personal workspace even when they can create an organization', () => {
  const access = { is_platform_admin: false, organizations: [], member: { id: 'employee-1' }, can_create_organization: true }
  assert.equal(consoleEntry(access), 'employee')
  assert.deepEqual(consoleCapabilities(null, false), { canManage: false, isOrgAdmin: false })
  assert.equal(consoleEntry({ ...access, organizations: [org('my-org', 'org_admin')] }), 'workspace')
})
