import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { test } from 'node:test'
import ts from 'typescript'

const source = ts.transpileModule(readFileSync(new URL('../src/lib/workSchedules.ts', import.meta.url), 'utf8'), {
  compilerOptions: { target: ts.ScriptTarget.ES2023, module: ts.ModuleKind.ESNext },
}).outputText
const {
  emptyScheduleForm, formFromSchedule, formatMinutes, formatWorkingDays, parseHours, plannedMinutes,
  resolveRule, scheduleSummary, spanMinutes, toClock, validateScheduleForm, weeklyPlannedMinutes,
} = await import('data:text/javascript;base64,' + Buffer.from(source).toString('base64'))

const form = (changes = {}) => ({ ...emptyScheduleForm(), name: 'Day', ...changes })
const errorsOf = (changes) => validateScheduleForm(form(changes)).errors

test('times and durations read the way people type them', () => {
  assert.equal(toClock('09:00:00'), '09:00')
  assert.equal(toClock('9:30'), '09:30')
  assert.equal(toClock('24:00'), null)
  assert.equal(parseHours('8'), 480)
  assert.equal(parseHours('7.5'), 450)
  assert.equal(parseHours('7:45'), 465)
  assert.equal(parseHours('0'), null)
  assert.equal(parseHours('eight'), null)
  assert.equal(formatMinutes(450), '7 h 30 min')
  assert.equal(formatMinutes(30), '30 min')
  assert.equal(spanMinutes('22:00', '06:00'), 480)
  assert.equal(spanMinutes('09:00', '18:00'), 540)
})

test('working days are summarized as ranges', () => {
  assert.equal(formatWorkingDays([1, 2, 3, 4, 5]), 'Mon–Fri')
  assert.equal(formatWorkingDays([5, 1, 3]), 'Mon, Wed, Fri')
  assert.equal(formatWorkingDays([1, 2, 3, 4, 5, 6, 7]), 'Every day')
  assert.equal(formatWorkingDays([1, 2, 3, 4, 5, 7]), 'Mon–Fri, Sun')
  assert.equal(formatWorkingDays([6, 7]), 'Sat, Sun')
})

test('a default fixed schedule becomes the database payload', () => {
  const { payload, errors } = validateScheduleForm(form({ breaks: [{ name: 'Lunch', minutes: '60', paid: false, start: '', end: '' }] }))
  assert.deepEqual(errors, [])
  assert.equal(payload.schedule_type, 'fixed')
  assert.deepEqual(payload.working_days, [1, 2, 3, 4, 5])
  assert.deepEqual(payload.breaks, [{ name: 'Lunch', minutes: 60, paid: false }])
  assert.equal(payload.daily_minutes, null)
  assert.equal(payload.overtime_daily_rate, null)
  assert.equal(plannedMinutes(payload, 1), 480)
  assert.equal(plannedMinutes(payload, 7), null)
  assert.equal(weeklyPlannedMinutes(payload), 2400)
  assert.equal(scheduleSummary(payload).hours, '09:00–18:00')
})

test('overnight hours are labelled as ending the next day', () => {
  const { payload } = validateScheduleForm(form({ start: '22:00', end: '06:00' }))
  assert.equal(scheduleSummary(payload).hours, '22:00–06:00 next day')
  assert.equal(plannedMinutes(payload, 1), 480)
})

test('a Saturday half day keeps its own hours and only on working days', () => {
  const { payload } = validateScheduleForm(form({
    days: [1, 2, 3, 4, 5, 6],
    dayTimes: { 6: { start: '09:00', end: '13:00' }, 7: { start: '10:00', end: '12:00' } },
  }))
  assert.deepEqual(payload.day_times, { 6: { start: '09:00', end: '13:00' } })
  assert.equal(plannedMinutes(payload, 6), 240)
  assert.equal(weeklyPlannedMinutes(payload), 5 * 540 + 240)
  assert.match(scheduleSummary(payload).hours, /Sat differ/)
})

