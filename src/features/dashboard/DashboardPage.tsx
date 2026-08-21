import { useMemo } from 'react'
import { Link } from 'react-router-dom'
import { useQuery } from '@tanstack/react-query'
import {
  fetchSites,
  fetchEmployees,
  fetchActivePresenceSessions,
  fetchLocationLogs,
} from '@/api/services'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import {
  Users,
  MapPin,
  Building2,
  CalendarDays,
  Download,
  ArrowUpRight,
  ArrowDownRight,
  Radar,
  ShieldAlert,
  ClipboardList,
} from 'lucide-react'
import type { EmployeeWithRelations } from '@/api/services'

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
  const { data: sites = [], isLoading: sitesLoading } = useQuery({
    queryKey: ['sites'],
    queryFn: fetchSites,
  })
  const { data: employees = [], isLoading: employeesLoading } = useQuery({
    queryKey: ['employees'],
    queryFn: fetchEmployees,
  })
  const { data: activeSessions = [] } = useQuery({
    queryKey: ['active-presence-sessions'],
    queryFn: fetchActivePresenceSessions,
  })
  const { data: recentLogs = [] } = useQuery({
    queryKey: ['recent-location-logs'],
    queryFn: () => fetchLocationLogs({ limit: 12 }),
  })

  const stats = useMemo(() => {
    const totalEmployees = employees.length
    const activeUserIds = new Set(
      activeSessions.map((s) => s.user_id).filter((id): id is string => id !== null)
    )
    const insideCount = activeUserIds.size
    const trackable = employees.filter((e) => e.user_id !== null)
    const outsideCount = trackable.filter((e) => e.user_id !== null && !activeUserIds.has(e.user_id)).length
    const offlineCount = totalEmployees - trackable.length
    const percentInside = totalEmployees > 0 ? Math.round((insideCount / totalEmployees) * 100) : 0
    return { totalEmployees, insideCount, outsideCount, offlineCount, percentInside }
  }, [employees, activeSessions])

  const alerts = useMemo(
    () => recentLogs.filter((log) => !log.is_inside).slice(0, 4),
    [recentLogs]
  )

  const employeeNameById = useMemo(() => {
    const map = new Map<string, string>()
    employees.forEach((e) => {
      if (e.user_id) map.set(e.user_id, `${e.first_name} ${e.last_name}`)
    })
    return map
  }, [employees])

  const siteNameById = useMemo(() => {
    const map = new Map<string, string>()
    sites.forEach((s) => map.set(s.id, s.name))
    return map
  }, [sites])

  const siteOccupancy = useMemo(() => {
    const assignedBySite = new Map<string, number>()
    // Occupancy derived from active sessions grouped by site
    const insideBySite = new Map<string, number>()
    activeSessions.forEach((s) => {
      if (s.site_id) insideBySite.set(s.site_id, (insideBySite.get(s.site_id) ?? 0) + 1)
    })
    return sites.map((site) => ({
      site,
      inside: insideBySite.get(site.id) ?? 0,
      assigned: assignedBySite.get(site.id) ?? null,
    }))
  }, [sites, activeSessions])

  if (sitesLoading && employeesLoading) {
    return (
      <div className="flex justify-center py-16">
        <div className="h-8 w-8 animate-spin rounded-full border-b-2 border-primary" />
      </div>
    )
  }

  return (
    <div className="mx-auto max-w-7xl space-y-6">
      {/* Page header */}
      <div className="flex flex-col justify-between gap-4 lg:flex-row lg:items-center">
        <div>
          <h1 className="font-headline text-headline-lg text-foreground">Global Operations</h1>
          <p className="text-body-sm text-muted-foreground">
            Real-time workforce overview for today.
          </p>
        </div>
        <div className="flex gap-2">
          <Button variant="outline" className="gap-2">
            <CalendarDays className="h-4 w-4" />
            {new Date().toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' })}
          </Button>
          <Button className="gap-2" onClick={() => exportEmployeesCsv(employees)}>
            <Download className="h-4 w-4" />
            Export Report
          </Button>
        </div>
      </div>

      {/* KPI Bento Grid */}
      <div className="grid grid-cols-1 gap-4 md:grid-cols-2 lg:grid-cols-4">
        <div className="card-kpi group">
          <div className="mb-2 flex items-start justify-between">
            <span className="font-label text-label-md text-muted-foreground">Total Employees</span>
            <Users className="h-4 w-4 text-muted-foreground" />
          </div>
          <span className="font-headline text-headline-lg text-foreground">{stats.totalEmployees}</span>
          <div className="mt-2 flex items-center gap-1">
            <ArrowUpRight className="h-3.5 w-3.5 text-emerald-600" />
            <span className="font-label text-label-sm text-emerald-600">
              {stats.percentInside}% on shift
            </span>
          </div>
          <div className="sparkline sparkline-blue" />
        </div>

        <div className="card-kpi group">
          <div className="mb-2 flex items-start justify-between">
            <span className="font-label text-label-md text-muted-foreground">On Duty</span>
            <Badge variant="success" dot>Live</Badge>
          </div>
          <span className="font-headline text-headline-lg text-foreground">{stats.insideCount}</span>
          <div className="relative z-10 mt-3 h-1.5 w-full rounded-full bg-muted">
            <div
              className="h-1.5 rounded-full bg-emerald-500 transition-all"
              style={{ width: `${stats.percentInside}%` }}
            />
          </div>
          <span className="relative z-10 mt-1 block text-[11px] text-muted-foreground">
            {stats.percentInside}% of workforce inside sites
          </span>
          <div className="sparkline sparkline-green" />
        </div>

        <div className="card p-4 md:col-span-2">
          <div className="mb-2 flex items-start justify-between">
            <span className="font-label text-label-md text-muted-foreground">Current Location Status</span>
            <Building2 className="h-4 w-4 text-muted-foreground" />
          </div>
          <div className="mt-1 flex flex-wrap gap-6">
            <div>
              <span className="mb-1 block font-label text-label-sm text-muted-foreground">Inside Site</span>
              <span className="flex items-baseline gap-2 font-headline text-headline-md text-foreground">
                {stats.insideCount} <Badge variant="success" dot>On-Site</Badge>
              </span>
            </div>
            <div className="w-px self-stretch bg-border" />
            <div>
              <span className="mb-1 block font-label text-label-sm text-muted-foreground">Outside Site</span>
              <span className="flex items-baseline gap-2 font-headline text-headline-md text-foreground">
                {stats.outsideCount} <Badge variant="warning" dot>Transit</Badge>
              </span>
            </div>
            <div className="w-px self-stretch bg-border" />
            <div>
              <span className="mb-1 block font-label text-label-sm text-muted-foreground">No Device Linked</span>
              <span className="flex items-baseline gap-2 font-headline text-headline-md text-foreground">
                {stats.offlineCount} <Badge variant="destructive" dot>Offline</Badge>
              </span>
            </div>
          </div>
        </div>
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
                        {site.latitude.toFixed(4)}, {site.longitude.toFixed(4)} · r={site.radius_in_meters}m
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
                <span className="h-2.5 w-2.5 rounded-full bg-blue-500" />
                <span className="text-[11px] text-muted-foreground">Medium (40–79%)</span>
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
                    Outside {log.site_id ? siteNameById.get(log.site_id) ?? 'assigned site' : 'any site'} ·{' '}
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
                {recentLogs.slice(0, 5).map((log) => (
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
                          {employeeNameById.get(log.user_id ?? '') ?? 'Unknown device'}
                        </span>
                      </div>
                    </td>
                    <td className="px-4 py-3 text-muted-foreground">
                      {log.site_id ? siteNameById.get(log.site_id) ?? '—' : 'No site'}
                    </td>
                    <td className="px-4 py-3 text-xs text-muted-foreground">
                      {timeAgo(log.timestamp)}
                    </td>
                    <td className="px-4 py-3">
                      <Badge variant={log.is_inside ? 'success' : 'warning'} dot>
                        {log.is_inside ? 'Entry' : 'Exit'}
                      </Badge>
                    </td>
                  </tr>
                ))}
                {recentLogs.length === 0 && (
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
                      {inside} checked in · {sites.length > 0 ? `${pct}% of peak` : ''}
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
