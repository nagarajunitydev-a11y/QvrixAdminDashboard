import { useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import {
  fetchActivePresenceSessions,
  fetchEmployees,
  fetchLocationLogs,
  fetchSites,
} from '@/api/services'
import { PageHeader } from '@/components/ui/page-header'
import { StatCard } from '@/components/ui/stat-card'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { EmptyState, ErrorState, PageSkeleton } from '@/components/ui/states'
import { useToast } from '@/components/ui/toast'
import { formatHours, timeAgo } from '@/lib/format'
import {
  ArrowRight,
  BellRing,
  Check,
  CheckCheck,
  Clock3,
  History,
  MapPinOff,
  RefreshCw,
  Search,
  ShieldAlert,
  SmartphoneNfc,
  Users,
} from 'lucide-react'
import { cn } from '@/lib/utils'

type AlertKind = 'geofence' | 'session' | 'device'
type Severity = 'high' | 'medium' | 'low'

type AlertItem = {
  id: string
  kind: AlertKind
  severity: Severity
  title: string
  description: string
  time: number | null
  href: string
  meta?: string
}

const kindMeta: Record<AlertKind, { label: string; icon: typeof ShieldAlert }> = {
  geofence: { label: 'Geofence', icon: ShieldAlert },
  session: { label: 'Attendance', icon: Clock3 },
  device: { label: 'Device', icon: SmartphoneNfc },
}

const severityMeta: Record<
  Severity,
  { label: string; badge: 'destructive' | 'warning' | 'secondary'; ring: string; icon: string }
> = {
  high: {
    label: 'High',
    badge: 'destructive',
    ring: 'border-red-500/25 bg-red-500/[0.04]',
    icon: 'bg-red-500/10 text-red-600 dark:text-red-400',
  },
  medium: {
    label: 'Medium',
    badge: 'warning',
    ring: 'border-amber-500/25 bg-amber-500/[0.04]',
    icon: 'bg-amber-500/10 text-amber-600 dark:text-amber-400',
  },
  low: {
    label: 'Low',
    badge: 'secondary',
    ring: 'border-border/70',
    icon: 'bg-muted text-muted-foreground',
  },
}

export function AlertsPage() {
  const queryClient = useQueryClient()
  const { toast } = useToast()
  const [filter, setFilter] = useState<'all' | AlertKind>('all')
  const [search, setSearch] = useState('')
  const [reviewed, setReviewed] = useState<Set<string>>(new Set())

  const logsQuery = useQuery({
    queryKey: ['alert-location-logs'],
    queryFn: () => fetchLocationLogs({ limit: 250 }),
  })
  const employeesQuery = useQuery({ queryKey: ['employees'], queryFn: fetchEmployees })
  const sitesQuery = useQuery({ queryKey: ['sites'], queryFn: fetchSites })
  const sessionsQuery = useQuery({
    queryKey: ['active-presence-sessions'],
    queryFn: fetchActivePresenceSessions,
  })

  const employees = employeesQuery.data ?? []
  const sites = sitesQuery.data ?? []
  const logs = logsQuery.data ?? []
  const sessions = sessionsQuery.data ?? []

  const employeeByUser = useMemo(
    () => new Map(employees.filter((e) => e.user_id).map((e) => [e.user_id as string, e])),
    [employees]
  )
  const siteById = useMemo(() => new Map(sites.map((site) => [site.id, site])), [sites])

  const alerts = useMemo<AlertItem[]>(() => {
    const items: AlertItem[] = []

    logs
      .filter((log) => !log.is_inside)
      .slice(0, 40)
      .forEach((log) => {
        const employee = employeeByUser.get(log.user_id)
        const name = employee
          ? `${employee.first_name} ${employee.last_name}`
          : `Device ${log.user_id.slice(0, 8)}`
        const siteName = log.site_id ? siteById.get(log.site_id)?.name ?? 'assigned site' : 'any site'
        items.push({
          id: `geofence-${log.id}`,
          kind: 'geofence',
          severity: 'high',
          title: `${name} is outside the geofence`,
          description: `${Math.round(log.distance_to_site)} m from ${siteName}. Accuracy ±${Math.round(log.accuracy)} m.`,
          time: log.timestamp,
          href: '/history',
          meta: siteName,
        })
      })

    sessions
      .filter((session) => !session.exit_timestamp)
      .forEach((session) => {
        const hours = (Date.now() - session.entry_timestamp) / 3_600_000
        if (hours < 10) return
        const employee = employeeByUser.get(session.user_id)
        const name = employee
          ? `${employee.first_name} ${employee.last_name}`
          : `Device ${session.user_id.slice(0, 8)}`
        items.push({
          id: `session-${session.id}`,
          kind: 'session',
          severity: hours >= 14 ? 'high' : 'medium',
          title: hours >= 14 ? 'Unusually long on-site session' : 'Long on-site session',
          description: `${name} has been checked in for ${formatHours(hours)} at ${
            siteById.get(session.site_id)?.name ?? 'a work site'
          }.`,
          time: session.entry_timestamp,
          href: '/attendance',
          meta: siteById.get(session.site_id)?.name ?? 'Work site',
        })
      })

    employees
      .filter((employee) => !employee.user_id && employee.is_active)
      .forEach((employee) => {
        items.push({
          id: `device-${employee.id}`,
          kind: 'device',
          severity: 'low',
          title: 'Employee has no linked device',
          description: `${employee.first_name} ${employee.last_name} cannot be tracked until an app account is linked.`,
          time: null,
          href: '/employees',
          meta: employee.email,
        })
      })

    return items.sort((a, b) => {
      const severityOrder = { high: 0, medium: 1, low: 2 }
      return (
        severityOrder[a.severity] - severityOrder[b.severity] ||
        (b.time ?? 0) - (a.time ?? 0)
      )
    })
  }, [employeeByUser, employees, logs, sessions, siteById])

  const visible = useMemo(() => {
    const query = search.trim().toLowerCase()
    return alerts.filter((alert) => {
      if (filter !== 'all' && alert.kind !== filter) return false
      if (!query) return true
      return `${alert.title} ${alert.description} ${alert.meta ?? ''}`
        .toLowerCase()
        .includes(query)
    })
  }, [alerts, filter, search])

  const counts = useMemo(
    () => ({
      high: alerts.filter((alert) => alert.severity === 'high').length,
      medium: alerts.filter((alert) => alert.severity === 'medium').length,
      low: alerts.filter((alert) => alert.severity === 'low').length,
      unreviewed: alerts.filter((alert) => !reviewed.has(alert.id)).length,
    }),
    [alerts, reviewed]
  )

  const isLoading =
    logsQuery.isLoading ||
    employeesQuery.isLoading ||
    sitesQuery.isLoading ||
    sessionsQuery.isLoading
  const isError =
    logsQuery.isError || employeesQuery.isError || sitesQuery.isError || sessionsQuery.isError

  const refresh = () => {
    queryClient.invalidateQueries({ queryKey: ['alert-location-logs'] })
    queryClient.invalidateQueries({ queryKey: ['employees'] })
    queryClient.invalidateQueries({ queryKey: ['sites'] })
    queryClient.invalidateQueries({ queryKey: ['active-presence-sessions'] })
  }

  const toggleReviewed = (alert: AlertItem) => {
    setReviewed((current) => {
      const next = new Set(current)
      if (next.has(alert.id)) {
        next.delete(alert.id)
        toast({ title: 'Alert reopened', variant: 'info' })
      } else {
        next.add(alert.id)
        toast({ title: 'Alert marked reviewed', description: alert.title })
      }
      return next
    })
  }

  if (isLoading) return <PageSkeleton cards={3} rows={6} />

  if (isError) {
    return (
      <div className="page-shell">
        <PageHeader
          title="Alerts"
          description="Geofence exceptions, long sessions, and device gaps."
          icon={BellRing}
        />
        <ErrorState description="Alerts could not be derived from the current data." onRetry={refresh} />
      </div>
    )
  }

  return (
    <div className="page-shell">
      <PageHeader
        eyebrow="Operations"
        title="Alerts"
        description="Exceptions derived from GPS pings, active attendance sessions, and device linkage."
        icon={BellRing}
        actions={
          <>
            <Badge variant={counts.unreviewed > 0 ? 'warning' : 'success'} dot>
              {counts.unreviewed} open
            </Badge>
            <Button variant="outline" onClick={refresh} className="gap-2">
              <RefreshCw className={cn('h-4 w-4', logsQuery.isFetching && 'animate-spin')} />
              Refresh
            </Button>
          </>
        }
      />

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
        <StatCard
          label="High priority"
          value={counts.high}
          hint="Geofence breaches and 14h+ sessions"
          icon={ShieldAlert}
          tone="red"
        />
        <StatCard
          label="Medium priority"
          value={counts.medium}
          hint="Long sessions needing review"
          icon={Clock3}
          tone="amber"
        />
        <StatCard
          label="Data quality"
          value={counts.low}
          hint="Active employees without linked devices"
          icon={SmartphoneNfc}
          tone="slate"
        />
      </div>

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-[minmax(0,1fr)_300px]">
        <section className="surface-panel overflow-hidden">
          <div className="flex flex-col gap-3 border-b border-border/70 p-4 sm:flex-row sm:items-center sm:justify-between">
            <div className="flex flex-wrap gap-1">
              {(
                [
                  ['all', 'All alerts'],
                  ['geofence', 'Geofence'],
                  ['session', 'Attendance'],
                  ['device', 'Devices'],
                ] as const
              ).map(([value, label]) => {
                const count =
                  value === 'all' ? alerts.length : alerts.filter((a) => a.kind === value).length
                return (
                  <button
                    key={value}
                    onClick={() => setFilter(value)}
                    className={cn(
                      'inline-flex items-center gap-1.5 rounded-full px-3 py-1.5 font-label text-[11px] transition-colors',
                      filter === value
                        ? 'bg-primary text-primary-foreground'
                        : 'bg-muted text-muted-foreground hover:text-foreground'
                    )}
                  >
                    {label}
                    <span
                      className={cn(
                        'rounded-full px-1.5 text-[9px] tabular-nums',
                        filter === value ? 'bg-white/20' : 'bg-card'
                      )}
                    >
                      {count}
                    </span>
                  </button>
                )
              })}
            </div>
            <div className="relative sm:w-56">
              <Search className="pointer-events-none absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground" />
              <Input
                value={search}
                onChange={(event) => setSearch(event.target.value)}
                placeholder="Search alerts…"
                className="h-8 pl-8 text-body-sm"
                aria-label="Search alerts"
              />
            </div>
          </div>

          {visible.length === 0 ? (
            <EmptyState
              icon={CheckCheck}
              title="No alerts in this view"
              description="Everything derived from the latest tracking data is clear. Refresh to check again."
              className="m-4 border-0"
            />
          ) : (
            <ul className="divide-y divide-border/60">
              {visible.map((alert) => {
                const Icon = kindMeta[alert.kind].icon
                const severity = severityMeta[alert.severity]
                const isReviewed = reviewed.has(alert.id)
                return (
                  <li
                    key={alert.id}
                    className={cn(
                      'flex flex-col gap-3 p-4 transition-colors sm:flex-row sm:items-start',
                      isReviewed ? 'bg-muted/25 opacity-70' : 'hover:bg-muted/20'
                    )}
                  >
                    <span
                      className={cn(
                        'flex h-9 w-9 shrink-0 items-center justify-center rounded-lg ring-1 ring-inset ring-current/10',
                        severity.icon
                      )}
                    >
                      <Icon className="h-4 w-4" />
                    </span>
                    <div className="min-w-0 flex-1">
                      <div className="flex flex-wrap items-center gap-2">
                        <p className="font-label text-label-md font-semibold text-foreground">
                          {alert.title}
                        </p>
                        <Badge variant={severity.badge}>{severity.label}</Badge>
                        <Badge variant="outline">{kindMeta[alert.kind].label}</Badge>
                        {isReviewed && (
                          <Badge variant="success" dot>
                            Reviewed
                          </Badge>
                        )}
                      </div>
                      <p className="mt-1 text-body-sm text-muted-foreground">{alert.description}</p>
                      <div className="mt-2 flex flex-wrap items-center gap-x-3 gap-y-1 text-[11px] text-muted-foreground">
                        {alert.meta && <span className="truncate">{alert.meta}</span>}
                        <span className="inline-flex items-center gap-1">
                          <Clock3 className="h-3 w-3" />
                          {alert.time ? timeAgo(alert.time) : 'No tracking timestamp'}
                        </span>
                        <Link
                          to={alert.href}
                          className="inline-flex items-center gap-1 font-medium text-primary hover:underline"
                        >
                          Investigate <ArrowRight className="h-3 w-3" />
                        </Link>
                      </div>
                    </div>
                    <Button
                      size="sm"
                      variant={isReviewed ? 'ghost' : 'outline'}
                      onClick={() => toggleReviewed(alert)}
                      className="shrink-0 gap-1.5"
                    >
                      <Check className="h-3.5 w-3.5" />
                      {isReviewed ? 'Reopen' : 'Mark reviewed'}
                    </Button>
                  </li>
                )
              })}
            </ul>
          )}

          <div className="border-t border-border/70 px-4 py-2.5 text-[10px] text-muted-foreground">
            Review markers are kept for this page session only. All alerts are derived from existing
            tracking and attendance records.
          </div>
        </section>

        <aside className="space-y-4">
          <div className="surface-panel p-4">
            <h2 className="font-headline text-headline-sm text-foreground">Alert mix</h2>
            <div className="mt-3 space-y-3">
              {(['high', 'medium', 'low'] as const).map((severity) => {
                const count = counts[severity]
                const pct = alerts.length > 0 ? Math.round((count / alerts.length) * 100) : 0
                return (
                  <div key={severity}>
                    <div className="mb-1 flex items-center justify-between text-[11px]">
                      <span className="capitalize text-muted-foreground">{severity}</span>
                      <span className="font-semibold text-foreground">{count}</span>
                    </div>
                    <div className="h-1.5 overflow-hidden rounded-full bg-muted">
                      <div
                        className={cn(
                          'h-full rounded-full',
                          severity === 'high'
                            ? 'bg-red-500'
                            : severity === 'medium'
                              ? 'bg-amber-500'
                              : 'bg-slate-400'
                        )}
                        style={{ width: `${Math.max(pct, count > 0 ? 4 : 0)}%` }}
                      />
                    </div>
                  </div>
                )
              })}
            </div>
          </div>

          <div className="surface-panel p-4">
            <h2 className="font-headline text-headline-sm text-foreground">How alerts work</h2>
            <ul className="mt-3 space-y-2.5 text-body-sm text-muted-foreground">
              <li className="flex gap-2">
                <ShieldAlert className="mt-0.5 h-3.5 w-3.5 shrink-0 text-red-500" />
                A high-priority geofence alert is raised for every recent ping recorded outside a
                work site.
              </li>
              <li className="flex gap-2">
                <Clock3 className="mt-0.5 h-3.5 w-3.5 shrink-0 text-amber-500" />
                Active sessions longer than 10 hours appear here for review. Over 14 hours is high
                priority.
              </li>
              <li className="flex gap-2">
                <MapPinOff className="mt-0.5 h-3.5 w-3.5 shrink-0 text-muted-foreground" />
                Active employees without a linked app account cannot generate location or
                attendance data.
              </li>
            </ul>
          </div>

          <div className="surface-panel p-4">
            <h2 className="font-headline text-headline-sm text-foreground">Quick links</h2>
            <div className="mt-2 flex flex-col">
              <Link
                to="/history"
                className="flex items-center gap-2 border-b border-border/60 py-2.5 text-body-sm text-muted-foreground transition-colors hover:text-primary"
              >
                <History className="h-4 w-4" /> Location history
                <ArrowRight className="ml-auto h-3.5 w-3.5" />
              </Link>
              <Link
                to="/attendance"
                className="flex items-center gap-2 border-b border-border/60 py-2.5 text-body-sm text-muted-foreground transition-colors hover:text-primary"
              >
                <Users className="h-4 w-4" /> Attendance sessions
                <ArrowRight className="ml-auto h-3.5 w-3.5" />
              </Link>
              <Link
                to="/sites"
                className="flex items-center gap-2 py-2.5 text-body-sm text-muted-foreground transition-colors hover:text-primary"
              >
                <ShieldAlert className="h-4 w-4" /> Geofence settings
                <ArrowRight className="ml-auto h-3.5 w-3.5" />
              </Link>
            </div>
          </div>
        </aside>
      </div>

      <div className="flex items-start gap-2 rounded-xl border border-border/70 bg-muted/30 px-4 py-3 text-[11px] text-muted-foreground">
        <SmartphoneNfc className="mt-0.5 h-3.5 w-3.5 shrink-0 text-primary" />
        Alerts are computed in the console and are not stored as separate records. Review status is
        local to this visit.
      </div>
    </div>
  )
}
