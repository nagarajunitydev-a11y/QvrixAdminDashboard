/**
 * CSV import for employees: parse, match headers, validate every row against the organization's
 * existing records, and build insert payloads. Pure functions so the rules are unit-tested; the
 * database constraints remain the final authority.
 */

export const IMPORT_COLUMNS = [
  'first_name',
  'last_name',
  'email',
  'phone',
  'employee_code',
  'employment_type',
  'department',
  'designation',
  'shift',
  'hire_date',
] as const

export type ImportColumn = (typeof IMPORT_COLUMNS)[number]

export const REQUIRED_COLUMNS: ImportColumn[] = ['first_name', 'last_name', 'email']

export const MAX_IMPORT_ROWS = 1000

export const EMPLOYMENT_TYPES = [
  { value: 'full_time', label: 'Full time' },
  { value: 'part_time', label: 'Part time' },
  { value: 'contract', label: 'Contract' },
  { value: 'temporary', label: 'Temporary' },
  { value: 'intern', label: 'Intern' },
] as const

export type EmploymentType = (typeof EMPLOYMENT_TYPES)[number]['value']

/** Mirrors the database check on employees.employee_code. */
export const EMPLOYEE_CODE_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._/-]{0,31}$/

const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/

export function employmentTypeLabel(value: string | null | undefined): string {
  return EMPLOYMENT_TYPES.find((type) => type.value === value)?.label ?? '—'
}

/** RFC 4180 CSV: quoted fields, escaped quotes, commas and line breaks inside quotes, CRLF or LF. */
export function parseCsv(text: string): string[][] {
  const rows: string[][] = []
  let row: string[] = []
  let field = ''
  let quoted = false
  const input = text.charCodeAt(0) === 0xfeff ? text.slice(1) : text

  for (let i = 0; i < input.length; i++) {
    const char = input[i]
    if (quoted) {
      if (char === '"') {
        if (input[i + 1] === '"') {
          field += '"'
          i++
        } else {
          quoted = false
        }
      } else {
        field += char
      }
    } else if (char === '"') {
      quoted = true
    } else if (char === ',') {
      row.push(field)
      field = ''
    } else if (char === '\n' || char === '\r') {
      if (char === '\r' && input[i + 1] === '\n') i++
      row.push(field)
      rows.push(row)
      row = []
      field = ''
    } else {
      field += char
    }
  }
  if (field !== '' || row.length > 0) {
    row.push(field)
    rows.push(row)
  }
  return rows.filter((cells) => cells.some((cell) => cell.trim() !== ''))
}

function headerKey(value: string): string {
  return value.trim().toLowerCase().replace(/[\s-]+/g, '_')
}

const HEADER_ALIASES: Record<string, ImportColumn> = {
  first: 'first_name',
  firstname: 'first_name',
  last: 'last_name',
  lastname: 'last_name',
  surname: 'last_name',
  email_address: 'email',
  mobile: 'phone',
  phone_number: 'phone',
  code: 'employee_code',
  employee_id: 'employee_code',
  emp_code: 'employee_code',
  type: 'employment_type',
  dept: 'department',
  joining_date: 'hire_date',
  join_date: 'hire_date',
}

export interface HeaderMatch {
  columns: Array<ImportColumn | null>
  missing: ImportColumn[]
  unknown: string[]
}

export function matchHeaders(header: string[]): HeaderMatch {
  const seen = new Set<ImportColumn>()
  const unknown: string[] = []
  const columns = header.map((raw) => {
    const key = headerKey(raw)
    const column = (IMPORT_COLUMNS as readonly string[]).includes(key) ? (key as ImportColumn) : HEADER_ALIASES[key]
    if (!column || seen.has(column)) {
      if (raw.trim()) unknown.push(raw.trim())
      return null
    }
    seen.add(column)
    return column
  })
  return { columns, missing: REQUIRED_COLUMNS.filter((column) => !seen.has(column)), unknown }
}

