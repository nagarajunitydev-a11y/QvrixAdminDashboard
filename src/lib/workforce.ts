import type { PresenceSession } from '@/types'

// Extended session type with optional last_heartbeat (added by migration)
type PresenceSessionWithHeartbeat = PresenceSession & {
  last_heartbeat?: number | null
}

type EmployeeIdentity = {
  user_id: string | null
}

// Session freshness timeout: 15 minutes (900000 ms)
const SESSION_FRESHNESS_MS = 15 * 60 * 1000
const LOCATION_FRESHNESS_MS = 60 * 60 * 1000 // 1 hour

type SessionWithHeartbeat = {
  user_id: string | null
  entry_timestamp: number
  exit_timestamp: number | null
  last_heartbeat?: number | null
}

type SessionStatus = 'online' | 'stale' | 'checked-out' | 'offline'

function isLocationFresh(timestamp: number | null | undefined): boolean {
  if (!timestamp) return false
  return Date.now() - timestamp <= LOCATION_FRESHNESS_MS
}

export function getSessionStatus(session: SessionWithHeartbeat | null | undefined): SessionStatus {
  if (!session) return 'offline'
  if (session.exit_timestamp !== null) return 'checked-out'
  const heartbeat = session.last_heartbeat ?? session.entry_timestamp
  return Date.now() - heartbeat <= SESSION_FRESHNESS_MS ? 'online' : 'stale'
}

export function getActiveUserIds(
  sessions: Pick<PresenceSession, 'user_id'>[]
): Set<string> {
  return new Set(
    sessions.map((session) => session.user_id).filter((id): id is string => id !== null)
  )
}

export function getOnlineUserIds(
  sessions: SessionWithHeartbeat[]
): Set<string> {
  const now = Date.now()
  return new Set(
    sessions
      .filter((s) => s.exit_timestamp === null && (s.last_heartbeat ?? s.entry_timestamp) > now - SESSION_FRESHNESS_MS)
      .map((s) => s.user_id)
      .filter((id): id is string => id !== null)
  )
}

export function getCheckedOutUserIds(
  sessions: SessionWithHeartbeat[]
): Set<string> {
  return new Set(
    sessions
      .filter((s) => s.exit_timestamp !== null)
      .map((s) => s.user_id)
      .filter((id): id is string => id !== null)
  )
}

export function getLatestSessionByUser(
  sessions: PresenceSessionWithHeartbeat[]
): Map<string, PresenceSessionWithHeartbeat> {
  const latest = new Map<string, PresenceSessionWithHeartbeat>()
  sessions.forEach((session) => {
    const current = latest.get(session.user_id)
    if (!current || session.entry_timestamp > current.entry_timestamp) {
      latest.set(session.user_id, session)
    }
  })
  return latest
}

export interface WorkforceCounts {
  totalEmployees: number
  activeUserIds: Set<string>
  checkedOutUserIds: Set<string>
  insideCount: number
  outsideCount: number
  offlineCount: number
  percentInside: number
}

export function deriveWorkforceCounts(
  employees: EmployeeIdentity[],
  sessions: SessionWithHeartbeat[]
): WorkforceCounts {
  const totalEmployees = employees.length
  const onlineUserIds = getOnlineUserIds(sessions)
  const checkedOutUserIds = getCheckedOutUserIds(sessions)
  const insideCount = onlineUserIds.size
  // Trackable = employees with linked device (user_id not null)
  const trackable = employees.filter((employee) => employee.user_id !== null)
  // Outside = trackable employees with recent location showing outside (handled by DB view)
  // For now, compute as trackable - online - checked-out - offline (no device)
  // This is a fallback; the accurate count comes from employees_outside_site view
  const outsideCount = trackable.filter(
    (employee) => employee.user_id !== null && 
                  !onlineUserIds.has(employee.user_id) && 
                  !checkedOutUserIds.has(employee.user_id)
  ).length
  const offlineCount = totalEmployees - trackable.length
  const percentInside = totalEmployees > 0 ? Math.round((insideCount / totalEmployees) * 100) : 0

  return {
    totalEmployees,
    activeUserIds: onlineUserIds,
    checkedOutUserIds,
    insideCount,
    outsideCount,
    offlineCount,
    percentInside,
  }
}

// Export for use in components
export { isLocationFresh, SESSION_FRESHNESS_MS, LOCATION_FRESHNESS_MS }
export type { SessionStatus }
