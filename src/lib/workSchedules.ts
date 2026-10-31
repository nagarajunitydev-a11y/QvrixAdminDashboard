/**
 * Work schedule rules for the Work Schedules screen. The form checks mirror the database checks in
 * migration 20261031000000, so people see a readable message before anything is sent.
 */

export type ScheduleType = 'fixed' | 'flexible' | 'weekly_flexible'
export type RuleSource = 'employee' | 'department' | 'organization'

export interface ScheduleBreak {
  name: string
  minutes: number
  paid: boolean
  start?: string
  end?: string
}

export type DayTimes = Record<string, { start: string; end: string }>

/** The schedule columns of public.shifts that the Console reads and writes. */
export interface WorkScheduleFields {
  name: string
  schedule_type: ScheduleType
  start_time: string
  end_time: string
  working_days: number[]
  day_times: DayTimes
  daily_minutes: number | null
  weekly_minutes: number | null
  breaks: ScheduleBreak[]
  auto_break_minutes: number | null
  auto_break_after_minutes: number | null
  day_split_time: string
  overtime_daily_after_minutes: number | null
  overtime_daily_rate: number | null
  overtime_double_after_minutes: number | null
  overtime_double_rate: number | null
  overtime_weekly_after_minutes: number | null
  overtime_weekly_rate: number | null
  overtime_rest_day_rate: number | null
  overtime_holiday_rate: number | null
  is_default: boolean
}

export const SCHEDULE_TYPES: Array<{ value: ScheduleType; label: string; description: string }> = [
  { value: 'fixed', label: 'Fixed', description: 'Set start and end times on each working day.' },
  { value: 'flexible', label: 'Flexible', description: 'A number of hours each working day, at any time.' },
  { value: 'weekly_flexible', label: 'Weekly flexible', description: 'A number of hours across the week.' },
]

export const WEEKDAYS = [
  { value: 1, short: 'Mon', long: 'Monday' },
  { value: 2, short: 'Tue', long: 'Tuesday' },
  { value: 3, short: 'Wed', long: 'Wednesday' },
  { value: 4, short: 'Thu', long: 'Thursday' },
  { value: 5, short: 'Fri', long: 'Friday' },
  { value: 6, short: 'Sat', long: 'Saturday' },
  { value: 7, short: 'Sun', long: 'Sunday' },
] as const

export const MAX_BREAKS = 5
const CLOCK = /^([01][0-9]|2[0-3]):[0-5][0-9]$/

export function scheduleTypeLabel(type: string | null | undefined): string {
  return SCHEDULE_TYPES.find((option) => option.value === type)?.label ?? 'Fixed'
}

/** "09:00:00" from the database, or "9:00" typed by hand, becomes "09:00". Returns null if invalid. */
export function toClock(value: string | null | undefined): string | null {
  const match = /^(\d{1,2}):(\d{2})(?::\d{2})?$/.exec((value ?? '').trim())
  if (!match) return null
  const clock = `${match[1].padStart(2, '0')}:${match[2]}`
  return CLOCK.test(clock) ? clock : null
}

const clockMinutes = (clock: string) => Number(clock.slice(0, 2)) * 60 + Number(clock.slice(3, 5))

/** Minutes from start to end; an end at or before the start finishes the next day. */
export function spanMinutes(start: string, end: string): number {
  const span = clockMinutes(end) - clockMinutes(start)
  return span > 0 ? span : span + 24 * 60
}

/** Accepts "8", "7.5" or "7:30" hours. Returns whole minutes, or null if the text is not a duration. */
export function parseHours(value: string): number | null {
  const text = value.trim()
  let minutes: number
  const clock = /^(\d{1,3}):([0-5]\d)$/.exec(text)
  if (clock) minutes = Number(clock[1]) * 60 + Number(clock[2])
  else if (/^\d{1,3}(\.\d{1,2})?$/.test(text)) minutes = Math.round(Number(text) * 60)
  else return null
  return minutes > 0 ? minutes : null
}

/** 480 -> "8 h", 450 -> "7 h 30 min", 30 -> "30 min". */
export function formatMinutes(minutes: number | null | undefined): string {
  if (minutes === null || minutes === undefined) return '—'
  const hours = Math.floor(minutes / 60)
  const rest = minutes % 60
  if (!hours) return `${rest} min`
  return rest ? `${hours} h ${rest} min` : `${hours} h`
}

