/**
 * Timesheet helpers for the Console. The numbers come from the server (timesheet_days in migration
 * 20261031000001); these functions only group, label and format them, always in the organization's
 * time zone rather than the browser's.
 */

export interface TimesheetDay {
  employee_id: string
  work_date: string
  day_type: 'working' | 'rest' | 'holiday' | 'unscheduled'
  holiday_name: string | null
  schedule_id: string | null
  schedule_name: string | null
  first_in: string | null
  last_out: string | null
  entry_count: number
  manual_count: number
  tracked_minutes: number
  break_minutes: number
  payroll_minutes: number
  planned_minutes: number | null
  regular_minutes: number
  overtime_daily_minutes: number
  overtime_double_minutes: number
  overtime_weekly_minutes: number
  overtime_rest_day_minutes: number
  overtime_holiday_minutes: number
  late_minutes: number
  early_out_minutes: number
  flags: TimesheetFlag[]
}

export interface TimesheetEntry {
  employee_id: string
  work_date: string
  source: 'app' | 'manual'
  session_id: number | null
  correction_id: string | null
  site_id: string | null
  start_at: string
  end_at: string | null
  effective_end: string | null
  recorded_start: string | null
  recorded_end: string | null
  status: 'recorded' | 'corrected' | 'added' | 'removed'
  end_state: 'closed' | 'in_progress' | 'missing_check_out' | 'auto_check_out'
}

export interface TimeEntryCorrection {
  id: string
  employee_id: string
  kind: 'add' | 'replace' | 'remove'
  session_id: number | null
  site_id: string | null
  start_at: string | null
  end_at: string | null
  reason: string
  supersedes_id: string | null
  created_by: string | null
  created_at: string
  voided_at: string | null
  voided_by: string | null
  void_reason: string | null
}

export type TimesheetFlag =
  | 'absent' | 'missing_check_out' | 'in_progress' | 'auto_check_out' | 'manual' | 'overlap'
  | 'long_entry' | 'late' | 'early_out' | 'early_check_in' | 'outside_schedule'

type Tone = 'destructive' | 'warning' | 'info' | 'secondary'

export const FLAG_META: Record<TimesheetFlag, { label: string; tone: Tone; attention: boolean; description: string }> = {
  absent: { label: 'Absent', tone: 'destructive', attention: false, description: 'No check-in on a scheduled working day.' },
  missing_check_out: { label: 'No check-out', tone: 'destructive', attention: true, description: 'A session was never closed and no automatic check-out applies, so it is not counted. Add the check-out time.' },
  in_progress: { label: 'In progress', tone: 'info', attention: false, description: 'Still checked in; counted up to now.' },
  auto_check_out: { label: 'Auto check-out', tone: 'warning', attention: true, description: 'Ended by the policy\'s automatic check-out.' },
  manual: { label: 'Edited', tone: 'secondary', attention: false, description: 'Includes an entry a manager added or corrected.' },
  overlap: { label: 'Overlap', tone: 'warning', attention: true, description: 'Entries overlap; the overlapping time is counted once.' },
  long_entry: { label: 'Over 16 h', tone: 'warning', attention: true, description: 'One entry lasts more than 16 hours.' },
  late: { label: 'Late', tone: 'warning', attention: false, description: 'First check-in after the scheduled start.' },
  early_out: { label: 'Left early', tone: 'warning', attention: false, description: 'Last check-out before the scheduled end.' },
  early_check_in: { label: 'Early check-in', tone: 'warning', attention: true, description: 'Checked in earlier than the policy allows.' },
  outside_schedule: { label: 'Outside hours', tone: 'warning', attention: true, description: 'Checked in outside scheduled hours while the policy blocks it.' },
}

export const DAY_TYPE_LABELS: Record<TimesheetDay['day_type'], string> = {
  working: 'Working day',
  rest: 'Rest day',
  holiday: 'Holiday',
  unscheduled: 'No schedule',
}

export const overtimeMinutes = (day: TimesheetDay) =>
  day.overtime_daily_minutes + day.overtime_double_minutes + day.overtime_weekly_minutes
  + day.overtime_rest_day_minutes + day.overtime_holiday_minutes

/** Minutes as hours and minutes for tables: 450 -> "7:30", 0 -> "0:00". */
export function hm(minutes: number | null | undefined): string {
  if (minutes === null || minutes === undefined) return '—'
  const sign = minutes < 0 ? '-' : ''
  const value = Math.abs(Math.round(minutes))
  return `${sign}${Math.floor(value / 60)}:${String(value % 60).padStart(2, '0')}`
}

