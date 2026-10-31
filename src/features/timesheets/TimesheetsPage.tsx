import { useMemo, useState } from 'react'
import { useSearchParams } from 'react-router-dom'
import { useQuery } from '@tanstack/react-query'
import { AlertTriangle, ArrowLeft, CalendarRange, ChevronLeft, ChevronRight, Clock3, Download, Plus, Search, TimerReset, Users } from 'lucide-react'
import { fetchDepartments, fetchEmployees, fetchSites, fetchTimesheet, type EmployeeWithRelations } from '@/api/services'
import { useOrganization } from '@/api/OrganizationProvider'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { DataTable } from '@/components/ui/data-table'
import { Input } from '@/components/ui/input'
import { PageHeader } from '@/components/ui/page-header'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { StatCard } from '@/components/ui/stat-card'
import { ErrorState, PageSkeleton } from '@/components/ui/states'
import { downloadCsv } from '@/lib/format'
import {
  DAY_TYPE_LABELS,
  FLAG_META,
  clockIn,
  dayLabel,
  groupByEmployee,
  hm,
  overtimeMinutes,
  periodLabel,
  periodRange,
  shiftPeriod,
  timesheetCsv,
  todayIn,
  totalsFor,
  type EmployeeLabel,
  type PeriodKind,
  type TimesheetDay,
} from '@/lib/timesheets'
import { cn } from '@/lib/utils'
import { TimesheetDayDialog } from './TimesheetDayDialog'
import { TimeEntryDialog } from './TimeEntryDialogs'

const ALL = 'all'
const fullName = (e: Pick<EmployeeWithRelations, 'first_name' | 'last_name'>) => `${e.first_name} ${e.last_name}`

function Flags({ flags }: { flags: TimesheetDay['flags'] }) {
  if (!flags.length) return null
  return (
    <div className="flex flex-wrap gap-1">
      {flags.map((flag) => (
        <Badge key={flag} variant={FLAG_META[flag]?.tone ?? 'secondary'} title={FLAG_META[flag]?.description}>
          {FLAG_META[flag]?.label ?? flag}
        </Badge>
      ))}
    </div>
  )
}

