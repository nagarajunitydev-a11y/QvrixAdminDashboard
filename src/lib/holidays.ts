import { normalizeDate } from './employeeImport'

/**
 * Holiday list rules for the Holidays screen: parse a pasted list and check it against the calendar
 * it goes into. The database keeps one holiday per calendar and date.
 */

export interface HolidayInput {
  date: string
  name: string
}

export interface HolidayLineProblem {
  line: number
  text: string
  message: string
}

export interface HolidayListPreview {
  holidays: HolidayInput[]
  problems: HolidayLineProblem[]
}

export const MAX_HOLIDAY_LINES = 200
export const MAX_HOLIDAY_NAME = 80

/**
 * One holiday per line: a date (YYYY-MM-DD or DD/MM/YYYY), then the name, separated by a comma, a tab
 * or spaces. Text pasted from a spreadsheet works as it is. Lines already in the calendar, repeated
 * in the list, or unreadable are reported and left out.
 */
export function parseHolidayList(text: string, existingDates: ReadonlySet<string>): HolidayListPreview {
  const holidays: HolidayInput[] = []
  const problems: HolidayLineProblem[] = []
  const seen = new Set<string>()
  const lines = text.split(/\r?\n/)
  lines.forEach((raw, index) => {
    const line = raw.trim()
    if (!line) return
    const report = (message: string) => problems.push({ line: index + 1, text: line, message })
    if (holidays.length + problems.length >= MAX_HOLIDAY_LINES) {
      report(`Only the first ${MAX_HOLIDAY_LINES} lines are read.`)
      return
    }
    const match = /^(\S+?)(?:\s*[,\t;]\s*|\s+)(.+)$/.exec(line)
    const date = match ? normalizeDate(match[1]) : null
    if (!match || !date) {
      report('Start the line with a date, such as 2026-01-26 or 26/01/2026, then the holiday name.')
      return
    }
    const name = match[2].replace(/^["']|["']$/g, '').replace(/\s+/g, ' ').trim()
    if (!name) report('Add the holiday name after the date.')
    else if (name.length > MAX_HOLIDAY_NAME) report(`Holiday names can be up to ${MAX_HOLIDAY_NAME} characters.`)
    else if (existingDates.has(date)) report('This calendar already has a holiday on that date.')
    else if (seen.has(date)) report('This date appears more than once in the list.')
    else {
      seen.add(date)
      holidays.push({ date, name })
    }
  })
  holidays.sort((a, b) => a.date.localeCompare(b.date))
  return { holidays, problems }
}

/**
 * India's three national holidays, which fall on the same date every year. Festival and state holidays
 * move with the calendar each year, so they are added from the organization's official list instead.
 */
export function indiaNationalHolidays(year: number): HolidayInput[] {
  return [
    { date: `${year}-01-26`, name: 'Republic Day' },
    { date: `${year}-08-15`, name: 'Independence Day' },
    { date: `${year}-10-02`, name: 'Gandhi Jayanti' },
  ]
}

const WEEKDAY = new Intl.DateTimeFormat('en-IN', { weekday: 'short', timeZone: 'UTC' })
const LONG_DATE = new Intl.DateTimeFormat('en-IN', { day: 'numeric', month: 'short', year: 'numeric', timeZone: 'UTC' })

/** "2026-01-26" -> { weekday: "Mon", date: "26 Jan 2026" }, read as a calendar date with no time zone shift. */
export function formatHolidayDate(date: string): { weekday: string; date: string } {
  const value = new Date(`${date}T00:00:00Z`)
  if (Number.isNaN(value.getTime())) return { weekday: '', date }
  return { weekday: WEEKDAY.format(value), date: LONG_DATE.format(value) }
}

/** ISO weekday (1 = Monday ... 7 = Sunday) of a calendar date. */
export function isoWeekday(date: string): number {
  const day = new Date(`${date}T00:00:00Z`).getUTCDay()
  return day === 0 ? 7 : day
}