/** Minutes as the hours text the form shows: 480 -> "8", 450 -> "7.5", 445 -> "7:25". */
export function hoursText(minutes: number | null | undefined): string {
  if (!minutes) return ''
  if (minutes % 15 === 0) return String(minutes / 60)
  return `${Math.floor(minutes / 60)}:${String(minutes % 60).padStart(2, '0')}`
}

/** [1,2,3,4,5] -> "Mon–Fri", [1,3,5] -> "Mon, Wed, Fri", all seven -> "Every day". */
export function formatWorkingDays(days: readonly number[]): string {
  const sorted = [...new Set(days)].filter((day) => day >= 1 && day <= 7).sort((a, b) => a - b)
  if (!sorted.length) return 'No working days'
  if (sorted.length === 7) return 'Every day'
  const name = (day: number) => WEEKDAYS[day - 1].short
  const runs: number[][] = []
  for (const day of sorted) {
    const run = runs[runs.length - 1]
    if (run && day === run[run.length - 1] + 1) run.push(day)
    else runs.push([day])
  }
  return runs
    .map((run) => (run.length >= 3 ? `${name(run[0])}–${name(run[run.length - 1])}` : run.map(name).join(', ')))
    .join(', ')
}

const unpaidBreakMinutes = (schedule: Pick<WorkScheduleFields, 'breaks'>) =>
  (schedule.breaks ?? []).filter((item) => !item.paid).reduce((sum, item) => sum + item.minutes, 0)

/** Hours someone is expected to work on a weekday (1-7), after unpaid breaks. Null on rest days and weekly schedules. */
export function plannedMinutes(schedule: WorkScheduleFields, weekday: number): number | null {
  if (!schedule.working_days.includes(weekday)) return null
  if (schedule.schedule_type === 'flexible') return schedule.daily_minutes
  if (schedule.schedule_type === 'weekly_flexible') return null
  const own = schedule.day_times?.[String(weekday)]
  const start = toClock(own?.start ?? schedule.start_time)
  const end = toClock(own?.end ?? schedule.end_time)
  if (!start || !end) return null
  return Math.max(spanMinutes(start, end) - unpaidBreakMinutes(schedule), 0)
}

export function weeklyPlannedMinutes(schedule: WorkScheduleFields): number | null {
  if (schedule.schedule_type === 'weekly_flexible') return schedule.weekly_minutes
  return schedule.working_days.reduce((sum, day) => sum + (plannedMinutes(schedule, day) ?? 0), 0)
}

export interface ScheduleSummary {
  type: string
  days: string
  hours: string
  weekly: string
  breaks: string
  overtime: string
}

const rate = (value: number | null) => `×${Number(value)}`

export function scheduleSummary(schedule: WorkScheduleFields): ScheduleSummary {
  const start = toClock(schedule.start_time) ?? '--:--'
  const end = toClock(schedule.end_time) ?? '--:--'
  let hours: string
  if (schedule.schedule_type === 'flexible') hours = `${formatMinutes(schedule.daily_minutes)} a day`
  else if (schedule.schedule_type === 'weekly_flexible') hours = `${formatMinutes(schedule.weekly_minutes)} a week`
  else {
    hours = `${start}–${end}`
    // HH:MM compares correctly as text; an end at or before the start finishes the next day.
    if (toClock(schedule.start_time) && toClock(schedule.end_time) && end <= start) hours += ' next day'
    const own = Object.keys(schedule.day_times ?? {}).map(Number).filter((day) => schedule.working_days.includes(day))
    if (own.length) hours += ` (${formatWorkingDays(own)} differ)`
  }

  const breaks = schedule.breaks ?? []
  const paid = breaks.filter((item) => item.paid).reduce((sum, item) => sum + item.minutes, 0)
  const unpaid = unpaidBreakMinutes(schedule)
  const breakParts = [
    unpaid ? `${formatMinutes(unpaid)} unpaid` : '',
    paid ? `${formatMinutes(paid)} paid` : '',
    schedule.auto_break_minutes
      ? `auto ${formatMinutes(schedule.auto_break_minutes)} after ${formatMinutes(schedule.auto_break_after_minutes)}`
      : '',
  ].filter(Boolean)

  const overtime = [
    schedule.overtime_daily_after_minutes
      ? `after ${formatMinutes(schedule.overtime_daily_after_minutes)} a day ${rate(schedule.overtime_daily_rate)}` : '',
    schedule.overtime_double_after_minutes
      ? `after ${formatMinutes(schedule.overtime_double_after_minutes)} ${rate(schedule.overtime_double_rate)}` : '',
    schedule.overtime_weekly_after_minutes
      ? `after ${formatMinutes(schedule.overtime_weekly_after_minutes)} a week ${rate(schedule.overtime_weekly_rate)}` : '',
    schedule.overtime_rest_day_rate ? `rest days ${rate(schedule.overtime_rest_day_rate)}` : '',
    schedule.overtime_holiday_rate ? `holidays ${rate(schedule.overtime_holiday_rate)}` : '',
  ].filter(Boolean)

  const weekly = weeklyPlannedMinutes(schedule)
  return {
    type: scheduleTypeLabel(schedule.schedule_type),
    days: formatWorkingDays(schedule.working_days),
    hours,
    weekly: weekly ? `${formatMinutes(weekly)} a week` : '—',
    breaks: breakParts.length ? breakParts.join(' · ') : 'None',
    overtime: overtime.length ? overtime.join(' · ') : 'None',
  }
}

