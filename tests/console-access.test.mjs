import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { test } from 'node:test'
import ts from 'typescript'

const source = ts.transpileModule(readFileSync(new URL('../src/lib/consoleAccess.ts', import.meta.url), 'utf8'), {
  compilerOptions: { target: ts.ScriptTarget.ES2023, module: ts.ModuleKind.ESNext },
}).outputText
const {
  consoleCapabilities,
  deviceHolderLabel,
  resolveActiveOrganization,
  unlinkedAccountLabel,
} = await import('data:text/javascript;base64,' + Buffer.from(source).toString('base64'))

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