export function TimesheetsPage() {
  const { organization, canManage } = useOrganization()
  const timeZone = organization?.timezone ?? 'Asia/Kolkata'
  const [searchParams, setSearchParams] = useSearchParams()
  const kind: PeriodKind = searchParams.get('period') === 'month' ? 'month' : 'week'
  const range = periodRange(kind, searchParams.get('from') ?? todayIn(timeZone))
  const employeeId = searchParams.get('employee')
  const [search, setSearch] = useState('')
  const [department, setDepartment] = useState(ALL)
  const [openDay, setOpenDay] = useState<{ employeeId: string; date: string } | null>(null)
  const [adding, setAdding] = useState(false)

  const update = (changes: Record<string, string | null>) => {
    const next = new URLSearchParams(searchParams)
    for (const [key, value] of Object.entries(changes)) {
      if (value === null) next.delete(key)
      else next.set(key, value)
    }
    setSearchParams(next)
  }

  const { data: employees = [] } = useQuery({ queryKey: ['employees'], queryFn: fetchEmployees })
  const { data: departments = [] } = useQuery({ queryKey: ['departments'], queryFn: fetchDepartments })
  const { data: sites = [] } = useQuery({ queryKey: ['sites'], queryFn: fetchSites })
  const sheet = useQuery({
    queryKey: ['timesheet', range.from, range.to, employeeId],
    queryFn: () => fetchTimesheet(range.from, range.to, employeeId ? [employeeId] : undefined),
  })

  const byEmployee = useMemo(() => groupByEmployee(sheet.data ?? []), [sheet.data])
  const employeesById = useMemo(() => new Map(employees.map((e) => [e.id, e])), [employees])
  const labels = useMemo(() => new Map<string, EmployeeLabel>(
    employees.map((e) => [e.id, { name: fullName(e), code: e.employee_code }])), [employees])

  const teamRows = useMemo(() => {
    const term = search.trim().toLowerCase()
    return [...byEmployee.entries()]
      .map(([id, days]) => ({ id, employee: employeesById.get(id), days, totals: totalsFor(days) }))
      .filter((row) => row.employee
        && (department === ALL || row.employee.department_id === department)
        && (!term || `${fullName(row.employee)} ${row.employee.employee_code ?? ''} ${row.employee.email}`.toLowerCase().includes(term)))
      .sort((a, b) => fullName(a.employee!).localeCompare(fullName(b.employee!)))
  }, [byEmployee, employeesById, department, search])

  const shownDays = employeeId ? byEmployee.get(employeeId) ?? [] : teamRows.flatMap((row) => row.days)
  const totals = totalsFor(shownDays)
  const employee = employeeId ? employeesById.get(employeeId) : undefined
  const selectedDay = openDay ? byEmployee.get(openDay.employeeId)?.find((d) => d.work_date === openDay.date) : undefined
  const selectedEmployee = openDay ? employeesById.get(openDay.employeeId) : undefined

  const exportCsv = () => {
    const [header, ...rows] = timesheetCsv(shownDays, labels, timeZone)
    const who = employee ? fullName(employee).replace(/\s+/g, '-').toLowerCase() : 'team'
    downloadCsv(`timesheet-${who}-${range.from}-to-${range.to}.csv`, header, rows)
  }

  const periodControls = (
    <div className="flex flex-wrap items-center gap-2">
      <div className="inline-flex rounded-lg border border-border p-0.5" role="group" aria-label="Period length">
        {(['week', 'month'] as const).map((option) => (
          <button key={option} type="button" aria-pressed={kind === option}
            onClick={() => update({ period: option === 'week' ? null : option, from: range.from })}
            className={cn('rounded-md px-3 py-1.5 font-label text-label-md capitalize transition-colors',
              kind === option ? 'bg-primary text-primary-foreground' : 'text-muted-foreground hover:bg-muted')}>
            {option}
          </button>
        ))}
      </div>
      <Button size="icon" variant="outline" title={`Previous ${kind}`} onClick={() => update({ from: shiftPeriod(kind, range.from, -1) })}>
        <ChevronLeft className="h-4 w-4" />
      </Button>
      <span className="min-w-40 text-center font-label text-label-md font-semibold text-foreground">{periodLabel(kind, range.from, range.to)}</span>
      <Button size="icon" variant="outline" title={`Next ${kind}`} onClick={() => update({ from: shiftPeriod(kind, range.from, 1) })}>
        <ChevronRight className="h-4 w-4" />
      </Button>
      <Button variant="ghost" size="sm" onClick={() => update({ from: null })}>This {kind}</Button>
    </div>
  )

  if (sheet.isLoading && !sheet.data) return <PageSkeleton cards={4} rows={6} />

  return (
    <div className="page-shell">
      <PageHeader
        eyebrow="Operations"
        title={employee ? `Timesheet · ${fullName(employee)}` : 'Timesheets'}
        description="Worked hours from check-ins and manager corrections, after unpaid breaks, compared with each employee's schedule, with overtime by type."
        icon={CalendarRange}
        actions={(
          <div className="flex flex-wrap gap-2">
            {employee && canManage && (
              <Button variant="outline" className="gap-2" onClick={() => setAdding(true)}>
                <Plus className="h-4 w-4" />
                Add entry
              </Button>
            )}
            <Button variant="outline" className="gap-2" onClick={exportCsv} disabled={!shownDays.length}>
              <Download className="h-4 w-4" />
              Export CSV
            </Button>
          </div>
        )}
      />

      <Card>
        <CardContent className="flex flex-col gap-3 pt-5 lg:flex-row lg:items-center lg:justify-between">
          {periodControls}
          {employee ? (
            <Button variant="ghost" size="sm" className="gap-2 self-start" onClick={() => update({ employee: null })}>
              <ArrowLeft className="h-4 w-4" />
              All employees
            </Button>
          ) : (
            <div className="flex flex-wrap gap-2">
              <div className="relative">
                <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
                <Input aria-label="Search employees" className="w-56 pl-9" placeholder="Search name or code…" value={search} onChange={(e) => setSearch(e.target.value)} />
              </div>
              <Select value={department} onValueChange={setDepartment}>
                <SelectTrigger className="w-48" aria-label="Department"><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value={ALL}>All departments</SelectItem>
                  {departments.map((d) => <SelectItem key={d.id} value={d.id}>{d.name}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
          )}
        </CardContent>
      </Card>

      {sheet.error ? (
        <ErrorState title="Timesheets could not be loaded" description={sheet.error instanceof Error ? sheet.error.message : undefined} onRetry={() => sheet.refetch()} />
      ) : (
        <>
          <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
            <StatCard label="Payroll hours" value={hm(totals.payroll)} hint={`of ${hm(totals.planned)} planned`} icon={Clock3} />
            <StatCard label="Overtime" value={hm(totals.overtime)} icon={TimerReset} tone="sky"
              hint={[totals.overtimeDaily + totals.overtimeDouble ? `daily ${hm(totals.overtimeDaily + totals.overtimeDouble)}` : '',
                totals.overtimeWeekly ? `weekly ${hm(totals.overtimeWeekly)}` : '',
                totals.overtimeRestDay + totals.overtimeHoliday ? `rest days and holidays ${hm(totals.overtimeRestDay + totals.overtimeHoliday)}` : '']
                .filter(Boolean).join(' · ') || 'None'} />
            <StatCard label="Absences" value={totals.absences} icon={Users} tone={totals.absences ? 'amber' : 'emerald'}
              hint={`${totals.lateDays} late day${totals.lateDays === 1 ? '' : 's'}`} />
            <StatCard label="Days to review" value={totals.attention} icon={AlertTriangle} tone={totals.attention ? 'red' : 'emerald'}
              hint="Missing check-outs, overlaps, policy breaks" />
          </div>

          {employee ? (
            <Card>
              <CardHeader>
                <CardTitle>Daily timesheet</CardTitle>
                <CardDescription>
                  {employee.departments?.name ?? 'No department'} · times in {timeZone}. Select a day to see its entries, corrections and location trail.
                </CardDescription>
              </CardHeader>
              <CardContent>
                <DataTable
                  pageSize={31}
                  emptyMessage="No timesheet for this period."
                  columns={[
                    {
                      header: 'Day',
                      accessor: (row) => (
                        <button type="button" className="text-left" onClick={() => setOpenDay({ employeeId: row.employee_id, date: row.work_date })}>
                          <span className="block font-semibold text-primary hover:underline">{dayLabel(row.work_date)}</span>
                          <span className="text-label-sm text-muted-foreground">{row.holiday_name ?? DAY_TYPE_LABELS[row.day_type]}</span>
                        </button>
                      ),
                    },
                    { header: 'In', accessor: (row) => clockIn(row.first_in, timeZone, row.work_date) },
                    { header: 'Out', accessor: (row) => row.flags.includes('in_progress') ? 'Checked in' : clockIn(row.last_out, timeZone, row.work_date) },
                    { header: 'Tracked', accessor: (row) => hm(row.tracked_minutes) },
                    { header: 'Breaks', accessor: (row) => (row.break_minutes ? hm(row.break_minutes) : '—') },
                    {
                      header: 'Payroll',
                      accessor: (row) => (
                        <span className="font-semibold text-foreground">
                          {hm(row.payroll_minutes)}
                          {row.planned_minutes ? <span className="ml-1 font-normal text-muted-foreground">/ {hm(row.planned_minutes)}</span> : null}
                        </span>
                      ),
                    },
                    { header: 'Overtime', accessor: (row) => (overtimeMinutes(row) ? hm(overtimeMinutes(row)) : '—') },
                    { header: 'Notes', accessor: (row) => <Flags flags={row.flags} /> },
                  ]}
                  data={shownDays}
                />
              </CardContent>
            </Card>
          ) : (
            <Card>
              <CardHeader>
                <CardTitle>Team</CardTitle>
                <CardDescription>
                  {teamRows.length} employee{teamRows.length === 1 ? '' : 's'}. Select a name for the daily timesheet.
                  Unpaid breaks with a time window, and the automatic break, are taken off worked time; other breaks once the app records them.
                </CardDescription>
              </CardHeader>
              <CardContent>
                <DataTable
                  pageSize={25}
                  emptyMessage="No employees match."
                  columns={[
                    {
                      header: 'Employee',
                      accessor: (row) => (
                        <button type="button" className="text-left" onClick={() => update({ employee: row.id })}>
                          <span className="block font-semibold text-primary hover:underline">{fullName(row.employee!)}</span>
                          <span className="text-label-sm text-muted-foreground">
                            {[row.employee!.employee_code, row.days.at(-1)?.schedule_name ?? 'No schedule',
                              row.employee!.user_id ? null : 'not on the app'].filter(Boolean).join(' · ')}
                          </span>
                        </button>
                      ),
                    },
                    {
                      header: 'Payroll',
                      accessor: (row) => (
                        <span className="font-semibold text-foreground">
                          {hm(row.totals.payroll)}<span className="ml-1 font-normal text-muted-foreground">/ {hm(row.totals.planned)}</span>
                        </span>
                      ),
                    },
                    { header: 'Overtime', accessor: (row) => (row.totals.overtime ? hm(row.totals.overtime) : '—') },
                    { header: 'Breaks', accessor: (row) => (row.totals.breaks ? hm(row.totals.breaks) : '—') },
                    { header: 'Days worked', accessor: (row) => row.totals.daysWorked },
                    {
                      header: 'Absent',
                      accessor: (row) => (row.totals.absences ? <Badge variant="destructive">{row.totals.absences}</Badge> : '—'),
                    },
                    { header: 'Late', accessor: (row) => (row.totals.lateDays ? row.totals.lateDays : '—') },
                    {
                      header: 'To review',
                      accessor: (row) => (
                        <div className="flex flex-wrap gap-1">
                          {row.totals.attention ? <Badge variant="warning">{row.totals.attention} day{row.totals.attention === 1 ? '' : 's'}</Badge> : null}
                          {row.totals.inProgress ? <Badge variant="info">Checked in</Badge> : null}
                          {!row.totals.attention && !row.totals.inProgress ? '—' : null}
                        </div>
                      ),
                    },
                  ]}
                  data={teamRows}
                />
              </CardContent>
            </Card>
          )}
        </>
      )}

      {selectedDay && selectedEmployee && (
        <TimesheetDayDialog
          key={`${selectedDay.employee_id}-${selectedDay.work_date}`}
          employee={selectedEmployee}
          day={selectedDay}
          timeZone={timeZone}
          sites={sites}
          canManage={canManage}
          onClose={() => setOpenDay(null)}
        />
      )}
      {adding && employee && (
        <TimeEntryDialog
          mode={{ kind: 'add', employeeId: employee.id, date: range.to < todayIn(timeZone) ? range.to : todayIn(timeZone) }}
          employeeName={fullName(employee)}
          sites={sites}
          timeZone={timeZone}
          onClose={() => setAdding(false)}
          onSaved={() => {
            setAdding(false)
            sheet.refetch()
          }}
        />
      )}
    </div>
  )
}
