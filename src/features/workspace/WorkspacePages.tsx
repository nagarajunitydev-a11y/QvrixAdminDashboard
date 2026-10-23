import {
  dayBoundary,
  dayEnd,
  offsetDay,
  organizationDay,
} from '@/lib/organizationTime'
import { useOrganization } from '@/hooks/useOrganization'
import { useState } from 'react'
import { Link } from 'react-router-dom'
import { useQuery } from '@tanstack/react-query'

import { WorkforceMap } from '@/components/WorkforceMap'
import { DataTable } from '@/components/ui/data-table'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { PageSkeleton } from '@/components/PageState'
import { downloadCsv } from '@/lib/export'
import {
  Download,
  MapPin,
  Radio,
  Smartphone,
  ArrowUpRight,
  CalendarDays,
} from 'lucide-react'
import { formatDistanceToNow } from 'date-fns'

function useWorkforceData() {
  const { fetchSites, fetchLocationLogs, fetchEmployees } =
    useOrganization().services

  const employeeQuery = useQuery({
    queryKey: ['employees'],
    queryFn: fetchEmployees,
  })
  const siteQuery = useQuery({ queryKey: ['sites'], queryFn: fetchSites })
  const logsQuery = useQuery({
    queryKey: ['recent-location-logs'],
    queryFn: () => fetchLocationLogs({ limit: 500 }),
    refetchInterval: 30000,
  })
  const employees = employeeQuery.data || []
  const sites = siteQuery.data || []
  const logs = logsQuery.data || []
  const name = (id: string) => {
    const e = employees.find((e) => e.user_id === id)
    return e ? `${e.first_name} ${e.last_name}` : `Account ${id.slice(0, 8)}`
  }
  const siteName = (id: string | null) =>
    sites.find((s) => s.id === id)?.name || 'No site'
  return {
    employees,
    sites,
    logs,
    name,
    siteName,
    pending:
      employeeQuery.isPending || siteQuery.isPending || logsQuery.isPending,
    logsError: logsQuery.isError,
  }
}

function Heading({
  title,
  description,
}: {
  title: string
  description: string
}) {
  return (
    <div>
      <p className="eyebrow mb-2">TRACKORA WORKSPACE</p>
      <h1 className="page-heading">{title}</h1>
      <p className="page-subtitle">{description}</p>
    </div>
  )
}