/** Decimal hours for spreadsheets: 450 -> "7.50". */
export const decimalHours = (minutes: number) => (minutes / 60).toFixed(2)

// ---------------------------------------------------------------------------
// Calendar dates (YYYY-MM-DD) handled as UTC so no time zone shifts the day.
// ---------------------------------------------------------------------------

const toDate = (iso: string) => new Date(`${iso}T00:00:00Z`)
const toIso = (date: Date) => date.toISOString().slice(0, 10)

export function addDays(iso: string, days: number): string {
  const date = toDate(iso)
  date.setUTCDate(date.getUTCDate() + days)
  return toIso(date)
}

export type PeriodKind = 'week' | 'month'

/** The Monday-to-Sunday week or the calendar month containing `anchor`. */
export function periodRange(kind: PeriodKind, anchor: string): { from: string; to: string } {
  const date = toDate(anchor)
  if (kind === 'week') {
    const weekday = date.getUTCDay() === 0 ? 7 : date.getUTCDay()
    const from = addDays(anchor, 1 - weekday)
    return { from, to: addDays(from, 6) }
  }
  const from = toIso(new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), 1)))
  const to = toIso(new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth() + 1, 0)))
  return { from, to }
}

export function shiftPeriod(kind: PeriodKind, from: string, direction: 1 | -1): string {
  if (kind === 'week') return addDays(from, 7 * direction)
  const date = toDate(from)
  return toIso(new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth() + direction, 1)))
}

export function datesBetween(from: string, to: string): string[] {
  const dates: string[] = []
  for (let day = from; day <= to; day = addDays(day, 1)) dates.push(day)
  return dates
}

const MONTH = new Intl.DateTimeFormat('en-IN', { month: 'short', timeZone: 'UTC' })
const MONTH_YEAR = new Intl.DateTimeFormat('en-IN', { month: 'long', year: 'numeric', timeZone: 'UTC' })
const WEEKDAY_DAY = new Intl.DateTimeFormat('en-IN', { weekday: 'short', day: 'numeric', month: 'short', timeZone: 'UTC' })

/** "19–25 Oct 2026", "27 Oct – 2 Nov 2026" or "October 2026". */
export function periodLabel(kind: PeriodKind, from: string, to: string): string {
  if (kind === 'month') return MONTH_YEAR.format(toDate(from))
  const a = toDate(from)
  const b = toDate(to)
  const year = b.getUTCFullYear()
  if (a.getUTCMonth() === b.getUTCMonth()) return `${a.getUTCDate()}–${b.getUTCDate()} ${MONTH.format(b)} ${year}`
  return `${a.getUTCDate()} ${MONTH.format(a)} – ${b.getUTCDate()} ${MONTH.format(b)} ${year}`
}

/** "Mon, 19 Oct". */
export const dayLabel = (iso: string) => WEEKDAY_DAY.format(toDate(iso))

// ---------------------------------------------------------------------------
// Instants shown and entered in the organization's time zone.
// ---------------------------------------------------------------------------

const partsCache = new Map<string, Intl.DateTimeFormat>()
function zonedFormatter(timeZone: string) {
  let formatter = partsCache.get(timeZone)
  if (!formatter) {
    formatter = new Intl.DateTimeFormat('en-CA', {
      timeZone, year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hourCycle: 'h23',
    })
    partsCache.set(timeZone, formatter)
  }
  return formatter
}

/** The calendar date and clock time of an instant in a time zone: { date: "2026-10-19", time: "08:30" }. */
export function zonedParts(instant: string | number | Date, timeZone: string): { date: string; time: string } {
  const parts = Object.fromEntries(zonedFormatter(timeZone).formatToParts(new Date(instant)).map((p) => [p.type, p.value]))
  return { date: `${parts.year}-${parts.month}-${parts.day}`, time: `${parts.hour}:${parts.minute}` }
}

/** Clock time of an instant in the zone, with the date when it falls on another day than `onDate`. */
export function clockIn(instant: string | null, timeZone: string, onDate?: string): string {
  if (!instant) return '—'
  const { date, time } = zonedParts(instant, timeZone)
  if (onDate && date !== onDate) return `${time} (${dayLabel(date)})`
  return time
}

export const todayIn = (timeZone: string) => zonedParts(new Date(), timeZone).date

// ---------------------------------------------------------------------------
// Totals per employee for the team view and exports.
// ---------------------------------------------------------------------------

