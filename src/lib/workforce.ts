import type { EmployeeSite, LocationLog, PresenceSession, Site } from '../types'
import { haversineMeters } from './geo'

export type PresenceSessionWithHeartbeat = PresenceSession & { last_heartbeat?: number | null }
type EmployeeIdentity = { id: string; user_id: string | null; is_active: boolean }
type SessionWithHeartbeat = Pick<PresenceSessionWithHeartbeat,
  'user_id' | 'entry_timestamp' | 'exit_timestamp' | 'last_heartbeat'>

// A current device fix is also a heartbeat. Historical/offline uploads do not
// become live merely because they were received by Supabase recently.
export const SESSION_FRESHNESS_MS = 15 * 60 * 1000
export const LOCATION_FRESHNESS_MS = SESSION_FRESHNESS_MS
export type SessionStatus = 'online' | 'stale' | 'checked-out' | 'offline'
export type TrackStatus = 'on-site' | 'outside' | 'recent' | 'offline' | 'checked-out'

export function isLocationFresh(timestamp: number | null | undefined, now = Date.now()): boolean {
  return typeof timestamp === 'number' && Number.isFinite(timestamp) &&
    timestamp > 0 && timestamp <= now && now - timestamp <= LOCATION_FRESHNESS_MS
}

export function hasValidCoordinates(latitude: number, longitude: number): boolean {
  return Number.isFinite(latitude) && Number.isFinite(longitude) &&
    Math.abs(latitude) <= 90 && Math.abs(longitude) <= 180 &&
    !(latitude === 0 && longitude === 0)
}

export function getSessionStatus(session: SessionWithHeartbeat | null | undefined, now = Date.now()): SessionStatus {
  if (!session) return 'offline'
  if (session.exit_timestamp !== null) return 'checked-out'
  return isLocationFresh(session.last_heartbeat ?? session.entry_timestamp, now) ? 'online' : 'stale'
}

export function getActiveUserIds(sessions: Pick<PresenceSession, 'user_id'>[]): Set<string> {
  return new Set(sessions.map((session) => session.user_id).filter((id): id is string => id !== null))
}

export function getLatestSessionByUser<T extends SessionWithHeartbeat>(sessions: T[]): Map<string, T> {
  const latest = new Map<string, T>()
  for (const session of sessions) {
    if (!session.user_id) continue
    const current = latest.get(session.user_id)
    if (!current || session.entry_timestamp > current.entry_timestamp ||
      (session.entry_timestamp === current.entry_timestamp && session.exit_timestamp !== null)) {
      latest.set(session.user_id, session)
    }
  }
  return latest
}

export function getOnlineUserIds(sessions: SessionWithHeartbeat[]): Set<string> {
  return new Set([...getLatestSessionByUser(sessions)]
    .filter(([, session]) => getSessionStatus(session) === 'online').map(([id]) => id))
}

export function getCheckedOutUserIds(sessions: SessionWithHeartbeat[]): Set<string> {
  return new Set([...getLatestSessionByUser(sessions)]
    .filter(([, session]) => session.exit_timestamp !== null).map(([id]) => id))
}

export function getLatestLocationByUser(locations: LocationLog[]): Map<string, LocationLog> {
  const latest = new Map<string, LocationLog>()
  for (const location of locations) {
    const current = latest.get(location.user_id)
    if (!current || location.timestamp > current.timestamp ||
      (location.timestamp === current.timestamp && location.id > current.id)) {
      latest.set(location.user_id, location)
    }
  }
  return latest
}

export interface TrackingState {
  status: TrackStatus
  latest: LocationLog | null
  session: PresenceSessionWithHeartbeat | null
  site: Site | null
  distanceToSite: number | null
}