test('flexible schedules carry their targets and no per-day hours', () => {
  const daily = validateScheduleForm(form({ type: 'flexible', dailyHours: '7.5', dayTimes: { 1: { start: '10:00', end: '12:00' } } })).payload
  assert.equal(daily.daily_minutes, 450)
  assert.deepEqual(daily.day_times, {})
  assert.equal(scheduleSummary(daily).hours, '7 h 30 min a day')
  const weekly = validateScheduleForm(form({ type: 'weekly_flexible', weeklyHours: '40' })).payload
  assert.equal(weekly.weekly_minutes, 2400)
  assert.equal(weekly.daily_minutes, null)
  assert.equal(scheduleSummary(weekly).weekly, '40 h a week')
  assert.match(errorsOf({ type: 'flexible', dailyHours: '25' })[0], /Hours per day/)
})

test('the form reports what the database would reject', () => {
  assert.match(errorsOf({ name: ' ' })[0], /schedule name/)
  assert.match(errorsOf({ days: [] })[0], /working day/)
  assert.match(errorsOf({ end: '09:00' })[0], /different/)
  assert.match(errorsOf({ breaks: [{ name: '', minutes: '0', paid: false, start: '13:00', end: '' }] })[0], /name and a length .* and both window times/)
  assert.match(errorsOf({ start: '09:00', end: '10:00', breaks: [{ name: 'Lunch', minutes: '60', paid: false, start: '', end: '' }] })[0], /Unpaid breaks/)
  assert.deepEqual(errorsOf({ start: '09:00', end: '10:00', breaks: [{ name: 'Rest', minutes: '60', paid: true, start: '', end: '' }] }), [])
  assert.match(errorsOf({ breaks: Array.from({ length: 6 }, (_, i) => ({ name: `B${i}`, minutes: '5', paid: true, start: '', end: '' })) })[0], /up to 5/)
  assert.match(errorsOf({ autoBreak: { enabled: true, minutes: '0', afterHours: '6' } })[0], /automatic break/)
})

test('overtime rules follow the same order as the database', () => {
  const on = (afterHours, rate) => ({ enabled: true, afterHours, rate })
  assert.match(errorsOf({ overtimeDouble: on('12', '2') })[0], /needs daily overtime/)
  assert.match(errorsOf({ overtimeDaily: on('9', '1.5'), overtimeDouble: on('9', '2') })[0], /start after/)
  assert.match(errorsOf({ overtimeDaily: on('9', '2'), overtimeDouble: on('12', '1.5') })[0], /cannot be lower/)
  assert.match(errorsOf({ overtimeDaily: on('9', '6') })[0], /between 1 and 5/)
  assert.match(errorsOf({ holidayRate: 'double' })[0], /public holiday rate/)
  const { payload } = validateScheduleForm(form({ overtimeDaily: on('9', '1.5'), overtimeWeekly: on('48', '2'), holidayRate: '2' }))
  assert.equal(payload.overtime_daily_after_minutes, 540)
  assert.equal(payload.overtime_weekly_after_minutes, 2880)
  assert.equal(payload.overtime_holiday_rate, 2)
  assert.equal(scheduleSummary(payload).overtime, 'after 9 h a day ×1.5 · after 48 h a week ×2 · holidays ×2')
})

test('a saved schedule opens in the form unchanged', () => {
  const { payload } = validateScheduleForm(form({
    type: 'fixed', start: '22:00', end: '06:00', days: [1, 2, 3, 4, 5, 6], splitTime: '12:00',
    dayTimes: { 6: { start: '22:00', end: '02:00' } },
    breaks: [{ name: 'Meal', minutes: '30', paid: false, start: '01:00', end: '03:00' }],
    autoBreak: { enabled: true, minutes: '30', afterHours: '6' },
    overtimeDaily: { enabled: true, afterHours: '8.5', rate: '1.25' },
    isDefault: true,
  }))
  // The database returns times with seconds and numbers for numeric columns.
  const stored = { ...payload, start_time: '22:00:00', end_time: '06:00:00', day_split_time: '12:00:00' }
  const again = validateScheduleForm(formFromSchedule(stored)).payload
  assert.deepEqual(again, payload)
})

test('the employee choice wins, then the department, then the default', () => {
  const shifts = [{ id: 'a', is_default: false }, { id: 'b', is_default: false }, { id: 'c', is_default: true }]
  assert.deepEqual(resolveRule('a', 'b', shifts), { value: shifts[0], source: 'employee' })
  assert.deepEqual(resolveRule(null, 'b', shifts), { value: shifts[1], source: 'department' })
  assert.deepEqual(resolveRule(null, null, shifts), { value: shifts[2], source: 'organization' })
  assert.equal(resolveRule(null, null, shifts.slice(0, 2)), null)
})