export function LiveTrackingPage() {
  const { employees, sites, logs, name, siteName, pending, logsError } =
    useWorkforceData()
  const [siteFilter, setSiteFilter] = useState('')
  const [selection, setSelection] = useState({ user: '', revision: 0 })
  const [status, setStatus] = useState('all')
  const latest = new Map<string, (typeof logs)[number]>()
  logs.forEach((log) => {
    if (!latest.has(log.user_id)) latest.set(log.user_id, log)
  })
  const filtered = [...latest.values()].filter(
    (log) =>
      (!siteFilter || log.site_id === siteFilter) &&
      (status === 'all' || log.is_inside === (status === 'inside')),
  )
  if (pending) return <PageSkeleton />
  return (
    <div className="mx-auto max-w-[1440px] space-y-6">
      <Heading
        title="Live tracking"
        description="Your people, in perspective. Explore the latest reported locations and site boundaries."
      />
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex flex-wrap gap-3">
          <select
            aria-label="Filter tracking by site"
            value={siteFilter}
            onChange={(e) => setSiteFilter(e.target.value)}
            className="h-9 rounded-lg border bg-card px-3 text-xs"
          >
            <option value="">All sites</option>
            {sites.map((site) => (
              <option key={site.id} value={site.id}>
                {site.name}
              </option>
            ))}
          </select>
          <select
            aria-label="Filter location status"
            value={status}
            onChange={(e) => setStatus(e.target.value)}
            className="h-9 rounded-lg border bg-card px-3 text-xs"
          >
            <option value="all">All statuses</option>
            <option value="inside">Inside geofence</option>
            <option value="outside">Outside geofence</option>
          </select>
        </div>
        <span className="flex items-center gap-2 text-xs text-muted-foreground">
          <Radio className="h-3.5 w-3.5 text-primary" />
          {logsError ? 'Updates unavailable' : 'Refreshes every 30 seconds'}
        </span>
      </div>
      <section className="card overflow-hidden">
        <div className="h-[440px]">
          <WorkforceMap
            sites={
              siteFilter ? sites.filter((s) => s.id === siteFilter) : sites
            }
            logs={filtered}
            employees={employees}
            selectedUser={selection.user}
            selectionRevision={selection.revision}
          />
        </div>
      </section>
      <section className="card overflow-hidden">
        <div className="section-heading">
          <h2>Last reported positions</h2>
          <span className="text-[11px] text-muted-foreground">
            Latest per account from 500 location records
          </span>
        </div>
        <DataTable
          data={filtered}
          columns={[
            { header: 'Employee', accessor: (row) => name(row.user_id) },
            { header: 'Site', accessor: (row) => siteName(row.site_id) },
            {
              header: 'Status',
              accessor: (row) => (
                <Badge dot variant={row.is_inside ? 'success' : 'warning'}>
                  {row.is_inside ? 'Inside site' : 'Outside site'}
                </Badge>
              ),
            },
            {
              header: 'Reported',
              sortValue: (row) => row.timestamp,
              accessor: (row) =>
                formatDistanceToNow(row.timestamp, { addSuffix: true }),
            },
            {
              header: 'Accuracy',
              sortValue: (row) => row.accuracy,
              accessor: (row) => `${row.accuracy.toFixed(1)}m`,
            },
            {
              header: 'Actions',
              accessor: (row) => (
                <Button
                  size="sm"
                  variant="ghost"
                  onClick={() => {
                    setSelection((previous) => ({
                      user: row.user_id,
                      revision: previous.revision + 1,
                    }))
                    document
                      .getElementById('main-content')
                      ?.scrollTo({ top: 0, behavior: 'smooth' })
                  }}
                >
                  <MapPin className="h-3.5 w-3.5" />
                  Locate
                </Button>
              ),
            },
          ]}
        />
      </section>
      <p className="text-xs text-muted-foreground">
        A last reported position may be out of date. Check the report time
        before making operational decisions.
      </p>
    </div>
  )
}

export function AlertsPage() {
  const { logs, name, siteName, pending } = useWorkforceData()
  const [site, setSite] = useState('all')
  if (pending) return <PageSkeleton />
  const alerts = logs.filter(
    (l) =>
      !l.is_inside &&
      (site === 'all' ||
        (site === 'assigned' ? l.site_id !== null : l.site_id === null)),
  )
  return (
    <div className="mx-auto max-w-7xl space-y-6">
      <Heading
        title="Alerts & notifications"
        description="Review outside-geofence location reports and keep your operations in sync."
      />
      <div className="grid gap-4 sm:grid-cols-3">
        {[
          ['Outside-geofence reports', logs.filter((l) => !l.is_inside).length],
          [
            'Affected accounts',
            new Set(logs.filter((l) => !l.is_inside).map((l) => l.user_id))
              .size,
          ],
          ['Location records reviewed', logs.length],
        ].map(([label, value]) => (
          <div className="card-kpi" key={label}>
            <span className="text-xs text-muted-foreground">{label}</span>
            <span className="mt-3 text-3xl font-semibold">{value}</span>
          </div>
        ))}
      </div>
      <div className="flex flex-wrap items-center justify-between gap-3">
        <p className="text-xs text-muted-foreground">
          Based on the latest 500 location records. These are reports, not
          confirmed incidents.
        </p>
        <select
          aria-label="Filter alert assignment"
          value={site}
          onChange={(e) => setSite(e.target.value)}
          className="rounded-lg border bg-card p-2 text-xs"
        >
          <option value="all">All reports</option>
          <option value="assigned">Assigned site</option>
          <option value="unassigned">No site assigned</option>
        </select>
      </div>
      <section className="card overflow-hidden">
        <DataTable
          data={alerts}
          columns={[
            { header: 'Employee', accessor: (row) => name(row.user_id) },
            { header: 'Site', accessor: (row) => siteName(row.site_id) },
            {
              header: 'Status',
              accessor: () => (
                <Badge variant="warning" dot>
                  Outside geofence
                </Badge>
              ),
            },
            {
              header: 'Distance',
              sortValue: (row) => row.distance_to_site,
              accessor: (row) => `${Math.round(row.distance_to_site)}m`,
            },
            {
              header: 'Reported',
              sortValue: (row) => row.timestamp,
              accessor: (row) => new Date(row.timestamp).toLocaleString(),
            },
            {
              header: 'Actions',
              accessor: () => (
                <Button variant="ghost" size="sm" asChild>
                  <Link to="/live-tracking">
                    Review location
                    <ArrowUpRight className="h-3 w-3" />
                  </Link>
                </Button>
              ),
            },
          ]}
        />
      </section>
    </div>
  )
}