// ---------------------------------------------------------------------------
// Form model: everything as typed text, converted and checked in one place.
// ---------------------------------------------------------------------------

export interface BreakForm {
  name: string
  minutes: string
  paid: boolean
  start: string
  end: string
}

export interface OvertimeRuleForm {
  enabled: boolean
  afterHours: string
  rate: string
}

export interface ScheduleForm {
  name: string
  type: ScheduleType
  start: string
  end: string
  days: number[]
  /** Fixed schedules: weekdays with their own hours. */
  dayTimes: Record<number, { start: string; end: string }>
  dailyHours: string
  weeklyHours: string
  breaks: BreakForm[]
  autoBreak: { enabled: boolean; minutes: string; afterHours: string }
  splitTime: string
  overtimeDaily: OvertimeRuleForm
  overtimeDouble: OvertimeRuleForm
  overtimeWeekly: OvertimeRuleForm
  restDayRate: string
  holidayRate: string
  isDefault: boolean
}

const offRule = (afterHours: string, rate: string): OvertimeRuleForm => ({ enabled: false, afterHours, rate })

export function emptyScheduleForm(): ScheduleForm {
  return {
    name: '',
    type: 'fixed',
    start: '09:00',
    end: '18:00',
    days: [1, 2, 3, 4, 5],
    dayTimes: {},
    dailyHours: '8',
    weeklyHours: '40',
    breaks: [],
    autoBreak: { enabled: false, minutes: '30', afterHours: '6' },
    splitTime: '00:00',
    overtimeDaily: offRule('9', '1.5'),
    overtimeDouble: offRule('12', '2'),
    overtimeWeekly: offRule('48', '1.5'),
    restDayRate: '',
    holidayRate: '',
    isDefault: false,
  }
}

const rateText = (value: number | null | undefined, fallback: string) => (value ? String(Number(value)) : fallback)

export function formFromSchedule(schedule: WorkScheduleFields): ScheduleForm {
  const empty = emptyScheduleForm()
  const rule = (after: number | null, value: number | null, fallback: OvertimeRuleForm): OvertimeRuleForm =>
    after ? { enabled: true, afterHours: hoursText(after), rate: rateText(value, fallback.rate) } : fallback
  const dayTimes: ScheduleForm['dayTimes'] = {}
  for (const [day, times] of Object.entries(schedule.day_times ?? {})) {
    dayTimes[Number(day)] = { start: toClock(times.start) ?? '', end: toClock(times.end) ?? '' }
  }
  return {
    name: schedule.name,
    type: schedule.schedule_type ?? 'fixed',
    start: toClock(schedule.start_time) ?? empty.start,
    end: toClock(schedule.end_time) ?? empty.end,
    days: [...(schedule.working_days ?? empty.days)],
    dayTimes,
    dailyHours: hoursText(schedule.daily_minutes) || empty.dailyHours,
    weeklyHours: hoursText(schedule.weekly_minutes) || empty.weeklyHours,
    breaks: (schedule.breaks ?? []).map((item) => ({
      name: item.name,
      minutes: String(item.minutes),
      paid: item.paid,
      start: item.start ?? '',
      end: item.end ?? '',
    })),
    autoBreak: schedule.auto_break_minutes
      ? { enabled: true, minutes: String(schedule.auto_break_minutes), afterHours: hoursText(schedule.auto_break_after_minutes) }
      : empty.autoBreak,
    splitTime: toClock(schedule.day_split_time) ?? empty.splitTime,
    overtimeDaily: rule(schedule.overtime_daily_after_minutes, schedule.overtime_daily_rate, empty.overtimeDaily),
    overtimeDouble: rule(schedule.overtime_double_after_minutes, schedule.overtime_double_rate, empty.overtimeDouble),
    overtimeWeekly: rule(schedule.overtime_weekly_after_minutes, schedule.overtime_weekly_rate, empty.overtimeWeekly),
    restDayRate: rateText(schedule.overtime_rest_day_rate, ''),
    holidayRate: rateText(schedule.overtime_holiday_rate, ''),
    isDefault: schedule.is_default,
  }
}

