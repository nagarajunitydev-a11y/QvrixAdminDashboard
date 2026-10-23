import { formatInTimeZone, fromZonedTime } from 'date-fns-tz'

export function organizationDay(
  date: Date | number | string,
  timezone: string,
) {
  return formatInTimeZone(date, timezone, 'yyyy-MM-dd')
}
export function offsetDay(day: string, offset: number) {
  const date = new Date(`${day}T12:00:00Z`)
  date.setUTCDate(date.getUTCDate() + offset)
  return date.toISOString().slice(0, 10)
}
export function dayBoundary(day: string, timezone: string) {
  return fromZonedTime(`${day}T00:00:00`, timezone).toISOString()
}
export function dayEnd(day: string, timezone: string) {
  return new Date(
    new Date(dayBoundary(offsetDay(day, 1), timezone)).getTime() - 1,
  ).toISOString()
}
