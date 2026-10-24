import { useMemo, useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { fetchPresenceSessions, fetchSites, fetchEmployees, type EmployeeWithRelations } from '@/api/services'
import { PresenceSession } from '@/types'
import { DataTable } from '@/components/ui/data-table'
import { Card, CardContent } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { formatDistanceToNow } from 'date-fns'
import { PageHeader } from '@/components/ui/page-header'
import { PageSkeleton } from '@/components/ui/states'
import { MapPin, Users, Radar, Clock3, CalendarRange, CalendarCheck2 } from 'lucide-react'

function initials(name: string) {
  return name
    .split(' ')
    .map((p) => p[0])
    .filter(Boolean)
    .slice(0, 2)
    .join('')
    .toUpperCase()
}

export function PresenceSessionsPage() {
  const [siteFilter, setSiteFilter] = useState<string | null>(null)
  const [employeeFilter, setEmployeeFilter] = useState<string | null>(null)
  const [startDate, setStartDate] = useState<string>('')
  const [endDate, setEndDate] = useState<string>('')

  const { data: sessions = [], isLoading } = useQuery({
    queryKey: ['presence-sessions', { siteId: siteFilter, userId: employeeFilter, startDate, endDate }],
    queryFn: () => fetchPresenceSessions({
      siteId: siteFilter ?? undefined,
      userId: employeeFilter ?? undefined,
      startDate: startDate || undefined,
      endDate: endDate || undefined,
    }),
  })
  const { data: sites = [] } = useQuery({ queryKey: ['sites'], queryFn: fetchSites })
  const { data: employees = [] } = useQuery({ queryKey: ['employees'], queryFn: fetchEmployees })

  const summary = useMemo(() => {
    const active = sessions.filter((s) => !s.exit_timestamp).length
    const completed = sessions.length - active
    const totalHours = sessions.reduce((acc, s) => acc + (s.total_hours ?? 0), 0)
    const avgHours = sessions.length > 0 ? totalHours / sessions.length : 0
    return { active, completed, avgHours }
  }, [sessions])

  if (isLoading) {
    return <PageSkeleton cards={3} rows={6} />
  }

  const siteMap = new Map(sites.map((s) => [s.id, s.name]))
  const employeeMap = new Map(employees.map((e) => [e.user_id, `${e.first_name} ${e.last_name}`]))

  return (
    <div className="page-shell">
      <PageHeader
        eyebrow="Time & attendance"
        title="Attendance & Presence"
        description="Check-in and check-out sessions recorded across all sites."
        icon={CalendarCheck2}
      />

      {/* Summary cards */}
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
        <div className="card-kpi group">
          <div className="mb-2 flex items-start justify-between">
            <span className="font-label text-label-md text-muted-foreground">Currently On Site</span>
            <Radar className="h-4 w-4 text-muted-foreground" />
          </div>
          <span className="font-headline text-headline-lg text-foreground">{summary.active}</span>
          <div className="mt-2 flex items-center gap-1">
            <Badge variant="success" dot>Active</Badge>
          </div>
          <div className="sparkline sparkline-green" />
        </div>
        <div className="card-kpi group">
          <div className="mb-2 flex items-start justify-between">
            <span className="font-label text-label-md text-muted-foreground">Completed Sessions</span>
            <Clock3 className="h-4 w-4 text-muted-foreground" />
          </div>
          <span className="font-headline text-headline-lg text-foreground">{summary.completed}</span>
          <div className="mt-2 flex items-center gap-1">
            <Badge variant="secondary" dot>Closed</Badge>
          </div>
          <div className="sparkline sparkline-blue" />
        </div>
        <div className="card-kpi group">
          <div className="mb-2 flex items-start justify-between">
            <span className="font-label text-label-md text-muted-foreground">Avg. Duration</span>
            <CalendarRange className="h-4 w-4 text-muted-foreground" />
          </div>
          <span className="font-headline text-headline-lg text-foreground">
            {summary.avgHours.toFixed(1)}h
          </span>
          <div className="mt-2 flex items-center gap-1">
            <span className="text-[11px] text-muted-foreground">across {sessions.length} sessions</span>
          </div>
          <div className="sparkline sparkline-amber" />
        </div>
      </div>

      {/* Filters */}
      <div className="flex flex-col gap-4 rounded-xl border border-border bg-card p-4 shadow-sm">
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
          <div className="space-y-1">
            <Label htmlFor="start-date" className="sr-only">Start date</Label>
            <Input
              id="start-date"
              type="date"
              value={startDate}
              onChange={(e) => setStartDate(e.target.value)}
              className="w-40"
            />
          </div>
          <div className="space-y-1">
            <Label htmlFor="end-date" className="sr-only">End date</Label>
            <Input
              id="end-date"
              type="date"
              value={endDate}
              onChange={(e) => setEndDate(e.target.value)}
              className="w-40"
            />
          </div>
        </div>
      </div>

      {/* Sessions table */}
      <Card className="overflow-hidden">
        <CardContent className="p-0 pt-0">
          <DataTable
            columns={[
              {
                header: 'Employee',
                accessor: (row: PresenceSession) => {
                  const name = employeeMap.get(row.user_id) ?? `Device ${row.user_id.slice(0, 8)}`
                  return (
                    <div className="flex items-center gap-3">
                      <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-primary/10 font-label text-label-sm font-semibold text-primary">
                        {employeeMap.has(row.user_id) ? initials(name) : '?'}
                      </div>
                      <span className="truncate font-medium text-foreground">{name}</span>
                    </div>
                  )
                },
              },
              {
                header: 'Site',
                accessor: (row: PresenceSession) => siteMap.get(row.site_id) ?? row.site_id.slice(0, 8),
              },
              {
                header: 'Check-in',
                accessor: (row: PresenceSession) =>
                  formatDistanceToNow(new Date(row.entry_timestamp), { addSuffix: true }),
              },
              {
                header: 'Check-out',
                accessor: (row: PresenceSession) => row.exit_timestamp
                  ? formatDistanceToNow(new Date(row.exit_timestamp), { addSuffix: true })
                  : '—',
              },
              {
                header: 'Duration',
                accessor: (row: PresenceSession) => (
                  <span className="font-label text-label-md">
                    {row.total_hours ? `${row.total_hours.toFixed(2)} hrs` : 'Active'}
                  </span>
                ),
              },
              {
                header: 'Status',
                accessor: (row: PresenceSession) => (
                  <Badge variant={row.exit_timestamp ? 'warning' : 'success'} dot>
                    {row.exit_timestamp ? 'Checked Out' : 'Active'}
                  </Badge>
                ),
              },
              {
                header: 'Synced',
                accessor: (row: PresenceSession) => (
                  <Badge variant={row.is_synced ? 'info' : 'outline'}>
                    {row.is_synced ? 'Yes' : 'Pending'}
                  </Badge>
                ),
              },
            ]}
            data={sessions}
          />
        </CardContent>
      </Card>
    </div>
  )
}
