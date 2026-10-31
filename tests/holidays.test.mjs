import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { test } from 'node:test'
import ts from 'typescript'

const moduleUrl = (source) => 'data:text/javascript;base64,' + Buffer.from(source).toString('base64')
const compile = (path) => ts.transpileModule(readFileSync(new URL(path, import.meta.url), 'utf8'), {
  compilerOptions: { target: ts.ScriptTarget.ES2023, module: ts.ModuleKind.ESNext },
}).outputText
const importUrl = moduleUrl(compile('../src/lib/employeeImport.ts'))
const { formatHolidayDate, indiaNationalHolidays, isoWeekday, parseHolidayList } = await import(
  moduleUrl(compile('../src/lib/holidays.ts').replace("'./employeeImport'", `'${importUrl}'`)))

test('pasted lines with commas, tabs or spaces become holidays in date order', () => {
  const { holidays, problems } = parseHolidayList([
    '2026-11-08, Deepavali',
    '26/01/2026\tRepublic Day',
    '',
    '14-01-2026   "Makara Sankranti"',
  ].join('\n'), new Set())
  assert.deepEqual(problems, [])
  assert.deepEqual(holidays, [
    { date: '2026-01-14', name: 'Makara Sankranti' },
    { date: '2026-01-26', name: 'Republic Day' },
    { date: '2026-11-08', name: 'Deepavali' },
  ])
})

test('problem lines are reported with their line number and left out', () => {
  const { holidays, problems } = parseHolidayList([
    'Republic Day 2026-01-26',
    '2026-02-30, Not a date',
    '2026-08-15',
    '2026-10-02, Gandhi Jayanti',
    '02/10/2026 Again',
    `2026-12-25, ${'x'.repeat(81)}`,
  ].join('\n'), new Set(['2026-10-02']))
  assert.equal(holidays.length, 0)
  assert.deepEqual(problems.map((p) => [p.line, p.message.split(' ')[0]]), [
    [1, 'Start'], [2, 'Start'], [3, 'Start'], [4, 'This'], [5, 'This'], [6, 'Holiday'],
  ])
  assert.match(problems[3].message, /already has a holiday/)
})

test('repeated dates inside one list are caught', () => {
  const { holidays, problems } = parseHolidayList('2026-03-04, Holi\n04/03/2026, Holi again', new Set())
  assert.deepEqual(holidays, [{ date: '2026-03-04', name: 'Holi' }])
  assert.match(problems[0].message, /more than once/)
})

test('India national holidays fall on fixed dates', () => {
  assert.deepEqual(indiaNationalHolidays(2027).map((h) => h.date), ['2027-01-26', '2027-08-15', '2027-10-02'])
})

test('calendar dates format without shifting a day', () => {
  assert.deepEqual(formatHolidayDate('2026-01-26'), { weekday: 'Mon', date: '26 Jan 2026' })
  assert.equal(isoWeekday('2026-01-25'), 7)
  assert.equal(isoWeekday('2026-01-26'), 1)
})
