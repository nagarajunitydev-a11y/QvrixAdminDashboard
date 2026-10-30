import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { test } from 'node:test'
import ts from 'typescript'

const source = ts.transpileModule(readFileSync(new URL('../src/lib/employeeIdentity.ts', import.meta.url), 'utf8'), {
  compilerOptions: { target: ts.ScriptTarget.ES2023, module: ts.ModuleKind.ESNext },
}).outputText
const { employeeNamesByUserId } = await import('data:text/javascript;base64,' + Buffer.from(source).toString('base64'))

test('attendance resolves auth user_id rather than employee id and preserves the actual profile name', () => {
  const names = employeeNamesByUserId([
    { id: 'profile-id', user_id: 'auth-id', first_name: '  Asha ', last_name: ' Rao  ' },
    { id: 'auth-id', user_id: null, first_name: 'Other', last_name: 'Person' },
  ])
  assert.equal(names.get('auth-id'), 'Asha Rao')
  assert.equal(names.has('profile-id'), false)
  assert.equal(names.has(null), false)
})

test('unlinked, unnamed and ambiguous identities remain unresolved instead of guessing', () => {
  const names = employeeNamesByUserId([
    { user_id: null, first_name: 'Unlinked', last_name: 'Employee' },
    { user_id: 'empty', first_name: ' ', last_name: '' },
    { user_id: 'duplicate', first_name: 'First', last_name: 'Employee' },
    { user_id: 'duplicate', first_name: 'Second', last_name: 'Employee' },
    { user_id: 'duplicate', first_name: 'Third', last_name: 'Employee' },
  ])
  assert.equal(names.size, 0)
})

test('all historical attendance and presence rows for the same auth user resolve consistently', () => {
  const employees = [{ user_id: 'auth-id', first_name: 'Asha', last_name: 'Rao' }]
  const records = [
    { user_id: 'auth-id', exit_timestamp: null },
    { user_id: 'auth-id', exit_timestamp: 123 },
  ]
  const names = employeeNamesByUserId(employees)
  assert.deepEqual(records.map((record) => names.get(record.user_id)), ['Asha Rao', 'Asha Rao'])
  assert.equal(names.has('unverified-auth-id'), false)
})
