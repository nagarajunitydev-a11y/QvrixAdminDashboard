import { useEffect, useMemo, useState } from 'react'
import { useSearchParams } from 'react-router-dom'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import {
  fetchEmployees,
  fetchDepartments,
  fetchDesignations,
  fetchShifts,
  fetchHolidayCalendars,
  fetchSites,
  createEmployee,
  updateEmployee,
  fetchEmployeeSites,
  assignEmployeeToSite,
  unassignEmployeeFromSite,
} from '@/api/services'
import type { EmployeeWithRelations } from '@/api/services'
import { useOrganization } from '@/api/OrganizationProvider'
import { Employee, EmployeeInsert, EmployeeUpdate, Site } from '@/types'
import { DataTable } from '@/components/ui/data-table'
import { Button } from '@/components/ui/button'
import { Card, CardContent } from '@/components/ui/card'
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Badge } from '@/components/ui/badge'
import { Alert, AlertDescription } from '@/components/ui/alert'
import { PageHeader } from '@/components/ui/page-header'
import { PageSkeleton } from '@/components/ui/states'
import { downloadCsv } from '@/lib/format'
import { RULE_SOURCE_LABELS, resolveRule } from '@/lib/workSchedules'
import { EMPLOYEE_CODE_PATTERN, EMPLOYMENT_TYPES, employmentTypeLabel } from '@/lib/employeeImport'
import {
  Archive,
  ArchiveRestore,
  Download,
  Edit,
  FileUp,
  MapPin,
  PencilLine,
  Plus,
  Search,
  UserCheck,
  UserX,
  Users,
  X,
} from 'lucide-react'
import { EmployeeImportDialog } from './EmployeeImportDialog'
import { ArchiveDialog, BulkAssignSiteDialog, BulkEditDialog } from './EmployeeBulkDialogs'

type StatusFilter = 'current' | 'active' | 'inactive' | 'archived'

function initials(first: string, last: string) {
  return `${first[0] ?? ''}${last[0] ?? ''}`.toUpperCase()
}

function exportEmployees(employees: EmployeeWithRelations[]) {
  downloadCsv(
    `employees-${new Date().toISOString().slice(0, 10)}.csv`,
    ['first_name', 'last_name', 'email', 'phone', 'employee_code', 'employment_type', 'department', 'designation', 'shift', 'hire_date', 'status', 'app_signed_in'],
    employees.map((e) => [
      e.first_name,
      e.last_name,
      e.email,
      e.phone,
      e.employee_code,
      e.employment_type ? employmentTypeLabel(e.employment_type) : '',
      e.departments?.name,
      e.designations?.name,
      e.shifts?.name,
      e.hire_date,
      e.archived_at ? 'Archived' : e.is_active ? 'Active' : 'Inactive',
      e.user_id ? 'Yes' : 'No',
    ]),
  )
}

// Radix Select cannot hold an empty value; this stands for "use the department or organization default".
const INHERIT = 'inherit'

