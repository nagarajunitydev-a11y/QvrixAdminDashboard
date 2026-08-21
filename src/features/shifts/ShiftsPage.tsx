import { useState } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import {
  fetchDepartments,
  fetchShifts,
  createShift,
  updateShift,
  deleteShift,
} from '@/api/services'
import { Shift, ShiftInsert, ShiftUpdate } from '@/types'
import { DataTable } from '@/components/ui/data-table'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card'
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Alert, AlertDescription } from '@/components/ui/alert'
import { Plus, Edit, Trash2 } from 'lucide-react'
import { format } from 'date-fns'

export function ShiftsPage() {
  const queryClient = useQueryClient()
  const { data: shifts = [], isLoading } = useQuery({
    queryKey: ['shifts'],
    queryFn: fetchShifts,
  })
  const { data: departments = [] } = useQuery({
    queryKey: ['departments'],
    queryFn: fetchDepartments,
  })
  const [editing, setEditing] = useState<Shift | null>(null)
  const [isFormOpen, setIsFormOpen] = useState(false)
  const [name, setName] = useState('')
  const [startTime, setStartTime] = useState('')
  const [endTime, setEndTime] = useState('')
  const [departmentId, setDepartmentId] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)

  const mutation = useMutation({
    mutationFn: async () => {
      const payload: ShiftInsert = {
        name,
        start_time: startTime,
        end_time: endTime,
        department_id: departmentId ?? null,
      }
      if (editing) {
        await updateShift(editing.id, payload as ShiftUpdate)
      } else {
        await createShift(payload)
      }
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['shifts'] })
      setIsFormOpen(false)
      setEditing(null)
      setName('')
      setStartTime('')
      setEndTime('')
      setDepartmentId(null)
      setError(null)
    },
    onError: (err) => {
      setError(err instanceof Error ? err.message : 'Failed to save shift')
    },
  })

  const handleDelete = async (id: string) => {
    if (!confirm('Delete this shift?')) return
    try {
      await deleteShift(id)
      setError(null)
      queryClient.invalidateQueries({ queryKey: ['shifts'] })
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to delete shift')
    }
  }

  const handleEdit = (s: Shift) => {
    setEditing(s)
    setName(s.name)
    setStartTime(s.start_time)
    setEndTime(s.end_time)
    setDepartmentId(s.department_id ?? null)
    setError(null)
    setIsFormOpen(true)
  }

  const handleAdd = () => {
    setEditing(null)
    setName('')
    setStartTime('')
    setEndTime('')
    setDepartmentId(null)
    setError(null)
    setIsFormOpen(true)
  }

  const handleCloseForm = () => {
    setIsFormOpen(false)
    setError(null)
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
          <h1 className="font-headline text-headline-lg text-foreground">Shifts</h1>
          <p className="mt-1 text-body-sm text-muted-foreground">Manage work shift definitions.</p>
        </div>
        <Button onClick={handleAdd} className="shrink-0 gap-2">
          <Plus className="h-4 w-4" />
          Add Shift
        </Button>
      </div>

      {error && !isFormOpen && (
        <Alert variant="destructive">
          <AlertDescription>{error}</AlertDescription>
        </Alert>
      )}

      <Card>
        <CardHeader>
          <CardTitle>Shifts</CardTitle>
          <CardDescription>{shifts.length} total shifts</CardDescription>
        </CardHeader>
        <CardContent>
          <DataTable
            columns={[
              { header: 'Name', accessor: 'name' },
              {
                header: 'Schedule',
                accessor: (row) => (
                  <span className="font-label text-label-md text-foreground">
                    {format(new Date('2000-01-01T' + row.start_time), 'HH:mm')} – {format(new Date('2000-01-01T' + row.end_time), 'HH:mm')}
                  </span>
                ),
              },
              { header: 'Department', accessor: (row) => row.departments?.name ?? '—' },
              { header: 'Actions', accessor: (row) => row.actions, className: 'text-right' },
            ]}
            data={shifts.map((s) => ({
              ...s,
              actions: (
                <div className="flex justify-end gap-1">
                  <Button size="icon" variant="ghost" title="Edit" onClick={() => handleEdit(s)}>
                    <Edit className="h-4 w-4" />
                  </Button>
                  <Button size="icon" variant="ghost" title="Delete" className="hover:text-destructive" onClick={() => handleDelete(s.id)}>
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
            <DialogTitle>{editing ? 'Edit' : 'Add'} Shift</DialogTitle>
          </DialogHeader>
          <div className="space-y-4">
            {error && (
              <Alert variant="destructive">
                <AlertDescription>{error}</AlertDescription>
              </Alert>
            )}
            <div className="space-y-2">
              <Label htmlFor="name">Shift Name *</Label>
              <Input
                id="name"
                value={name}
                onChange={(e) => setName(e.target.value)}
                required
              />
            </div>
            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-2">
                <Label htmlFor="start_time">Start Time *</Label>
                <Input
                  id="start_time"
                  type="time"
                  value={startTime}
                  onChange={(e) => setStartTime(e.target.value)}
                  required
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="end_time">End Time *</Label>
                <Input
                  id="end_time"
                  type="time"
                  value={endTime}
                  onChange={(e) => setEndTime(e.target.value)}
                  required
                />
              </div>
            </div>
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
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={handleCloseForm} disabled={mutation.isPending}>
              Cancel
            </Button>
            <Button
              onClick={() => mutation.mutate()}
              disabled={mutation.isPending || !name || !startTime || !endTime}
            >
              {mutation.isPending ? 'Saving...' : 'Save'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  )
}
