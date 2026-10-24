import { useEffect, useMemo, useRef, useState } from 'react'
import { Link } from 'react-router-dom'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import {
  fetchActivePresenceSessions,
  fetchEmployees,
  fetchLocationLogs,
  fetchSites,
  type EmployeeWithRelations,
} from '@/api/services'
import type { LocationLog, PresenceSession } from '@/types'
import { PageHeader } from '@/components/ui/page-header'
import { StatCard } from '@/components/ui/stat-card'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { ErrorState, PageSkeleton } from '@/components/ui/states'
import { MapCanvas, type MapCircle, type MapMarker } from '@/components/map/MapCanvas'
import { centroidOf, formatRadius, type LatLng } from '@/lib/geo'
import { initialsFromName, isRecent, timeAgo } from '@/lib/format'
import {
  deriveWorkforceCounts,
  getLatestSessionByUser,
  isLocationFresh,
  getSessionStatus,
} from '@/lib/workforce'
import {
  Activity,
  ArrowRight,
  Clock3,
  Crosshair,
  History,
  MapPin,
  Radar,
  RefreshCw,
  Search,
  ShieldAlert,
  UserRound,
  Users,
  WifiOff,
} from 'lucide-react'
import { cn } from '@/lib/utils'

const DEFAULT_CENTER: LatLng = { lat: 20.5937, lng: 78.9629 }

type TrackStatus = 'on-site' | 'outside' | 'recent' | 'offline' | 'checked-out'

type TrackedMember = {
  id: string
  employee: EmployeeWithRelations | null
  name: string
  email: string
  latest: LocationLog | null
  session: PresenceSession | null
  status: TrackStatus
  position: LatLng | null
}

const statusMeta: Record<
  TrackStatus,
  { label: string; badge: 'success' | 'destructive' | 'info' | 'secondary' | 'warning'; dot: boolean }
> = {
  'on-site': { label: 'On site', badge: 'success', dot: true },
  outside: { label: 'Outside fence', badge: 'destructive', dot: true },
  recent: { label: 'Recently seen', badge: 'info', dot: false },
  offline: { label: 'No signal', badge: 'secondary', dot: false },
  'checked-out': { label: 'Checked Out', badge: 'warning', dot: false },
}

const statusOrder: Record<TrackStatus, number> = {
  'on-site': 0,
  outside: 1,
  recent: 2,
  'checked-out': 3,
  offline: 4,
}

function positionOf(
  latest: LocationLog | null,
  session: PresenceSession | null,
  siteById: Map<string, { latitude: number; longitude: number }>
): LatLng | null {
  if (latest) return { lat: latest.latitude, lng: latest.longitude }
  const site = session ? siteById.get(session.site_id) : null
  return site ? { lat: site.latitude, lng: site.longitude } : null
}

