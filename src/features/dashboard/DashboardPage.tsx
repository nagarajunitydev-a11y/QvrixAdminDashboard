import { dayBoundary, offsetDay, organizationDay } from '@/lib/organizationTime'
import { useOrganization } from '@/hooks/useOrganization'
import { useState } from 'react'
import { Link } from 'react-router-dom'
import { useQuery } from '@tanstack/react-query'

import { useAuth } from '@/api/AuthProvider'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { WorkforceMap } from '@/components/WorkforceMap'
import { EmptyState, PageSkeleton } from '@/components/PageState'
import { downloadCsv } from '@/lib/export'
import {
  Users,
  MapPin,
  CalendarDays,
  Download,
  ArrowUpRight,
  Radar,
  ShieldAlert,
  Clock3,
  ArrowRight,
  Activity,
} from 'lucide-react'
import { formatDistanceToNow } from 'date-fns'

export function DashboardPage() {
  const { activeOrganization } = useOrganization()
  const {
    fetchSites,
    fetchLocationLogs,
    fetchPresenceSessions,
    fetchShifts,
    fetchEmployees,
    fetchActivePresenceSessions,
  } = useOrganization().services

  const { user } = useAuth()
  const [days, setDays] = useState(7)
  const { data: sites = [], isPending: sitesPending } = useQuery({
    queryKey: ['sites'],
    queryFn: fetchSites,
  })
  const { data: employees = [], isPending: employeesPending } = useQuery({
    queryKey: ['employees'],
    queryFn: fetchEmployees,
  })
  const { data: activeSessions = [] } = useQuery({
    queryKey: ['active-presence-sessions'],
    queryFn: fetchActivePresenceSessions,
    refetchInterval: 30000,
  })
  const {
    data: logs = [],
    isError: logsError,
    dataUpdatedAt,
  } = useQuery({
    queryKey: ['recent-location-logs'],
    queryFn: () => fetchLocationLogs({ limit: 500 }),
    refetchInterval: 30000,
  })
  const { data: shifts = [] } = useQuery({
    queryKey: ['shifts'],
    queryFn: fetchShifts,
  })
  const timezone = activeOrganization?.timezone || 'UTC'
  const firstDay = offsetDay(organizationDay(new Date(), timezone), 1 - days)
  const startDate = dayBoundary(firstDay, timezone)
  const { data: sessions = [], isError: sessionsError } = useQuery({
    queryKey: ['presence-sessions', 'overview', days, timezone, firstDay],
    queryFn: () => fetchPresenceSessions({ startDate }),
  })
  const activeUsers = new Set(activeSessions.map((s) => s.user_id))
  const activeEmployees = employees.filter((e) => e.is_active)
  const latestLogs = new Map<string, (typeof logs)[number]>()
  logs.forEach((log) => {
    if (!latestLogs.has(log.user_id)) latestLogs.set(log.user_id, log)
  })
  const outsideCount = [...latestLogs.values()].filter(
    (l) => !l.is_inside,
  ).length
  const alerts = [...latestLogs.values()]
    .filter((l) => !l.is_inside)
    .slice(0, 3)
  const employeeName = (id: string) => {
    const employee = employees.find((e) => e.user_id === id)
    return employee
      ? `${employee.first_name} ${employee.last_name}`
      : `Account ${id.slice(0, 8)}`
  }
  const siteName = (id: string | null) =>
    sites.find((s) => s.id === id)?.name || 'Unassigned site'
  const trend = Array.from({ length: days }, (_, i) => {
    const day = offsetDay(firstDay, i)
    const date = new Date(dayBoundary(day, timezone))
    const daySessions = sessions.filter(
      (s) => organizationDay(s.entry_timestamp, timezone) === day,
    )
    return { date, count: new Set(daySessions.map((s) => s.user_id)).size }
  })
  const maxAttendance = Math.max(1, ...trend.map((d) => d.count))
  const name =
    user?.user_metadata?.full_name?.split(' ')[0] ||
    user?.email?.split('@')[0] ||
    'there'
  const exportReport = () =>
    downloadCsv(
      `crewtraxa-workforce-${new Date().toISOString().slice(0, 10)}.csv`,
      ['First name', 'Last name', 'Email', 'Department', 'Shift', 'Active'],
      employees.map((e) => [
        e.first_name,
        e.last_name,
        e.email,
        e.departments?.name,
        e.shifts?.name,
        e.is_active,
      ]),
    )
  if (sitesPending || employeesPending) return <PageSkeleton />
  return (
    <div className="mx-auto max-w-[1440px] space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-4">
        <div>
          <p className="eyebrow mb-2 flex items-center gap-2">
            <span className="h-1.5 w-1.5 rounded-full bg-primary" />
            {activeOrganization?.branding.display_name ||
              activeOrganization?.name}
          </p>
          <h1 className="page-heading">
            Welcome back, {name}
            <span className="text-primary">.</span>
          </h1>
          <p className="page-subtitle">
            A clear view of your people, places, and daily operations.
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <span className="flex items-center gap-2 rounded-lg border bg-card px-3 py-2 text-xs text-muted-foreground">
            <CalendarDays className="h-3.5 w-3.5" />
            {new Date().toLocaleDateString(undefined, {
              timeZone: timezone,
              month: 'short',
              day: 'numeric',
              year: 'numeric',
            })}
          </span>
          <Button onClick={exportReport}>
            <Download className="h-3.5 w-3.5" />
            Export report
          </Button>
        </div>
      </div>
      <div className="grid grid-cols-2 gap-3 xl:grid-cols-4">
        {[
          {
            label: 'Total employees',
            value: employees.length,
            detail: `${activeEmployees.length} active employee accounts`,
            icon: Users,
            to: '/employees',
          },
          {
            label: 'Currently on site',
            value: activeUsers.size,
            detail: 'Unique employees with open sessions',
            icon: Radar,
            to: '/presence',
          },
          {
            label: 'Outside geofence',
            value: logsError ? '—' : outsideCount,
            detail: 'Latest location per reporting account',
            icon: ShieldAlert,
            to: '/alerts',
          },
          {
            label: 'Managed sites',
            value: sites.length,
            detail: `${shifts.length} configured shifts`,
            icon: MapPin,
            to: '/sites',
          },
        ].map(({ label, value, detail, icon: Icon, to }) => (
          <Link
            key={label}
            to={to}
            className="card-kpi group transition hover:-translate-y-0.5 hover:border-primary/30"
          >
            <div className="flex items-center justify-between gap-2">
              <span className="text-xs font-medium text-muted-foreground">
                {label}
              </span>
              <span className="rounded-lg bg-primary/[.06] p-2 text-primary">
                <Icon className="h-4 w-4" />
              </span>
            </div>
            <div className="mt-2 flex items-center justify-between">
              <span className="font-headline text-[32px] font-semibold tracking-tight tabular-nums">
                {value}
              </span>
              <ArrowUpRight className="h-4 w-4 text-muted-foreground/40 transition group-hover:text-primary" />
            </div>
            <p className="mt-2 text-[10px] leading-relaxed text-muted-foreground">
              {detail}
            </p>
          </Link>
        ))}
      </div>
      <div className="grid gap-5 xl:grid-cols-[1.7fr_1fr]">
        <section className="card overflow-hidden">
          <div className="section-heading">
            <div>
              <h2>Workforce live view</h2>
              <p className="mt-1 text-[11px] text-muted-foreground">
                Last reported positions · refreshes every 30s
              </p>
            </div>
            <Link
              to="/live-tracking"
              className="flex items-center gap-1 text-xs font-medium text-primary"
            >
              Open tracking
              <ArrowUpRight className="h-3.5 w-3.5" />
            </Link>
          </div>
          <div className="h-[330px]">
            <WorkforceMap sites={sites} logs={logs} employees={employees} />
          </div>
          <div className="flex items-center justify-between border-t px-5 py-3 text-[10px] text-muted-foreground">
            <span>{latestLogs.size} accounts in the latest 500 records</span>
            <span className="flex items-center gap-1.5">
              <span
                className={`h-1.5 w-1.5 rounded-full ${logsError ? 'bg-amber-500' : 'bg-primary'}`}
              />
              {logsError
                ? 'Update failed'
                : dataUpdatedAt
                  ? `Updated ${new Date(dataUpdatedAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}`
                  : 'Waiting for updates'}
            </span>
          </div>
        </section>
        <section className="card flex flex-col overflow-hidden">
          <div className="section-heading">
            <div>
              <h2>Attendance trends</h2>
              <p className="mt-1 text-[11px] text-muted-foreground">
                Unique employees checked in per day
              </p>
            </div>
            <select
              aria-label="Attendance chart period"
              value={days}
              onChange={(e) => setDays(Number(e.target.value))}
              className="rounded-lg border bg-background px-2 py-1.5 text-[11px]"
            >
              <option value={7}>7 days</option>
              <option value={14}>14 days</option>
            </select>
          </div>
          <div className="flex-1 p-5">
            <div className="mb-4 flex items-end justify-between">
              <div>
                <span className="text-[30px] font-semibold tracking-tight">
                  {sessionsError
                    ? '—'
                    : new Set(sessions.map((s) => s.user_id)).size}
                </span>
                <span className="ml-2 text-xs text-muted-foreground">
                  employees
                </span>
              </div>
              <span className="flex items-center gap-1.5 text-[10px] text-muted-foreground">
                <span className="h-2 w-2 rounded-sm bg-primary" />
                Check-ins
              </span>
            </div>
            {sessionsError ? (
              <EmptyState
                title="Attendance unavailable"
                description="Use the refresh control to try loading attendance again."
              />
            ) : (
              <div
                className="relative flex h-[190px] items-end justify-between gap-2 border-b bg-[linear-gradient(to_top,transparent_calc(100%-1px),#e8eef0_1px)] bg-[length:100%_25%]"
                role="img"
                aria-label={trend
                  .map(
                    (d) =>
                      `${d.date.toLocaleDateString(undefined, { timeZone: timezone })}: ${d.count} employees`,
                  )
                  .join('; ')}
              >
                {trend.map(({ date, count }) => (
                  <div
                    key={date.toISOString()}
                    className="group relative flex h-full flex-1 items-end justify-center"
                  >
                    <div
                      className="trend-bar"
                      style={{
                        height: `${count ? Math.max(4, (count / maxAttendance) * 90) : 0}%`,
                      }}
                    />
                    <span className="absolute bottom-full z-10 hidden whitespace-nowrap rounded bg-foreground px-2 py-1 text-[10px] text-white group-hover:block">
                      {count} checked in
                    </span>
                    <span className="absolute -bottom-6 text-[9px] text-muted-foreground">
                      {date.toLocaleDateString(undefined, {
                        timeZone: timezone,
                        weekday: 'narrow',
                      })}
                    </span>
                    <span className="sr-only">
                      {date.toLocaleDateString(undefined, {
                        timeZone: timezone,
                      })}
                      : {count}
                    </span>
                  </div>
                ))}
              </div>
            )}
          </div>
          <Link
            to="/presence"
            className="mt-7 flex items-center justify-between border-t px-5 py-3 text-xs text-muted-foreground"
          >
            Explore attendance
            <ArrowRight className="h-3.5 w-3.5" />
          </Link>
        </section>
      </div>
      <div className="grid gap-5 xl:grid-cols-[1.7fr_1fr]">
        <section className="card overflow-hidden">
          <div className="section-heading">
            <div className="flex items-center gap-2">
              <Activity className="h-4 w-4 text-primary" />
              <h2>Recent employee activity</h2>
            </div>
            <Link
              to="/location-logs"
              className="text-xs font-medium text-primary"
            >
              View all activity
            </Link>
          </div>
          {logs.length === 0 ? (
            <EmptyState
              title={
                logsError
                  ? 'Activity unavailable'
                  : 'Ready for your first update'
              }
              description="Employee location reports will appear here as they arrive."
            />
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-left text-xs">
                <thead className="border-b bg-muted/50 text-[10px] uppercase tracking-wide text-muted-foreground">
                  <tr>
                    <th className="px-5 py-3 font-medium">Employee</th>
                    <th className="px-4 py-3 font-medium">Site</th>
                    <th className="px-4 py-3 font-medium">Location status</th>
                    <th className="px-4 py-3 font-medium">Reported</th>
                  </tr>
                </thead>
                <tbody className="divide-y">
                  {logs.slice(0, 5).map((log) => (
                    <tr key={log.id} className="row-hover">
                      <td className="px-5 py-4">
                        <div className="flex items-center gap-2.5">
                          <span className="avatar h-7 w-7 text-[9px]">
                            {employeeName(log.user_id)
                              .split(' ')
                              .map((n) => n[0])
                              .slice(0, 2)
                              .join('')}
                          </span>
                          <span className="whitespace-nowrap font-medium">
                            {employeeName(log.user_id)}
                          </span>
                        </div>
                      </td>
                      <td className="px-4 py-4 text-muted-foreground">
                        {siteName(log.site_id)}
                      </td>
                      <td className="px-4 py-4">
                        <Badge
                          dot
                          variant={log.is_inside ? 'success' : 'warning'}
                        >
                          {log.is_inside ? 'Inside site' : 'Outside site'}
                        </Badge>
                      </td>
                      <td className="whitespace-nowrap px-4 py-4 text-muted-foreground">
                        {formatDistanceToNow(log.timestamp, {
                          addSuffix: true,
                        })}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </section>
        <section className="card overflow-hidden">
          <div className="section-heading">
            <div className="flex items-center gap-2">
              <ShieldAlert className="h-4 w-4 text-amber-600" />
              <h2>Needs your attention</h2>
            </div>
            <Link to="/alerts" className="text-xs text-primary">
              View alerts
            </Link>
          </div>
          {alerts.length === 0 ? (
            <EmptyState
              title={
                logsError ? 'Alerts unavailable' : 'No alerts in recent reports'
              }
              description="Outside-geofence reports from the latest location records appear here."
            />
          ) : (
            <div className="divide-y px-5">
              {alerts.map((log) => (
                <Link
                  to="/alerts"
                  key={log.id}
                  className="flex items-start gap-3 py-4"
                >
                  <span className="mt-0.5 rounded-lg bg-amber-50 p-2 text-amber-700">
                    <MapPin className="h-3.5 w-3.5" />
                  </span>
                  <div className="flex-1">
                    <p className="text-xs font-medium">
                      {employeeName(log.user_id)}
                    </p>
                    <p className="mt-1 text-[11px] leading-relaxed text-muted-foreground">
                      Outside {siteName(log.site_id)} ·{' '}
                      {Math.round(log.distance_to_site)}m away
                    </p>
                    <p className="mt-1.5 text-[10px] text-muted-foreground">
                      {formatDistanceToNow(log.timestamp, { addSuffix: true })}
                    </p>
                  </div>
                  <ChevronIcon />
                </Link>
              ))}
            </div>
          )}
        </section>
      </div>
      <section className="card overflow-hidden">
        <div className="section-heading">
          <div className="flex items-center gap-2">
            <Clock3 className="h-4 w-4 text-primary" />
            <h2>Shift overview</h2>
          </div>
          <Link to="/shifts" className="text-xs font-medium text-primary">
            Manage shifts
          </Link>
        </div>
        {shifts.length === 0 ? (
          <EmptyState
            title="Build a rhythm for your team"
            description="Create shifts and assign employees to see your coverage here."
          />
        ) : (
          <div className="grid divide-y sm:grid-cols-2 sm:divide-y-0 xl:grid-cols-4">
            {shifts.slice(0, 4).map((shift) => (
              <div key={shift.id} className="border-r p-5 last:border-r-0">
                <p className="text-xs font-semibold">{shift.name}</p>
                <p className="mt-2 text-[11px] text-muted-foreground">
                  {shift.start_time.slice(0, 5)} – {shift.end_time.slice(0, 5)}
                </p>
                <div className="mt-4 flex items-center justify-between">
                  <span className="text-xl font-semibold">
                    {employees.filter((e) => e.shift_id === shift.id).length}
                    <span className="ml-2 text-[10px] font-normal text-muted-foreground">
                      assigned
                    </span>
                  </span>
                  <Badge variant="outline">
                    {shift.departments?.name || 'All departments'}
                  </Badge>
                </div>
              </div>
            ))}
          </div>
        )}
      </section>
      <footer className="flex flex-wrap justify-between gap-2 pb-1 text-[10px] text-muted-foreground">
        <span>
          Crewtraxa Console <span className="mx-2 text-border">/</span> Every
          Team. Every Site. In Sync.
        </span>
        <span>Built around your people.</span>
      </footer>
    </div>
  )
}
function ChevronIcon() {
  return <ArrowUpRight className="mt-1 h-3.5 w-3.5 text-muted-foreground" />
}
