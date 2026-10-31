import { useState, type ReactNode } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import {
  fetchDepartments,
  fetchHolidayCalendars,
  fetchShifts,
  createDepartment,
  updateDepartment,
  deleteDepartment,
} from '@/api/services'
import { Department, DepartmentInsert, DepartmentUpdate } from '@/types'
import { DataTable } from '@/components/ui/data-table'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card'
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Textarea } from '@/components/ui/textarea'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Alert, AlertDescription } from '@/components/ui/alert'
import { PageHeader } from '@/components/ui/page-header'
import { PageSkeleton } from '@/components/ui/states'
import { Building2, Plus, Edit, Trash2 } from 'lucide-react'
import { useOrganization } from '@/api/OrganizationProvider'

// Radix Select cannot hold an empty value.
const NONE = 'none'

export function DepartmentsPage() {
  const queryClient = useQueryClient()
  const [editing, setEditing] = useState<Department | null>(null)
  const [isFormOpen, setIsFormOpen] = useState(false)
  const [name, setName] = useState('')
  const [description, setDescription] = useState('')
  const [shiftId, setShiftId] = useState(NONE)
  const [calendarId, setCalendarId] = useState(NONE)
  const [error, setError] = useState<string | null>(null)
  const { canManage } = useOrganization()
  const { data: shifts = [] } = useQuery({ queryKey: ['shifts'], queryFn: fetchShifts })
  const { data: calendars = [] } = useQuery({ queryKey: ['holiday-calendars'], queryFn: fetchHolidayCalendars })
  const nameOf = (records: Array<{ id: string; name: string }>, id: string | null) => records.find((r) => r.id === id)?.name

  const { data: departments = [], isLoading } = useQuery({
    queryKey: ['departments'],
    queryFn: fetchDepartments,
  })

  const mutation = useMutation({
    mutationFn: async () => {
      const payload: DepartmentInsert = {
        name,
        description: description || null,
        shift_id: shiftId === NONE ? null : shiftId,
        holiday_calendar_id: calendarId === NONE ? null : calendarId,
      }
      if (editing) {
        await updateDepartment(editing.id, payload as DepartmentUpdate)
      } else {
        await createDepartment(payload)
      }
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['departments'] })
      setIsFormOpen(false)
      setEditing(null)
      setName('')
      setDescription('')
      setShiftId(NONE)
      setCalendarId(NONE)
      setError(null)
    },
    onError: (err) => {
      setError(err instanceof Error ? err.message : 'Failed to save department')
    },
  })

  const handleDelete = async (id: string) => {
    if (!confirm('Delete this department? This cannot be undone.')) return
    try {
      await deleteDepartment(id)
      setError(null)
      queryClient.invalidateQueries({ queryKey: ['departments'] })
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to delete department')
    }
  }

  const handleEdit = (dept: Department) => {
    setEditing(dept)
    setName(dept.name)
    setDescription(dept.description ?? '')
    setShiftId(dept.shift_id ?? NONE)
    setCalendarId(dept.holiday_calendar_id ?? NONE)
    setError(null)
    setIsFormOpen(true)
  }

  const handleAdd = () => {
    setEditing(null)
    setName('')
    setDescription('')
    setShiftId(NONE)
    setCalendarId(NONE)
    setError(null)
    setIsFormOpen(true)
  }

  const handleCloseForm = () => {
    setIsFormOpen(false)
    setError(null)
  }

  if (isLoading) {
    return <PageSkeleton cards={0} rows={5} />
  }

  return (
    <div className="page-shell">
      <PageHeader
        eyebrow="Organization"
        title="Departments"
        description="Structure the business into teams and reporting groups."
        icon={Building2}
        actions={canManage && (
          <Button onClick={handleAdd} className="shrink-0 gap-2">
            <Plus className="h-4 w-4" />
            Add Department
          </Button>
        )}
      />

      {error && !isFormOpen && (
        <Alert variant="destructive">
          <AlertDescription>{error}</AlertDescription>
        </Alert>
      )}

      <Card>
        <CardHeader>
          <CardTitle>Departments</CardTitle>
          <CardDescription>{departments.length} total departments</CardDescription>
        </CardHeader>
        <CardContent>
          <DataTable
            columns={[
              { header: 'Name', accessor: 'name' },
              { header: 'Description', accessor: 'description' },
              { header: 'Default schedule', accessor: (row) => nameOf(shifts, row.shift_id) ?? <span className="text-muted-foreground">Organization default</span> },
              { header: 'Holiday calendar', accessor: (row) => nameOf(calendars, row.holiday_calendar_id) ?? <span className="text-muted-foreground">Organization default</span> },
              ...(canManage ? [{ header: 'Actions', accessor: (row: { actions: ReactNode }) => row.actions, className: 'text-right' }] : []),
            ]}
            data={departments.map((d) => ({
              ...d,
              actions: (
                <div className="flex justify-end gap-1">
                  <Button size="icon" variant="ghost" title="Edit" onClick={() => handleEdit(d)}>
                    <Edit className="h-4 w-4" />
                  </Button>
                  <Button size="icon" variant="ghost" title="Delete" className="hover:text-destructive" onClick={() => handleDelete(d.id)}>
                    <Trash2 className="h-4 w-4" />
                  </Button>
                </div>
              ),
            }))}
          />
        </CardContent>
      </Card>

      <Dialog open={isFormOpen} onOpenChange={(open) => (open ? setIsFormOpen(true) : handleCloseForm())}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{editing ? 'Edit' : 'Add'} Department</DialogTitle>
          </DialogHeader>
          <div className="space-y-4">
            {error && (
              <Alert variant="destructive">
                <AlertDescription>{error}</AlertDescription>
              </Alert>
            )}
            <div className="space-y-2">
              <Label htmlFor="name">Name *</Label>
              <Input
                id="name"
                value={name}
                onChange={(e) => setName(e.target.value)}
                required
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="description">Description</Label>
              <Textarea
                id="description"
                value={description}
                onChange={(e) => setDescription(e.target.value)}
              />
            </div>
            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
              <div className="space-y-2">
                <Label htmlFor="department-shift">Default schedule</Label>
                <Select value={shiftId} onValueChange={setShiftId}>
                  <SelectTrigger id="department-shift"><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value={NONE}>Organization default</SelectItem>
                    {shifts.map((s) => <SelectItem key={s.id} value={s.id}>{s.name}</SelectItem>)}
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-2">
                <Label htmlFor="department-calendar">Holiday calendar</Label>
                <Select value={calendarId} onValueChange={setCalendarId}>
                  <SelectTrigger id="department-calendar"><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value={NONE}>Organization default</SelectItem>
                    {calendars.map((c) => <SelectItem key={c.id} value={c.id}>{c.name}</SelectItem>)}
                  </SelectContent>
                </Select>
              </div>
            </div>
            <p className="text-label-sm text-muted-foreground">Employees in this department use these unless their own profile sets a schedule or calendar.</p>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={handleCloseForm} disabled={mutation.isPending}>
              Cancel
            </Button>
            <Button
              type="submit"
              disabled={mutation.isPending || !name}
              onClick={() => mutation.mutate()}
            >
              {mutation.isPending ? 'Saving...' : 'Save'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  )
}