export function ReportsPage() {
  const { fetchSites, fetchPresenceSessions, fetchEmployees } =
    useOrganization().services

  const { activeOrganization } = useOrganization()
  const timezone = activeOrganization?.timezone || 'UTC'
  const [start, setStart] = useState(() =>
    offsetDay(organizationDay(new Date(), timezone), -6),
  )
  const [end, setEnd] = useState(() => organizationDay(new Date(), timezone))
  const valid = !!start && !!end && start <= end
  const { data: employees = [] } = useQuery({
    queryKey: ['employees'],
    queryFn: fetchEmployees,
  })
  const { data: sites = [] } = useQuery({
    queryKey: ['sites'],
    queryFn: fetchSites,
  })
  const query = useQuery({
    queryKey: ['presence-sessions', 'report', start, end, timezone],
    queryFn: () =>
      fetchPresenceSessions({
        startDate: dayBoundary(start, timezone),
        endDate: dayEnd(end, timezone),
      }),
    enabled: valid,
  })
  const sessions = query.data || []
  const rows = employees.map((e) => {
    const entries = sessions.filter((s) => s.user_id === e.user_id)
    return {
      id: e.id,
      name: `${e.first_name} ${e.last_name}`,
      department: e.departments?.name || 'Unassigned',
      sessions: entries.length,
      hours: entries.reduce((sum, s) => sum + (s.total_hours ?? 0), 0),
    }
  })
  return (
    <div className="mx-auto max-w-7xl space-y-6">
      <Heading
        title="Reports & insights"
        description="Turn attendance records into a clear picture of your workforce. Export the details you need."
      />
      <div className="card flex flex-wrap items-end justify-between gap-4 p-5">
        <div className="flex flex-wrap gap-4">
          <label className="text-xs font-medium">
            From
            <input
              aria-label="Report start date"
              type="date"
              value={start}
              max={end}
              onChange={(e) => setStart(e.target.value)}
              className="mt-2 block h-10 rounded-lg border bg-background px-3"
            />
          </label>
          <label className="text-xs font-medium">
            Through
            <input
              aria-label="Report end date"
              type="date"
              value={end}
              min={start}
              onChange={(e) => setEnd(e.target.value)}
              className="mt-2 block h-10 rounded-lg border bg-background px-3"
            />
          </label>
        </div>
        <Button
          disabled={!valid || query.isPending || query.isError}
          onClick={() =>
            downloadCsv(
              `crewtraxa-attendance-${start}-${end}.csv`,
              ['Employee', 'Site', 'Check in', 'Check out', 'Completed hours'],
              sessions.map((s) => [
                employees.find((e) => e.user_id === s.user_id)?.email ||
                  s.user_id,
                sites.find((site) => site.id === s.site_id)?.name || s.site_id,
                new Date(s.entry_timestamp).toISOString(),
                s.exit_timestamp
                  ? new Date(s.exit_timestamp).toISOString()
                  : '',
                s.total_hours,
              ]),
            )
          }
        >
          <Download className="h-4 w-4" />
          Export attendance CSV
        </Button>
      </div>
      {!valid && (
        <p role="alert" className="text-sm text-destructive">
          Choose a valid date range. The end date must be on or after the start
          date.
        </p>
      )}
      <div className="grid gap-4 sm:grid-cols-3">
        {[
          ['Recorded sessions', sessions.length],
          ['Unique employees', new Set(sessions.map((s) => s.user_id)).size],
          [
            'Completed hours',
            sessions
              .reduce((sum, s) => sum + (s.total_hours ?? 0), 0)
              .toFixed(1),
          ],
        ].map(([label, value]) => (
          <div className="card-kpi" key={label}>
            <span className="text-xs text-muted-foreground">{label}</span>
            <span className="mt-3 text-3xl font-semibold">
              {query.isError || !valid ? '—' : value}
            </span>
          </div>
        ))}
      </div>
      <section className="card overflow-hidden">
        <div className="section-heading">
          <h2>Employee attendance summary</h2>
          <span className="flex items-center gap-2 text-xs text-muted-foreground">
            <CalendarDays className="h-3.5 w-3.5" />
            Grouped by session creation date ? {timezone}
          </span>
        </div>
        {query.isPending && valid ? (
          <div className="p-5">
            <PageSkeleton />
          </div>
        ) : (
          <DataTable
            data={valid && !query.isError ? rows : []}
            columns={[
              { header: 'Employee', accessor: 'name' },
              { header: 'Department', accessor: 'department' },
              { header: 'Sessions', accessor: 'sessions' },
              {
                header: 'Completed hours',
                sortValue: (row) => row.hours,
                accessor: (row) => `${row.hours.toFixed(1)}h`,
              },
            ]}
          />
        )}
      </section>
      <p className="text-xs text-muted-foreground">
        Open sessions are included in session counts. Hours reflect completed
        durations stored in attendance records.
      </p>
    </div>
  )
}

