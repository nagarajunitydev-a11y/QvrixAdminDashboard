import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { test } from 'node:test'
import ts from 'typescript'

const moduleUrl = (source) => 'data:text/javascript;base64,' + Buffer.from(source).toString('base64')
const compile = (path) => ts.transpileModule(readFileSync(new URL(path, import.meta.url), 'utf8'), {
  compilerOptions: { target: ts.ScriptTarget.ES2023, module: ts.ModuleKind.ESNext },
}).outputText
const {
  SETUP_STEPS, countryOptions, furthestStep, guessCountry, normalizeTimeZone, resumeStep, stepAfter, stepBefore,
  timeZoneOptions, validateInvites, validateOrganizationForm,
} = await import(moduleUrl(compile('../src/lib/setupWizard.ts')))
const workSchedulesUrl = moduleUrl(compile('../src/lib/workSchedules.ts'))
const { policyFromForm, policyToForm, POLICY_OFF } = await import(
  moduleUrl(compile('../src/lib/timePolicy.ts').replace("'./workSchedules'", `'${workSchedulesUrl}'`)))

test('steps run from creating the organization to done', () => {
  assert.deepEqual(SETUP_STEPS.map((s) => s.id), ['organization', 'company', 'schedule', 'rules', 'sites', 'team', 'done'])
  assert.equal(stepAfter('company'), 'schedule')
  assert.equal(stepBefore('company'), 'organization')
  assert.equal(stepAfter('done'), 'done')
})

test('setup resumes where it was left, never before the organization exists', () => {
  assert.equal(resumeStep('sites'), 'sites')
  assert.equal(resumeStep('organization'), 'company')
  assert.equal(resumeStep(undefined), 'company')
  assert.equal(resumeStep('unknown'), 'company')
  assert.equal(furthestStep('rules', 'schedule'), 'rules')
  assert.equal(furthestStep('schedule', 'team'), 'team')
})

test('countries and time zones', () => {
  const countries = countryOptions()
  assert.ok(countries.length > 240)
  assert.equal(countries.find((c) => c.code === 'IN').name, 'India')
  assert.equal(guessCountry(['en-IN', 'en']), 'IN')
  assert.equal(guessCountry(['en']), 'IN')
  assert.equal(guessCountry(['de-DE']), 'DE')
  assert.equal(normalizeTimeZone('Asia/Calcutta'), 'Asia/Kolkata')
  assert.ok(timeZoneOptions().includes('Asia/Kolkata'))
  assert.ok(!timeZoneOptions().includes('Asia/Calcutta'))
})

test('the organization form needs a name, country and time zone', () => {
  assert.deepEqual(validateOrganizationForm({ name: 'Acme Facilities', countryCode: 'IN', timeZone: 'Asia/Kolkata' }), [])
  assert.equal(validateOrganizationForm({ name: ' A ', countryCode: 'XX', timeZone: '' }).length, 3)
})

test('invites skip empty rows and catch incomplete, duplicate and existing people', () => {
  const blank = { firstName: '', lastName: '', email: '', phone: '' }
  const result = validateInvites(
    [
      { firstName: 'Ravi', lastName: 'Kumar', email: 'Ravi@Acme.test', phone: '+91 98450 12345' },
      blank,
      { firstName: 'Asha', lastName: '', email: 'asha@acme', phone: '12' },
      { firstName: 'Ravi', lastName: 'K', email: 'ravi@acme.test', phone: '' },
      { firstName: 'Old', lastName: 'Hand', email: 'old@acme.test', phone: '' },
    ],
    [{ email: 'Lead@Acme.test', role: 'manager' }, { email: '', role: 'supervisor' }, { email: 'nope', role: 'manager' }],
    new Set(['old@acme.test']),
  )
  assert.deepEqual(result.employees, [{ first_name: 'Ravi', last_name: 'Kumar', email: 'ravi@acme.test', phone: '+91 98450 12345' }])
  assert.deepEqual(result.managers, [{ email: 'lead@acme.test', role: 'manager' }])
  assert.equal(result.errors.length, 4)
  assert.match(result.errors[0], /Employee 3 needs a last name, a valid email, a phone number/)
  assert.match(result.errors[1], /listed twice/)
  assert.match(result.errors[2], /already an employee/)
  assert.match(result.errors[3], /Console user 3/)
})

test('policy form round trip used by the wizard and the policy page', () => {
  const form = { ...policyToForm(POLICY_OFF), autoAfter: true, autoAfterHours: '12', earlyLimit: true, earlyMinutes: '15' }
  assert.deepEqual(policyFromForm(form).fields, { ...POLICY_OFF, auto_clock_out_after_minutes: 720, early_clock_in_minutes: 15 })
  assert.match(policyFromForm({ ...form, autoAfterHours: '0.2' }).errors[0], /between 0.5 and 24 hours/)
})
