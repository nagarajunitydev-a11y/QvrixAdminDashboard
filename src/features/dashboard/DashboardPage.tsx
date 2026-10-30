import { useMemo } from 'react'
import { Link } from 'react-router-dom'
import { useQuery } from '@tanstack/react-query'
import {
  fetchSites,
  fetchEmployees,
} from '@/api/services'
import { fetchRecentActivity } from '@/api/recentActivity'
import { recentActivityEvents } from '@/lib/recentActivity'
import { employeeNamesByUserId } from '@/lib/employeeIdentity'
import { Badge } from '@/components/ui/badge'
import { PageHeader } from '@/components/ui/page-header'
import { ErrorState, PageSkeleton } from '@/components/ui/states'
import { StatCard } from '@/components/ui/stat-card'
import { Button } from '@/components/ui/button'
import {
  Users,
  MapPin,
  Building2,
  CalendarDays,
  Download,
  ArrowDownRight,
  Radar,
  ShieldAlert,
  ClipboardList,
  Clock3,
} from 'lucide-react'
import type { EmployeeWithRelations } from '@/api/services'
import { useWorkforceTracking } from '@/api/useWorkforceTracking'
import { OnboardingCard } from '@/features/onboarding/GettingStartedPage'

function initials(first?: string | null, last?: string | null) {
  return `${first?.[0] ?? 'E'}${last?.[0] ?? ''}`.toUpperCase()
}

function timeAgo(timestamp: number) {
  const diffMs = Date.now() - timestamp
  const mins = Math.floor(diffMs / 60000)
  if (mins < 1) return 'just now'
  if (mins < 60) return `${mins} min ago`
  const hrs = Math.floor(mins / 60)
  if (hrs < 24) return `${hrs} hr ago`
  return `${Math.floor(hrs / 24)} d ago`
}

function exportEmployeesCsv(employees: EmployeeWithRelations[]) {
  const header = 'First Name,Last Name,Email,Phone,Department,Designation,Shift,Hire Date,Active'
  const rows = employees.map((e) =>
    [
      e.first_name,
      e.last_name,
      e.email,
      e.phone ?? '',
      e.departments?.name ?? '',
      e.designations?.name ?? '',
      e.shifts?.name ?? '',
      e.hire_date ?? '',
      e.is_active ? 'Yes' : 'No',
    ]
      .map((v) => `"${String(v).replace(/"/g, '""')}"`)
      .join(',')
  )
  const blob = new Blob([[header, ...rows].join('\n')], { type: 'text/csv;charset=utf-8' })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = `workforce-report-${new Date().toISOString().slice(0, 10)}.csv`
  a.click()
  URL.revokeObjectURL(url)
}

