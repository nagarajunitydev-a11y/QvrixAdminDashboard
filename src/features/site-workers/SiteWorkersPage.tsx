import { useEffect, useMemo, useState } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { Building2, Crosshair, Layers, MapPin, RefreshCw, Search, UserRound, UsersRound } from 'lucide-react'
import { useAuth } from '@/api/AuthProvider'
import type { EmployeeWithRelations } from '@/api/services'
import { fetchSiteWorkerDirectory } from '@/api/siteWorkers'
import { supabase } from '@/api/supabase'
import { fetchWorkforceSnapshot } from '@/api/workforceTracking'
import { MapCanvas, type MapCircle, type MapMarker } from '@/components/map/MapCanvas'
import { Badge, type BadgeProps } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { PageHeader } from '@/components/ui/page-header'
import { EmptyState, ErrorState, PageSkeleton } from '@/components/ui/states'
import { refreshPageData } from '@/hooks/useRouteDataRefresh'
import { formatDateTime, initialsFromName, timeAgo } from '@/lib/format'
import { fitView, formatRadius, type LatLng } from '@/lib/geo'
import { groupSiteWorkers, siteWorkerStatus, type SiteWorkerStatus } from '@/lib/siteWorkers'
import { cn } from '@/lib/utils'
import { deriveWorkforceCounts, hasValidCoordinates, type TrackingState } from '@/lib/workforce'
import type { Site } from '@/types'

const DEFAULT_VIEW = { center: { lat: 20.5937, lng: 78.9629 }, zoom: 5 }

const statusVariants: Record<SiteWorkerStatus, BadgeProps['variant']> = {
  Online: 'info',
  Offline: 'secondary',
  'On Site': 'success',
  'Outside Site': 'destructive',
  'Checked Out': 'warning',
}

const statusOrder: SiteWorkerStatus[] = ['On Site', 'Outside Site', 'Online', 'Checked Out', 'Offline']

// Only fresh fixes are plotted; stale or post-checkout positions would read as current.
const plottedStatuses = new Set<SiteWorkerStatus>(['On Site', 'Outside Site', 'Online'])

type StatusFilter = 'all' | SiteWorkerStatus

type WorkerRow = {
  employee: EmployeeWithRelations
  name: string
  state: TrackingState | undefined
  status: SiteWorkerStatus
  sites: Site[]
  position: LatLng | null
}

type MapFocus = { center: LatLng; zoom: number; key: number }

function sitePoint(site: Site): LatLng | null {
  return hasValidCoordinates(site.latitude, site.longitude) ? { lat: site.latitude, lng: site.longitude } : null
}

