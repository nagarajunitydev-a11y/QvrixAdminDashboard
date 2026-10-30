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
const eventsUrl = moduleUrl(compile('../src/lib/recentActivity.ts'))
const { recentActivityEvents } = await import(eventsUrl)
const session = { id: 1, user_id: 'user', site_id: 'site', entry_timestamp: 1000, exit_timestamp: null }
const location = { id: 1, user_id: 'user', site_id: 'site', timestamp: 2000, is_inside: true }

test('checkout is shown at its recorded exit time even when the last GPS fix says inside', () => {
  const events = recentActivityEvents([{ ...session, exit_timestamp: 3000 }], [location], 5, 10_000)
  assert.deepEqual(events.map(({ status, timestamp }) => [status, timestamp]), [['Checked Out', 3000], ['Entry', 1000]])
})
test('actual fence crossings yield Exit and re-entry; repeated GPS observations are not new events', () => {
  const events = recentActivityEvents([session], [
    location, { ...location, id: 2, timestamp: 2100 },
    { ...location, id: 3, timestamp: 2200, is_inside: false },
    { ...location, id: 4, timestamp: 2300, is_inside: false },
    { ...location, id: 5, timestamp: 2400 },
  ], 10, 10_000)
  assert.deepEqual(events.map(({ status, timestamp }) => [status, timestamp]), [['Entry', 2400], ['Exit', 2200], ['Entry', 1000]])
})
test('residual GPS after checkout cannot invent an entry or exit, and a new shift restores crossings', () => {
  const sessions = [{ ...session, exit_timestamp: 3000 }, { ...session, id: 2, entry_timestamp: 5000 }]
  const events = recentActivityEvents(sessions, [location,
    { ...location, id: 2, timestamp: 3100, is_inside: false },
    { ...location, id: 3, timestamp: 3200 },
    { ...location, id: 4, timestamp: 5100 },
    { ...location, id: 5, timestamp: 5200, is_inside: false },
  ], 10, 10_000)
  assert.deepEqual(events.map(({ status, timestamp }) => [status, timestamp]), [['Exit', 5200], ['Entry', 5000], ['Checked Out', 3000], ['Entry', 1000]])
})
test('an initially outside device or observations from different sites do not prove an exit', () => {
  assert.equal(recentActivityEvents([], [{ ...location, is_inside: false }], 5, 10_000).length, 0)
  assert.equal(recentActivityEvents([], [location, { ...location, id: 2, site_id: 'other-site', is_inside: false }], 5, 10_000).length, 0)
})
test('checkout wins over duplicate open reads and same-time GPS; duplicate records do not duplicate events', () => {
  const events = recentActivityEvents([session, { ...session, exit_timestamp: 3000 }, session], [location,
    { ...location, id: 2, timestamp: 3000, is_inside: false },
  ], 5, 10_000)
  assert.deepEqual(events.map(({ status, timestamp }) => [status, timestamp]), [['Checked Out', 3000], ['Entry', 1000]])
})
test('sorts by actual event time across users and retains a recent checkout from an old shift', () => {
  const events = recentActivityEvents([
    { ...session, entry_timestamp: 100, exit_timestamp: 9000 },
    ...Array.from({ length: 10 }, (_, index) => ({ ...session, id: index + 2, user_id: `other-${index}`, entry_timestamp: 500 + index })),
  ], [], 5, 10_000)
  assert.equal(events[0].status, 'Checked Out')
  assert.equal(events[0].timestamp, 9000)
  assert.equal(events.length, 5)
})
test('invalid, future and backwards timestamps do not create activity', () => {
  const events = recentActivityEvents([
    { ...session, entry_timestamp: NaN }, { ...session, id: 2, entry_timestamp: 20_000 },
    { ...session, id: 3, exit_timestamp: 500 },
  ], [{ ...location, timestamp: NaN }, { ...location, timestamp: 20_000 }], 10, 10_000)
  assert.deepEqual(events.map(({ status }) => status), ['Entry'])
})

const transportUrl = moduleUrl(`
  export const state = { rows: {}, calls: [], cap: 500, fail: null };
  export const supabase = { from(table) {
    const filters = [], orders = [];
    const run = async (offset, size) => {
      state.calls.push({ table, filters: [...filters], orders: [...orders], offset, size });
      if (state.fail === table) return { data: null, error: new Error('Read failed') };
      let rows = [...(state.rows[table] ?? [])];
      for (const [operator, column, value] of filters) rows = rows.filter((row) =>
        operator === 'eq' ? row[column] === value : operator === 'lt' ? row[column] < value :
        operator === 'gte' ? row[column] >= value : row[column] !== null);
      rows.sort((a, b) => { for (const [column, ascending] of orders) {
        const difference = (a[column] ?? -Infinity) - (b[column] ?? -Infinity);
        if (difference) return ascending ? difference : -difference;
      } return 0; });
      return { data: rows.slice(offset, offset + Math.min(size, state.cap)), error: null };
    };
    const query = {
      select() { return query; },
      order(column, options) { orders.push([column, options.ascending]); return query; },
      not(column, operator, value) { filters.push(['not', column, value]); return query; },
      eq(column, value) { filters.push(['eq', column, value]); return query; },
      lt(column, value) { filters.push(['lt', column, value]); return query; },
      gte(column, value) { filters.push(['gte', column, value]); return query; },
      limit(size) { return run(0, size); },
      range(start, end) { return run(start, end - start + 1); },
    };
    return query;
  } };
`)
const { state } = await import(transportUrl)
const { fetchRecentActivity } = await import(moduleUrl(compile('../src/api/recentActivity.ts')
  .replace("'./supabase'", JSON.stringify(transportUrl))
  .replace("'../lib/recentActivity'", JSON.stringify(eventsUrl))))

test('reader orders checkouts independently and loads the predecessor needed to confirm a window-boundary exit', async () => {
  state.calls = []
  state.rows = {
    presence_sessions: Array.from({ length: 5 }, (_, index) => ({ ...session, id: index + 1, entry_timestamp: 1000 + index * 100, exit_timestamp: 1100 + index * 100 })),
    location_logs: [
      { ...location, timestamp: 1200 },
      { ...location, id: 2, timestamp: 1600, is_inside: false },
    ],
  }
  const snapshot = await fetchRecentActivity()
  assert.ok(state.calls.some((call) => call.table === 'presence_sessions' && call.orders[0][0] === 'exit_timestamp'))
  assert.ok(snapshot.locations.some((row) => row.timestamp === 1200))
  assert.ok(snapshot.locations.some((row) => row.timestamp === 1600))
  assert.ok(state.calls.some((call) => call.table === 'location_logs' && call.filters.some(([operator]) => operator === 'lt')))
})
test('reader does not truncate GPS history at the server cap and reports read errors', async () => {
  state.cap = 2
  state.rows = { presence_sessions: [], location_logs: Array.from({ length: 7 }, (_, index) => ({ ...location, id: index + 1, timestamp: 2000 + index })) }
  assert.equal((await fetchRecentActivity()).locations.length, 7)
  state.fail = 'presence_sessions'
  await assert.rejects(fetchRecentActivity(), /Read failed/)
  state.fail = 'location_logs'
  await assert.rejects(fetchRecentActivity(), /Read failed/)
  state.fail = null
  state.cap = 500
})