export function classifyTracking(
  latest: LocationLog | null,
  session: PresenceSessionWithHeartbeat | null,
  assignedSites: Site[],
  now = Date.now(),
): TrackingState {
  const state: TrackingState = { status: 'offline', latest, session, site: null, distanceToSite: null }
  // A residual GPS fix must never override an explicit end of shift.
  if (session?.exit_timestamp != null) return { ...state, status: 'checked-out' }
  if (!latest || !isLocationFresh(latest.timestamp, now) ||
    !hasValidCoordinates(latest.latitude, latest.longitude) ||
    !Number.isFinite(latest.accuracy) || latest.accuracy < 0) return state

  // No confirmed shift, or a fix from the previous shift: no outside claim.
  if (!session || !Number.isFinite(session.entry_timestamp) || session.entry_timestamp <= 0 ||
    latest.timestamp < session.entry_timestamp) return { ...state, status: 'recent' }

  // The active shift determines which assigned geofence applies. Do not trust
  // a historical log's site_id, is_inside flag or cached distance after edits.
  const site = assignedSites.find((site) => site.id === session.site_id)
  if (!site || !hasValidCoordinates(site.latitude, site.longitude) ||
    !Number.isFinite(site.radius_in_meters) || site.radius_in_meters <= 0) {
    return { ...state, status: 'recent' }
  }
  const distanceToSite = haversineMeters(
    { lat: latest.latitude, lng: latest.longitude },
    { lat: site.latitude, lng: site.longitude },
  )
  // If the GPS accuracy circle overlaps the boundary, outside is unconfirmed.
  const status = distanceToSite <= site.radius_in_meters ? 'on-site'
    : distanceToSite - latest.accuracy > site.radius_in_meters ? 'outside' : 'recent'
  return { ...state, status, site, distanceToSite }
}

export interface WorkforceCounts {
  totalEmployees: number
  activeUserIds: Set<string>
  checkedOutUserIds: Set<string>
  insideCount: number
  outsideCount: number
  offlineCount: number
  percentInside: number
  employeeStates: Map<string, TrackingState>
}

export function deriveWorkforceCounts(
  employees: EmployeeIdentity[],
  sessions: PresenceSessionWithHeartbeat[],
  locations: LocationLog[],
  sites: Site[],
  assignments: Pick<EmployeeSite, 'employee_id' | 'site_id'>[],
  now = Date.now(),
): WorkforceCounts {
  const latestSessions = getLatestSessionByUser(sessions)
  const latestLocations = getLatestLocationByUser(locations)
  const siteById = new Map(sites.map((site) => [site.id, site]))
  const assignedByEmployee = new Map<string, Site[]>()
  for (const assignment of assignments) {
    const site = siteById.get(assignment.site_id)
    if (!site) continue
    const assigned = assignedByEmployee.get(assignment.employee_id) ?? []
    assigned.push(site)
    assignedByEmployee.set(assignment.employee_id, assigned)
  }
  const employeeStates = new Map<string, TrackingState>()
  const activeUserIds = new Set<string>()
  const outsideUserIds = new Set<string>()
  const checkedOutUserIds = new Set<string>()
  for (const employee of employees) {
    const latest = employee.user_id ? latestLocations.get(employee.user_id) ?? null : null
    const session = employee.user_id ? latestSessions.get(employee.user_id) ?? null : null
    const state = employee.is_active && employee.user_id
      ? classifyTracking(latest, session, assignedByEmployee.get(employee.id) ?? [], now)
      : { status: 'offline' as const, latest, session, site: null, distanceToSite: null }
    employeeStates.set(employee.id, state)
    if (!employee.user_id) continue
    if (state.status === 'on-site') activeUserIds.add(employee.user_id)
    if (state.status === 'outside') outsideUserIds.add(employee.user_id)
    if (state.status === 'checked-out') checkedOutUserIds.add(employee.user_id)
  }
  const totalEmployees = employees.length
  const insideCount = activeUserIds.size
  return {
    totalEmployees,
    activeUserIds,
    checkedOutUserIds,
    insideCount,
    outsideCount: outsideUserIds.size,
    offlineCount: employees.filter((employee) => !employee.user_id).length,
    percentInside: totalEmployees > 0 ? Math.round((insideCount / totalEmployees) * 100) : 0,
    employeeStates,
  }
}
