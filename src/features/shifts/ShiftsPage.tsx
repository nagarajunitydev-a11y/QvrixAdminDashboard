import { useMemo, useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { CalendarClock, Edit, Plus, Star, Trash2 } from 'lucide-react'
import { deleteShift, fetchDepartments, fetchEmployees, fetchShifts, updateShift } from '@/api/services'
import { useOrganization } from '@/api/OrganizationProvider'
import type { Shift } from '@/types'
import { DataTable } from '@/components/ui/data-table'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Alert, AlertDescription } from '@/components/ui/alert'
import { PageHeader } from '@/components/ui/page-header'
import { EmptyState, PageSkeleton } from '@/components/ui/states'
import { useToast } from '@/components/ui/toast'
import { scheduleSummary } from '@/lib/workSchedules'
import { WorkScheduleDialog } from './WorkScheduleDialog'

const plural = (count: number, word: string) => `${count} ${word}${count === 1 ? '' : 's'}`

export function ShiftsPage() {
  const queryClient = useQueryClient()
  const { toast } = useToast()
  const { canManage } = useOrganization()
  const { data: shifts = [], isLoading } = useQuery({ queryKey: ['shifts'], queryFn: fetchShifts })
  const { data: departments = [] } = useQuery({ queryKey: ['departments'], queryFn: fetchDepartments })
  const { data: employees = [] } = useQuery({ queryKey: ['employees'], queryFn: fetchEmployees })
  // A new key per opening resets the form to the record being edited.
  const [dialog, setDialog] = useState<{ key: number; schedule: Shift | null } | null>(null)
  const [error, setError] = useState<string | null>(null)

  const usage = useMemo(() => {
    const byShift = new Map<string, { employees: number; departments: string[] }>()
    const entry = (id: string) => byShift.get(id) ?? byShift.set(id, { employees: 0, departments: [] }).get(id)!
    for (const employee of employees) {
      if (employee.shift_id && !employee.archived_at) entry(employee.shift_id).employees++
    }
    for (const department of departments) {
      if (department.shift_id) entry(department.shift_id).departments.push(department.name)
    }
    return byShift
  }, [employees, departments])

  const refresh = () => {
    queryClient.invalidateQueries({ queryKey: ['shifts'] })
    queryClient.invalidateQueries({ queryKey: ['onboarding-counts'] })
  }

  const makeDefault = useMutation({
    mutationFn: (schedule: Shift) => updateShift(schedule.id, { is_default: true }),
    onSuccess: (saved) => {
      setError(null)
      refresh()
      toast({ title: `${saved.name} is now the organization default`, variant: 'success' })
    },
    onError: (err) => setError(err instanceof Error ? err.message : 'Could not change the default schedule.'),
  })

  const remove = async (schedule: Shift) => {
    const used = usage.get(schedule.id)
    if (used && (used.employees || used.departments.length)) {
      setError(`${schedule.name} is still used by ${[
        used.employees ? plural(used.employees, 'employee') : '',
        used.departments.length ? `the ${used.departments.join(', ')} department${used.departments.length === 1 ? '' : 's'}` : '',
      ].filter(Boolean).join(' and ')}. Move them to another schedule first.`)
      return
    }
    if (!confirm(`Delete the ${schedule.name} schedule?`)) return
    try {
      await deleteShift(schedule.id)
      setError(null)
      refresh()
      toast({ title: `Deleted ${schedule.name}`, variant: 'success' })
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to delete the schedule.')
    }
  }

  if (isLoading) return <PageSkeleton cards={0} rows={5} />

  const fallback = shifts.find((shift) => shift.is_default)

  return (
    <div className="page-shell">
      <PageHeader
        eyebrow="Scheduling"
        title="Work Schedules"
        description="Working days, hours, breaks and overtime. Each employee follows their own schedule, otherwise their department's, otherwise the organization default."
        icon={CalendarClock}
        actions={canManage && (
          <Button onClick={() => setDialog({ key: Date.now(), schedule: null })} className="shrink-0 gap-2">
            <Plus className="h-4 w-4" />
            New schedule
          </Button>
        )}
      />

      {error && (
        <Alert variant="destructive">
          <AlertDescription>{error}</AlertDescription>
        </Alert>
      )}

      {shifts.length > 0 && !fallback && (
        <Alert>
          <AlertDescription>
            No organization default is set, so employees without a schedule of their own or from their department have
            no planned hours. Choose one with the star button.
          </AlertDescription>
        </Alert>
      )}

      <Card>
        <CardHeader>
          <CardTitle>Schedules</CardTitle>
          <CardDescription>
            {plural(shifts.length, 'schedule')}. The Android app shows each employee's start and end times today; it applies breaks and the
            time-tracking policy after its next update, and timesheets will use the rest.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <DataTable
            emptyState={(
              <EmptyState
                icon={CalendarClock}
                title="No work schedules yet"
                description="Create the schedules your people work, so attendance can be compared with planned hours."
                action={canManage && (
                  <Button onClick={() => setDialog({ key: Date.now(), schedule: null })} className="gap-2">
                    <Plus className="h-4 w-4" />
                    New schedule
                  </Button>
                )}
              />
            )}
            columns={[
              {
                header: 'Schedule',
                accessor: (row) => (
                  <div className="space-y-0.5">
                    <div className="flex items-center gap-2">
                      <span className="font-semibold text-foreground">{row.name}</span>
                      {row.is_default && <Badge variant="info">Default</Badge>}
                    </div>
                    <span className="text-label-sm text-muted-foreground">{row.summary.type} · {row.summary.days}</span>
                  </div>
                ),
              },
              {
                header: 'Hours',
                accessor: (row) => (
                  <div className="space-y-0.5">
                    <span className="font-label text-label-md text-foreground">{row.summary.hours}</span>
                    {row.summary.weekly !== '—' && <span className="block text-label-sm text-muted-foreground">{row.summary.weekly}</span>}
                  </div>
                ),
              },
              { header: 'Breaks', accessor: (row) => <span className="text-body-sm">{row.summary.breaks}</span> },
              { header: 'Overtime', accessor: (row) => <span className="text-body-sm">{row.summary.overtime}</span> },
              {
                header: 'Used by',
                accessor: (row) => {
                  const used = usage.get(row.id)
                  const parts = [
                    used?.employees ? plural(used.employees, 'employee') : '',
                    used?.departments.length ? used.departments.join(', ') : '',
                  ].filter(Boolean)
                  return <span className="text-body-sm">{parts.length ? parts.join(' · ') : row.is_default ? 'Everyone else' : '—'}</span>
                },
              },
              ...(canManage ? [{
                header: 'Actions',
                className: 'text-right',
                accessor: (row: Shift) => (
                  <div className="flex justify-end gap-1">
                    {!row.is_default && (
                      <Button size="icon" variant="ghost" title="Make organization default" disabled={makeDefault.isPending}
                        onClick={() => makeDefault.mutate(row)}>
                        <Star className="h-4 w-4" />
                      </Button>
                    )}
                    <Button size="icon" variant="ghost" title="Edit" onClick={() => setDialog({ key: Date.now(), schedule: row })}>
                      <Edit className="h-4 w-4" />
                    </Button>
                    <Button size="icon" variant="ghost" title="Delete" className="hover:text-destructive" onClick={() => remove(row)}>
                      <Trash2 className="h-4 w-4" />
                    </Button>
                  </div>
                ),
              }] : []),
            ]}
            data={shifts.map((shift) => ({ ...shift, summary: scheduleSummary(shift) }))}
          />
        </CardContent>
      </Card>

      {dialog && (
        <WorkScheduleDialog
          key={dialog.key}
          open
          schedule={dialog.schedule}
          onClose={() => setDialog(null)}
          onSaved={(saved) => {
            setDialog(null)
            setError(null)
            refresh()
            toast({ title: `Saved ${saved.name}`, variant: 'success' })
          }}
        />
      )}
    </div>
  )
}
