import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { test } from 'node:test'
import ts from 'typescript'

// Compile the actual pure helpers without adding a test framework dependency.
function moduleUrl(source) {
  return 'data:text/javascript;base64,' + Buffer.from(source).toString('base64')
}
function compile(path) {
  return ts.transpileModule(readFileSync(new URL(path, import.meta.url), 'utf8'), {
    compilerOptions: { target: ts.ScriptTarget.ES2023, module: ts.ModuleKind.ESNext },
  }).outputText
}
const geoUrl = moduleUrl(compile('../src/lib/geo.ts'))
const workforceUrl = moduleUrl(compile('../src/lib/workforce.ts').replace("'./geo'", JSON.stringify(geoUrl)))
const { classifyTracking, deriveWorkforceCounts, LOCATION_FRESHNESS_MS } = await import(workforceUrl)
const { haversineMeters } = await import(geoUrl)

const now = Date.parse('2026-10-29T12:00:00Z')
const employee = { id: 'employee-1', user_id: 'user-1', is_active: true }
const site = { id: 'site-1', latitude: 13.163166, longitude: 79.944892, radius_in_meters: 600 }
const assignment = { employee_id: employee.id, site_id: site.id }
const session = { id: 1, user_id: employee.user_id, site_id: site.id,
  entry_timestamp: now - 60_000, exit_timestamp: null, last_heartbeat: null }
const inside = { id: 1, user_id: employee.user_id, site_id: site.id,
  latitude: 13.1626587, longitude: 79.9445881, accuracy: 20,
  timestamp: now - 1000, is_inside: true, distance_to_site: 65.0469 }
const outside = { ...inside, latitude: 13.18, is_inside: false }

function counts({ employees = [employee], sessions = [session], locations = [outside],
  sites = [site], assignments = [assignment], at = now } = {}) {
  return deriveWorkforceCounts(employees, sessions, locations, sites, assignments, at)
}
function assertState(result, status, outsideCount = 0) {
  assert.equal(result.employeeStates.get(employee.id).status, status)
  assert.equal(result.outsideCount, outsideCount)
  assert.equal(result.outsideCount,
    [...result.employeeStates.values()].filter((state) => state.status === 'outside').length)
  assert.equal(result.insideCount,
    [...result.employeeStates.values()].filter((state) => state.status === 'on-site').length)
}

