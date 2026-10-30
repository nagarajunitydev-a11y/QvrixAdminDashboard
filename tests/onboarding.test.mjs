import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { test } from 'node:test'
import ts from 'typescript'

const source = ts.transpileModule(readFileSync(new URL('../src/lib/onboarding.ts', import.meta.url), 'utf8'), {
  compilerOptions: { target: ts.ScriptTarget.ES2023, module: ts.ModuleKind.ESNext },
}).outputText
const { onboardingStatus } = await import('data:text/javascript;base64,' + Buffer.from(source).toString('base64'))

const none = { sites: 0, departments: 0, shifts: 0, employees: 0, assignments: 0, linkedEmployees: 0 }

test('a new organization starts at zero with sites as the next step', () => {
  const status = onboardingStatus(none, 1)
  assert.equal(status.completed, 0)
  assert.equal(status.total, 6)
  assert.equal(status.complete, false)
  assert.equal(status.next.id, 'sites')
})

test('optional departments never block completion or count toward progress', () => {
  const status = onboardingStatus({ ...none, sites: 2, shifts: 1, employees: 4, assignments: 4, linkedEmployees: 1 }, 3)
  assert.equal(status.complete, true)
  assert.equal(status.percent, 100)
  assert.equal(status.next, null)
  assert.equal(status.steps.find((step) => step.id === 'departments').done, false)
})

test('the team step appears only for viewers who can see the team', () => {
  assert.equal(onboardingStatus(none, null).steps.some((step) => step.id === 'team'), false)
  assert.equal(onboardingStatus(none, null).total, 5)
  assert.equal(onboardingStatus(none, 1).steps.find((step) => step.id === 'team').done, false)
  assert.equal(onboardingStatus(none, 2).steps.find((step) => step.id === 'team').done, true)
})

test('progress and details reflect real counts', () => {
  const status = onboardingStatus({ ...none, sites: 1, employees: 5, linkedEmployees: 2 }, null)
  assert.equal(status.completed, 3)
  assert.equal(status.percent, 60)
  assert.equal(status.next.id, 'shifts')
  assert.equal(status.steps.find((step) => step.id === 'app').detail, '2 of 5 signed in')
  assert.equal(status.steps.find((step) => step.id === 'sites').detail, '1 site added')
})
