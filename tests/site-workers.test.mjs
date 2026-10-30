import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { test } from 'node:test'
import ts from 'typescript'

const moduleUrl = (source) => 'data:text/javascript;base64,' + Buffer.from(source).toString('base64')
function compile(path) {
  return ts.transpileModule(readFileSync(new URL(path, import.meta.url), 'utf8'), {
    compilerOptions: { target: ts.ScriptTarget.ES2023, module: ts.ModuleKind.ESNext },
  }).outputText
}
const { groupSiteWorkers, siteWorkerStatus } = await import(moduleUrl(compile('../src/lib/siteWorkers.ts')))
const geoUrl = moduleUrl(compile('../src/lib/geo.ts'))
const { deriveWorkforceCounts, LOCATION_FRESHNESS_MS } = await import(moduleUrl(
  compile('../src/lib/workforce.ts').replace("'./geo'", JSON.stringify(geoUrl)),
))

const sites = [
  { id: 'b', name: 'West Yard', latitude: 13.1, longitude: 79.9, radius_in_meters: 600 },
  { id: 'a', name: 'East Yard', latitude: 13.2, longitude: 79.9, radius_in_meters: 600 },
  { id: 'empty', name: 'Empty Yard' },
]
const employees = [
  { id: 'one', user_id: 'device-one', first_name: 'Zara', last_name: 'Das', is_active: true },
  { id: 'two', user_id: null, first_name: 'Asha', last_name: 'Rao', is_active: false },
  { id: 'unassigned', user_id: 'device-other', first_name: 'Ben', last_name: 'Shah', is_active: true },
]
const assignments = [
  { employee_id: 'one', site_id: 'a' },
  { employee_id: 'two', site_id: 'a' },
  { employee_id: 'one', site_id: 'a' },
  { employee_id: 'one', site_id: 'b' },
  { employee_id: 'inaccessible-employee', site_id: 'a' },
  { employee_id: 'two', site_id: 'inaccessible-site' },
]

test('groups by actual assignments, deduplicates each roster, and preserves multiple-site assignments', () => {
  const groups = groupSiteWorkers({ employees, sites, assignments })
  assert.deepEqual(groups.map((group) => [group.site.id, group.employees.map((employee) => employee.id)]), [
    ['a', ['two', 'one']], ['empty', []], ['b', ['one']],
  ])
  assert.equal(new Set(groups.flatMap((group) => group.employees.map((employee) => employee.id))).size, 2)
  assert.equal(assignments.length, 6)
})

test('reassignment and deletion update the derived roster without altering employee records', () => {
  const groups = groupSiteWorkers({ employees, sites, assignments: [{ employee_id: 'two', site_id: 'b' }] })
  assert.deepEqual(groups.find((group) => group.site.id === 'a').employees, [])
  assert.equal(groups.find((group) => group.site.id === 'b').employees[0], employees[1])
  assert.deepEqual(groupSiteWorkers({ employees, sites: [], assignments }), [])
})

test('unassigned or inaccessible employees and sites never create synthetic worker groups', () => {
  assert.ok(groupSiteWorkers({ employees: [], sites, assignments }).every((group) => !group.employees.length))
  assert.ok(groupSiteWorkers({ employees, sites, assignments: [] }).every((group) => !group.employees.length))
})

test('site worker labels reuse live tracking classifications, including Online for a fresh unconfirmed location', () => {
  for (const [status, label] of [
    ['on-site', 'On Site'], ['outside', 'Outside Site'], ['recent', 'Online'],
    ['offline', 'Offline'], ['checked-out', 'Checked Out'],
  ]) assert.equal(siteWorkerStatus({ status }), label)
  assert.equal(siteWorkerStatus(undefined), 'Offline')
})

