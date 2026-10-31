import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { test } from 'node:test'
import ts from 'typescript'

const source = ts.transpileModule(readFileSync(new URL('../src/lib/timesheets.ts', import.meta.url), 'utf8'), {
  compilerOptions: { target: ts.ScriptTarget.ES2023, module: ts.ModuleKind.ESNext },
}).outputText
const {
  addDays, clockIn, datesBetween, groupByEmployee, hm, periodLabel, periodRange, shiftPeriod, timesheetCsv, totalsFor, zonedParts,
} = await import('data:text/javascript;base64,' + Buffer.from(source).toString('base64'))

const day = (changes = {}) => ({
  employee_id: 'e1', work_date: '2026-10-19', day_type: 'working', holiday_name: null, schedule_id: 's', schedule_name: 'Day',
  first_in: null, last_out: null, entry_count: 0, manual_count: 0, tracked_minutes: 0, break_minutes: 0, payroll_minutes: 0,
  planned_minutes: 480, regular_minutes: 0, overtime_daily_minutes: 0, overtime_double_minutes: 0, overtime_weekly_minutes: 0,
  overtime_rest_day_minutes: 0, overtime_holiday_minutes: 0, late_minutes: 0, early_out_minutes: 0, flags: [], ...changes,
})

test('weeks run Monday to Sunday and months by calendar', () => {
  assert.deepEqual(periodRange('week', '2026-10-21'), { from: '2026-10-19', to: '2026-10-25' })
  assert.deepEqual(periodRange('week', '2026-10-25'), { from: '2026-10-19', to: '2026-10-25' })
  assert.deepEqual(periodRange('week', '2026-11-01'), { from: '2026-10-26', to: '2026-11-01' })
  assert.deepEqual(periodRange('month', '2026-02-14'), { from: '2026-02-01', to: '2026-02-28' })
  assert.equal(shiftPeriod('week', '2026-10-26', -1), '2026-10-19')
  assert.equal(shiftPeriod('month', '2026-12-01', 1), '2027-01-01')
  assert.equal(addDays('2026-10-31', 1), '2026-11-01')
  assert.equal(datesBetween('2026-10-30', '2026-11-02').length, 4)
})

test('period labels', () => {
  assert.equal(periodLabel('week', '2026-10-19', '2026-10-25'), '19–25 Oct 2026')
  assert.equal(periodLabel('week', '2026-10-26', '2026-11-01'), '26 Oct – 1 Nov 2026')
  assert.equal(periodLabel('month', '2026-10-01', '2026-10-31'), 'October 2026')
})

test('instants are shown in the organization time zone, not the browser', () => {
  assert.deepEqual(zonedParts('2026-10-19T03:00:00Z', 'Asia/Kolkata'), { date: '2026-10-19', time: '08:30' })
  assert.deepEqual(zonedParts('2026-10-19T20:00:00Z', 'Asia/Kolkata'), { date: '2026-10-20', time: '01:30' })
  assert.equal(clockIn('2026-10-20T00:30:00Z', 'Asia/Kolkata', '2026-10-19'), '06:00 (Tue, 20 Oct)')
  assert.equal(clockIn(null, 'Asia/Kolkata'), '—')
})

test('hours and minutes', () => {
  assert.equal(hm(450), '7:30')
  assert.equal(hm(0), '0:00')
  assert.equal(hm(null), '—')
})

test('totals add up days and count what needs attention', () => {
  const totals = totalsFor([
    day({ tracked_minutes: 580, break_minutes: 60, payroll_minutes: 520, regular_minutes: 520, flags: ['early_check_in'] }),
    day({ work_date: '2026-10-20', tracked_minutes: 720, break_minutes: 60, payroll_minutes: 660, regular_minutes: 540,
      overtime_daily_minutes: 60, overtime_double_minutes: 60, late_minutes: 20, flags: ['late', 'auto_check_out'] }),
    day({ work_date: '2026-10-23', flags: ['absent'] }),
    day({ work_date: '2026-10-25', day_type: 'rest', planned_minutes: 0, payroll_minutes: 120, overtime_rest_day_minutes: 120, flags: ['manual'] }),
  ])
  assert.equal(totals.payroll, 1300)
  assert.equal(totals.overtime, 240)
  assert.equal(totals.planned, 1440)
  assert.equal(totals.daysWorked, 3)
  assert.equal(totals.absences, 1)
  assert.equal(totals.lateDays, 1)
  // Absences have their own count; the early check-in and the automatic check-out need review.
  assert.equal(totals.attention, 2)
})

test('days are grouped per employee in date order', () => {
  const grouped = groupByEmployee([day({ work_date: '2026-10-20' }), day({ employee_id: 'e2' }), day()])
  assert.deepEqual(grouped.get('e1').map((d) => d.work_date), ['2026-10-19', '2026-10-20'])
  assert.equal(grouped.get('e2').length, 1)
})

test('the export has one row per employee and day in decimal hours', () => {
  const [header, ...rows] = timesheetCsv(
    [day({ employee_id: 'e2', payroll_minutes: 450 }), day({ first_in: '2026-10-19T03:00:00Z', last_out: '2026-10-19T12:40:00Z', payroll_minutes: 520, flags: ['late'] })],
    new Map([['e1', { name: 'Asha Rao', code: 'E-1' }], ['e2', { name: 'Zoya Khan', code: null }]]),
    'Asia/Kolkata',
  )
  assert.equal(header[10], 'Payroll hours')
  assert.deepEqual(rows.map((row) => row[0]), ['Asha Rao', 'Zoya Khan'])
  assert.deepEqual(rows[0].slice(6, 11), ['08:30', '18:10', '0.00', '0.00', '8.67'])
  assert.equal(rows[0].at(-1), 'Late')
})