export function SiteWorkersPage() {
  const { user } = useAuth()
  const userId = user?.id
  const queryClient = useQueryClient()
  const [selectedSiteId, setSelectedSiteId] = useState('all')
  const [siteSearch, setSiteSearch] = useState('')
  const [search, setSearch] = useState('')
  const [statusFilter, setStatusFilter] = useState<StatusFilter>('all')
  const [selectedWorkerId, setSelectedWorkerId] = useState<string | null>(null)
  const [focus, setFocus] = useState<MapFocus | null>(null)
  const [clock, setClock] = useState(Date.now)
  const directoryQuery = useQuery({
    queryKey: ['site-workers', userId],
    queryFn: fetchSiteWorkerDirectory,
    enabled: !!userId,
    staleTime: 0,
    refetchInterval: 15_000,
    refetchOnWindowFocus: true,
  })
  const userIds = useMemo(() => [...new Set(directoryQuery.data?.employees
    .flatMap((employee) => employee.user_id ? [employee.user_id] : []) ?? [])].sort(), [directoryQuery.data])
  const snapshotQuery = useQuery({
    queryKey: ['workforce-tracking', userIds],
    queryFn: () => fetchWorkforceSnapshot(userIds),
    enabled: directoryQuery.isSuccess,
    staleTime: 0,
    refetchInterval: 15_000,
    refetchOnWindowFocus: true,
  })

  useEffect(() => {
    const interval = window.setInterval(() => setClock(Date.now()), 15_000)
    return () => window.clearInterval(interval)
  }, [])

  useEffect(() => {
    if (!userId) return
    let rosterTimer: ReturnType<typeof setTimeout> | undefined
    let trackingTimer: ReturnType<typeof setTimeout> | undefined
    const refreshRoster = () => {
      window.clearTimeout(rosterTimer)
      rosterTimer = window.setTimeout(() => {
        queryClient.invalidateQueries({ queryKey: ['site-workers', userId] }, { cancelRefetch: false })
      }, 300)
    }
    const refreshTracking = () => {
      window.clearTimeout(trackingTimer)
      trackingTimer = window.setTimeout(() => {
        queryClient.invalidateQueries({ queryKey: ['workforce-tracking'] }, { cancelRefetch: false })
      }, 300)
    }
    const channel = supabase.channel(`site-workers:${userId}`)
    for (const table of ['employees', 'employee_sites', 'sites', 'departments', 'designations', 'shifts']) {
      channel.on('postgres_changes', { event: '*', schema: 'public', table }, refreshRoster)
    }
    for (const table of ['presence_sessions', 'location_logs']) {
      channel.on('postgres_changes', { event: '*', schema: 'public', table }, refreshTracking)
    }
    channel.subscribe()
    return () => {
      window.clearTimeout(rosterTimer)
      window.clearTimeout(trackingTimer)
      void supabase.removeChannel(channel)
    }
  }, [queryClient, userId])

  const now = Math.max(clock, snapshotQuery.dataUpdatedAt)
  const employeeStates = useMemo(() => {
    const directory = directoryQuery.data
    return deriveWorkforceCounts(
      directory?.employees ?? [], snapshotQuery.data?.sessions ?? [], snapshotQuery.data?.locations ?? [],
      directory?.sites ?? [], directory?.assignments ?? [], now,
    ).employeeStates
  }, [directoryQuery.data, snapshotQuery.data, now])
  const groups = useMemo(() => directoryQuery.data ? groupSiteWorkers(directoryQuery.data) : [], [directoryQuery.data])
  // A site removed while selected falls back to the all-sites overview.
  const activeSiteId = groups.some((group) => group.site.id === selectedSiteId) ? selectedSiteId : 'all'
  const activeSite = groups.find((group) => group.site.id === activeSiteId)?.site ?? null

  const workers = useMemo(() => {
    const rows = new Map<string, WorkerRow>()
    for (const { site, employees } of groups) {
      if (activeSiteId !== 'all' && site.id !== activeSiteId) continue
      for (const employee of employees) {
        const existing = rows.get(employee.id)
        if (existing) {
          existing.sites.push(site)
          continue
        }
        const state = employeeStates.get(employee.id)
        const status = siteWorkerStatus(state)
        const latest = state?.latest
        rows.set(employee.id, {
          employee,
          name: `${employee.first_name} ${employee.last_name}`.trim(),
          state,
          status,
          sites: [site],
          position: plottedStatuses.has(status) && latest && hasValidCoordinates(latest.latitude, latest.longitude)
            ? { lat: latest.latitude, lng: latest.longitude }
            : null,
        })
      }
    }
    return [...rows.values()]
  }, [activeSiteId, employeeStates, groups])

  const siteStats = useMemo(() => new Map(groups.map(({ site, employees }) => {
    let onSite = 0
    let outside = 0
    for (const employee of employees) {
      const state = employeeStates.get(employee.id)
      if (state?.site?.id !== site.id) continue
      if (state.status === 'on-site') onSite += 1
      if (state.status === 'outside') outside += 1
    }
    return [site.id, { total: employees.length, onSite, outside }]
  })), [employeeStates, groups])

  const statusCounts = useMemo(() => {
    const counts = new Map<SiteWorkerStatus, number>()
    for (const worker of workers) counts.set(worker.status, (counts.get(worker.status) ?? 0) + 1)
    return counts
  }, [workers])

  const query = search.trim().toLowerCase()
  const visibleWorkers = useMemo(() => workers
    .filter((worker) => statusFilter === 'all' || worker.status === statusFilter)
    .filter(({ employee, name }) => !query || [
      name, employee.email, employee.phone, employee.departments?.name, employee.designations?.name, employee.shifts?.name,
    ].some((value) => value?.toLowerCase().includes(query)))
    .sort((a, b) => statusOrder.indexOf(a.status) - statusOrder.indexOf(b.status) ||
      a.name.localeCompare(b.name) || a.employee.id.localeCompare(b.employee.id)),
  [query, statusFilter, workers])

  const siteQuery = siteSearch.trim().toLowerCase()
  const visibleGroups = groups.filter(({ site }) => !siteQuery || site.name.toLowerCase().includes(siteQuery))
  const assignedWorkerCount = useMemo(
    () => new Set(groups.flatMap((group) => group.employees.map((employee) => employee.id))).size, [groups])
  const totalOnSite = [...siteStats.values()].reduce((sum, stats) => sum + stats.onSite, 0)

  const allSitesView = useMemo(() => {
    const points = groups.flatMap(({ site }) => sitePoint(site) ?? [])
    const largestRadius = groups.reduce((max, { site }) => Math.max(max, site.radius_in_meters || 0), 0)
    return fitView(points, largestRadius * 1.5) ?? DEFAULT_VIEW
  }, [groups])
  const mapView = focus ?? { ...allSitesView, key: 0 }

  const plottedWorkers = useMemo(() => visibleWorkers.filter((worker) => worker.position), [visibleWorkers])
  const unplottedCount = visibleWorkers.length - plottedWorkers.length

  const markers = useMemo<MapMarker[]>(() => plottedWorkers.map((worker) => ({
    id: worker.employee.id,
    position: worker.position as LatLng,
    label: worker.name,
    sublabel: worker.status,
    tone: worker.employee.id === selectedWorkerId ? 'selected'
      : worker.status === 'Outside Site' ? 'danger'
        : worker.status === 'On Site' ? 'primary' : 'muted',
    onClick: () => setSelectedWorkerId(worker.employee.id),
  })), [plottedWorkers, selectedWorkerId])

  const circles = useMemo<MapCircle[]>(() => groups.flatMap(({ site }) => {
    const center = sitePoint(site)
    if (!center || !(site.radius_in_meters > 0)) return []
    return [{ id: site.id, center, radiusMeters: site.radius_in_meters, tone: site.id === activeSiteId ? 'saved' : 'muted' }]
  }), [activeSiteId, groups])

  // Keep the worker picked on the map visible in the roster.
  useEffect(() => {
    if (selectedWorkerId) document.getElementById(`site-worker-${selectedWorkerId}`)?.scrollIntoView({ block: 'nearest' })
  }, [selectedWorkerId])

  const focusOn = (center: LatLng, zoom: number) => setFocus((current) => ({ center, zoom, key: (current?.key ?? 0) + 1 }))
  const selectSite = (site: Site | null) => {
    setSelectedSiteId(site?.id ?? 'all')
    setSelectedWorkerId(null)
    setSearch('')
    setStatusFilter('all')
    const center = site ? sitePoint(site) : null
    const view = center ? fitView([center], Math.max(site?.radius_in_meters ?? 0, 50) * 1.6) : allSitesView
    if (view) focusOn(view.center, view.zoom)
  }
  const selectWorker = (worker: WorkerRow) => {
    setSelectedWorkerId(worker.employee.id)
    if (worker.position) focusOn(worker.position, Math.max(mapView.zoom, 17))
  }

  const failed = directoryQuery.isError || snapshotQuery.isError
  const hasData = !!directoryQuery.data && !!snapshotQuery.data
  const isRefreshing = directoryQuery.isFetching || snapshotQuery.isFetching
  const refresh = () => refreshPageData(queryClient, '/site-workers')

  if (!failed && !hasData) return <PageSkeleton cards={0} rows={6} />

  return (
    <div className="page-shell tabular-nums">
      <PageHeader
        title="Site Workers"
        description="Pick a site to see where its workers are and their current status."
        icon={UsersRound}
        actions={
          <>
            <span className="hidden items-center gap-2 rounded-full border border-border/70 bg-card px-3 py-1.5 font-label text-label-sm text-muted-foreground sm:inline-flex">
              <span className={cn('h-1.5 w-1.5 rounded-full', failed ? 'bg-amber-500' : 'animate-pulse bg-emerald-500 motion-reduce:animate-none')} />
              {failed ? 'Updates interrupted' : 'Auto-refresh every 15 seconds'}
            </span>
            <Button variant="outline" className="gap-2" onClick={refresh} disabled={isRefreshing}>
              <RefreshCw className={isRefreshing ? 'h-4 w-4 animate-spin motion-reduce:animate-none' : 'h-4 w-4'} />
              {isRefreshing ? 'Refreshing' : 'Refresh'}
            </Button>
          </>
        }
      />

      {failed && (
        <ErrorState
          title={hasData ? 'Site workers may be out of date' : 'Could not load site workers'}
          description={hasData
            ? 'Updates could not be loaded. Showing the last available roster and status. Try again to refresh.'
            : 'The worker roster or live status could not be loaded. Try again, or check your connection and access permissions.'}
          onRetry={refresh}
        />
      )}

      {hasData && (groups.length === 0 ? (
        <EmptyState icon={MapPin} title="No sites available" description="No sites are available for your account. Workers will appear here when sites and employee assignments are available." />
      ) : (
        <div className="grid grid-cols-1 gap-4 lg:grid-cols-[260px_minmax(0,1fr)] xl:grid-cols-[280px_minmax(0,1fr)_350px]">
          {/* Sites */}
          <aside className="surface-panel flex max-h-[420px] min-w-0 flex-col overflow-hidden lg:h-[680px] lg:max-h-none" aria-labelledby="site-workers-sites">
            <div className="border-b border-border/70 px-4 py-3.5">
              <div className="flex items-center justify-between gap-2">
                <h2 id="site-workers-sites" className="font-headline text-headline-sm text-foreground">Sites</h2>
                <Badge variant="outline">{groups.length}</Badge>
              </div>
              <div className="relative mt-3">
                <Search className="pointer-events-none absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground" aria-hidden />
                <Input value={siteSearch} onChange={(event) => setSiteSearch(event.target.value)} placeholder="Search sites…" className="h-8 pl-8 text-body-sm" type="search" aria-label="Search sites" />
              </div>
            </div>
            <ul className="scrollbar-thin flex-1 space-y-1 overflow-y-auto p-2">
              {!siteQuery && (
                <li>
                  <button
                    type="button"
                    onClick={() => selectSite(null)}
                    aria-pressed={activeSiteId === 'all'}
                    className={cn(
                      'flex w-full items-center gap-2.5 rounded-lg border px-2.5 py-2.5 text-left transition-colors',
                      activeSiteId === 'all' ? 'border-primary/35 bg-primary/[0.06]' : 'border-transparent hover:border-border/70 hover:bg-muted/50',
                    )}
                  >
                    <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-primary/10 text-primary" aria-hidden><Layers className="h-4 w-4" /></span>
                    <span className="min-w-0 flex-1">
                      <span className="block truncate font-label text-label-md font-medium text-foreground">All sites</span>
                      <span className="block text-[11px] text-muted-foreground">{assignedWorkerCount} {assignedWorkerCount === 1 ? 'worker' : 'workers'} · {totalOnSite} on site</span>
                    </span>
                  </button>
                </li>
              )}
              {visibleGroups.length === 0 ? (
                <li className="px-3 py-10 text-center">
                  <p className="font-label text-label-md text-foreground">No matching sites</p>
                  <button type="button" onClick={() => setSiteSearch('')} className="mt-1 text-body-sm font-medium text-primary hover:underline">Clear search</button>
                </li>
              ) : visibleGroups.map(({ site }) => {
                const stats = siteStats.get(site.id) ?? { total: 0, onSite: 0, outside: 0 }
                const isActive = site.id === activeSiteId
                return (
                  <li key={site.id}>
                    <button
                      type="button"
                      onClick={() => selectSite(site)}
                      aria-pressed={isActive}
                      className={cn(
                        'flex w-full items-center gap-2.5 rounded-lg border px-2.5 py-2.5 text-left transition-colors',
                        isActive ? 'border-primary/35 bg-primary/[0.06]' : 'border-transparent hover:border-border/70 hover:bg-muted/50',
                      )}
                    >
                      <span className={cn('flex h-8 w-8 shrink-0 items-center justify-center rounded-lg', isActive ? 'bg-primary text-primary-foreground' : 'bg-muted text-muted-foreground')} aria-hidden>
                        <Building2 className="h-4 w-4" />
                      </span>
                      <span className="min-w-0 flex-1">
                        <span className="block truncate font-label text-label-md font-medium text-foreground" title={site.name}>{site.name}</span>
                        <span className="block truncate text-[11px] text-muted-foreground">
                          {stats.total} {stats.total === 1 ? 'worker' : 'workers'} · {formatRadius(site.radius_in_meters)} radius
                        </span>
                      </span>
                      <span className="flex shrink-0 flex-col items-end gap-1">
                        <span className={cn('font-label text-label-sm font-semibold', stats.onSite > 0 ? 'text-emerald-700 dark:text-emerald-400' : 'text-muted-foreground')} title={`${stats.onSite} of ${stats.total} on site`}>
                          {stats.onSite}/{stats.total}
                        </span>
                        {stats.outside > 0 && <span className="text-[10px] font-medium text-red-600 dark:text-red-400">{stats.outside} outside</span>}
                      </span>
                    </button>
                  </li>
                )
              })}
            </ul>
          </aside>

          {/* Map */}
          <section className="surface-panel flex min-w-0 flex-col overflow-hidden p-2 lg:h-[680px]" aria-label="Site map">
            <div className="relative min-h-[420px] flex-1">
              <MapCanvas
                center={mapView.center}
                zoom={mapView.zoom}
                focusKey={mapView.key}
                markers={markers}
                circles={circles}
                showSearch={false}
                className="absolute inset-0 h-full"
                ariaLabel={activeSite ? `Map of ${activeSite.name} and its workers` : 'Map of all sites and workers'}
              />
              <div className="pointer-events-none absolute left-3 top-3 z-30 max-w-[calc(100%-5rem)] rounded-lg border border-border/80 bg-card/95 px-3 py-2 shadow-premium backdrop-blur">
                <p className="truncate font-label text-label-md font-semibold text-foreground">{activeSite?.name ?? 'All sites'}</p>
                <p className="text-[11px] text-muted-foreground">
                  {plottedWorkers.length} on map{unplottedCount > 0 && ` · ${unplottedCount} without a current location`}
                </p>
              </div>
            </div>
            <div className="flex flex-wrap items-center gap-x-4 gap-y-1.5 px-1 pt-2 text-[11px] text-muted-foreground">
              <span className="inline-flex items-center gap-1.5"><span className="h-2.5 w-2.5 rounded-full bg-primary" /> On site</span>
              <span className="inline-flex items-center gap-1.5"><span className="h-2.5 w-2.5 rounded-full bg-red-500" /> Outside site</span>
              <span className="inline-flex items-center gap-1.5"><span className="h-2.5 w-2.5 rounded-full bg-slate-500" /> Online, not confirmed on site</span>
              <span className="inline-flex items-center gap-1.5"><span className="h-2.5 w-2.5 rounded-full border border-primary/60 bg-primary/10" /> Site geofence</span>
            </div>
          </section>

          {/* Workers */}
          <aside className="surface-panel flex max-h-[640px] min-w-0 flex-col overflow-hidden lg:col-span-2 xl:col-span-1 xl:h-[680px] xl:max-h-none" aria-labelledby="site-workers-roster">
            <div className="border-b border-border/70 px-4 py-3.5">
              <div className="flex items-center justify-between gap-2">
                <div className="min-w-0">
                  <h2 id="site-workers-roster" className="font-headline text-headline-sm text-foreground">Workers</h2>
                  <p className="truncate text-[11px] text-muted-foreground">{activeSite ? `Assigned to ${activeSite.name}` : 'Assigned across all sites'}</p>
                </div>
                <Badge variant="outline">{query || statusFilter !== 'all' ? `${visibleWorkers.length} of ${workers.length}` : workers.length}</Badge>
              </div>
              <div className="relative mt-3">
                <Search className="pointer-events-none absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground" aria-hidden />
                <Input value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Name, email, department…" className="h-8 pl-8 text-body-sm" type="search" aria-label="Search workers" />
              </div>
              <div className="mt-2 flex flex-wrap gap-1" role="group" aria-label="Filter by status">
                {(['all', ...statusOrder] as const).map((value) => {
                  const count = value === 'all' ? workers.length : statusCounts.get(value) ?? 0
                  return (
                    <button
                      key={value}
                      type="button"
                      onClick={() => setStatusFilter(value)}
                      aria-pressed={statusFilter === value}
                      className={cn(
                        'rounded-full px-2.5 py-1 font-label text-[11px] transition-colors',
                        statusFilter === value ? 'bg-primary text-primary-foreground' : 'bg-muted text-muted-foreground hover:text-foreground',
                      )}
                    >
                      {value === 'all' ? 'All' : value} <span className="opacity-70">{count}</span>
                    </button>
                  )
                })}
              </div>
            </div>

            <div className="scrollbar-thin flex-1 overflow-y-auto p-2">
              {workers.length === 0 ? (
                <div className="px-4 py-12 text-center">
                  <UserRound className="mx-auto mb-2 h-8 w-8 text-muted-foreground/50" aria-hidden />
                  <p className="font-label text-label-md text-foreground">No workers assigned</p>
                  <p className="mt-1 text-body-sm text-muted-foreground">Workers will appear here when assigned to {activeSite ? 'this site' : 'a site'}.</p>
                </div>
              ) : visibleWorkers.length === 0 ? (
                <div className="px-4 py-12 text-center">
                  <Search className="mx-auto mb-2 h-8 w-8 text-muted-foreground/50" aria-hidden />
                  <p className="font-label text-label-md text-foreground">No matching workers</p>
                  <button type="button" onClick={() => { setSearch(''); setStatusFilter('all') }} className="mt-1 text-body-sm font-medium text-primary hover:underline">Clear filters</button>
                </div>
              ) : (
                <ul className="space-y-1">
                  {visibleWorkers.map((worker) => {
                    const { employee, name, state, status } = worker
                    const isSelected = employee.id === selectedWorkerId
                    const activityAt = status === 'Checked Out' ? state?.session?.exit_timestamp : state?.latest?.timestamp
                    const currentSite = state?.site && !worker.sites.some((site) => site.id === state.site?.id) ? state.site : null
                    return (
                      <li key={employee.id} id={`site-worker-${employee.id}`}>
                        <button
                          type="button"
                          onClick={() => selectWorker(worker)}
                          aria-pressed={isSelected}
                          className={cn(
                            'w-full rounded-lg border px-2.5 py-2.5 text-left transition-colors',
                            isSelected ? 'border-primary/35 bg-primary/[0.06]' : 'border-transparent hover:border-border/70 hover:bg-muted/50',
                          )}
                        >
                          <div className="flex items-start gap-2.5">
                            <span
                              className={cn(
                                'flex h-8 w-8 shrink-0 items-center justify-center rounded-full font-label text-[11px] font-semibold',
                                status === 'Outside Site' ? 'bg-red-500/10 text-red-600 dark:text-red-400'
                                  : status === 'On Site' ? 'bg-primary/10 text-primary' : 'bg-muted text-muted-foreground',
                              )}
                              aria-hidden
                            >
                              {initialsFromName(name)}
                            </span>
                            <div className="min-w-0 flex-1">
                              <div className="flex items-center justify-between gap-2">
                                <span className="truncate font-label text-label-md font-medium text-foreground">{name}</span>
                                <Badge variant={statusVariants[status]} dot className="shrink-0 whitespace-nowrap text-[10px]">{status}</Badge>
                              </div>
                              <p className="mt-0.5 truncate text-[11px] text-muted-foreground">
                                {employee.designations?.name ?? 'No designation'} · {employee.departments?.name ?? 'No department'}
                              </p>
                              <div className="mt-0.5 flex items-center justify-between gap-2 text-[11px] text-muted-foreground">
                                <span className="truncate" title={activityAt ? formatDateTime(activityAt) : undefined}>
                                  {!employee.user_id ? 'Device not linked' : activityAt ? `Last activity ${timeAgo(activityAt)}` : 'No location received'}
                                </span>
                                {state?.distanceToSite != null && (
                                  <span className={cn('shrink-0', status === 'Outside Site' && 'text-red-600 dark:text-red-400')}>{Math.round(state.distanceToSite)} m</span>
                                )}
                              </div>
                              {activeSiteId === 'all' && (
                                <p className="mt-0.5 truncate text-[11px] text-muted-foreground" title={worker.sites.map((site) => site.name).join(', ')}>
                                  {worker.sites.length === 1 ? worker.sites[0].name : `${worker.sites.length} sites: ${worker.sites.map((site) => site.name).join(', ')}`}
                                </p>
                              )}
                              {currentSite && <p className="mt-0.5 truncate text-[11px] text-muted-foreground">Current site: {currentSite.name}</p>}
                              <div className="mt-1 flex flex-wrap items-center gap-1.5">
                                {!employee.is_active && <Badge variant="secondary" className="text-[10px]">Inactive employee</Badge>}
                                {isSelected && worker.position && (
                                  <span className="inline-flex items-center gap-1 text-[11px] font-medium text-primary"><Crosshair className="h-3 w-3" aria-hidden /> Shown on map</span>
                                )}
                                {isSelected && !worker.position && (
                                  <span className="text-[11px] text-muted-foreground">No current location to show on the map</span>
                                )}
                              </div>
                            </div>
                          </div>
                        </button>
                      </li>
                    )
                  })}
                </ul>
              )}
            </div>
          </aside>
        </div>
      ))}
    </div>
  )
}