test('checkout, new shifts, stale signals, inactive employees, and unlinked devices retain shared status rules', () => {
  const now = Date.parse('2026-10-29T12:00:00Z')
  const session = { user_id: 'device-one', site_id: 'a', entry_timestamp: now - 60_000, exit_timestamp: null }
  const location = { id: 1, user_id: 'device-one', latitude: 13.2, longitude: 79.9, accuracy: 10, timestamp: now - 1000 }
  const statusAt = (sessions, locations, at = now) => {
    const result = deriveWorkforceCounts(employees, sessions, locations, sites, assignments, at)
    assert.equal(siteWorkerStatus(result.employeeStates.get('two')), 'Offline')
    return siteWorkerStatus(result.employeeStates.get('one'))
  }
  assert.equal(statusAt([session], [location]), 'On Site')
  assert.equal(statusAt([session], [{ ...location, latitude: 13.3 }]), 'Outside Site')
  assert.equal(statusAt([], [location]), 'Online')
  assert.equal(statusAt([session], [location], now + LOCATION_FRESHNESS_MS + 1), 'Offline')
  assert.equal(statusAt([{ ...session, exit_timestamp: now - 500 }], [location]), 'Checked Out')
  assert.equal(statusAt([
    { ...session, entry_timestamp: now - 120_000, exit_timestamp: now - 90_000 }, session,
  ], [location]), 'On Site')
})

// Exercise the actual reader with a Supabase-shaped transport, without database writes.
const transportUrl = moduleUrl(`
  export const state = { rows: {}, calls: [], cap: 500, errorTable: null, errorOffset: 0 };
  export const supabase = { from(table) {
    const order = [];
    const query = {
      select() { return query; },
      order(column) { order.push(column); return query; },
      async range(start, end) {
        state.calls.push({ table, start, end, order: [...order] });
        if (table === state.errorTable && start >= state.errorOffset) {
          return { data: null, error: new Error('Read denied') };
        }
        return { data: (state.rows[table] ?? []).slice(start, Math.min(end + 1, start + state.cap)), error: null };
      },
    };
    return query;
  } };
`)
const { state } = await import(transportUrl)
const { fetchSiteWorkerDirectory } = await import(moduleUrl(
  compile('../src/api/siteWorkers.ts').replace("'./supabase'", JSON.stringify(transportUrl)),
))

test('fetches complete rosters beyond the Supabase row cap with stable page ordering', async () => {
  state.rows = {
    employees: Array.from({ length: 1203 }, (_, id) => ({ id })),
    sites: [{ id: 'a' }],
    employee_sites: Array.from({ length: 1501 }, (_, id) => ({ employee_id: id, site_id: 'a' })),
  }
  state.calls = []
  const directory = await fetchSiteWorkerDirectory()
  assert.equal(directory.employees.length, 1203)
  assert.equal(directory.assignments.length, 1501)
  assert.equal(directory.sites.length, 1)
  assert.equal(new Set(directory.employees.map((employee) => employee.id)).size, 1203)
  assert.deepEqual(state.calls.filter((call) => call.table === 'employee_sites').map((call) => call.start), [0, 500, 1000, 1500, 1501])
  assert.ok(state.calls.every((call) => call.order.length > 0))
  assert.deepEqual(state.calls.find((call) => call.table === 'employee_sites').order, ['employee_id', 'site_id'])
})

test('continues reading when Supabase enforces a smaller row cap than requested', async () => {
  state.cap = 2
  state.rows = { employees: [{ id: 1 }, { id: 2 }, { id: 3 }], sites: [], employee_sites: [] }
  assert.equal((await fetchSiteWorkerDirectory()).employees.length, 3)
  state.cap = 500
})

test('a failed later page rejects the directory instead of displaying a partial roster as complete', async () => {
  state.rows = { employees: Array.from({ length: 501 }, (_, id) => ({ id })), sites: [], employee_sites: [] }
  state.errorTable = 'employees'
  state.errorOffset = 500
  await assert.rejects(fetchSiteWorkerDirectory(), /Read denied/)
  state.errorTable = null
})

test('menu refresh resolves the directory and shared live tracking query keys', async () => {
  const { queryKeysForPath } = await import(moduleUrl(compile('../src/api/pageQueries.ts')))
  assert.deepEqual(queryKeysForPath('/site-workers'), ['site-workers', 'workforce-tracking'])
})
