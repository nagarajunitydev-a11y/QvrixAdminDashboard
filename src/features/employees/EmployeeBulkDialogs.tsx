import { useState } from 'react'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import { archiveEmployees, assignEmployeesToSite, restoreEmployees, updateEmployees } from '@/api/services'
import type { Department, Designation, EmployeeUpdate, HolidayCalendar, Shift, Site } from '@/types'
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { Button } from '@/components/ui/button'
import { Label } from '@/components/ui/label'
import { Alert, AlertDescription } from '@/components/ui/alert'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { useToast } from '@/components/ui/toast'
import { EMPLOYMENT_TYPES } from '@/lib/employeeImport'

const NO_CHANGE = '__no_change__'
const CLEAR = '__clear__'

function useEmployeeMutation<T>(fn: () => Promise<T>, onDone: (result: T) => void) {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: fn,
    onSuccess: (result) => {
      void queryClient.invalidateQueries({ queryKey: ['employees'] })
      void queryClient.invalidateQueries({ queryKey: ['employee-sites'] })
      void queryClient.invalidateQueries({ queryKey: ['onboarding-counts'] })
      onDone(result)
    },
  })
}

function ChangeSelect({
  id,
  label,
  value,
  onChange,
  options,
  clearable = true,
}: {
  id: string
  label: string
  value: string
  onChange: (value: string) => void
  options: Array<{ value: string; label: string }>
  clearable?: boolean
}) {
  return (
    <div className="space-y-2">
      <Label htmlFor={id}>{label}</Label>
      <Select value={value} onValueChange={onChange}>
        <SelectTrigger id={id}>
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          <SelectItem value={NO_CHANGE}>No change</SelectItem>
          {clearable && <SelectItem value={CLEAR}>Clear (none)</SelectItem>}
          {options.map((option) => (
            <SelectItem key={option.value} value={option.value}>{option.label}</SelectItem>
          ))}
        </SelectContent>
      </Select>
    </div>
  )
}

