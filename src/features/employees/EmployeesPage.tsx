import { useMemo, useState } from 'react'
import { useSearchParams } from 'react-router-dom'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import {
  fetchEmployees,
  fetchDepartments,
  fetchDesignations,
  fetchShifts,
  fetchSites,
  createEmployee,
  updateEmployee,
  deleteEmployee,
  fetchEmployeeSites,
  assignEmployeeToSite,
  unassignEmployeeFromSite,
} from '@/api/services'
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
import { Plus, Edit, Trash2, UserCheck, UserX, MapPin, Search } from 'lucide-react'

function initials(first: string, last: string) {
  return `${first[0] ?? ''}${last[0] ?? ''}`.toUpperCase()
}

export function EmployeesPage() {
  const queryClient = useQueryClient()
  const [searchParams] = useSearchParams()
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
  const { data: sites = [] } = useQuery({
    queryKey: ['sites'],
    queryFn: fetchSites,
  })
  const [editing, setEditing] = useState<Employee | null>(null)
  const [isFormOpen, setIsFormOpen] = useState(false)
  const [selectedEmployee, setSelectedEmployee] = useState<Employee | null>(null)

  // Filters
  const [search, setSearch] = useState(searchParams.get('q') ?? '')
  const [departmentFilter, setDepartmentFilter] = useState<string>('all')
  const [statusFilter, setStatusFilter] = useState<string>('all')

  const [firstName, setFirstName] = useState('')
  const [lastName, setLastName] = useState('')
  const [email, setEmail] = useState('')
  const [phone, setPhone] = useState('')
  const [hireDate, setHireDate] = useState('')
  const [departmentId, setDepartmentId] = useState<string | null>(null)
  const [designationId, setDesignationId] = useState<string | null>(null)
  const [shiftId, setShiftId] = useState<string | null>(null)
  const [isActive, setIsActive] = useState(true)
  const [error, setError] = useState<string | null>(null)

  const filteredEmployees = useMemo(() => {
    const q = search.trim().toLowerCase()
    return employees.filter((e) => {
      if (q && !`${e.first_name} ${e.last_name} ${e.email}`.toLowerCase().includes(q)) return false
      if (departmentFilter !== 'all' && e.department_id !== departmentFilter) return false
      if (statusFilter === 'active' && !e.is_active) return false
      if (statusFilter === 'inactive' && e.is_active) return false
      return true
    })
  }, [employees, search, departmentFilter, statusFilter])

  const mutation = useMutation({
    mutationFn: async () => {
      const payload: EmployeeInsert = {
        first_name: firstName,
        last_name: lastName,
        email,
        phone: phone || null,
        department_id: departmentId ?? null,
        designation_id: designationId ?? null,
        shift_id: shiftId ?? null,
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
    setDepartmentId(null)
    setDesignationId(null)
    setShiftId(null)
    setIsActive(true)
  }

  const handleDelete = async (id: string) => {
    if (!confirm('Remove this employee? This cannot be undone.')) return
    try {
      await deleteEmployee(id)
      setError(null)
      queryClient.invalidateQueries({ queryKey: ['employees'] })
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to delete employee')
    }
  }

  const handleEdit = (e: Employee) => {
    setEditing(e)
    setFirstName(e.first_name)
    setLastName(e.last_name)
    setEmail(e.email)
    setPhone(e.phone ?? '')
    setHireDate(e.hire_date ?? '')
    setDepartmentId(e.department_id ?? null)
    setDesignationId(e.designation_id ?? null)
    setShiftId(e.shift_id ?? null)
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
      await updateEmployee(e.id, { is_active: !e.is_active } as EmployeeUpdate)
      setError(null)
      queryClient.invalidateQueries({ queryKey: ['employees'] })
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to update employee status')
    }
  }

  if (isLoading) {
    return (
      <div className="flex justify-center py-16">
        <div className="h-8 w-8 animate-spin rounded-full border-b-2 border-primary" />
      </div>
    )
  }

  return (
    <div className="mx-auto max-w-7xl space-y-6">
      <div className="flex flex-col justify-between gap-4 sm:flex-row sm:items-center">
        <div>
          <h1 className="font-headline text-headline-lg text-foreground">Employees</h1>
          <p className="mt-1 text-body-sm text-muted-foreground">
            Manage personnel, assignments, and real-time status.
          </p>
        </div>
        <Button onClick={handleAdd} className="shrink-0 gap-2">
          <Plus className="h-4 w-4" />
          Add Employee
        </Button>
      </div>

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
              placeholder="Search name or email…"
              className="pl-10"
            />
          </div>
          <div className="min-w-[160px]">
            <Select value={departmentFilter} onValueChange={setDepartmentFilter}>
              <SelectTrigger>
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
          <div className="min-w-[140px]">
            <Select value={statusFilter} onValueChange={setStatusFilter}>
              <SelectTrigger>
                <SelectValue placeholder="All Statuses" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All Statuses</SelectItem>
                <SelectItem value="active">Active</SelectItem>
                <SelectItem value="inactive">Inactive</SelectItem>
              </SelectContent>
            </Select>
          </div>
        </div>
        <span className="shrink-0 font-label text-label-md text-muted-foreground">
          {filteredEmployees.length} of {employees.length} shown
        </span>
      </div>

      {/* Table */}
      <Card className="overflow-hidden">
        <CardContent className="p-0 pt-0">
          <DataTable
            columns={[
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
                        {row.designations?.name ?? '—'}
                      </p>
                    </div>
                  </div>
                ),
              },
              { header: 'Email', accessor: 'email' },
              { header: 'Department', accessor: (row) => row.departments?.name ?? '—' },
              { header: 'Shift', accessor: (row) => row.shifts?.name ?? '—' },
              {
                header: 'Status',
                accessor: (row) => (
                  <Badge variant={row.is_active ? 'success' : 'secondary'} dot>
                    {row.is_active ? 'Active' : 'Inactive'}
                  </Badge>
                ),
              },
              {
                header: 'Actions',
                accessor: (row) => (
                  <div className="flex justify-end gap-1">
                    <Button size="icon" variant="ghost" title="Site assignments" onClick={() => setSelectedEmployee(row)}>
                      <MapPin className="h-4 w-4" />
                    </Button>
                    <Button size="icon" variant="ghost" title={row.is_active ? 'Deactivate' : 'Activate'} onClick={() => handleToggleActive(row)}>
                      {row.is_active ? <UserX className="h-4 w-4" /> : <UserCheck className="h-4 w-4" />}
                    </Button>
                    <Button size="icon" variant="ghost" title="Edit" onClick={() => handleEdit(row)}>
                      <Edit className="h-4 w-4" />
                    </Button>
                    <Button size="icon" variant="ghost" title="Delete" className="hover:text-destructive" onClick={() => handleDelete(row.id)}>
                      <Trash2 className="h-4 w-4" />
                    </Button>
                  </div>
                ),
                className: 'text-right',
              },
            ]}
            data={filteredEmployees}
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
            <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
              <div className="space-y-2">
                <Label htmlFor="department_id">Department</Label>
                <Select
                  value={departmentId ?? undefined}
                  onValueChange={setDepartmentId}
                >
                  <SelectTrigger>
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
                  <SelectTrigger>
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
                <Label htmlFor="shift_id">Shift</Label>
                <Select
                  value={shiftId ?? undefined}
                  onValueChange={setShiftId}
                >
                  <SelectTrigger>
                    <SelectValue placeholder="Select shift" />
                  </SelectTrigger>
                  <SelectContent>
                    {shifts.map((s) => (
                      <SelectItem key={s.id} value={s.id}>{s.name}</SelectItem>
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
              disabled={mutation.isPending || !firstName || !lastName || !email}
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