export function EmployeesPage() {
  const queryClient = useQueryClient()
  const { canManage } = useOrganization()
  const [searchParams, setSearchParams] = useSearchParams()
  const { data: employees = [], isLoading } = useQuery({
    queryKey: ['employees'],
    queryFn: fetchEmployees,
  })
  const { data: departments = [] } = useQuery({
    queryKey: ['departments'],
    queryFn: fetchDepartments,
  })
  const { data: designations = [] } = useQuery({
    queryKey: ['designations'],
    queryFn: fetchDesignations,
  })
  const { data: shifts = [] } = useQuery({
    queryKey: ['shifts'],
    queryFn: fetchShifts,
  })
  const { data: holidayCalendars = [] } = useQuery({
    queryKey: ['holiday-calendars'],
    queryFn: fetchHolidayCalendars,
  })
  const { data: sites = [] } = useQuery({
    queryKey: ['sites'],
    queryFn: fetchSites,
  })
  const [editing, setEditing] = useState<Employee | null>(null)
  const [isFormOpen, setIsFormOpen] = useState(false)
  const [selectedEmployee, setSelectedEmployee] = useState<Employee | null>(null)
  // Getting Started links here with ?import=1 to open the CSV import directly.
  const [importOpen, setImportOpen] = useState(() => searchParams.get('import') === '1')
  const [bulkEditOpen, setBulkEditOpen] = useState(false)
  const [bulkSiteOpen, setBulkSiteOpen] = useState(false)
  const [archiveTarget, setArchiveTarget] = useState<{ mode: 'archive' | 'restore'; employees: EmployeeWithRelations[] } | null>(null)
  const [selected, setSelected] = useState<Set<string>>(new Set())

  // Filters
  const [search, setSearch] = useState(searchParams.get('q') ?? '')
  const [departmentFilter, setDepartmentFilter] = useState<string>('all')
  const [statusFilter, setStatusFilter] = useState<StatusFilter>('current')

  const [firstName, setFirstName] = useState('')
  const [lastName, setLastName] = useState('')
  const [email, setEmail] = useState('')
  const [phone, setPhone] = useState('')
  const [hireDate, setHireDate] = useState('')
  const [employeeCode, setEmployeeCode] = useState('')
  const [employmentType, setEmploymentType] = useState<string | null>(null)
  const [departmentId, setDepartmentId] = useState<string | null>(null)
  const [designationId, setDesignationId] = useState<string | null>(null)
  const [shiftId, setShiftId] = useState<string | null>(null)
  const [holidayCalendarId, setHolidayCalendarId] = useState<string | null>(null)
  const [isActive, setIsActive] = useState(true)
  const [error, setError] = useState<string | null>(null)

  // Drop the one-time ?import=1 flag so a refresh or back navigation does not reopen the dialog.
  useEffect(() => {
    if (searchParams.has('import')) {
      const next = new URLSearchParams(searchParams)
      next.delete('import')
      setSearchParams(next, { replace: true })
    }
  }, [searchParams, setSearchParams])

  const archivedCount = useMemo(() => employees.filter((e) => e.archived_at).length, [employees])

  const filteredEmployees = useMemo(() => {
    const q = search.trim().toLowerCase()
    return employees.filter((e) => {
      if (q && !`${e.first_name} ${e.last_name} ${e.email} ${e.employee_code ?? ''}`.toLowerCase().includes(q)) return false
      if (departmentFilter !== 'all' && e.department_id !== departmentFilter) return false
      if (statusFilter === 'archived') return Boolean(e.archived_at)
      if (e.archived_at) return false
      if (statusFilter === 'active' && !e.is_active) return false
      if (statusFilter === 'inactive' && e.is_active) return false
      return true
    })
  }, [employees, search, departmentFilter, statusFilter])

  // Selection only ever covers rows the current filters show.
  const selectedEmployees = useMemo(
    () => filteredEmployees.filter((e) => selected.has(e.id)),
    [filteredEmployees, selected],
  )
  const allVisibleSelected = filteredEmployees.length > 0 && selectedEmployees.length === filteredEmployees.length
  const clearSelection = () => setSelected(new Set())
  const toggleOne = (id: string) =>
    setSelected((current) => {
      const next = new Set(current)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  const toggleAll = () => setSelected(allVisibleSelected ? new Set() : new Set(filteredEmployees.map((e) => e.id)))

  const codeError = employeeCode.trim() && !EMPLOYEE_CODE_PATTERN.test(employeeCode.trim())
    ? 'Use 1–32 letters, digits, or . _ / - starting with a letter or digit.'
    : null

  const mutation = useMutation({
    mutationFn: async () => {
      const payload: EmployeeInsert = {
        first_name: firstName.trim(),
        last_name: lastName.trim(),
        email: email.trim(),
        phone: phone.trim() || null,
        employee_code: employeeCode.trim() || null,
        employment_type: employmentType,
        department_id: departmentId ?? null,
        designation_id: designationId ?? null,
        shift_id: shiftId ?? null,
        holiday_calendar_id: holidayCalendarId ?? null,
        is_active: isActive,
        hire_date: hireDate || null,
      }
      if (editing) {
        await updateEmployee(editing.id, payload as EmployeeUpdate)
      } else {
        await createEmployee(payload)
      }
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['employees'] })
      queryClient.invalidateQueries({ queryKey: ['onboarding-counts'] })
      setIsFormOpen(false)
      setEditing(null)
      resetForm()
      setError(null)
    },
    onError: (err) => {
      setError(err instanceof Error ? err.message : 'Failed to save employee')
    },
  })

  function resetForm() {
    setFirstName('')
    setLastName('')
    setEmail('')
    setPhone('')
    setHireDate('')
    setEmployeeCode('')
    setEmploymentType(null)
    setDepartmentId(null)
    setDesignationId(null)
    setShiftId(null)
    setHolidayCalendarId(null)
    setIsActive(true)
  }

  const handleEdit = (e: Employee) => {
    setEditing(e)
    setFirstName(e.first_name)
    setLastName(e.last_name)
    setEmail(e.email)
    setPhone(e.phone ?? '')
    setHireDate(e.hire_date ?? '')
    setEmployeeCode(e.employee_code ?? '')
    setEmploymentType(e.employment_type ?? null)
    setDepartmentId(e.department_id ?? null)
    setDesignationId(e.designation_id ?? null)
    setShiftId(e.shift_id ?? null)
    setHolidayCalendarId(e.holiday_calendar_id ?? null)
    setIsActive(e.is_active)
    setError(null)
    setIsFormOpen(true)
  }

  const handleAdd = () => {
    setEditing(null)
    resetForm()
    setError(null)
    setIsFormOpen(true)
  }

  const handleCloseForm = () => {
    setIsFormOpen(false)
    setError(null)
  }

  const handleToggleActive = async (e: Employee) => {
    try {
      await updateEmployee(e.id, { is_active: !e.is_active })
      setError(null)
      queryClient.invalidateQueries({ queryKey: ['employees'] })
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to update employee status')
    }
  }

  if (isLoading) {
    return <PageSkeleton cards={0} rows={7} />
  }

  const viewingArchived = statusFilter === 'archived'

  return (
    <div className="page-shell">
      <PageHeader
        eyebrow="Workforce directory"
        title="Employees"
        description="Manage personnel, site assignments, and real-time status."
        icon={Users}
        actions={
          <div className="flex flex-wrap gap-2">
            <Button variant="outline" onClick={() => exportEmployees(filteredEmployees)} className="gap-2" disabled={filteredEmployees.length === 0}>
              <Download className="h-4 w-4" />
              Export
            </Button>
            {canManage && (
              <>
                <Button variant="outline" onClick={() => setImportOpen(true)} className="gap-2">
                  <FileUp className="h-4 w-4" />
                  Import CSV
                </Button>
                <Button onClick={handleAdd} className="shrink-0 gap-2">
                  <Plus className="h-4 w-4" />
                  Add Employee
                </Button>
              </>
            )}
          </div>
        }
      />

      {error && !isFormOpen && (
        <Alert variant="destructive">
          <AlertDescription>{error}</AlertDescription>
        </Alert>
      )}

      {/* Filters */}
      <div className="flex flex-col items-center gap-4 rounded-xl border border-border bg-card p-4 shadow-sm md:flex-row md:justify-between">
        <div className="flex w-full flex-1 flex-wrap gap-3">
          <div className="relative min-w-[200px] flex-1">
            <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
            <Input
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Search name, email or code…"
              className="pl-10"
              aria-label="Search employees"
            />
          </div>
          <div className="min-w-[160px]">
            <Select value={departmentFilter} onValueChange={setDepartmentFilter}>
              <SelectTrigger aria-label="Department">
                <SelectValue placeholder="All Departments" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All Departments</SelectItem>
                {departments.map((d) => (
                  <SelectItem key={d.id} value={d.id}>{d.name}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="min-w-[160px]">
            <Select value={statusFilter} onValueChange={(value) => { setStatusFilter(value as StatusFilter); clearSelection() }}>
              <SelectTrigger aria-label="Status">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="current">Current employees</SelectItem>
                <SelectItem value="active">Active</SelectItem>
                <SelectItem value="inactive">Inactive</SelectItem>
                <SelectItem value="archived">Archived ({archivedCount})</SelectItem>
              </SelectContent>
            </Select>
          </div>
        </div>
        <span className="shrink-0 font-label text-label-md text-muted-foreground">
          {filteredEmployees.length} shown
        </span>
      </div>

      {/* Bulk actions */}
      {canManage && selectedEmployees.length > 0 && (
        <div
          className="flex flex-wrap items-center gap-2 rounded-xl border border-primary/30 bg-primary/5 px-4 py-3"
          role="region"
          aria-label="Bulk actions"
        >
          <span className="mr-2 font-label text-label-md font-semibold text-foreground">
            {selectedEmployees.length} selected
          </span>
          {viewingArchived ? (
            <Button size="sm" className="gap-2" onClick={() => setArchiveTarget({ mode: 'restore', employees: selectedEmployees })}>
              <ArchiveRestore className="h-4 w-4" />
              Restore
            </Button>
          ) : (
            <>
              <Button size="sm" variant="outline" className="gap-2" onClick={() => setBulkEditOpen(true)}>
                <PencilLine className="h-4 w-4" />
                Edit fields
              </Button>
              <Button size="sm" variant="outline" className="gap-2" onClick={() => setBulkSiteOpen(true)}>
                <MapPin className="h-4 w-4" />
                Assign site
              </Button>
              <Button size="sm" variant="outline" className="gap-2 hover:text-destructive" onClick={() => setArchiveTarget({ mode: 'archive', employees: selectedEmployees })}>
                <Archive className="h-4 w-4" />
                Archive
              </Button>
            </>
          )}
          <Button size="sm" variant="ghost" className="ml-auto gap-1" onClick={clearSelection}>
            <X className="h-4 w-4" />
            Clear
          </Button>
        </div>
      )}

      {/* Table */}
      <Card className="overflow-hidden">
        <CardContent className="p-0 pt-0">
          <DataTable
            columns={[
              ...(canManage
                ? [{
                    header: (
                      <input
                        type="checkbox"
                        checked={allVisibleSelected}
                        onChange={toggleAll}
                        aria-label={`Select all ${filteredEmployees.length} shown employees`}
                        className="h-4 w-4 rounded border-input accent-primary"
                      />
                    ),
                    accessor: (row: EmployeeWithRelations) => (
                      <input
                        type="checkbox"
                        checked={selected.has(row.id)}
                        onChange={() => toggleOne(row.id)}
                        aria-label={`Select ${row.first_name} ${row.last_name}`}
                        className="h-4 w-4 rounded border-input accent-primary"
                      />
                    ),
                    className: 'w-10',
                  }]
                : []),
              {
                header: 'Profile',
                accessor: (row) => (
                  <div className="flex items-center gap-3">
                    <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-primary/10 font-label text-label-sm font-semibold text-primary">
                      {initials(row.first_name, row.last_name)}
                    </div>
                    <div className="min-w-0">
                      <p className="truncate font-medium text-foreground">
                        {row.first_name} {row.last_name}
                      </p>
                      <p className="truncate text-xs text-muted-foreground">
                        {[row.employee_code, row.designations?.name].filter(Boolean).join(' · ') || '—'}
                      </p>
                    </div>
                  </div>
                ),
              },
              { header: 'Email', accessor: 'email' },
              { header: 'Department', accessor: (row) => row.departments?.name ?? '—' },
              {
                header: 'Schedule',
                accessor: (row) => {
                  const department = departments.find((d) => d.id === row.department_id)
                  const schedule = resolveRule(row.shift_id, department?.shift_id, shifts)
                  if (!schedule) return <span className="text-muted-foreground">None</span>
                  return (
                    <span title={RULE_SOURCE_LABELS[schedule.source]}>
                      {schedule.value.name}
                      {schedule.source !== 'employee' && (
                        <span className="ml-1 text-label-sm text-muted-foreground">{schedule.source === 'department' ? '(department)' : '(default)'}</span>
                      )}
                    </span>
                  )
                },
              },
              { header: 'Type', accessor: (row) => employmentTypeLabel(row.employment_type) },
              {
                header: 'App',
                accessor: (row) => (
                  <Badge variant={row.user_id ? 'info' : 'outline'}>
                    {row.user_id ? 'Signed in' : 'Not signed in'}
                  </Badge>
                ),
              },
              {
                header: 'Status',
                accessor: (row) => (
                  <Badge variant={row.archived_at ? 'outline' : row.is_active ? 'success' : 'secondary'} dot>
                    {row.archived_at ? 'Archived' : row.is_active ? 'Active' : 'Inactive'}
                  </Badge>
                ),
              },
              {
                header: 'Actions',
                accessor: (row) => canManage ? (
                  <div className="flex justify-end gap-1">
                    {row.archived_at ? (
                      <Button size="icon" variant="ghost" title="Restore" aria-label={`Restore ${row.first_name} ${row.last_name}`} onClick={() => setArchiveTarget({ mode: 'restore', employees: [row] })}>
                        <ArchiveRestore className="h-4 w-4" />
                      </Button>
                    ) : (
                      <>
                        <Button size="icon" variant="ghost" title="Site assignments" aria-label={`Site assignments for ${row.first_name} ${row.last_name}`} onClick={() => setSelectedEmployee(row)}>
                          <MapPin className="h-4 w-4" />
                        </Button>
                        <Button size="icon" variant="ghost" title={row.is_active ? 'Deactivate' : 'Activate'} aria-label={`${row.is_active ? 'Deactivate' : 'Activate'} ${row.first_name} ${row.last_name}`} onClick={() => handleToggleActive(row)}>
                          {row.is_active ? <UserX className="h-4 w-4" /> : <UserCheck className="h-4 w-4" />}
                        </Button>
                        <Button size="icon" variant="ghost" title="Edit" aria-label={`Edit ${row.first_name} ${row.last_name}`} onClick={() => handleEdit(row)}>
                          <Edit className="h-4 w-4" />
                        </Button>
                        <Button size="icon" variant="ghost" title="Archive" aria-label={`Archive ${row.first_name} ${row.last_name}`} className="hover:text-destructive" onClick={() => setArchiveTarget({ mode: 'archive', employees: [row] })}>
                          <Archive className="h-4 w-4" />
                        </Button>
                      </>
                    )}
                  </div>
                ) : null,
                className: 'text-right',
              },
            ]}
            data={filteredEmployees}
            emptyMessage={viewingArchived ? 'No archived employees' : 'No employees match these filters'}
          />
        </CardContent>
      </Card>

      <Dialog open={isFormOpen} onOpenChange={(open) => (open ? setIsFormOpen(true) : handleCloseForm())}>
        <DialogContent className="max-w-2xl">
          <DialogHeader>
            <DialogTitle>{editing ? 'Edit' : 'Add'} Employee</DialogTitle>
          </DialogHeader>
          <div className="space-y-4">
            {error && (
              <Alert variant="destructive">
                <AlertDescription>{error}</AlertDescription>
              </Alert>
            )}
            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
              <div className="space-y-2">
                <Label htmlFor="first_name">First Name *</Label>
                <Input
                  id="first_name"
                  value={firstName}
                  onChange={(e) => setFirstName(e.target.value)}
                  required
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="last_name">Last Name *</Label>
                <Input
                  id="last_name"
                  value={lastName}
                  onChange={(e) => setLastName(e.target.value)}
                  required
                />
              </div>
            </div>
            <div className="space-y-2">
              <Label htmlFor="email">Email *</Label>
              <Input
                id="email"
                type="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                required
              />
              <p className="text-xs text-muted-foreground">The employee signs in to the Crewtraxa app with this email.</p>
            </div>
            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
              <div className="space-y-2">
                <Label htmlFor="phone">Phone</Label>
                <Input
                  id="phone"
                  value={phone}
                  onChange={(e) => setPhone(e.target.value)}
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="hire_date">Hire Date</Label>
                <Input
                  id="hire_date"
                  type="date"
                  value={hireDate}
                  onChange={(e) => setHireDate(e.target.value)}
                />
              </div>
            </div>
            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
              <div className="space-y-2">
                <Label htmlFor="employee_code">Employee Code</Label>
                <Input
                  id="employee_code"
                  value={employeeCode}
                  onChange={(e) => setEmployeeCode(e.target.value)}
                  placeholder="e.g. EMP-014"
                  aria-invalid={Boolean(codeError)}
                  aria-describedby="employee_code_hint"
                />
                <p id="employee_code_hint" className={codeError ? 'text-xs text-destructive' : 'text-xs text-muted-foreground'}>
                  {codeError ?? 'Optional. Unique within your organization.'}
                </p>
              </div>
              <div className="space-y-2">
                <Label htmlFor="employment_type">Employment Type</Label>
                <Select
                  value={employmentType ?? 'none'}
                  onValueChange={(value) => setEmploymentType(value === 'none' ? null : value)}
                >
                  <SelectTrigger id="employment_type">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="none">Not set</SelectItem>
                    {EMPLOYMENT_TYPES.map((type) => (
                      <SelectItem key={type.value} value={type.value}>{type.label}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            </div>
            <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
              <div className="space-y-2">
                <Label htmlFor="department_id">Department</Label>
                <Select
                  value={departmentId ?? undefined}
                  onValueChange={setDepartmentId}
                >
                  <SelectTrigger id="department_id">
                    <SelectValue placeholder="Select department" />
                  </SelectTrigger>
                  <SelectContent>
                    {departments.map((d) => (
                      <SelectItem key={d.id} value={d.id}>{d.name}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-2">
                <Label htmlFor="designation_id">Designation</Label>
                <Select
                  value={designationId ?? undefined}
                  onValueChange={setDesignationId}
                >
                  <SelectTrigger id="designation_id">
                    <SelectValue placeholder="Select designation" />
                  </SelectTrigger>
                  <SelectContent>
                    {designations.map((d) => (
                      <SelectItem key={d.id} value={d.id}>{d.name}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-2">
                <Label htmlFor="shift_id">Work schedule</Label>
                <Select
                  value={shiftId ?? INHERIT}
                  onValueChange={(value) => setShiftId(value === INHERIT ? null : value)}
                >
                  <SelectTrigger id="shift_id">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value={INHERIT}>Department or organization default</SelectItem>
                    {shifts.map((s) => (
                      <SelectItem key={s.id} value={s.id}>{s.name}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-2">
                <Label htmlFor="holiday_calendar_id">Holiday calendar</Label>
                <Select
                  value={holidayCalendarId ?? INHERIT}
                  onValueChange={(value) => setHolidayCalendarId(value === INHERIT ? null : value)}
                >
                  <SelectTrigger id="holiday_calendar_id">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value={INHERIT}>Department or organization default</SelectItem>
                    {holidayCalendars.map((c) => (
                      <SelectItem key={c.id} value={c.id}>{c.name}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={handleCloseForm} disabled={mutation.isPending}>
              Cancel
            </Button>
            <Button
              onClick={() => mutation.mutate()}
              disabled={mutation.isPending || !firstName.trim() || !lastName.trim() || !email.trim() || Boolean(codeError)}
            >
              {mutation.isPending ? 'Saving...' : 'Save Changes'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {selectedEmployee && (
        <EmployeeAssignmentsDialog
          employee={selectedEmployee}
          open={!!selectedEmployee}
          onOpenChange={() => setSelectedEmployee(null)}
          sites={sites}
        />
      )}

      <EmployeeImportDialog
        open={importOpen && canManage}
        onOpenChange={setImportOpen}
        employees={employees}
        departments={departments}
        designations={designations}
        shifts={shifts}
      />
      <BulkEditDialog
        ids={selectedEmployees.map((e) => e.id)}
        open={bulkEditOpen}
        onOpenChange={setBulkEditOpen}
        onDone={clearSelection}
        departments={departments}
        designations={designations}
        shifts={shifts}
        holidayCalendars={holidayCalendars}
      />
      <BulkAssignSiteDialog
        ids={selectedEmployees.map((e) => e.id)}
        open={bulkSiteOpen}
        onOpenChange={setBulkSiteOpen}
        onDone={clearSelection}
        sites={sites}
      />
      {archiveTarget && (
        <ArchiveDialog
          mode={archiveTarget.mode}
          employees={archiveTarget.employees}
          open
          onOpenChange={(open) => { if (!open) setArchiveTarget(null) }}
          onDone={clearSelection}
        />
      )}
    </div>
  )
}

function EmployeeAssignmentsDialog({
  employee,
  open,
  onOpenChange,
  sites,
}: {
  employee: Employee
  open: boolean
  onOpenChange: (open: boolean) => void
  sites: Site[]
}) {
  const queryClient = useQueryClient()
  const [assignmentError, setAssignmentError] = useState<string | null>(null)
  const { data: employeeSites = [] } = useQuery({
    queryKey: ['employee-sites', employee.id],
    queryFn: () => fetchEmployeeSites(employee.id),
    enabled: open,
  })

  const assignedSiteIds = new Set(employeeSites.map((es) => es.site_id))

  const handleAssign = async (siteId: string) => {
    try {
      await assignEmployeeToSite({ employee_id: employee.id, site_id: siteId })
      setAssignmentError(null)
      queryClient.invalidateQueries({ queryKey: ['employee-sites', employee.id] })
    } catch (err) {
      setAssignmentError(err instanceof Error ? err.message : 'Failed to assign site')
    }
  }

  const handleUnassign = async (siteId: string) => {
    try {
      await unassignEmployeeFromSite(employee.id, siteId)
      setAssignmentError(null)
      queryClient.invalidateQueries({ queryKey: ['employee-sites', employee.id] })
    } catch (err) {
      setAssignmentError(err instanceof Error ? err.message : 'Failed to unassign site')
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>
            Site Assignments — {employee.first_name} {employee.last_name}
          </DialogTitle>
        </DialogHeader>
        <div className="max-h-96 space-y-3 overflow-y-auto pr-1">
          {assignmentError && (
            <Alert variant="destructive">
              <AlertDescription>{assignmentError}</AlertDescription>
            </Alert>
          )}
          {sites.map((site) => {
            const assigned = assignedSiteIds.has(site.id)
            return (
              <div
                key={site.id}
                className={`flex items-center justify-between rounded-lg border p-3 transition-colors ${
                  assigned ? 'border-primary/30 bg-primary/5' : 'border-border bg-card hover:bg-muted/50'
                }`}
              >
                <div className="min-w-0">
                  <span className="block truncate font-medium text-foreground">{site.name}</span>
                  <span className="block font-label text-label-sm text-muted-foreground">
                    {site.latitude.toFixed(4)}, {site.longitude.toFixed(4)} · r={site.radius_in_meters}m
                  </span>
                </div>
                {assigned ? (
                  <div className="flex shrink-0 items-center gap-2 pl-3">
                    <Badge variant="success" dot>Assigned</Badge>
                    <Button
                      size="sm"
                      variant="outline"
                      onClick={() => handleUnassign(site.id)}
                    >
                      Unassign
                    </Button>
                  </div>
                ) : (
                  <Button size="sm" variant="outline" className="ml-3 shrink-0" onClick={() => handleAssign(site.id)}>
                    Assign
                  </Button>
                )}
              </div>
            )
          })}
          {sites.length === 0 && (
            <p className="py-6 text-center text-body-sm text-muted-foreground">
              No sites available. Create a site first.
            </p>
          )}
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            Close
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