export function LiveTrackingPage() {
  const queryClient = useQueryClient()
  const [filter, setFilter] = useState<'all' | 'on-site' | 'outside' | 'checked-out' | 'no-signal'>('all')
  const [search, setSearch] = useState('')
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const [mapCenter, setMapCenter] = useState<LatLng>(DEFAULT_CENTER)
  const centeredRef = useRef(false)

  const employeesQuery = useQuery({ queryKey: ['employees'], queryFn: fetchEmployees })
  const sitesQuery = useQuery({ queryKey: ['sites'], queryFn: fetchSites })
  const sessionsQuery = useQuery({
    queryKey: ['active-presence-sessions'],
    queryFn: fetchActivePresenceSessions,
    refetchInterval: 15_000,
  })
  const logsQuery = useQuery({
    queryKey: ['live-location-logs'],
    queryFn: () => fetchLocationLogs({ limit: 300 }),
    refetchInterval: 15_000,
  })

  const employees = employeesQuery.data ?? []
  const sites = sitesQuery.data ?? []
  const sessions = sessionsQuery.data ?? []
  const logs = logsQuery.data ?? []

  const latestByUser = useMemo(() => {
    const map = new Map<string, LocationLog>()
    logs.forEach((log) => {
      if (!map.has(log.user_id)) map.set(log.user_id, log)
    })
    return map
  }, [logs])

  const sessionByUser = useMemo(() => getLatestSessionByUser(sessions), [sessions])

  const siteById = useMemo(
    () => new Map(sites.map((site) => [site.id, site])),
    [sites]
  )

  const tracked = useMemo<TrackedMember[]>(() => {
    const linkedUserIds = new Set(
      employees
        .map((employee) => employee.user_id)
        .filter((userId): userId is string => userId !== null)
    )

    const employeeRows = employees.map((employee): TrackedMember => {
      const latest = employee.user_id ? latestByUser.get(employee.user_id) ?? null : null
      const session = employee.user_id ? sessionByUser.get(employee.user_id) ?? null : null
      let status: TrackStatus = 'offline'
      if (employee.user_id) {
        const sessionStatus = getSessionStatus(session)
        if (sessionStatus === 'online') status = 'on-site'
        else if (sessionStatus === 'checked-out') status = 'checked-out'
        else if (latest && isLocationFresh(latest.timestamp)) {
          status = latest.is_inside ? 'recent' : 'outside'
        } else if (sessionStatus === 'stale') {
          status = 'outside'
        } else {
          status = 'offline'
        }
      }
      return {
        id: employee.id,
        employee,
        name: `${employee.first_name} ${employee.last_name}`.trim(),
        email: employee.email,
        latest,
        session,
        status,
        position: positionOf(latest, session, siteById),
      }
    })

    // Get all sessions for unlinked devices
    const allSessionUserIds = new Set(
      sessions
        .map((s) => s.user_id)
        .filter((id): id is string => id !== null)
    )
    const unlinkedSessionUserIds = [...allSessionUserIds].filter((userId) => !linkedUserIds.has(userId))

    const deviceRows = unlinkedSessionUserIds
      .map((userId): TrackedMember => {
        const latest = latestByUser.get(userId) ?? null
        const session = sessionByUser.get(userId) ?? null
        let status: TrackStatus = 'offline'
        const sessionStatus = getSessionStatus(session)
        if (sessionStatus === 'online') status = 'on-site'
        else if (sessionStatus === 'checked-out') status = 'checked-out'
        else if (latest && isLocationFresh(latest.timestamp)) {
          status = latest.is_inside ? 'recent' : 'outside'
        } else if (sessionStatus === 'stale') {
          status = 'outside'
        } else {
          status = 'offline'
        }
        return {
          id: `session:${userId}`,
          employee: null,
          name: `Unlinked device ${userId.slice(0, 8)}`,
          email: '',
          latest,
          session,
          status,
          position: positionOf(latest, session, siteById),
        }
      })
      // Only show devices that have some recent activity
      .filter((row) => row.status !== 'offline')

    return [...employeeRows, ...deviceRows]
  }, [employees, latestByUser, sessionByUser, sessions, siteById])

  const stats = useMemo(() => {
    const counts = deriveWorkforceCounts(employees, sessions)
    return {
      onSite: counts.insideCount,
      outside: counts.outsideCount,
      checkedOut: counts.checkedOutUserIds.size,
      noDevice: counts.offlineCount,
      unlinkedActive: tracked.filter((row) => !row.employee).length,
    }
  }, [employees, sessions, tracked])

  const visible = useMemo(() => {
    const query = search.trim().toLowerCase()
    return tracked
      .filter((row) => {
        if (filter === 'no-signal') return row.status === 'offline'
        if (filter === 'outside') {
          return row.status === 'outside' || row.status === 'recent'
        }
        if (filter === 'checked-out') {
          return row.status === 'checked-out'
        }
        if (filter !== 'all' && row.status !== filter) return false
        return true
      })
      .filter((row) => {
        if (!query) return true
        return `${row.name} ${row.email}`.toLowerCase().includes(query)
      })
      .sort(
        (a, b) =>
          statusOrder[a.status] - statusOrder[b.status] || a.name.localeCompare(b.name)
      )
  }, [filter, search, tracked])

  const selected = useMemo(
    () => tracked.find((row) => row.id === selectedId) ?? null,
    [selectedId, tracked]
  )

  useEffect(() => {
    if (centeredRef.current || sites.length === 0) return
    centeredRef.current = true
    const center =
      centroidOf(
        sites.map((site) => ({ lat: site.latitude, lng: site.longitude }))
      ) ?? DEFAULT_CENTER
    setMapCenter(center)
  }, [sites])

  const markers = useMemo<MapMarker[]>(() => {
    return tracked
      .filter((row) => row.position)
      .map((row) => {
        const isSelected = row.id === selectedId
        return {
          id: row.id,
          position: row.position as LatLng,
          label: row.name,
          sublabel: statusMeta[row.status].label,
          tone: isSelected
            ? 'selected'
            : row.status === 'outside'
              ? 'danger'
              : row.status === 'offline' || row.status === 'recent'
                ? 'muted'
                : 'primary',
          onClick: () => {
            setSelectedId(row.id)
            if (row.position) setMapCenter(row.position)
          },
        }
      })
  }, [selectedId, tracked])

  const circles = useMemo<MapCircle[]>(
    () =>
      sites.map((site) => ({
        id: site.id,
        center: { lat: site.latitude, lng: site.longitude },
        radiusMeters: site.radius_in_meters,
        tone: 'muted',
      })),
    [sites]
  )

  const isLoading =
    employeesQuery.isLoading ||
    sitesQuery.isLoading ||
    sessionsQuery.isLoading ||
    logsQuery.isLoading
  const isError =
    employeesQuery.isError || sitesQuery.isError || sessionsQuery.isError || logsQuery.isError
  const isFetching =
    employeesQuery.isFetching ||
    sitesQuery.isFetching ||
    sessionsQuery.isFetching ||
    logsQuery.isFetching

  const refresh = () => {
    queryClient.invalidateQueries({ queryKey: ['live-location-logs'] })
    queryClient.invalidateQueries({ queryKey: ['active-presence-sessions'] })
    queryClient.invalidateQueries({ queryKey: ['sites'] })
    queryClient.invalidateQueries({ queryKey: ['employees'] })
  }

  if (isLoading) return <PageSkeleton cards={4} rows={6} />

  if (isError) {
    return (
      <div className="page-shell">
        <PageHeader
          title="Live Tracking"
          description="Real-time workforce positions and geofence status."
          icon={Radar}
        />
        <ErrorState
          description="Live positions could not be loaded from Supabase."
          onRetry={refresh}
        />
      </div>
    )
  }

  const lastUpdated = logsQuery.dataUpdatedAt
    ? new Date(logsQuery.dataUpdatedAt).toLocaleTimeString(undefined, {
        hour: '2-digit',
        minute: '2-digit',
        second: '2-digit',
      })
    : '—'

  return (
    <div className="page-shell">
      <PageHeader
        eyebrow="Workspace"
        title="Live Tracking"
        description="Latest GPS positions, on-site sessions, and geofence exceptions across your workforce."
        icon={() => <img src="/crewtraxa-pin.png" alt="Crewtraxa" className="h-5 w-5 object-contain" />}
        actions={
          <>
            <span className="hidden items-center gap-2 rounded-full border border-border/70 bg-card px-3 py-1.5 font-label text-label-sm text-muted-foreground sm:inline-flex">
              <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-emerald-500" />
              Snapshot · {lastUpdated}
            </span>
            <Button variant="outline" onClick={refresh} disabled={isFetching} className="gap-2">
              <RefreshCw className={cn('h-4 w-4', isFetching && 'animate-spin')} />
              Refresh
            </Button>
          </>
        }
      />

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <StatCard
          label="Workforce"
          value={employees.length}
          hint={`${employees.filter((employee) => employee.is_active).length} active employees`}
          icon={Users}
          tone="teal"
        />
        <StatCard
          label="On site now"
          value={stats.onSite}
          hint={
            stats.unlinkedActive > 0
              ? `${stats.unlinkedActive} unlinked of ${stats.onSite} active`
              : `${stats.onSite} active ${stats.onSite === 1 ? 'session' : 'sessions'}`
          }
          icon={Activity}
          tone="emerald"
        />
        <StatCard
          label="Outside site"
          value={stats.outside}
          hint="Tracked employees without an active session"
          icon={ShieldAlert}
          tone="red"
        />
        <StatCard
          label="No device linked"
          value={stats.noDevice}
          hint="Employees without a tracking device"
          icon={WifiOff}
          tone="slate"
        />
      </div>

      <div className="grid grid-cols-1 gap-4 xl:grid-cols-[minmax(0,1fr)_350px]">
        <section className="min-w-0">
          <div className="surface-panel overflow-hidden p-2">
            <MapCanvas
              center={mapCenter}
              zoom={13}
              markers={markers}
              circles={circles}
              onMapClick={(position) => {
                const nearest = markers.reduce<{ marker: MapMarker; distance: number } | null>(
                  (best, marker) => {
                    const distance = Math.hypot(
                      marker.position.lat - position.lat,
                      marker.position.lng - position.lng
                    )
                    if (!best || distance < best.distance) return { marker, distance }
                    return best
                  },
                  null
                )
                if (nearest && nearest.distance < 0.02) {
                  setSelectedId(nearest.marker.id)
                  setMapCenter(nearest.marker.position)
                }
              }}
              className="h-[420px] sm:h-[520px] xl:h-[640px]"
              ariaLabel="Live employee tracking map"
            />
          </div>
          <div className="mt-2 flex flex-wrap items-center gap-x-4 gap-y-1.5 px-1 text-[11px] text-muted-foreground">
            <span className="inline-flex items-center gap-1.5">
              <span className="h-2.5 w-2.5 rounded-full bg-primary" /> On site
            </span>
            <span className="inline-flex items-center gap-1.5">
              <span className="h-2.5 w-2.5 rounded-full bg-red-500" /> Outside fence
            </span>
            <span className="inline-flex items-center gap-1.5">
              <span className="h-2.5 w-2.5 rounded-full bg-slate-500" /> No recent signal
            </span>
            <span className="inline-flex items-center gap-1.5">
              <MapPin className="h-3.5 w-3.5 text-primary" /> Click a pin to focus a team member
            </span>
          </div>
        </section>

        <aside className="surface-panel flex max-h-[680px] flex-col overflow-hidden">
          <div className="border-b border-border/70 px-4 py-3.5">
            <div className="flex items-center justify-between">
              <h2 className="font-headline text-headline-sm text-foreground">Live roster</h2>
              <Badge variant="outline">{visible.length} shown</Badge>
            </div>
            <div className="relative mt-3">
              <Search className="pointer-events-none absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground" />
              <Input
                value={search}
                onChange={(event) => setSearch(event.target.value)}
                placeholder="Search team members…"
                className="h-8 pl-8 text-body-sm"
                aria-label="Search live roster"
              />
            </div>
            <div className="mt-2 flex flex-wrap gap-1">
              {(
                [
                  ['all', 'All'],
                  ['on-site', 'On site'],
                  ['outside', 'Outside'],
                  ['checked-out', 'Checked Out'],
                  ['no-signal', 'No signal'],
                ] as const
              ).map(([value, label]) => (
                <button
                  key={value}
                  onClick={() => setFilter(value)}
                  className={cn(
                    'rounded-full px-2.5 py-1 font-label text-[11px] transition-colors',
                    filter === value
                      ? 'bg-primary text-primary-foreground'
                      : 'bg-muted text-muted-foreground hover:text-foreground'
                  )}
                >
                  {label}
                </button>
              ))}
            </div>
          </div>

          {selected && (
            <div className="border-b border-border/70 bg-primary/[0.04] px-4 py-3">
              <div className="flex items-start gap-2.5">
                <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-primary/10 font-label text-label-sm font-semibold text-primary">
                  {initialsFromName(selected.name)}
                </span>
                <div className="min-w-0 flex-1">
                  <p className="truncate font-label text-label-md font-semibold text-foreground">
                    {selected.name}
                  </p>
                  <p className="truncate text-[11px] text-muted-foreground">
                    {selected.employee
                      ? `${selected.employee.designations?.name ?? 'No designation'} · ${selected.employee.departments?.name ?? 'No department'}`
                      : 'Active session not linked to an employee profile'}
                  </p>
                </div>
                <Badge variant={statusMeta[selected.status].badge}>
                  {statusMeta[selected.status].label}
                </Badge>
              </div>
              <div className="mt-2.5 flex items-center gap-3 text-[11px] text-muted-foreground">
                <span className="inline-flex items-center gap-1">
                  <Clock3 className="h-3 w-3" /> {timeAgo(selected.latest?.timestamp)}
                </span>
                <span className="truncate">
                  {selected.session
                    ? selected.session.site_id
                      ? siteById.get(selected.session.site_id)?.name ?? 'Unknown site'
                      : 'On site'
                    : selected.latest?.site_id
                      ? siteById.get(selected.latest.site_id)?.name ?? 'Unassigned'
                      : 'No site link'}
                </span>
                <Link
                  to="/history"
                  className="ml-auto inline-flex shrink-0 items-center gap-1 font-medium text-primary hover:underline"
                >
                  <History className="h-3 w-3" /> History
                </Link>
              </div>
              {selected.position && (
                <button
                  onClick={() => setMapCenter(selected.position as LatLng)}
                  className="mt-2 inline-flex items-center gap-1.5 text-[11px] font-medium text-primary hover:underline"
                >
                  <Crosshair className="h-3 w-3" /> Center on last known position
                </button>
              )}
            </div>
          )}

          <div className="scrollbar-thin flex-1 overflow-y-auto p-2">
            {visible.length === 0 ? (
              <div className="px-4 py-12 text-center">
                <UserRound className="mx-auto mb-2 h-8 w-8 text-muted-foreground/50" />
                <p className="font-label text-label-md text-foreground">No team members match</p>
                <p className="mt-1 text-body-sm text-muted-foreground">
                  Try another filter or clear the search.
                </p>
              </div>
            ) : (
              <ul className="space-y-1">
                {visible.map((row) => {
                  const isSelected = row.id === selectedId
                  const siteName = row.session?.site_id
                    ? siteById.get(row.session.site_id)?.name
                    : row.latest?.site_id
                      ? siteById.get(row.latest.site_id)?.name
                      : null
                  return (
                    <li key={row.id}>
                      <button
                        onClick={() => {
                          setSelectedId(row.id)
                          if (row.position) setMapCenter(row.position)
                        }}
                        className={cn(
                          'w-full rounded-lg border px-2.5 py-2.5 text-left transition-colors',
                          isSelected
                            ? 'border-primary/35 bg-primary/[0.06]'
                            : 'border-transparent hover:border-border/70 hover:bg-muted/50'
                        )}
                      >
                        <div className="flex items-center gap-2.5">
                          <span
                            className={cn(
                              'flex h-8 w-8 shrink-0 items-center justify-center rounded-full font-label text-[11px] font-semibold',
                              row.status === 'outside'
                                ? 'bg-red-500/10 text-red-600 dark:text-red-400'
                                : row.status === 'on-site'
                                  ? 'bg-primary/10 text-primary'
                                  : 'bg-muted text-muted-foreground'
                            )}
                          >
                            {initialsFromName(row.name)}
                          </span>
                          <div className="min-w-0 flex-1">
                            <div className="flex items-center justify-between gap-2">
                              <span className="truncate font-label text-label-md font-medium text-foreground">
                                {row.name}
                              </span>
                              <Badge
                                variant={statusMeta[row.status].badge}
                                className="shrink-0 text-[10px]"
                              >
                                {statusMeta[row.status].label}
                              </Badge>
                            </div>
                            <div className="mt-0.5 flex items-center justify-between gap-2 text-[11px] text-muted-foreground">
                              <span className="truncate">
                                {siteName ?? 'No site'} ·{' '}
                                {row.latest
                                  ? isRecent(row.latest.timestamp, 60)
                                    ? timeAgo(row.latest.timestamp)
                                    : `Last seen ${timeAgo(row.latest.timestamp)}`
                                  : 'No ping yet'}
                              </span>
                              {row.latest?.distance_to_site != null && (
                                <span
                                  className={cn(
                                    'shrink-0 tabular-nums',
                                    !row.latest.is_inside && 'text-red-600 dark:text-red-400'
                                  )}
                                >
                                  {Math.round(row.latest.distance_to_site)} m
                                </span>
                              )}
                            </div>
                          </div>
                          <ArrowRight className="h-3.5 w-3.5 shrink-0 text-muted-foreground/40" />
                        </div>
                      </button>
                    </li>
                  )
                })}
              </ul>
            )}
          </div>

          <div className="border-t border-border/70 px-4 py-2.5 text-[10px] text-muted-foreground">
            {sites.length} geofences · {formatRadius(
              sites.reduce((max, site) => Math.max(max, site.radius_in_meters), 0)
            )}{' '}
            largest radius
          </div>
        </aside>
      </div>

      <div className="flex flex-col gap-2 rounded-xl border border-primary/15 bg-primary/[0.04] px-4 py-3 text-body-sm text-muted-foreground sm:flex-row sm:items-center sm:justify-between">
        <p className="flex items-start gap-2">
          <Radar className="mt-0.5 h-4 w-4 shrink-0 text-primary" />
          Tracking reflects the most recent device ping per employee. Sessions enter and exit
          automatically when a device crosses a geofence.
          {stats.unlinkedActive > 0 && (
            <span className="block text-amber-600 dark:text-amber-400">
              {stats.unlinkedActive} active {stats.unlinkedActive === 1 ? 'session is' : 'sessions are'}{' '}
              not linked to an employee profile.
            </span>
          )}
        </p>
        <Link
          to="/history"
          className="inline-flex shrink-0 items-center gap-1.5 font-label text-label-md text-primary hover:underline"
        >
          Open location history <ArrowRight className="h-3.5 w-3.5" />
        </Link>
      </div>
    </div>
  )
}
