import { useState } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { format } from 'date-fns'
import { fetchEmployeeSites, fetchEmployees, fetchSites, assignEmployeeToSite, unassignEmployeeFromSite } from '@/api/services'
import { Employee, Site, EmployeeSite } from '@/types'
import { DataTable } from '@/components/ui/data-table'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Alert, AlertDescription } from '@/components/ui/alert'
import { Badge } from '@/components/ui/badge'
import { Plus, Trash2, Users, MapPin } from 'lucide-react'

type Feedback = { type: 'success' | 'error'; text: string }

function initials(name: string) {
  return name
    .split(' ')
    .map((p) => p[0])
    .filter(Boolean)
    .slice(0, 2)
    .join('')
    .toUpperCase()
}

export function AssignmentsPage() {
  const queryClient = useQueryClient()
  const [feedback, setFeedback] = useState<Feedback | null>(null)
  const { data: assignments = [], isLoading } = useQuery({
    queryKey: ['employee-sites'],
    queryFn: () => fetchEmployeeSites(),
  })
  const { data: employees = [] } = useQuery({ queryKey: ['employees'], queryFn: fetchEmployees })
  const { data: sites = [] } = useQuery({ queryKey: ['sites'], queryFn: fetchSites })

  if (isLoading) {
    return (
      <div className="flex justify-center py-16">
        <div className="h-8 w-8 animate-spin rounded-full border-b-2 border-primary" />
      </div>
    )
  }

  const employeeMap = new Map(employees.map((e) => [e.id, `${e.first_name} ${e.last_name}`]))
  const siteMap = new Map(sites.map((s) => [s.id, s.name]))

  const handleUnassign = async (employeeId: string, siteId: string) => {
    if (!confirm('Unassign employee from this site?')) return
    try {
      await unassignEmployeeFromSite(employeeId, siteId)
      setFeedback({ type: 'success', text: 'Assignment deleted successfully.' })
      queryClient.invalidateQueries({ queryKey: ['employee-sites'] })
    } catch (err) {
      setFeedback({
        type: 'error',
        text: err instanceof Error ? err.message : 'Failed to delete assignment',
      })
    }
  }

  return (
    <div className="mx-auto max-w-7xl space-y-6">
      <div>
        <h1 className="font-headline text-headline-lg text-foreground">Employee Assignments</h1>
        <p className="mt-1 text-body-sm text-muted-foreground">
          Manage which employees are assigned to which sites.
        </p>
      </div>

      {feedback && (
        <Alert variant={feedback.type === 'error' ? 'destructive' : 'default'}>
          <AlertDescription>{feedback.text}</AlertDescription>
        </Alert>
      )}

      <Card className="overflow-hidden">
        <CardHeader className="flex-row items-center justify-between space-y-0">
          <div>
            <CardTitle>Assignments</CardTitle>
            <CardDescription>{assignments.length} total assignments</CardDescription>
          </div>
          <Badge variant="info" dot>Live roster</Badge>
        </CardHeader>
        <CardContent className="p-0 pt-0">
          <DataTable
            columns={[
              {
                header: 'Employee',
                accessor: (row) => {
                  const name = employeeMap.get(row.employee_id) ?? row.employee_id.slice(0, 8)
                  return (
                    <div className="flex items-center gap-3">
                      <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-primary/10 font-label text-label-sm font-semibold text-primary">
                        {employeeMap.has(row.employee_id) ? initials(name) : '?'}
                      </div>
                      <span className="truncate font-medium text-foreground">{name}</span>
                    </div>
                  )
                },
              },
              {
                header: 'Site',
                accessor: (row) => (
                  <span className="flex items-center gap-2">
                    <MapPin className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
                    {siteMap.get(row.site_id) ?? row.site_id.slice(0, 8)}
                  </span>
                ),
              },
              {
                header: 'Assigned',
                accessor: (row) => (
                  <span className="font-label text-label-md text-muted-foreground">
                    {format(new Date(row.assigned_at), 'dd MMM yyyy, h:mm a')}
                  </span>
                ),
              },
              {
                header: 'Actions',
                accessor: (row) => row.actions,
                className: 'text-right',
              },
            ]}
            data={assignments.map((a) => ({
              ...a,
              actions: (
                <Button
                  size="icon"
                  variant="ghost"
                  title="Unassign"
                  className="hover:text-destructive"
                  onClick={() => handleUnassign(a.employee_id, a.site_id)}
                >
                  <Trash2 className="h-4 w-4" />
                </Button>
              ),
            }))}
          />
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Users className="h-5 w-5 text-primary" />
            New Assignment
          </CardTitle>
          <CardDescription>
            Assign an employee to a site.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <AssignmentForm employees={employees} sites={sites} assignments={assignments} />
        </CardContent>
      </Card>
    </div>
  )
}

function AssignmentForm({
  employees,
  sites,
  assignments,
}: {
  employees: Employee[]
  sites: Site[]
  assignments: EmployeeSite[]
}) {
  const queryClient = useQueryClient()
  const [employeeId, setEmployeeId] = useState('')
  const [siteId, setSiteId] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [success, setSuccess] = useState<string | null>(null)

  const mutation = useMutation({
    mutationFn: async () => {
      const duplicate = assignments.some(
        (a) => a.employee_id === employeeId && a.site_id === siteId
      )
      if (duplicate) {
        throw new Error('This employee already has an active assignment for this site.')
      }
      await assignEmployeeToSite({ employee_id: employeeId, site_id: siteId })
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['employee-sites'] })
      setEmployeeId('')
      setSiteId('')
      setError(null)
      setSuccess('Employee assigned successfully.')
    },
    onError: (err) => {
      setSuccess(null)
      const code = (err as { code?: string }).code
      if (code === '23505' || /duplicate key/i.test(err.message)) {
        setError('This employee already has an active assignment for this site.')
      } else {
        setError(err instanceof Error ? err.message : 'Failed to assign employee')
      }
    },
  })

  return (
    <div className="space-y-4">
      <div className="flex flex-col gap-4 sm:flex-row sm:items-end">
      <div className="min-w-[200px] flex-1 space-y-1.5">
        <label className="font-label text-label-md text-foreground">Employee</label>
        <Select value={employeeId} onValueChange={setEmployeeId}>
          <SelectTrigger>
            <SelectValue placeholder="Select employee" />
          </SelectTrigger>
          <SelectContent>
            {employees.map((e) => (
              <SelectItem key={e.id} value={e.id}>
                {e.first_name} {e.last_name}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>
      <div className="min-w-[200px] flex-1 space-y-1.5">
        <label className="font-label text-label-md text-foreground">Site</label>
        <Select value={siteId} onValueChange={setSiteId}>
          <SelectTrigger>
            <SelectValue placeholder="Select site" />
          </SelectTrigger>
          <SelectContent>
            {sites.map((s) => (
              <SelectItem key={s.id} value={s.id}>{s.name}</SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>
      <Button
        onClick={() => mutation.mutate()}
        disabled={!employeeId || !siteId || mutation.isPending}
        className="gap-2 sm:mb-[2px]"
      >
        <Plus className="h-4 w-4" />
        Assign
      </Button>
      </div>
      {error && (
        <Alert variant="destructive">
          <AlertDescription>{error}</AlertDescription>
        </Alert>
      )}
      {success && (
        <Alert>
          <AlertDescription>{success}</AlertDescription>
        </Alert>
      )}
    </div>
  )
}
