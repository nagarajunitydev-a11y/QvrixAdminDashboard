import { useMemo, useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { fetchLocationLogs, fetchSites, fetchEmployees, type EmployeeWithRelations } from '@/api/services'
import { LocationLog } from '@/types'
import { DataTable } from '@/components/ui/data-table'
import { Card, CardContent } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { formatDistanceToNow } from 'date-fns'
import { MapPin, Users, Route, ShieldCheck, ShieldAlert } from 'lucide-react'

function initials(name: string) {
  return name
    .split(' ')
    .map((p) => p[0])
    .filter(Boolean)
    .slice(0, 2)
    .join('')
    .toUpperCase()
}

export function LocationLogsPage() {
  const [siteFilter, setSiteFilter] = useState<string | null>(null)
  const [employeeFilter, setEmployeeFilter] = useState<string | null>(null)

  const { data: logs = [], isLoading } = useQuery({
    queryKey: ['location-logs', { siteId: siteFilter, userId: employeeFilter }],
    queryFn: () => fetchLocationLogs({
      siteId: siteFilter ?? undefined,
      userId: employeeFilter ?? undefined,
      limit: 100,
    }),
  })
  const { data: sites = [] } = useQuery({
    queryKey: ['sites'],
    queryFn: fetchSites,
  })
  const { data: employees = [] } = useQuery({
    queryKey: ['employees'],
    queryFn: fetchEmployees,
  })

  const summary = useMemo(() => {
    const inside = logs.filter((l) => l.is_inside).length
    return { inside, outside: logs.length - inside }
  }, [logs])

  if (isLoading) {
    return (
      <div className="flex justify-center py-16">
        <div className="h-8 w-8 animate-spin rounded-full border-b-2 border-primary" />
      </div>
    )
  }

  const employeeMap = new Map(employees.map((e) => [e.user_id, `${e.first_name} ${e.last_name}`]))
  const siteMap = new Map(sites.map((s) => [s.id, s.name]))

  return (
    <div className="mx-auto max-w-7xl space-y-6">
      <div>
        <h1 className="font-headline text-headline-lg text-foreground">Location History</h1>
        <p className="mt-1 text-body-sm text-muted-foreground">
          GPS location points recorded by employee devices. Showing most recent 100 records.
        </p>
      </div>

      {/* Summary */}
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
        <div className="card-kpi group">
          <div className="mb-2 flex items-start justify-between">
            <span className="font-label text-label-md text-muted-foreground">Total Pings</span>
            <Route className="h-4 w-4 text-muted-foreground" />
          </div>
          <span className="font-headline text-headline-lg text-foreground">{logs.length}</span>
          <span className="mt-2 block text-[11px] text-muted-foreground">latest records</span>
          <div className="sparkline sparkline-blue" />
        </div>
        <div className="card-kpi group">
          <div className="mb-2 flex items-start justify-between">
            <span className="font-label text-label-md text-muted-foreground">Inside Geofence</span>
            <ShieldCheck className="h-4 w-4 text-emerald-500" />
          </div>
          <span className="font-headline text-headline-lg text-foreground">{summary.inside}</span>
          <div className="mt-2">
            <Badge variant="success" dot>Compliant</Badge>
          </div>
          <div className="sparkline sparkline-green" />
        </div>
        <div className="card-kpi group">
          <div className="mb-2 flex items-start justify-between">
            <span className="font-label text-label-md text-muted-foreground">Outside Geofence</span>
            <ShieldAlert className="h-4 w-4 text-red-500" />
          </div>
          <span className="font-headline text-headline-lg text-foreground">{summary.outside}</span>
          <div className="mt-2">
            <Badge variant="destructive" dot>Review</Badge>
          </div>
          <div className="sparkline sparkline-red" />
        </div>
      </div>

      {/* Filters */}
      <div className="flex flex-col gap-4 rounded-xl border border-border bg-card p-4 shadow-sm sm:flex-row sm:items-center sm:justify-between">
        <div className="flex flex-wrap gap-3">
          <div className="min-w-[180px] flex-1 sm:max-w-64">
            <Select value={siteFilter ?? ''} onValueChange={setSiteFilter}>
              <SelectTrigger>
                <MapPin className="mr-2 h-4 w-4 shrink-0" />
                <SelectValue placeholder="Filter by site" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="">All sites</SelectItem>
                {sites.map((s) => (
                  <SelectItem key={s.id} value={s.id}>{s.name}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="min-w-[180px] flex-1 sm:max-w-64">
            <Select value={employeeFilter ?? ''} onValueChange={setEmployeeFilter}>
              <SelectTrigger>
                <Users className="mr-2 h-4 w-4 shrink-0" />
                <SelectValue placeholder="Filter by employee" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="">All employees</SelectItem>
                {employees.filter((e): e is EmployeeWithRelations & { user_id: string } => e.user_id !== null).map((e) => (
                  <SelectItem key={e.user_id} value={e.user_id}>
                    {e.first_name} {e.last_name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        </div>
        <span className="shrink-0 font-label text-label-md text-muted-foreground">
          {logs.length} records found
        </span>
      </div>

      {/* Logs table */}
      <Card className="overflow-hidden">
        <CardContent className="p-0 pt-0">
          <DataTable
            columns={[
              {
                header: 'Employee',
                accessor: (row: LocationLog) => {
                  const name = employeeMap.get(row.user_id) ?? `Device ${row.user_id.slice(0, 8)}`
                  return (
                    <div className="flex items-center gap-3">
                      <div className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-primary/10 font-label text-[10px] font-semibold text-primary">
                        {employeeMap.has(row.user_id) ? initials(name) : '?'}
                      </div>
                      <span className="truncate">{name}</span>
                    </div>
                  )
                },
              },
              {
                header: 'Site',
                accessor: (row: LocationLog) =>
                  row.site_id ? siteMap.get(row.site_id) ?? row.site_id.slice(0, 8) : 'No site',
              },
              {
                header: 'Latitude',
                accessor: (row: LocationLog) => (
                  <span className="font-label text-label-md tabular-nums">{row.latitude.toFixed(6)}</span>
                ),
              },
              {
                header: 'Longitude',
                accessor: (row: LocationLog) => (
                  <span className="font-label text-label-md tabular-nums">{row.longitude.toFixed(6)}</span>
                ),
              },
              {
                header: 'Distance (m)',
                accessor: (row: LocationLog) => (
                  <span className="font-label text-label-md tabular-nums">{row.distance_to_site.toFixed(1)}</span>
                ),
              },
              {
                header: 'Status',
                accessor: (row: LocationLog) => (
                  <Badge variant={row.is_inside ? 'success' : 'destructive'} dot>
                    {row.is_inside ? 'INSIDE' : 'OUTSIDE'}
                  </Badge>
                ),
              },
              {
                header: 'Accuracy',
                accessor: (row: LocationLog) => `${row.accuracy.toFixed(1)}m`,
              },
              {
                header: 'Time',
                accessor: (row: LocationLog) => formatDistanceToNow(new Date(row.timestamp), { addSuffix: true }),
              },
              {
                header: 'Synced',
                accessor: (row: LocationLog) => (
                  <Badge variant={row.is_synced ? 'info' : 'outline'}>
                    {row.is_synced ? 'Yes' : 'Pending'}
                  </Badge>
                ),
              },
            ]}
            data={logs}
          />
        </CardContent>
      </Card>
    </div>
  )
}