/** Accepts YYYY-MM-DD, or DD/MM/YYYY and DD-MM-YYYY (day first). Returns ISO or null if invalid. */
export function normalizeDate(value: string): string | null {
  const trimmed = value.trim()
  let year: number, month: number, day: number
  let match = /^(\d{4})-(\d{1,2})-(\d{1,2})$/.exec(trimmed)
  if (match) {
    ;[year, month, day] = [Number(match[1]), Number(match[2]), Number(match[3])]
  } else {
    match = /^(\d{1,2})[/-](\d{1,2})[/-](\d{4})$/.exec(trimmed)
    if (!match) return null
    ;[day, month, year] = [Number(match[1]), Number(match[2]), Number(match[3])]
  }
  const date = new Date(Date.UTC(year, month - 1, day))
  if (date.getUTCFullYear() !== year || date.getUTCMonth() !== month - 1 || date.getUTCDate() !== day) return null
  return `${year}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`
}

export function normalizeEmploymentType(value: string): EmploymentType | null {
  const key = headerKey(value)
  return EMPLOYMENT_TYPES.find((type) => type.value === key || headerKey(type.label) === key)?.value ?? null
}

export interface NamedRecord {
  id: string
  name: string
}

export interface ImportContext {
  existingEmails: Iterable<string>
  existingCodes: Iterable<string>
  departments: NamedRecord[]
  designations: NamedRecord[]
  shifts: NamedRecord[]
}

export interface ImportPayload {
  first_name: string
  last_name: string
  email: string
  phone: string | null
  employee_code: string | null
  employment_type: EmploymentType | null
  department: string | null
  designation: string | null
  shift_id: string | null
  hire_date: string | null
}

export interface ImportRow {
  /** 1-based line number in the file, counting the header. */
  line: number
  name: string
  email: string
  errors: string[]
  payload: ImportPayload | null
}

export interface ImportPreview {
  rows: ImportRow[]
  headerErrors: string[]
  ignoredColumns: string[]
  /** Department and designation names the import would create, as first written in the file. */
  newDepartments: string[]
  newDesignations: string[]
  validCount: number
}

const nameKey = (value: string) => value.trim().replace(/\s+/g, ' ').toLowerCase()