export function DevicesPage() {
  const { employees, logs, pending } = useWorkforceData()
  if (pending) return <PageSkeleton />
  const rows = employees.map((e) => ({
    ...e,
    lastReport: logs.find((l) => l.user_id === e.user_id),
  }))
  return (
    <div className="mx-auto max-w-7xl space-y-6">
      <Heading
        title="Device management"
        description="See which employee accounts are linked and when they last reported a location."
      />
      <div className="card flex items-start gap-3 p-5">
        <Smartphone className="mt-0.5 h-5 w-5 text-primary" />
        <div>
          <p className="text-sm font-medium">Employee account connections</p>
          <p className="mt-2 max-w-3xl text-xs leading-relaxed text-muted-foreground">
            Location reports are linked to employee accounts. Device
            identifiers, battery levels, operating systems, and remote device
            controls are not available in this workspace.
          </p>
        </div>
      </div>
      <section className="card overflow-hidden">
        <DataTable
          data={rows}
          columns={[
            {
              header: 'Employee',
              accessor: (row) => `${row.first_name} ${row.last_name}`,
            },
            { header: 'Email', accessor: 'email' },
            {
              header: 'Account link',
              accessor: (row) => (
                <Badge dot variant={row.user_id ? 'success' : 'secondary'}>
                  {row.user_id ? 'Linked' : 'Not linked'}
                </Badge>
              ),
            },
            {
              header: 'Last report',
              sortValue: (row) => row.lastReport?.timestamp || 0,
              accessor: (row) =>
                row.lastReport
                  ? formatDistanceToNow(row.lastReport.timestamp, {
                      addSuffix: true,
                    })
                  : 'Not in recent 500 records',
            },
            {
              header: 'Actions',
              accessor: () => (
                <Button size="sm" variant="ghost" asChild>
                  <Link to="/employees">
                    Manage employee
                    <ArrowUpRight className="h-3 w-3" />
                  </Link>
                </Button>
              ),
            },
          ]}
        />
      </section>
    </div>
  )
}