export interface TimesheetTotals {
  tracked: number
  breaks: number
  payroll: number
  planned: number
  regular: number
  overtime: number
  overtimeDaily: number
  overtimeDouble: number
  overtimeWeekly: number
  overtimeRestDay: number
  overtimeHoliday: number
  daysWorked: number
  absences: number
  lateDays: number
  attention: number
  inProgress: boolean
}

export function totalsFor(days: readonly TimesheetDay[]): TimesheetTotals {
  const totals: TimesheetTotals = {
    tracked: 0, breaks: 0, payroll: 0, planned: 0, regular: 0, overtime: 0, overtimeDaily: 0, overtimeDouble: 0,
    overtimeWeekly: 0, overtimeRestDay: 0, overtimeHoliday: 0, daysWorked: 0, absences: 0, lateDays: 0, attention: 0,
    inProgress: false,
  }
  for (const day of days) {
    totals.tracked += day.tracked_minutes
    totals.breaks += day.break_minutes
    totals.payroll += day.payroll_minutes
    totals.planned += day.planned_minutes ?? 0
    totals.regular += day.regular_minutes
    totals.overtimeDaily += day.overtime_daily_minutes
    totals.overtimeDouble += day.overtime_double_minutes
    totals.overtimeWeekly += day.overtime_weekly_minutes
    totals.overtimeRestDay += day.overtime_rest_day_minutes
    totals.overtimeHoliday += day.overtime_holiday_minutes
    totals.overtime += overtimeMinutes(day)
    if (day.payroll_minutes > 0) totals.daysWorked++
    if (day.flags.includes('absent')) totals.absences++
    if (day.flags.includes('late')) totals.lateDays++
    if (day.flags.some((flag) => FLAG_META[flag]?.attention)) totals.attention++
    if (day.flags.includes('in_progress')) totals.inProgress = true
  }
  return totals
}

export function groupByEmployee(days: readonly TimesheetDay[]): Map<string, TimesheetDay[]> {
  const grouped = new Map<string, TimesheetDay[]>()
  for (const day of days) {
    const list = grouped.get(day.employee_id)
    if (list) list.push(day)
    else grouped.set(day.employee_id, [day])
  }
  for (const list of grouped.values()) list.sort((a, b) => a.work_date.localeCompare(b.work_date))
  return grouped
}

export interface EmployeeLabel {
  name: string
  code: string | null
}

/** One row per employee per day, in decimal hours, for payroll spreadsheets. */
export function timesheetCsv(days: readonly TimesheetDay[], employees: ReadonlyMap<string, EmployeeLabel>, timeZone: string): string[][] {
  const header = [
    'Employee', 'Employee code', 'Date', 'Day', 'Holiday', 'Schedule', 'First in', 'Last out',
    'Tracked hours', 'Break hours', 'Payroll hours', 'Planned hours', 'Regular hours', 'Daily overtime',
    'Double overtime', 'Weekly overtime', 'Rest-day overtime', 'Holiday overtime', 'Late minutes',
    'Early out minutes', 'Flags',
  ]
  const rows = [...days]
    .sort((a, b) => (employees.get(a.employee_id)?.name ?? '').localeCompare(employees.get(b.employee_id)?.name ?? '')
      || a.work_date.localeCompare(b.work_date))
    .map((day) => [
      employees.get(day.employee_id)?.name ?? day.employee_id,
      employees.get(day.employee_id)?.code ?? '',
      day.work_date,
      DAY_TYPE_LABELS[day.day_type],
      day.holiday_name ?? '',
      day.schedule_name ?? '',
      day.first_in ? zonedParts(day.first_in, timeZone).time : '',
      day.last_out ? clockIn(day.last_out, timeZone, day.work_date) : '',
      decimalHours(day.tracked_minutes),
      decimalHours(day.break_minutes),
      decimalHours(day.payroll_minutes),
      day.planned_minutes === null ? '' : decimalHours(day.planned_minutes),
      decimalHours(day.regular_minutes),
      decimalHours(day.overtime_daily_minutes),
      decimalHours(day.overtime_double_minutes),
      decimalHours(day.overtime_weekly_minutes),
      decimalHours(day.overtime_rest_day_minutes),
      decimalHours(day.overtime_holiday_minutes),
      String(day.late_minutes),
      String(day.early_out_minutes),
      day.flags.map((flag) => FLAG_META[flag]?.label ?? flag).join('; '),
    ])
  return [header, ...rows]
}