export function DashboardPage() {
  const sitesQuery = useQuery({
    queryKey: ['sites'],
    queryFn: fetchSites,
    refetchInterval: 15_000,
  })
  const employeesQuery = useQuery({
    queryKey: ['employees'],
    queryFn: fetchEmployees,
    refetchInterval: 15_000,
  })
  const sites = useMemo(() => sitesQuery.data ?? [], [sitesQuery.data])
  const employees = useMemo(() => employeesQuery.data ?? [], [employeesQuery.data])
  // Archived profiles keep their names for history, but are no longer part of the workforce.
  const currentEmployees = useMemo(() => employees.filter((employee) => !employee.archived_at), [employees])
  const { counts: stats, snapshotQuery, assignmentsQuery } = useWorkforceTracking(
    currentEmployees, sites, employeesQuery.isSuccess && sitesQuery.isSuccess,
  )
  const activityQuery = useQuery({
    queryKey: ['recent-entry-exit-activity'],
    queryFn: fetchRecentActivity,
    refetchInterval: 15_000,
    refetchOnWindowFocus: true,
  })
  const recentActivity = useMemo(() => recentActivityEvents(
    [...(activityQuery.data?.sessions ?? []), ...(snapshotQuery.data?.sessions ?? [])],
    activityQuery.data?.locations ?? [],
  ), [activityQuery.data, snapshotQuery.data])

  const alerts = useMemo(
    () => [...stats.employeeStates.values()]
      .filter((state) => state.status === 'outside' && state.latest && state.site)
      .map((state) => ({
        ...state.latest!,
        site_id: state.site!.id,
        distance_to_site: state.distanceToSite,
      }))
      .sort((a, b) => b.timestamp - a.timestamp).slice(0, 4),
    [stats]
  )

  const employeeNameById = useMemo(() => employeeNamesByUserId(employees), [employees])

  const siteNameById = useMemo(() => {
    const map = new Map<string, string>()
    sites.forEach((s) => map.set(s.id, s.name))
    return map
  }, [sites])

  const siteOccupancy = useMemo(() => {
    const assignedBySite = new Map<string, number>()
    // Use the same confirmed on-site states as the workforce count.
    const insideBySite = new Map<string, number>()
    stats.employeeStates.forEach((state) => {
      if (state.status === 'on-site' && state.site) {
        insideBySite.set(state.site.id, (insideBySite.get(state.site.id) ?? 0) + 1)
      }
    })
    return sites.map((site) => ({
      site,
      inside: insideBySite.get(site.id) ?? 0,
      assigned: assignedBySite.get(site.id) ?? null,
    }))
  }, [sites, stats])

  if (sitesQuery.isLoading || employeesQuery.isLoading || snapshotQuery.isLoading || assignmentsQuery.isLoading) {
    return <PageSkeleton cards={4} rows={5} />
  }

  if (sitesQuery.isError || employeesQuery.isError || snapshotQuery.isError || assignmentsQuery.isError) {
    return <ErrorState description="Workforce status could not be loaded from Supabase." onRetry={() => {
      void sitesQuery.refetch()
      void employeesQuery.refetch()
      void snapshotQuery.refetch()
      void assignmentsQuery.refetch()
    }} />
  }

  return (
    <div className="page-shell">
      <PageHeader
        eyebrow="Operations overview"
        title="Command Center"
        description="Live workforce posture, geofence health, and activity across every site."
        icon={() => <img src="/crewtraxa-pin.png" alt="Crewtraxa" className="h-5 w-5 object-contain" />}
        actions={
          <>
            <Button variant="outline" className="gap-2">
              <CalendarDays className="h-4 w-4" />
              {new Date().toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' })}
            </Button>
            <Button className="gap-2" onClick={() => exportEmployeesCsv(currentEmployees)}>
              <Download className="h-4 w-4" />
              Export Report
            </Button>
          </>
        }
      />

      <OnboardingCard />

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <StatCard
          label="Total Employees"
          value={stats.totalEmployees}
          hint={`${stats.percentInside}% currently inside a site`}
          icon={Users}
          tone="teal"
        />
        <StatCard
          label="On Duty"
          value={stats.insideCount}
          icon={MapPin}
          tone="emerald"
          footer={
            <div>
              <div className="h-1.5 w-full overflow-hidden rounded-full bg-muted">
                <div
                  className="h-1.5 rounded-full bg-emerald-500 transition-all"
                  style={{ width: `${stats.percentInside}%` }}
                />
              </div>
              <span className="mt-1.5 block text-[11px]">
                {stats.percentInside}% of workforce inside sites
              </span>
            </div>
          }
        />
        <StatCard
          label="Outside Site"
          value={stats.outsideCount}
          hint="Tracked employees outside geofence (recent location)"
          icon={Building2}
          tone="amber"
        />
        <StatCard
          label="Checked Out"
          value={stats.checkedOutUserIds.size}
          hint="Employees who ended their shift"
          icon={Clock3}
          tone="slate"
        />
        <StatCard
          label="No Device Linked"
          value={stats.offlineCount}
          hint="Accounts without a tracking device"
          icon={ShieldAlert}
          tone="red"
        />
      </div>

      {/* Distribution + Alerts */}
      <div className="grid grid-cols-1 gap-4 lg:h-[420px] lg:grid-cols-3">
        <div className="card flex flex-col overflow-hidden lg:col-span-2">
          <div className="flex items-center justify-between border-b border-border bg-card p-4">
            <h2 className="flex items-center gap-2 font-headline text-headline-md text-foreground">
              <MapPin className="h-5 w-5 text-primary" /> Live Workforce Distribution
            </h2>
            <Badge variant="info">Global View</Badge>
          </div>
          <div className="relative flex-1 overflow-y-auto bg-muted/50 p-4">
            {siteOccupancy.length === 0 ? (
              <p className="py-10 text-center text-body-sm text-muted-foreground">
                No sites configured yet.
              </p>
            ) : (
              <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-3">
                {siteOccupancy.map(({ site, inside }) => {
                  const capacity = Math.max(site.radius_in_meters, 1)
                  const load = Math.min(100, Math.round((inside / capacity) * 100))
                  return (
                    <Link
                      key={site.id}
                      to="/sites"
                      className="rounded-lg border border-border bg-card p-3 shadow-sm transition-all hover:border-primary/40 hover:shadow-soft"
                    >
                      <div className="mb-2 flex items-start justify-between gap-2">
                        <span className="truncate font-label text-label-md font-semibold text-foreground">
                          {site.name}
                        </span>
                        <Badge variant={load >= 80 ? 'success' : load >= 40 ? 'info' : 'warning'} dot>
                          {load >= 80 ? 'High' : load >= 40 ? 'Medium' : 'Low'}
                        </Badge>
                      </div>
                      <div className="mb-2 flex items-baseline gap-1">
                        <span className="font-headline text-headline-md text-primary">{inside}</span>
                        <span className="text-body-sm text-muted-foreground">checked in</span>
                      </div>
                      <div className="h-1.5 w-full rounded-full bg-muted">
                        <div
                          className="h-1.5 rounded-full bg-primary transition-all"
                          style={{ width: `${Math.max(load, 4)}%` }}
                        />
                      </div>
                      <p className="mt-2 truncate font-label text-label-sm text-muted-foreground">
                        {site.latitude.toFixed(4)}, {site.longitude.toFixed(4)} Â· r={site.radius_in_meters}m
                      </p>
                    </Link>
                  )
                })}
              </div>
            )}
            <div className="pointer-events-none absolute bottom-4 right-4 rounded-md border border-border bg-card/90 p-3 backdrop-blur-sm">
              <span className="mb-2 block border-b border-border pb-1 font-label text-label-sm text-foreground">
                Cluster Density
              </span>
              <div className="flex items-center gap-2">
                <span className="h-2.5 w-2.5 rounded-full bg-emerald-500" />
                <span className="text-[11px] text-muted-foreground">High (80%+)</span>
              </div>
              <div className="flex items-center gap-2">
                <span className="h-2.5 w-2.5 rounded-full bg-sky-500" />
                <span className="text-[11px] text-muted-foreground">Medium (40â€“79%)</span>
              </div>
              <div className="flex items-center gap-2">
                <span className="h-2.5 w-2.5 rounded-full bg-amber-500" />
                <span className="text-[11px] text-muted-foreground">Low (&lt;40%)</span>
              </div>
            </div>
          </div>
        </div>

        <div className="card flex flex-col overflow-hidden border-l-4 border-l-red-500">
          <div className="flex items-center justify-between border-b border-border bg-card p-4">
            <h2 className="flex items-center gap-2 font-headline text-headline-md text-foreground">
              <ShieldAlert className="h-5 w-5 text-destructive" /> Geofence Alerts
            </h2>
            <span className="rounded-full bg-red-500/10 px-2 py-0.5 font-label text-label-sm text-red-700 dark:text-red-400">
              Outside Fence
            </span>
          </div>
          <div className="flex-1 space-y-2 overflow-y-auto bg-card p-2">
            {alerts.length === 0 ? (
              <div className="flex h-full flex-col items-center justify-center gap-2 py-10 text-center">
                <Radar className="h-8 w-8 text-emerald-500" />
                <p className="text-body-sm text-muted-foreground">All personnel within geofences.</p>
              </div>
            ) : (
              alerts.map((log) => (
                <div
                  key={log.id}
                  className="rounded-md border border-red-500/20 bg-red-500/5 p-3"
                >
                  <div className="mb-1 flex items-start justify-between gap-2">
                    <span className="font-label text-label-md font-semibold text-foreground">
                      {employeeNameById.get(log.user_id ?? '') ?? `Device ${log.user_id?.slice(0, 8) ?? 'Unknown'}`}
                    </span>
                    <span className="shrink-0 font-label text-[10px] text-muted-foreground">
                      {timeAgo(log.timestamp)}
                    </span>
                  </div>
                  <p className="mb-2 text-xs text-muted-foreground">
                    Outside {log.site_id ? siteNameById.get(log.site_id) ?? 'assigned site' : 'any site'} Â·{' '}
                    {log.distance_to_site != null ? `${Math.round(log.distance_to_site)}m away` : 'distance unknown'}
                  </p>
                  <Link
                    to="/location-logs"
                    className="inline-flex items-center gap-1 font-label text-label-sm text-destructive hover:underline"
                  >
                    Investigate <ArrowDownRight className="h-3.5 w-3.5" />
                  </Link>
                </div>
              ))
            )}
          </div>
          <div className="border-t border-border p-3">
            <Link
              to="/audit"
              className="flex items-center justify-center gap-2 rounded-md py-1.5 font-label text-label-md text-primary transition-colors hover:bg-muted"
            >
              <ClipboardList className="h-4 w-4" /> View Audit Logs
            </Link>
          </div>
        </div>
      </div>

      {/* Activity tables */}
      <div className="grid grid-cols-1 gap-4 xl:grid-cols-2">
        <div className="card flex flex-col overflow-hidden">
          <div className="flex items-center justify-between border-b border-border bg-card p-4">
            <h2 className="font-headline text-headline-md text-foreground">Recent Entry/Exit Activity</h2>
            <Link to="/presence" className="font-label text-label-md text-primary hover:underline">
              View All
            </Link>
          </div>
          <div className="overflow-x-auto">
            <table className="w-full border-collapse text-left">
              <thead>
                <tr className="border-b border-border bg-muted">
                  <th className="px-4 py-3 font-label text-label-sm font-semibold uppercase tracking-wider text-muted-foreground">Employee</th>
                  <th className="px-4 py-3 font-label text-label-sm font-semibold uppercase tracking-wider text-muted-foreground">Site</th>
                  <th className="px-4 py-3 font-label text-label-sm font-semibold uppercase tracking-wider text-muted-foreground">Time</th>
                  <th className="px-4 py-3 font-label text-label-sm font-semibold uppercase tracking-wider text-muted-foreground">Status</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border font-body text-body-sm">
                {activityQuery.isError && (
                  <tr><td colSpan={4} className="px-4 py-3"><ErrorState title="Activity updates unavailable" description="Recent entry, exit and checkout activity could not be refreshed." onRetry={() => { void activityQuery.refetch() }} /></td></tr>
                )}
                {activityQuery.isPending && (
                  <tr><td colSpan={4} className="px-4 py-10 text-center text-body-sm text-muted-foreground" role="status">Loading recent activity...</td></tr>
                )}
                {activityQuery.data && recentActivity.map((log) => (
                  <tr key={log.id} className="row-hover transition-colors">
                    <td className="px-4 py-3">
                      <div className="flex items-center gap-2">
                        <div className="flex h-6 w-6 items-center justify-center rounded-full bg-primary/10 font-label text-[10px] font-semibold text-primary">
                          {initials(
                            employeeNameById.get(log.user_id ?? '')?.split(' ')[0],
                            employeeNameById.get(log.user_id ?? '')?.split(' ')[1]
                          )}
                        </div>
                        <span className="text-foreground">
                          {employeeNameById.get(log.user_id) ?? 'Employee unavailable'}
                        </span>
                      </div>
                    </td>
                    <td className="px-4 py-3 text-muted-foreground">
                      {log.site_id ? siteNameById.get(log.site_id) ?? 'â€”' : 'No site'}
                    </td>
                    <td className="px-4 py-3 text-xs text-muted-foreground">
                      {timeAgo(log.timestamp)}
                    </td>
                    <td className="px-4 py-3">
                      <Badge variant={log.status === 'Entry' ? 'success' : 'warning'} dot>
                        {log.status}
                      </Badge>
                    </td>
                  </tr>
                ))}
                {activityQuery.isSuccess && recentActivity.length === 0 && (
                  <tr>
                    <td colSpan={4} className="px-4 py-10 text-center text-body-sm text-muted-foreground">
                      No activity recorded yet.
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        </div>

        <div className="card flex flex-col overflow-hidden">
          <div className="flex items-center justify-between border-b border-border bg-card p-4">
            <h2 className="font-headline text-headline-md text-foreground">Site Activity Summary</h2>
            <Link to="/assignments" className="font-label text-label-md text-primary hover:underline">
              Manage
            </Link>
          </div>
          <div className="flex flex-1 flex-col justify-center gap-4 p-5">
            {siteOccupancy.length === 0 && (
              <p className="text-center text-body-sm text-muted-foreground">No sites configured yet.</p>
            )}
            {siteOccupancy.map(({ site, inside }) => {
              const max = Math.max(
                ...siteOccupancy.map((s) => s.inside),
                1
              )
              const pct = Math.round((inside / max) * 100)
              return (
                <div key={site.id}>
                  <div className="mb-1 flex items-end justify-between">
                    <span className="font-label text-label-sm text-foreground">{site.name}</span>
                    <span className="font-label text-label-sm text-muted-foreground">
                      {inside} checked in Â· {sites.length > 0 ? `${pct}% of peak` : ''}
                    </span>
                  </div>
                  <div className="h-2 w-full overflow-hidden rounded-full bg-muted">
                    <div
                      className={`h-full rounded-full transition-all ${pct >= 70 ? 'bg-primary' : pct >= 40 ? 'bg-secondary-foreground/70' : 'bg-amber-500'}`}
                      style={{ width: `${Math.max(pct, 3)}%` }}
                    />
                  </div>
                </div>
              )
            })}
          </div>
        </div>
      </div>
    </div>
  )
}
