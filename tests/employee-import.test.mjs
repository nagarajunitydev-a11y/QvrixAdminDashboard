import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { test } from 'node:test'
import ts from 'typescript'

const source = ts.transpileModule(readFileSync(new URL('../src/lib/employeeImport.ts', import.meta.url), 'utf8'), {
  compilerOptions: { target: ts.ScriptTarget.ES2023, module: ts.ModuleKind.ESNext },
}).outputText
const { parseCsv, matchHeaders, normalizeDate, normalizeEmploymentType, buildImportPreview, MAX_IMPORT_ROWS } =
  await import('data:text/javascript;base64,' + Buffer.from(source).toString('base64'))

const context = {
  existingEmails: ['Taken@Example.com'],
  existingCodes: ['EMP-900'],
  departments: [{ id: 'd1', name: 'Operations' }],
  designations: [{ id: 'g1', name: 'Guard' }],
  shifts: [{ id: 's1', name: 'Day Shift' }],
}
const header = 'first_name,last_name,email,phone,employee_code,employment_type,department,designation,shift,hire_date'

test('parses quoted fields, escaped quotes, embedded commas and newlines, BOM and CRLF', () => {
  const rows = parseCsv('﻿a,b\r\n"Rao, Asha","say ""hi""\nthere"\r\n\r\n')
  assert.deepEqual(rows, [['a', 'b'], ['Rao, Asha', 'say "hi"\nthere']])
})

test('matches headers by name, alias, case and spacing, and reports missing required columns', () => {
  const match = matchHeaders(['First Name', 'SURNAME', 'Email', 'Emp Code', 'Notes'])
  assert.deepEqual(match.columns, ['first_name', 'last_name', 'email', 'employee_code', null])
  assert.deepEqual(match.missing, [])
  assert.deepEqual(match.unknown, ['Notes'])
  assert.deepEqual(matchHeaders(['first_name', 'phone']).missing, ['last_name', 'email'])
})

test('dates accept ISO and day-first formats and reject impossible dates', () => {
  assert.equal(normalizeDate('2026-4-1'), '2026-04-01')
  assert.equal(normalizeDate('01/04/2026'), '2026-04-01')
  assert.equal(normalizeDate('31-12-2025'), '2025-12-31')
  assert.equal(normalizeDate('31/02/2026'), null)
  assert.equal(normalizeDate('04/01/26'), null)
})

test('employment types accept values and labels in any case', () => {
  assert.equal(normalizeEmploymentType('Full time'), 'full_time')
  assert.equal(normalizeEmploymentType('PART-TIME'), 'part_time')
  assert.equal(normalizeEmploymentType('freelance'), null)
})

test('valid rows become payloads, resolving names case-insensitively', () => {
  const preview = buildImportPreview(parseCsv(`${header}\nAsha,Rao,ASHA@x.in,+91 1,EMP-1,contract,operations,guard,day shift,01/04/2026`), context)
  assert.equal(preview.validCount, 1)
  assert.deepEqual(preview.rows[0].payload, {
    first_name: 'Asha', last_name: 'Rao', email: 'asha@x.in', phone: '+91 1', employee_code: 'EMP-1',
    employment_type: 'contract', department: 'Operations', designation: 'Guard', shift_id: 's1', hire_date: '2026-04-01',
  })
  assert.deepEqual(preview.newDepartments, [])
})

test('values exported with a formula guard round-trip without the guard', () => {
  const preview = buildImportPreview(parseCsv(`${header}\nA,B,a@x.in,'+91 98450 00001,,,,,,`), context)
  assert.equal(preview.rows[0].payload.phone, '+91 98450 00001')
})

test('flags existing and repeated emails and codes, bad values and unknown shifts per line', () => {
  const csv = [
    header,
    'A,One,taken@example.com,,,,,,,',
    'B,Two,b@x.in,,emp-900,,,,,',
    'C,Three,c@x.in,,C-1,,,,,',
    'D,Four,C@X.IN,,c-1,boss,,,Night,2026-13-01',
    ',Five,not-an-email,,bad code,,,,,',
  ].join('\n')
  const { rows, validCount } = buildImportPreview(parseCsv(csv), context)
  assert.equal(validCount, 1)
  assert.match(rows[0].errors.join(' '), /already exists/)
  assert.match(rows[1].errors.join(' '), /already used/)
  assert.deepEqual(rows[2].errors, [])
  assert.equal(rows[3].line, 5)
  assert.match(rows[3].errors.join(' '), /Same email as line 4/)
  assert.match(rows[3].errors.join(' '), /Same employee code as line 4/)
  assert.match(rows[3].errors.join(' '), /Employment type/)
  assert.match(rows[3].errors.join(' '), /Hire date/)
  assert.match(rows[3].errors.join(' '), /Shift "Night" does not exist/)
  assert.match(rows[4].errors.join(' '), /First name is required/)
  assert.match(rows[4].errors.join(' '), /Email is not valid/)
  assert.match(rows[4].errors.join(' '), /Employee code must be/)
})

test('new departments and designations are listed once, and only when a valid row uses them', () => {
  const csv = [
    header,
    'A,One,a@x.in,,,,Field  Ops,Rigger,,',
    'B,Two,b@x.in,,,,field ops,,,',
    'C,Three,bad,,,,Ghost Dept,,,',
  ].join('\n')
  const preview = buildImportPreview(parseCsv(csv), context)
  assert.deepEqual(preview.newDepartments, ['Field Ops'])
  assert.deepEqual(preview.newDesignations, ['Rigger'])
  assert.equal(preview.rows[1].payload.department, 'Field Ops')
})

test('rejects files without required headers, without rows, or over the row limit', () => {
  assert.match(buildImportPreview(parseCsv('first_name,phone\nA,1'), context).headerErrors[0], /last_name, email/)
  assert.match(buildImportPreview(parseCsv(header), context).headerErrors[0], /no employees/)
  const big = [header, ...Array.from({ length: MAX_IMPORT_ROWS + 1 }, (_, i) => `A,B,a${i}@x.in,,,,,,,`)].join('\n')
  assert.match(buildImportPreview(parseCsv(big), context).headerErrors[0], /up to 1000/)
  assert.match(buildImportPreview([], context).headerErrors[0], /empty/)
})
