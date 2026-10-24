import { useMemo, useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import {
  fetchDepartments,
  fetchEmployees,
  fetchLocationLogs,
  fetchPresenceSessions,
  fetchSites,
  type EmployeeWithRelations,
} from '@/api/services'
import type { PresenceSession } from '@/types'
import { PageHeader } from '@/components/ui/page-header'
import { StatCard } from '@/components/ui/stat-card'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { EmptyState, ErrorState, PageSkeleton } from '@/components/ui/states'
import { formatHours, initialsFromName } from '@/lib/format'
import { downloadCsv } from '@/lib/format'
import {
  BarChart3,
  Building2,
  CalendarRange,
  Clock3,
  Download,
  MapPinned,
  ShieldCheck,
  Timer,
  TrendingUp,
  Users,
} from 'lucide-react'
import { cn } from '@/lib/utils'

type RangeKey = '7' | '30' | '90' | 'all'

const rangeOptions: Array<{ key: RangeKey; label: string; days: number | null }> = [
  { key: '7', label: '7 days', days: 7 },
  { key: '30', label: '30 days', days: 30 },
  { key: '90', label: '90 days', days: 90 },
  { key: 'all', label: 'All time', days: null },
]

type SessionWithSite = PresenceSession & {
  sites: { name: string; latitude: number; longitude: number } | null
}

function sessionHours(session: SessionWithSite, now = Date.now()) {
  if (session.total_hours !== null && Number.isFinite(session.total_hours)) {
    return Math.max(0, session.total_hours)
  }
  const end = session.exit_timestamp ?? now
  return Math.max(0, (end - session.entry_timestamp) / 3_600_000)
}

function dateKey(timestamp: number) {
  const date = new Date(timestamp)
  return `${date.getFullYear()}-${date.getMonth()}-${date.getDate()}`
}

export function ReportsPage() {
  const [range, setRange] = useState<RangeKey>('30')

  const employeesQuery = useQuery({ queryKey: ['employees'], queryFn: fetchEmployees })
  const departmentsQuery = useQuery({ queryKey: ['departments'], queryFn: fetchDepartments })
  const sitesQuery = useQuery({ queryKey: ['sites'], queryFn: fetchSites })
  const sessionsQuery = useQuery({ queryKey: ['presence-sessions'], queryFn: () => fetchPresenceSessions() })

  const employees = employeesQuery.data ?? []
  const departments = departmentsQuery.data ?? []
  const sites = sitesQuery.data ?? []
  const allSessions = (sessionsQuery.data ?? []) as SessionWithSite[]

  const days = rangeOptions.find((option) => option.key === range)?.days ?? null
  const startMs = days ? Date.now() - days * 86_400_000 : null

  const logsQuery = useQuery({
    queryKey: ['report-location-logs', range],
    queryFn: () =>
      fetchLocationLogs({
        limit: 1000,
        startDate: startMs ?? undefined,
      }),
  })

  const employeeByUser = useMemo(
    () => new Map(employees.filter((e) => e.user_id).map((e) => [e.user_id as string, e])),
    [employees]
  )
  const siteById = useMemo(() => new Map(sites.map((site) => [site.id, site])), [sites])
  const departmentById = useMemo(
    () => new Map(departments.map((department) => [department.id, department])),
    [departments]
  )

  const sessions = useMemo(
    () =>
      allSessions.filter(
        (session) => startMs === null || session.entry_timestamp >= startMs
      ),
    [allSessions, startMs]
  )

  const logs = logsQuery.data ?? []

  const summary = useMemo(() => {
    const now = Date.now()
    const totalHours = sessions.reduce((total, session) => total + sessionHours(session, now), 0)
    const uniqueEmployees = new Set(sessions.map((session) => session.user_id)).size
    const completed = sessions.filter((session) => session.exit_timestamp !== null)
    const avgHours = sessions.length > 0 ? totalHours / sessions.length : 0
    const inside = logs.filter((log) => log.is_inside).length
    const compliance = logs.length > 0 ? Math.round((inside / logs.length) * 100) : null
    return { totalHours, uniqueEmployees, avgHours, compliance, completed: completed.length }
  }, [logs, sessions])

  const daily = useMemo(() => {
    const dayCount = Math.min(days ?? 30, 30)
    const buckets = Array.from({ length: dayCount }).map((_, index) => {
      const date = new Date()
      date.setHours(0, 0, 0, 0)
      date.setDate(date.getDate() - (dayCount - 1 - index))
      return {
        key: dateKey(date.getTime()),
        label: date.toLocaleDateString(undefined, { month: 'short', day: 'numeric' }),
        hours: 0,
        sessions: 0,
      }
    })
    const bucketByKey = new Map(buckets.map((bucket) => [bucket.key, bucket]))
    sessions.forEach((session) => {
      const bucket = bucketByKey.get(dateKey(session.entry_timestamp))
      if (!bucket) return
      bucket.hours += sessionHours(session)
      bucket.sessions += 1
    })
    const max = Math.max(...buckets.map((bucket) => bucket.hours), 1)
    return { buckets, max }
  }, [days, sessions])

  const siteBreakdown = useMemo(() => {
    const now = Date.now()
    const rows = new Map<string, { name: string; hours: number; sessions: number; employees: Set<string> }>()
    sessions.forEach((session) => {
      const name = session.sites?.name ?? siteById.get(session.site_id)?.name ?? 'Unknown site'
      const current = rows.get(session.site_id) ?? {
        name,
        hours: 0,
        sessions: 0,
        employees: new Set<string>(),
      }
      current.hours += sessionHours(session, now)
      current.sessions += 1
      current.employees.add(session.user_id)
      rows.set(session.site_id, current)
    })
    const total = [...rows.values()].reduce((sum, row) => sum + row.hours, 0)
    return [...rows.entries()]
      .map(([id, row]) => ({
        id,
        name: row.name,
        hours: row.hours,
        sessions: row.sessions,
        employees: row.employees.size,
        share: total > 0 ? Math.round((row.hours / total) * 100) : 0,
      }))
      .sort((a, b) => b.hours - a.hours)
  }, [sessions, siteById])

  const topEmployees = useMemo(() => {
    const now = Date.now()
    const rows = new Map<
      string,
      { employee: EmployeeWithRelations | null; hours: number; sessions: number; sites: Set<string> }
    >()
    sessions.forEach((session) => {
      const employee = employeeByUser.get(session.user_id) ?? null
      const current = rows.get(session.user_id) ?? {
        employee,
        hours: 0,
        sessions: 0,
        sites: new Set<string>(),
      }
      current.hours += sessionHours(session, now)
      current.sessions += 1
      current.sites.add(session.sites?.name ?? siteById.get(session.site_id)?.name ?? 'Unknown')
      rows.set(session.user_id, current)
    })
    return [...rows.entries()]
      .map(([userId, row]) => ({
        userId,
        name: row.employee
          ? `${row.employee.first_name} ${row.employee.last_name}`
          : `Device ${userId.slice(0, 8)}`,
        email: row.employee?.email ?? null,
        department:
          (row.employee?.department_id && departmentById.get(row.employee.department_id)?.name) ||
          'Unassigned',
        hours: row.hours,
        sessions: row.sessions,
        sites: row.sites.size,
      }))
      .sort((a, b) => b.hours - a.hours)
      .slice(0, 10)
  }, [departmentById, employeeByUser, sessions, siteById])

  const departmentBreakdown = useMemo(() => {
    const now = Date.now()
    const rows = new Map<string, { hours: number; sessions: number }>()
    sessions.forEach((session) => {
      const employee = employeeByUser.get(session.user_id)
      const name =
        (employee?.department_id && departmentById.get(employee.department_id)?.name) ||
        'Unassigned'
      const current = rows.get(name) ?? { hours: 0, sessions: 0 }
      current.hours += sessionHours(session, now)
      current.sessions += 1
      rows.set(name, current)
    })
    const total = [...rows.values()].reduce((sum, row) => sum + row.hours, 0)
    return [...rows.entries()]
      .map(([name, row]) => ({
        name,
        ...row,
        share: total > 0 ? Math.round((row.hours / total) * 100) : 0,
      }))
      .sort((a, b) => b.hours - a.hours)
  }, [departmentById, employeeByUser, sessions])

  const isLoading =
    employeesQuery.isLoading ||
    departmentsQuery.isLoading ||
    sitesQuery.isLoading ||
    sessionsQuery.isLoading ||
    logsQuery.isLoading
  const isError =
    employeesQuery.isError ||
    departmentsQuery.isError ||
    sitesQuery.isError ||
    sessionsQuery.isError ||
    logsQuery.isError

  const exportReport = () => {
    const now = Date.now()
    downloadCsv(
      `crewtraxa-attendance-${range}-${new Date().toISOString().slice(0, 10)}.csv`,
      ['Employee', 'Email', 'Department', 'Site', 'Entry', 'Exit', 'Hours', 'Status'],
      sessions.map((session) => {
        const employee = employeeByUser.get(session.user_id)
        return [
          employee ? `${employee.first_name} ${employee.last_name}` : `Device ${session.user_id.slice(0, 8)}`,
          employee?.email ?? '',
          (employee?.department_id && departmentById.get(employee.department_id)?.name) || 'Unassigned',
          session.sites?.name ?? siteById.get(session.site_id)?.name ?? 'Unknown',
          new Date(session.entry_timestamp).toISOString(),
          session.exit_timestamp ? new Date(session.exit_timestamp).toISOString() : '',
          sessionHours(session, now).toFixed(2),
          session.exit_timestamp ? 'Completed' : 'Active',
        ]
      })
    )
  }

  if (isLoading) return <PageSkeleton cards={4} rows={6} />

  if (isError) {
    return (
      <div className="page-shell">
        <PageHeader
          title="Reports"
          description="Attendance, hours, and geofence compliance."
          icon={BarChart3}
        />
        <ErrorState
          description="Report data could not be loaded from Supabase."
          onRetry={() => {
            sessionsQuery.refetch()
            logsQuery.refetch()
          }}
        />
      </div>
    )
  }

  const rangeLabel = rangeOptions.find((option) => option.key === range)?.label ?? '30 days'

  return (
    <div className="page-shell">
      <PageHeader
        eyebrow="Insights"
        title="Reports"
        description="Attendance volume, site utilisation, and geofence compliance from existing records."
        icon={BarChart3}
        actions={
          <Button onClick={exportReport} disabled={sessions.length === 0} className="gap-2">
            <Download className="h-4 w-4" />
            Export CSV
          </Button>
        }
      />

      <div className="flex flex-col gap-3 rounded-xl border border-border/70 bg-card p-3 shadow-sm sm:flex-row sm:items-center sm:justify-between">
        <div className="flex items-center gap-2">
          <CalendarRange className="h-4 w-4 text-muted-foreground" />
          <span className="font-label text-label-md text-foreground">Reporting period</span>
          <span className="text-[11px] text-muted-foreground">
            {sessions.length} sessions · {logs.length} GPS pings sampled
          </span>
        </div>
        <div className="flex flex-wrap gap-1">
          {rangeOptions.map((option) => (
            <button
              key={option.key}
              onClick={() => setRange(option.key)}
              className={cn(
                'rounded-full px-3 py-1.5 font-label text-[11px] transition-colors',
                range === option.key
                  ? 'bg-primary text-primary-foreground'
                  : 'bg-muted text-muted-foreground hover:text-foreground'
              )}
            >
              {option.label}
            </button>
          ))}
        </div>
      </div>

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <StatCard
          label="Hours logged"
          value={formatHours(summary.totalHours)}
          hint={`${summary.completed} completed sessions`}
          icon={Timer}
          tone="teal"
        />
        <StatCard
          label="Total sessions"
          value={sessions.length}
          hint={`${summary.uniqueEmployees} unique employees`}
          icon={Clock3}
          tone="sky"
        />
        <StatCard
          label="Average session"
          value={formatHours(summary.avgHours)}
          hint={`Across ${rangeLabel.toLowerCase()}`}
          icon={TrendingUp}
          tone="emerald"
        />
        <StatCard
          label="Geofence compliance"
          value={summary.compliance === null ? '—' : `${summary.compliance}%`}
          hint={`${logs.filter((log) => log.is_inside).length} of ${logs.length} pings inside`}
          icon={ShieldCheck}
          tone={summary.compliance !== null && summary.compliance < 80 ? 'amber' : 'emerald'}
        />
      </div>

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-[minmax(0,1fr)_320px]">
        <section className="surface-panel p-4">
          <div className="mb-4 flex items-start justify-between gap-3">
            <div>
              <h2 className="font-headline text-headline-sm text-foreground">Daily activity</h2>
              <p className="text-[11px] text-muted-foreground">
                Hours logged per day for the trailing {Math.min(days ?? 30, 30)} days.
              </p>
            </div>
            <Badge variant="outline">
              {formatHours(daily.buckets.reduce((sum, bucket) => sum + bucket.hours, 0))}
            </Badge>
          </div>
          <div className="flex h-48 items-end gap-1.5 sm:gap-2">
            {daily.buckets.map((bucket) => {
              const height = Math.max(3, Math.round((bucket.hours / daily.max) * 100))
              return (
                <div key={bucket.key} className="group flex min-w-0 flex-1 flex-col items-center gap-1.5">
                  <div className="relative flex w-full flex-1 items-end">
                    <div
                      className="w-full rounded-t-md bg-gradient-to-t from-primary/50 to-primary transition-all duration-300 group-hover:from-primary group-hover:to-teal-400"
                      style={{ height: `${height}%` }}
                      title={`${bucket.label}: ${formatHours(bucket.hours)} · ${bucket.sessions} sessions`}
                    />
                  </div>
                  <span className="w-full truncate text-center text-[9px] text-muted-foreground sm:text-[10px]">
                    {bucket.label}
                  </span>
                </div>
              )
            })}
          </div>
        </section>

        <section className="surface-panel p-4">
          <h2 className="font-headline text-headline-sm text-foreground">Coverage</h2>
          <p className="text-[11px] text-muted-foreground">Distribution of tracked activity.</p>
          <div className="mt-4 space-y-4">
            <div>
              <div className="mb-1.5 flex items-center justify-between text-[11px]">
                <span className="inline-flex items-center gap-1.5 text-muted-foreground">
                  <Users className="h-3.5 w-3.5" /> Employees tracked
                </span>
                <span className="font-semibold text-foreground">{summary.uniqueEmployees}</span>
              </div>
              <div className="h-1.5 overflow-hidden rounded-full bg-muted">
                <div
                  className="h-full rounded-full bg-primary"
                  style={{
                    width: `${employees.length > 0 ? Math.min(100, Math.round((summary.uniqueEmployees / employees.length) * 100)) : 0}%`,
                  }}
                />
              </div>
              <p className="mt-1 text-[10px] text-muted-foreground">
                of {employees.length} employees in the directory
              </p>
            </div>
            <div>
              <div className="mb-1.5 flex items-center justify-between text-[11px]">
                <span className="inline-flex items-center gap-1.5 text-muted-foreground">
                  <MapPinned className="h-3.5 w-3.5" /> Sites with activity
                </span>
                <span className="font-semibold text-foreground">
                  {siteBreakdown.length}/{sites.length}
                </span>
              </div>
              <div className="h-1.5 overflow-hidden rounded-full bg-muted">
                <div
                  className="h-full rounded-full bg-emerald-500"
                  style={{
                    width: `${sites.length > 0 ? Math.round((siteBreakdown.length / sites.length) * 100) : 0}%`,
                  }}
                />
              </div>
              <p className="mt-1 text-[10px] text-muted-foreground">
                {logs.length > 0
                  ? `${summary.compliance ?? 0}% of sampled pings were inside a geofence`
                  : 'No GPS pings sampled for this period'}
              </p>
            </div>
            <div>
              <div className="mb-1.5 flex items-center justify-between text-[11px]">
                <span className="inline-flex items-center gap-1.5 text-muted-foreground">
                  <Building2 className="h-3.5 w-3.5" /> Departments represented
                </span>
                <span className="font-semibold text-foreground">{departmentBreakdown.length}</span>
              </div>
              <div className="h-1.5 overflow-hidden rounded-full bg-muted">
                <div
                  className="h-full rounded-full bg-sky-500"
                  style={{
                    width: `${departments.length > 0 ? Math.round((departmentBreakdown.length / departments.length) * 100) : 0}%`,
                  }}
                />
              </div>
              <p className="mt-1 text-[10px] text-muted-foreground">
                of {departments.length} configured departments
              </p>
            </div>
          </div>
        </section>
      </div>

      <div className="grid grid-cols-1 gap-4 xl:grid-cols-2">
        <section className="surface-panel overflow-hidden">
          <div className="flex items-center justify-between border-b border-border/70 px-4 py-3.5">
            <div>
              <h2 className="font-headline text-headline-sm text-foreground">Site utilisation</h2>
              <p className="text-[11px] text-muted-foreground">Hours logged per work site.</p>
            </div>
            <Badge variant="outline">{siteBreakdown.length} sites</Badge>
          </div>
          {siteBreakdown.length === 0 ? (
            <EmptyState
              icon={MapPinned}
              title="No site activity"
              description="No attendance sessions were recorded in this period."
              className="m-4 border-0"
            />
          ) : (
            <div className="divide-y divide-border/60">
              {siteBreakdown.map((row) => (
                <div key={row.id} className="px-4 py-3">
                  <div className="flex items-center justify-between gap-3">
                    <span className="truncate font-label text-label-md text-foreground">
                      {row.name}
                    </span>
                    <span className="shrink-0 font-mono text-[11px] text-muted-foreground">
                      {formatHours(row.hours)}
                    </span>
                  </div>
                  <div className="mt-1.5 flex items-center gap-2">
                    <div className="h-1.5 flex-1 overflow-hidden rounded-full bg-muted">
                      <div
                        className="h-full rounded-full bg-primary/80"
                        style={{ width: `${Math.max(row.share, 2)}%` }}
                      />
                    </div>
                    <span className="w-9 shrink-0 text-right text-[10px] text-muted-foreground">
                      {row.share}%
                    </span>
                  </div>
                  <p className="mt-1 text-[10px] text-muted-foreground">
                    {row.sessions} sessions · {row.employees} employees
                  </p>
                </div>
              ))}
            </div>
          )}
        </section>

        <section className="surface-panel overflow-hidden">
          <div className="flex items-center justify-between border-b border-border/70 px-4 py-3.5">
            <div>
              <h2 className="font-headline text-headline-sm text-foreground">Top employees</h2>
              <p className="text-[11px] text-muted-foreground">Ranked by hours logged.</p>
            </div>
            <Badge variant="outline">Top 10</Badge>
          </div>
          {topEmployees.length === 0 ? (
            <EmptyState
              icon={Users}
              title="No employee activity"
              description="No attendance sessions were recorded in this period."
              className="m-4 border-0"
            />
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full border-collapse text-left">
                <thead>
                  <tr className="border-b border-border/70 bg-muted/40">
                    <th className="px-4 py-2 font-label text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
                      Employee
                    </th>
                    <th className="px-4 py-2 font-label text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
                      Department
                    </th>
                    <th className="px-2 py-2 text-right font-label text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
                      Sessions
                    </th>
                    <th className="px-4 py-2 text-right font-label text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
                      Hours
                    </th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-border/60">
                  {topEmployees.map((row) => (
                    <tr key={row.userId} className="row-hover">
                      <td className="px-4 py-2.5">
                        <div className="flex items-center gap-2">
                          <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-primary/10 font-label text-[10px] font-semibold text-primary">
                            {initialsFromName(row.name)}
                          </span>
                          <div className="min-w-0">
                            <p className="truncate font-label text-label-md text-foreground">
                              {row.name}
                            </p>
                            <p className="truncate text-[10px] text-muted-foreground">
                              {row.sites} {row.sites === 1 ? 'site' : 'sites'}
                            </p>
                          </div>
                        </div>
                      </td>
                      <td className="max-w-[140px] truncate px-4 py-2.5 text-body-sm text-muted-foreground">
                        {row.department}
                      </td>
                      <td className="px-2 py-2.5 text-right font-mono text-[11px] text-muted-foreground">
                        {row.sessions}
                      </td>
                      <td className="px-4 py-2.5 text-right font-mono text-[11px] font-semibold text-foreground">
                        {formatHours(row.hours)}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </section>
      </div>

      <section className="surface-panel p-4">
        <div className="mb-4 flex items-center justify-between">
          <div>
            <h2 className="font-headline text-headline-sm text-foreground">Department mix</h2>
            <p className="text-[11px] text-muted-foreground">Share of total hours logged.</p>
          </div>
          <Building2 className="h-4 w-4 text-muted-foreground" />
        </div>
        {departmentBreakdown.length === 0 ? (
          <p className="py-6 text-center text-body-sm text-muted-foreground">
            No department activity in this period.
          </p>
        ) : (
          <div className="grid grid-cols-1 gap-x-8 gap-y-4 sm:grid-cols-2">
            {departmentBreakdown.map((row) => (
              <div key={row.name}>
                <div className="mb-1 flex items-center justify-between text-[11px]">
                  <span className="truncate text-foreground">{row.name}</span>
                  <span className="shrink-0 text-muted-foreground">
                    {formatHours(row.hours)} · {row.share}%
                  </span>
                </div>
                <div className="h-1.5 overflow-hidden rounded-full bg-muted">
                  <div
                    className="h-full rounded-full bg-secondary-foreground/70"
                    style={{ width: `${Math.max(row.share, 2)}%` }}
                  />
                </div>
                <p className="mt-1 text-[10px] text-muted-foreground">{row.sessions} sessions</p>
              </div>
            ))}
          </div>
        )}
      </section>

      <div className="flex flex-col gap-2 rounded-xl border border-border/70 bg-muted/30 px-4 py-3 text-[11px] text-muted-foreground sm:flex-row sm:items-center sm:justify-between">
        <p className="flex items-start gap-2">
          <BarChart3 className="mt-0.5 h-3.5 w-3.5 shrink-0 text-primary" />
          Reports use attendance sessions and a 1,000-ping GPS sample. Active sessions are counted up
          to the current time.
        </p>
        <span className="shrink-0">
          {rangeLabel} · generated {new Date().toLocaleDateString()}
        </span>
      </div>
    </div>
  )
}