export function buildImportPreview(table: string[][], context: ImportContext): ImportPreview {
  const empty: ImportPreview = {
    rows: [], headerErrors: [], ignoredColumns: [], newDepartments: [], newDesignations: [], validCount: 0,
  }
  if (table.length === 0) return { ...empty, headerErrors: ['The file is empty.'] }

  const { columns, missing, unknown } = matchHeaders(table[0])
  if (missing.length) {
    return { ...empty, ignoredColumns: unknown, headerErrors: [`Missing required column${missing.length > 1 ? 's' : ''}: ${missing.join(', ')}.`] }
  }
  const body = table.slice(1)
  if (body.length === 0) return { ...empty, ignoredColumns: unknown, headerErrors: ['The file has a header row but no employees.'] }
  if (body.length > MAX_IMPORT_ROWS) {
    return { ...empty, ignoredColumns: unknown, headerErrors: [`Import up to ${MAX_IMPORT_ROWS} employees at a time; this file has ${body.length}.`] }
  }

  const emails = new Set([...context.existingEmails].map((email) => email.trim().toLowerCase()))
  const codes = new Set([...context.existingCodes].map((code) => code.trim().toLowerCase()))
  const departments = new Map(context.departments.map((d) => [nameKey(d.name), d.name]))
  const designations = new Map(context.designations.map((d) => [nameKey(d.name), d.name]))
  const shifts = new Map(context.shifts.map((s) => [nameKey(s.name), s.id]))
  const fileEmails = new Map<string, number>()
  const fileCodes = new Map<string, number>()
  const newDepartments = new Map<string, string>()
  const newDesignations = new Map<string, string>()

  const rows = body.map((cells, index): ImportRow => {
    const line = index + 2
    const value = (column: ImportColumn) => {
      const position = columns.indexOf(column)
      const cell = position === -1 ? '' : (cells[position] ?? '').trim()
      // Our CSV export guards formula-like text with a leading ' (e.g. '+91 phone numbers); undo it.
      return /^'[=+\-@]/.test(cell) ? cell.slice(1) : cell
    }
    const errors: string[] = []
    const firstName = value('first_name')
    const lastName = value('last_name')
    const email = value('email').toLowerCase()
    if (!firstName) errors.push('First name is required.')
    if (!lastName) errors.push('Last name is required.')
    if (!email) {
      errors.push('Email is required.')
    } else if (!EMAIL_PATTERN.test(email)) {
      errors.push('Email is not valid.')
    } else if (emails.has(email)) {
      errors.push('An employee with this email already exists.')
    } else if (fileEmails.has(email)) {
      errors.push(`Same email as line ${fileEmails.get(email)}.`)
    } else {
      fileEmails.set(email, line)
    }

    const code = value('employee_code')
    if (code) {
      const key = code.toLowerCase()
      if (!EMPLOYEE_CODE_PATTERN.test(code)) errors.push('Employee code must be 1–32 letters, digits, or . _ / - and start with a letter or digit.')
      else if (codes.has(key)) errors.push('Employee code is already used.')
      else if (fileCodes.has(key)) errors.push(`Same employee code as line ${fileCodes.get(key)}.`)
      else fileCodes.set(key, line)
    }

    const rawType = value('employment_type')
    const employmentType = rawType ? normalizeEmploymentType(rawType) : null
    if (rawType && !employmentType) errors.push(`Employment type must be one of: ${EMPLOYMENT_TYPES.map((t) => t.label).join(', ')}.`)

    const rawHireDate = value('hire_date')
    const hireDate = rawHireDate ? normalizeDate(rawHireDate) : null
    if (rawHireDate && !hireDate) errors.push('Hire date must be YYYY-MM-DD or DD/MM/YYYY.')

    const rawShift = value('shift')
    const shiftId = rawShift ? shifts.get(nameKey(rawShift)) ?? null : null
    if (rawShift && !shiftId) errors.push(`Shift "${rawShift}" does not exist. Create it on the Shifts page first.`)

    const phone = value('phone')
    if (phone.length > 32) errors.push('Phone number is too long.')

    const resolveName = (raw: string, existing: Map<string, string>, created: Map<string, string>) => {
      if (!raw) return null
      const key = nameKey(raw)
      if (existing.has(key)) return existing.get(key)!
      if (!created.has(key)) created.set(key, raw.replace(/\s+/g, ' '))
      return created.get(key)!
    }
    const department = resolveName(value('department'), departments, newDepartments)
    const designation = resolveName(value('designation'), designations, newDesignations)

    return {
      line,
      name: `${firstName} ${lastName}`.trim(),
      email,
      errors,
      payload: errors.length
        ? null
        : {
            first_name: firstName,
            last_name: lastName,
            email,
            phone: phone || null,
            employee_code: code || null,
            employment_type: employmentType,
            department,
            designation,
            shift_id: shiftId,
            hire_date: hireDate,
          },
    }
  })

  // Only create departments and designations that a valid row will actually use.
  const used = (field: 'department' | 'designation', created: Map<string, string>) => {
    const names = new Set(rows.flatMap((row) => (row.payload?.[field] ? [nameKey(row.payload[field]!)] : [])))
    return [...created.entries()].filter(([key]) => names.has(key)).map(([, name]) => name)
  }

  return {
    rows,
    headerErrors: [],
    ignoredColumns: unknown,
    newDepartments: used('department', newDepartments),
    newDesignations: used('designation', newDesignations),
    validCount: rows.filter((row) => row.payload).length,
  }
}

export const IMPORT_TEMPLATE_ROWS: string[][] = [
  ['Asha', 'Rao', 'asha.rao@example.com', '+91 98450 00001', 'EMP-001', 'Full time', 'Operations', 'Supervisor', '', '2026-04-01'],
]