function parseRate(value: string): number | null {
  if (!/^\d(\.\d{1,2})?$/.test(value.trim())) return null
  const parsed = Number(value)
  return parsed >= 1 && parsed <= 5 ? parsed : null
}

export interface ScheduleFormResult {
  payload: WorkScheduleFields | null
  errors: string[]
}

export function validateScheduleForm(form: ScheduleForm): ScheduleFormResult {
  const errors: string[] = []
  const name = form.name.trim()
  if (!name) errors.push('Enter a schedule name.')

  const days = [...new Set(form.days)].filter((day) => day >= 1 && day <= 7).sort((a, b) => a - b)
  if (!days.length) errors.push('Choose at least one working day.')

  const start = toClock(form.start)
  const end = toClock(form.end)
  const hoursLabel = form.type === 'fixed' ? 'Start and end times' : 'Usual hours'
  if (!start || !end) errors.push(`${hoursLabel} must be times such as 09:00.`)
  else if (start === end) errors.push(`${hoursLabel} must be different.`)

  let daily_minutes: number | null = null
  let weekly_minutes: number | null = null
  if (form.type === 'flexible') {
    daily_minutes = parseHours(form.dailyHours)
    if (!daily_minutes || daily_minutes > 24 * 60) errors.push('Hours per day must be between 0 and 24, for example 8 or 7.5.')
  } else if (form.type === 'weekly_flexible') {
    weekly_minutes = parseHours(form.weeklyHours)
    if (!weekly_minutes || weekly_minutes > 7 * 24 * 60) errors.push('Hours per week must be between 0 and 168, for example 40.')
  }

  const day_times: DayTimes = {}
  if (form.type === 'fixed') {
    for (const day of days) {
      const own = form.dayTimes[day]
      if (!own) continue
      const ownStart = toClock(own.start)
      const ownEnd = toClock(own.end)
      const label = WEEKDAYS[day - 1].long
      if (!ownStart || !ownEnd) errors.push(`${label} needs a start and end time.`)
      else if (ownStart === ownEnd) errors.push(`${label} start and end times must be different.`)
      else day_times[String(day)] = { start: ownStart, end: ownEnd }
    }
  }

  if (form.breaks.length > MAX_BREAKS) errors.push(`A schedule can have up to ${MAX_BREAKS} breaks.`)
  const breaks: ScheduleBreak[] = []
  form.breaks.forEach((item, index) => {
    const label = item.name.trim() || `Break ${index + 1}`
    const minutes = /^\d{1,3}$/.test(item.minutes.trim()) ? Number(item.minutes) : NaN
    const problems: string[] = []
    if (!item.name.trim()) problems.push('a name')
    else if (item.name.trim().length > 40) problems.push('a name of up to 40 characters')
    if (!(minutes >= 1 && minutes <= 240)) problems.push('a length of 1 to 240 minutes')
    const breakStart = item.start.trim() ? toClock(item.start) : null
    const breakEnd = item.end.trim() ? toClock(item.end) : null
    const hasWindow = Boolean(item.start.trim() || item.end.trim())
    if (hasWindow && (!breakStart || !breakEnd || breakStart === breakEnd)) problems.push('both window times, different from each other, or neither')
    if (problems.length) {
      errors.push(`${label} needs ${problems.join(' and ')}.`)
      return
    }
    breaks.push({
      name: item.name.trim(),
      minutes,
      paid: item.paid,
      ...(hasWindow ? { start: breakStart!, end: breakEnd! } : {}),
    })
  })

  let auto_break_minutes: number | null = null
  let auto_break_after_minutes: number | null = null
  if (form.autoBreak.enabled) {
    auto_break_minutes = /^\d{1,3}$/.test(form.autoBreak.minutes.trim()) ? Number(form.autoBreak.minutes) : null
    auto_break_after_minutes = parseHours(form.autoBreak.afterHours)
    if (!auto_break_minutes || auto_break_minutes > 240) errors.push('The automatic break must be 1 to 240 minutes.')
    if (!auto_break_after_minutes || auto_break_after_minutes > 24 * 60) errors.push('The automatic break needs a threshold of up to 24 hours.')
  }

  const splitTime = toClock(form.splitTime)
  if (!splitTime) errors.push('The day split time must be a time such as 00:00.')

  const overtimeRule = (rule: OvertimeRuleForm, label: string, maxMinutes: number) => {
    if (!rule.enabled) return { after: null, rate: null }
    const after = parseHours(rule.afterHours)
    const value = parseRate(rule.rate)
    if (!after || after > maxMinutes) errors.push(`${label} needs a threshold of up to ${maxMinutes / 60} hours.`)
    if (value === null) errors.push(`${label} needs a pay multiplier between 1 and 5, such as 1.5.`)
    return { after, rate: value }
  }
  const dailyRule = overtimeRule(form.overtimeDaily, 'Daily overtime', 24 * 60)
  const doubleRule = overtimeRule(form.overtimeDouble, 'Daily double overtime', 24 * 60)
  const weeklyRule = overtimeRule(form.overtimeWeekly, 'Weekly overtime', 7 * 24 * 60)
  if (form.overtimeDouble.enabled) {
    if (!form.overtimeDaily.enabled) errors.push('Daily double overtime needs daily overtime turned on.')
    else if (dailyRule.after && doubleRule.after && doubleRule.after <= dailyRule.after) {
      errors.push('Daily double overtime must start after daily overtime.')
    } else if (dailyRule.rate && doubleRule.rate && doubleRule.rate < dailyRule.rate) {
      errors.push('The double overtime multiplier cannot be lower than the daily one.')
    }
  }
  const optionalRate = (value: string, label: string) => {
    if (!value.trim()) return null
    const parsed = parseRate(value)
    if (parsed === null) errors.push(`${label} must be a multiplier between 1 and 5, or empty.`)
    return parsed
  }
  const overtime_rest_day_rate = optionalRate(form.restDayRate, 'The rest-day rate')
  const overtime_holiday_rate = optionalRate(form.holidayRate, 'The public holiday rate')

  if (errors.length) return { payload: null, errors }

  const payload: WorkScheduleFields = {
    name,
    schedule_type: form.type,
    start_time: start!,
    end_time: end!,
    working_days: days,
    day_times,
    daily_minutes,
    weekly_minutes,
    breaks,
    auto_break_minutes,
    auto_break_after_minutes,
    day_split_time: splitTime!,
    overtime_daily_after_minutes: dailyRule.after,
    overtime_daily_rate: dailyRule.rate,
    overtime_double_after_minutes: doubleRule.after,
    overtime_double_rate: doubleRule.rate,
    overtime_weekly_after_minutes: weeklyRule.after,
    overtime_weekly_rate: weeklyRule.rate,
    overtime_rest_day_rate,
    overtime_holiday_rate,
    is_default: form.isDefault,
  }

  if (form.type === 'fixed') {
    const shortest = Math.min(...days.map((day) => plannedMinutes({ ...payload, breaks: [] }, day) ?? Infinity))
    const unpaid = unpaidBreakMinutes(payload)
    if (unpaid && unpaid >= shortest) errors.push('Unpaid breaks must be shorter than every working day.')
  }
  return errors.length ? { payload: null, errors } : { payload, errors }
}

// ---------------------------------------------------------------------------
// Which schedule and holiday calendar apply: employee, then department, then the default.
// The database applies the same order in work_rules_for_employee().
// ---------------------------------------------------------------------------

interface WithId {
  id: string
}

export interface Resolved<T> {
  value: T
  source: RuleSource
}

export function resolveRule<T extends WithId>(
  own: string | null | undefined,
  fromDepartment: string | null | undefined,
  records: readonly (T & { is_default?: boolean })[],
): Resolved<T> | null {
  const find = (id: string | null | undefined) => (id ? records.find((record) => record.id === id) : undefined)
  const employee = find(own)
  if (employee) return { value: employee, source: 'employee' }
  const department = find(fromDepartment)
  if (department) return { value: department, source: 'department' }
  const fallback = records.find((record) => record.is_default)
  return fallback ? { value: fallback, source: 'organization' } : null
}

export const RULE_SOURCE_LABELS: Record<RuleSource, string> = {
  employee: 'Set on the employee',
  department: 'From the department',
  organization: 'Organization default',
}
