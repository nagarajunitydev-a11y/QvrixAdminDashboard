import type { LocationLog, PresenceSession } from '../types'

export type ActivitySession = Pick<PresenceSession, 'id' | 'user_id' | 'site_id' | 'entry_timestamp' | 'exit_timestamp'>
export type ActivityLocation = Pick<LocationLog, 'id' | 'user_id' | 'site_id' | 'timestamp' | 'is_inside'>
export interface ActivityEvent {
  id: string
  user_id: string
  site_id: string
  timestamp: number
  status: 'Entry' | 'Exit' | 'Checked Out'
}

export function recentActivityEvents(
  sessions: ActivitySession[], locations: ActivityLocation[], limit = 5, now = Date.now(),
): ActivityEvent[] {
  const validTime = (time: number | null): time is number =>
    typeof time === 'number' && Number.isFinite(time) && time > 0 && time <= now
  const sessionById = new Map<number, ActivitySession>()
  for (const session of sessions) {
    // A completed session wins when two concurrent reads saw the same row.
    const previous = sessionById.get(session.id)
    if (!previous || previous.exit_timestamp === null || session.exit_timestamp !== null) {
      sessionById.set(session.id, session)
    }
  }
  const sessionsByUser = new Map<string, ActivitySession[]>()
  const events = new Map<string, ActivityEvent>()
  const add = (event: ActivityEvent) => {
    const key = JSON.stringify([event.user_id, event.site_id, event.timestamp, event.status])
    if (!events.has(key)) events.set(key, event)
  }
  for (const session of sessionById.values()) {
    if (!validTime(session.entry_timestamp)) continue
    const history = sessionsByUser.get(session.user_id) ?? []
    history.push(session)
    sessionsByUser.set(session.user_id, history)
    add({ id: `session:${session.id}:entry`, user_id: session.user_id, site_id: session.site_id,
      timestamp: session.entry_timestamp, status: 'Entry' })
    if (validTime(session.exit_timestamp) && session.exit_timestamp >= session.entry_timestamp) {
      add({ id: `session:${session.id}:checkout`, user_id: session.user_id, site_id: session.site_id,
        timestamp: session.exit_timestamp, status: 'Checked Out' })
    }
  }
  for (const history of sessionsByUser.values()) history.sort((a, b) => b.entry_timestamp - a.entry_timestamp || b.id - a.id)

  const previousBySite = new Map<string, ActivityLocation>()
  for (const location of [...locations].sort((a, b) => a.timestamp - b.timestamp || a.id - b.id)) {
    if (!location.site_id || !validTime(location.timestamp) || typeof location.is_inside !== 'boolean') continue
    const key = JSON.stringify([location.user_id, location.site_id])
    const previous = previousBySite.get(key)
    previousBySite.set(key, location)
    if (!previous || previous.is_inside === location.is_inside) continue
    const session = sessionsByUser.get(location.user_id)?.find((item) => item.entry_timestamp <= location.timestamp)
    // Residual GPS after checkout is not a new entry/exit. A new shift must
    // establish its own location history before asserting a fence crossing.
    if (session && (
      (validTime(session.exit_timestamp) && location.timestamp >= session.exit_timestamp) ||
      previous.timestamp < session.entry_timestamp
    )) continue
    add({ id: `location:${location.id}`, user_id: location.user_id, site_id: location.site_id,
      timestamp: location.timestamp, status: location.is_inside ? 'Entry' : 'Exit' })
  }
  const statusOrder = { 'Checked Out': 0, Exit: 1, Entry: 2 }
  return [...events.values()].sort((a, b) => b.timestamp - a.timestamp ||
    statusOrder[a.status] - statusOrder[b.status] || a.id.localeCompare(b.id)).slice(0, Math.max(0, limit))
}