export function BulkEditDialog({
  ids,
  open,
  onOpenChange,
  onDone,
  departments,
  designations,
  shifts,
  holidayCalendars,
}: {
  ids: string[]
  open: boolean
  onOpenChange: (open: boolean) => void
  onDone: () => void
  departments: Department[]
  designations: Designation[]
  shifts: Shift[]
  holidayCalendars: HolidayCalendar[]
}) {
  const { toast } = useToast()
  const [department, setDepartment] = useState(NO_CHANGE)
  const [designation, setDesignation] = useState(NO_CHANGE)
  const [shift, setShift] = useState(NO_CHANGE)
  const [calendar, setCalendar] = useState(NO_CHANGE)
  const [employmentType, setEmploymentType] = useState(NO_CHANGE)
  const [status, setStatus] = useState(NO_CHANGE)

  const payload: EmployeeUpdate = {}
  const pick = (value: string) => (value === CLEAR ? null : value)
  if (department !== NO_CHANGE) payload.department_id = pick(department)
  if (designation !== NO_CHANGE) payload.designation_id = pick(designation)
  if (shift !== NO_CHANGE) payload.shift_id = pick(shift)
  if (calendar !== NO_CHANGE) payload.holiday_calendar_id = pick(calendar)
  if (employmentType !== NO_CHANGE) payload.employment_type = pick(employmentType)
  if (status !== NO_CHANGE) payload.is_active = status === 'active'
  const changes = Object.keys(payload).length

  const resetFields = () => {
    setDepartment(NO_CHANGE)
    setDesignation(NO_CHANGE)
    setShift(NO_CHANGE)
    setCalendar(NO_CHANGE)
    setEmploymentType(NO_CHANGE)
    setStatus(NO_CHANGE)
  }

  const mutation = useEmployeeMutation(() => updateEmployees(ids, payload), (count) => {
    toast({ title: `Updated ${count} employee${count === 1 ? '' : 's'}`, variant: 'success' })
    onDone()
    resetFields()
    onOpenChange(false)
  })
  const close = () => {
    mutation.reset()
    resetFields()
    onOpenChange(false)
  }

  return (
    <Dialog open={open} onOpenChange={(next) => (next ? onOpenChange(true) : close())}>
      <DialogContent className="max-w-xl">
        <DialogHeader>
          <DialogTitle>Edit {ids.length} employee{ids.length === 1 ? '' : 's'}</DialogTitle>
        </DialogHeader>
        <div className="space-y-4">
          <p className="text-body-sm text-muted-foreground">Only the fields you change are updated. Every selected employee changes together, or none do.</p>
          {mutation.error && (
            <Alert variant="destructive">
              <AlertDescription>{mutation.error instanceof Error ? mutation.error.message : 'Update failed.'}</AlertDescription>
            </Alert>
          )}
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            <ChangeSelect id="bulk-department" label="Department" value={department} onChange={setDepartment}
              options={departments.map((d) => ({ value: d.id, label: d.name }))} />
            <ChangeSelect id="bulk-designation" label="Designation" value={designation} onChange={setDesignation}
              options={designations.map((d) => ({ value: d.id, label: d.name }))} />
            <ChangeSelect id="bulk-shift" label="Work schedule" value={shift} onChange={setShift}
              options={shifts.map((s) => ({ value: s.id, label: s.name }))} />
            <ChangeSelect id="bulk-calendar" label="Holiday calendar" value={calendar} onChange={setCalendar}
              options={holidayCalendars.map((c) => ({ value: c.id, label: c.name }))} />
            <ChangeSelect id="bulk-type" label="Employment type" value={employmentType} onChange={setEmploymentType}
              options={EMPLOYMENT_TYPES.map((t) => ({ value: t.value, label: t.label }))} />
            <ChangeSelect id="bulk-status" label="Status" value={status} onChange={setStatus} clearable={false}
              options={[{ value: 'active', label: 'Active' }, { value: 'inactive', label: 'Inactive' }]} />
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={close} disabled={mutation.isPending}>Cancel</Button>
          <Button onClick={() => mutation.mutate()} disabled={changes === 0 || mutation.isPending}>
            {mutation.isPending ? 'Saving…' : `Apply to ${ids.length}`}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

export function BulkAssignSiteDialog({
  ids,
  open,
  onOpenChange,
  onDone,
  sites,
}: {
  ids: string[]
  open: boolean
  onOpenChange: (open: boolean) => void
  onDone: () => void
  sites: Site[]
}) {
  const { toast } = useToast()
  const [siteId, setSiteId] = useState<string | undefined>(undefined)
  const mutation = useEmployeeMutation(() => assignEmployeesToSite(ids, siteId!), (added) => {
    const already = ids.length - added
    toast({
      title: `Assigned ${added} employee${added === 1 ? '' : 's'}`,
      description: already ? `${already} already worked at this site.` : undefined,
      variant: 'success',
    })
    onDone()
    setSiteId(undefined)
    onOpenChange(false)
  })
  const close = () => {
    mutation.reset()
    setSiteId(undefined)
    onOpenChange(false)
  }

  return (
    <Dialog open={open} onOpenChange={(next) => (next ? onOpenChange(true) : close())}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Assign {ids.length} employee{ids.length === 1 ? '' : 's'} to a site</DialogTitle>
        </DialogHeader>
        <div className="space-y-4">
          {mutation.error && (
            <Alert variant="destructive">
              <AlertDescription>{mutation.error instanceof Error ? mutation.error.message : 'Assignment failed.'}</AlertDescription>
            </Alert>
          )}
          <div className="space-y-2">
            <Label htmlFor="bulk-site">Site</Label>
            <Select value={siteId} onValueChange={setSiteId}>
              <SelectTrigger id="bulk-site">
                <SelectValue placeholder={sites.length ? 'Select a site' : 'No sites yet'} />
              </SelectTrigger>
              <SelectContent>
                {sites.map((site) => (
                  <SelectItem key={site.id} value={site.id}>{site.name}</SelectItem>
                ))}
              </SelectContent>
            </Select>
            <p className="text-body-sm text-muted-foreground">Existing site assignments are kept; this adds one more.</p>
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={close} disabled={mutation.isPending}>Cancel</Button>
          <Button onClick={() => mutation.mutate()} disabled={!siteId || mutation.isPending}>
            {mutation.isPending ? 'Assigning…' : 'Assign'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

export function ArchiveDialog({
  mode,
  employees,
  open,
  onOpenChange,
  onDone,
}: {
  mode: 'archive' | 'restore'
  employees: Array<{ id: string; first_name: string; last_name: string }>
  open: boolean
  onOpenChange: (open: boolean) => void
  onDone: () => void
}) {
  const { toast } = useToast()
  const ids = employees.map((e) => e.id)
  const mutation = useEmployeeMutation(
    () => (mode === 'archive' ? archiveEmployees(ids) : restoreEmployees(ids)),
    (count) => {
      toast({ title: `${mode === 'archive' ? 'Archived' : 'Restored'} ${count} employee${count === 1 ? '' : 's'}`, variant: 'success' })
      onDone()
      onOpenChange(false)
    },
  )
  const close = () => {
    mutation.reset()
    onOpenChange(false)
  }
  const names = employees.slice(0, 5).map((e) => `${e.first_name} ${e.last_name}`).join(', ')
  const more = employees.length > 5 ? ` and ${employees.length - 5} more` : ''

  return (
    <Dialog open={open} onOpenChange={(next) => (next ? onOpenChange(true) : close())}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>
            {mode === 'archive' ? 'Archive' : 'Restore'} {employees.length === 1 ? names : `${employees.length} employees`}?
          </DialogTitle>
        </DialogHeader>
        <div className="space-y-3 text-body-sm text-muted-foreground">
          {employees.length > 1 && <p className="text-foreground">{names}{more}</p>}
          {mode === 'archive' ? (
            <p>
              Archived employees can no longer use the Crewtraxa app and are hidden from the workforce. Their attendance
              and location history is kept, and you can restore them at any time. Anyone still checked in at a site
              must be checked out first.
            </p>
          ) : (
            <p>Restored employees become active again and can sign in to the Crewtraxa app.</p>
          )}
          {mutation.error && (
            <Alert variant="destructive">
              <AlertDescription>{mutation.error instanceof Error ? mutation.error.message : 'The change failed.'}</AlertDescription>
            </Alert>
          )}
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={close} disabled={mutation.isPending}>Cancel</Button>
          <Button
            variant={mode === 'archive' ? 'destructive' : 'default'}
            onClick={() => mutation.mutate()}
            disabled={mutation.isPending || ids.length === 0}
          >
            {mutation.isPending ? 'Saving…' : mode === 'archive' ? 'Archive' : 'Restore'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