test('regression: a linked employee without any GPS/session is not outside', () => {
  assertState(counts({ sessions: [], locations: [] }), 'offline')
})
test('observed Supabase coordinates are about 65m inside the assigned 600m circle', () => {
  const result = counts({ locations: [{ ...inside, is_inside: false, distance_to_site: 2000 }] })
  assertState(result, 'on-site')
  assert.ok(Math.abs(result.employeeStates.get(employee.id).distanceToSite - 65.0469) < 1)
})
test('fresh GPS genuinely outside is counted even with an obsolete inside flag and no heartbeat', () => {
  assertState(counts({ locations: [{ ...outside, is_inside: true, distance_to_site: 0 }] }), 'outside', 1)
})
test('historical linked employee with a completed shift and stale inside fix is checked out', () => {
  assertState(counts({
    sessions: [{ ...session, entry_timestamp: Date.parse('2026-08-29T11:32:42Z'),
      exit_timestamp: Date.parse('2026-08-29T11:32:54Z') }],
    locations: [{ ...inside, timestamp: Date.parse('2026-08-29T11:32:42Z') }],
  }), 'checked-out')
})
test('checkout wins over a residual fresh outside fix and any older open session', () => {
  const result = counts({ sessions: [
    { ...session, id: 3, exit_timestamp: now - 500 },
    { ...session, id: 2, entry_timestamp: now - 120_000 },
  ] })
  assertState(result, 'checked-out')
  assert.equal(result.checkedOutUserIds.size, 1)
})
test('a new shift overrides historical checkout', () => {
  const result = counts({ sessions: [
    { ...session, entry_timestamp: now - 120_000, exit_timestamp: now - 90_000 },
    session,
  ] })
  assertState(result, 'outside', 1)
  assert.equal(result.checkedOutUserIds.size, 0)
})
test('a checkout duplicate takes precedence over an open row with the same entry', () => {
  assertState(counts({ sessions: [
    { ...session, id: 2, exit_timestamp: now - 500 }, session,
  ] }), 'checked-out')
})
test('stale GPS is offline even with an open session and a fresh heartbeat', () => {
  assertState(counts({
    sessions: [{ ...session, last_heartbeat: now }],
    locations: [{ ...outside, timestamp: now - LOCATION_FRESHNESS_MS - 1 }],
  }), 'offline')
})
test('unchanged GPS expires as the clock advances', () => {
  assertState(counts({ at: now + LOCATION_FRESHNESS_MS + 1 }), 'offline')
})
test('invalid or missing GPS timestamps and coordinates never count as outside', () => {
  for (const timestamp of [null, undefined, NaN, Infinity, 0, -1, now + 1, now / 1000]) {
    assertState(counts({ locations: [{ ...outside, timestamp }] }), 'offline')
  }
  for (const coords of [
    { latitude: null }, { longitude: null }, { latitude: NaN }, { longitude: Infinity },
    { latitude: 91 }, { latitude: -91 }, { longitude: 181 }, { longitude: -181 },
    { latitude: 0, longitude: 0 },
  ]) {
    assertState(counts({ locations: [{ ...outside, ...coords }] }), 'offline')
  }
  assertState(counts({ locations: [] }), 'offline')
})
test('missing or invalid accuracy does not prove an outside position', () => {
  for (const accuracy of [null, undefined, NaN, Infinity, -1]) {
    assertState(counts({ locations: [{ ...outside, accuracy }] }), 'offline')
  }
})
test('the newest fix wins regardless of input order; never fall back to an older outside fix', () => {
  assertState(counts({ locations: [
    { ...inside, id: 2, timestamp: now }, outside,
  ] }), 'on-site')
  assertState(counts({ locations: [outside, { ...inside, id: 2, timestamp: now }] }), 'on-site')
  assertState(counts({ locations: [
    outside, { ...outside, id: 2, latitude: null, timestamp: now },
  ] }), 'offline')
})
test('at equal fix timestamps, the larger log id wins', () => {
  assertState(counts({ locations: [outside, { ...inside, id: 2 }] }), 'on-site')
})
test('no active shift or a fix before check-in cannot assert outside', () => {
  assertState(counts({ sessions: [] }), 'recent')
  assertState(counts({ sessions: [{ ...session, entry_timestamp: now }] }), 'recent')
})
test('missing or invalid assigned geofence cannot assert outside', () => {
  assertState(counts({ assignments: [] }), 'recent')
  assertState(counts({ sites: [] }), 'recent')
  for (const patch of [
    { latitude: null }, { longitude: NaN }, { latitude: 91 },
    { radius_in_meters: null }, { radius_in_meters: NaN },
    { radius_in_meters: -1 }, { radius_in_meters: 0 },
  ]) assertState(counts({ sites: [{ ...site, ...patch }] }), 'recent')
})
test('the shift site must be assigned; unrelated and historical log sites are ignored', () => {
  assertState(counts({ locations: [{ ...outside, site_id: 'obsolete-site' }] }), 'outside', 1)
  assertState(counts({ sessions: [{ ...session, site_id: 'unassigned-site' }] }), 'recent')
  assertState(counts({ sites: [site, { ...site, id: 'other-assigned-site', latitude: outside.latitude }],
    assignments: [assignment, { ...assignment, site_id: 'other-assigned-site' }] }), 'outside', 1)
})
test('edited site radius is used instead of the recorded distance/flag', () => {
  assertState(counts({ sites: [{ ...site, radius_in_meters: 3000 }] }), 'on-site')
})
test('boundary is inclusive and accuracy overlap cannot assert outside', () => {
  const distance = haversineMeters(
    { lat: outside.latitude, lng: outside.longitude }, { lat: site.latitude, lng: site.longitude })
  assertState(counts({ sites: [{ ...site, radius_in_meters: distance }] }), 'on-site')
  assertState(counts({ sites: [{ ...site, radius_in_meters: distance - outside.accuracy }] }), 'recent')
  assertState(counts({ sites: [{ ...site, radius_in_meters: distance - outside.accuracy - 1 }] }), 'outside', 1)
})
test('inactive employees and unlinked devices cannot contribute to employee totals', () => {
  assertState(counts({ employees: [{ ...employee, is_active: false }] }), 'offline')
  assertState(counts({ employees: [{ ...employee, user_id: null }] }), 'offline')
  const result = counts({ employees: [] })
  assert.equal(result.outsideCount, 0)
  assert.equal(result.insideCount, 0)
  assert.equal(result.checkedOutUserIds.size, 0)
  assert.equal(classifyTracking(outside, session, [], now).status, 'recent')
})
test('Haversine uses metres, correct coordinate order, and handles the antimeridian', () => {
  assert.equal(haversineMeters({ lat: 0, lng: 0 }, { lat: 0, lng: 0 }), 0)
  assert.ok(Math.abs(haversineMeters({ lat: 0, lng: 0 }, { lat: 0, lng: 1 }) - 111195.08) < 1)
  assert.ok(haversineMeters({ lat: 0, lng: 179.999 }, { lat: 0, lng: -179.999 }) < 223)
})

// Optional read-only verification against a private Supabase snapshot, kept
// out of source control. No employee identifiers or GPS records are printed.
if (process.env.WORKFORCE_SNAPSHOT_PATH) {
  test('actual Supabase snapshot reproduces 1 before the fix and 0 after', () => {
    const snapshot = JSON.parse(readFileSync(process.env.WORKFORCE_SNAPSHOT_PATH, 'utf8').replace(/^\uFEFF/, ''))
    const oldOnlineIds = new Set(snapshot.sessions.filter((s) => s.exit_timestamp === null &&
      (s.last_heartbeat ?? s.entry_timestamp) > snapshot.now_ms - LOCATION_FRESHNESS_MS).map((s) => s.user_id))
    const oldOutsideCount = snapshot.employees.filter((e) => e.user_id && !oldOnlineIds.has(e.user_id)).length
    assert.equal(oldOutsideCount, 1)
    const corrected = deriveWorkforceCounts(snapshot.employees, snapshot.sessions, snapshot.locations,
      snapshot.sites, snapshot.assignments, snapshot.now_ms)
    assert.equal(corrected.outsideCount, 0)
    assert.equal(corrected.checkedOutUserIds.size, 1)
    assert.equal(corrected.insideCount, 0)
    console.log('Supabase snapshot verified: Outside Site 1 -> 0; linked employee is checked out.')
  })
}
