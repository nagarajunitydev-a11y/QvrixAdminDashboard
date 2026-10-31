import { useState } from 'react'
import { useMutation } from '@tanstack/react-query'
import { addTimeEntry, editTimeEntry, type TimeEntryTarget } from '@/api/services'
import type { Site } from '@/types'
import { Button } from '@/components/ui/button'
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Textarea } from '@/components/ui/textarea'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Alert, AlertDescription } from '@/components/ui/alert'
import { addDays, zonedParts, type TimesheetEntry } from '@/lib/timesheets'

const NO_SITE = 'none'
const errorText = (error: unknown, fallback: string) => (error instanceof Error ? error.message : fallback)

export type EntryDialogMode =
  | { kind: 'add'; employeeId: string; date: string }
  | { kind: 'edit'; entry: TimesheetEntry }

function initialTimes(mode: EntryDialogMode, timeZone: string) {
  if (mode.kind === 'add') return { startDate: mode.date, startTime: '09:00', endDate: mode.date, endTime: '18:00' }
  const start = zonedParts(mode.entry.start_at, timeZone)
  const endInstant = mode.entry.end_at ?? mode.entry.recorded_end
  const end = endInstant ? zonedParts(endInstant, timeZone) : { date: start.date, time: '' }
  return { startDate: start.date, startTime: start.time, endDate: end.date, endTime: end.time }
}

export function TimeEntryDialog({ mode, employeeName, sites, timeZone, onClose, onSaved }: {
  mode: EntryDialogMode
  employeeName: string
  sites: Site[]
  timeZone: string
  onClose: () => void
  onSaved: () => void
}) {
  const [times, setTimes] = useState(() => initialTimes(mode, timeZone))
  const [siteId, setSiteId] = useState(mode.kind === 'edit' ? mode.entry.site_id ?? NO_SITE : NO_SITE)
  const [reason, setReason] = useState('')
  const set = (changes: Partial<typeof times>) => setTimes((current) => ({ ...current, ...changes }))
  const start = `${times.startDate} ${times.startTime}`
  const end = `${times.endDate} ${times.endTime}`
  const complete = Boolean(times.startDate && times.startTime && times.endDate && times.endTime)
  const problem = !complete ? 'Enter the start and the end.'
    : end <= start ? 'The end must be after the start.'
    : reason.trim().length < 3 ? 'Give a reason; it is kept in the change history.'
    : null

  const mutation = useMutation({
    mutationFn: async () => {
      const site = siteId === NO_SITE ? null : siteId
      if (mode.kind === 'add') return addTimeEntry(mode.employeeId, site, start, end, reason.trim())
      const target: TimeEntryTarget = mode.entry.session_id !== null
        ? { sessionId: mode.entry.session_id }
        : { correctionId: mode.entry.correction_id! }
      return editTimeEntry(target, site, start, end, reason.trim())
    },
    onSuccess: onSaved,
  })

  const recorded = mode.kind === 'edit' && mode.entry.source === 'app' && mode.entry.recorded_start
    ? `${zonedParts(mode.entry.recorded_start, timeZone).time}–${mode.entry.recorded_end ? zonedParts(mode.entry.recorded_end, timeZone).time : 'no check-out'}`
    : null

  return (
    <Dialog open onOpenChange={(open) => !open && !mutation.isPending && onClose()}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle>{mode.kind === 'add' ? `Add time for ${employeeName}` : `Correct time for ${employeeName}`}</DialogTitle>
        </DialogHeader>
        <form className="space-y-4" onSubmit={(e) => { e.preventDefault(); if (!problem) mutation.mutate() }}>
          {mutation.error && <Alert variant="destructive"><AlertDescription>{errorText(mutation.error, 'Could not save the entry.')}</AlertDescription></Alert>}
          {recorded && (
            <p className="text-body-sm text-muted-foreground">
              The app recorded {recorded}. That record is kept; your times are used for the timesheet instead.
            </p>
          )}
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1.5">
              <Label htmlFor="entry-start-date">Start date</Label>
              <Input id="entry-start-date" type="date" value={times.startDate}
                onChange={(e) => set({ startDate: e.target.value, endDate: times.endDate < e.target.value ? e.target.value : times.endDate })} />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="entry-start-time">Start time</Label>
              <Input id="entry-start-time" type="time" value={times.startTime} onChange={(e) => set({ startTime: e.target.value })} />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="entry-end-date">End date</Label>
              <Input id="entry-end-date" type="date" value={times.endDate} onChange={(e) => set({ endDate: e.target.value })} />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="entry-end-time">End time</Label>
              <Input id="entry-end-time" type="time" value={times.endTime} onChange={(e) => set({ endTime: e.target.value })} />
            </div>
          </div>
          {times.startDate && times.endDate === times.startDate && times.endTime && times.startTime && times.endTime <= times.startTime && (
            <Button type="button" variant="link" className="h-auto p-0 text-body-sm"
              onClick={() => set({ endDate: addDays(times.startDate, 1) })}>
              Ends after midnight? Set the end date to the next day
            </Button>
          )}
          <div className="space-y-1.5">
            <Label htmlFor="entry-site">Site</Label>
            <Select value={siteId} onValueChange={setSiteId}>
              <SelectTrigger id="entry-site"><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value={NO_SITE}>No site (office, travel or other work)</SelectItem>
                {sites.map((site) => <SelectItem key={site.id} value={site.id}>{site.name}</SelectItem>)}
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="entry-reason">Reason</Label>
            <Textarea id="entry-reason" rows={2} maxLength={500} value={reason} onChange={(e) => setReason(e.target.value)}
              placeholder="Forgot to check out; phone battery died; worked at the head office…" />
            <p className="text-label-sm text-muted-foreground">Times are in the organization's time zone ({timeZone}).</p>
          </div>
          <DialogFooter>
            <Button type="button" variant="outline" onClick={onClose} disabled={mutation.isPending}>Cancel</Button>
            <Button type="submit" disabled={mutation.isPending || Boolean(problem)} title={problem ?? undefined}>
              {mutation.isPending ? 'Saving…' : 'Save'}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}

export function ReasonDialog({ title, description, confirmLabel, destructive, onClose, onConfirm }: {
  title: string
  description: string
  confirmLabel: string
  destructive?: boolean
  onClose: () => void
  onConfirm: (reason: string) => Promise<void>
}) {
  const [reason, setReason] = useState('')
  const mutation = useMutation({ mutationFn: () => onConfirm(reason.trim()) })
  return (
    <Dialog open onOpenChange={(open) => !open && !mutation.isPending && onClose()}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>{title}</DialogTitle>
        </DialogHeader>
        <form className="space-y-4" onSubmit={(e) => { e.preventDefault(); if (reason.trim().length >= 3) mutation.mutate() }}>
          <p className="text-body-sm text-muted-foreground">{description}</p>
          {mutation.error && <Alert variant="destructive"><AlertDescription>{errorText(mutation.error, 'Could not save the change.')}</AlertDescription></Alert>}
          <div className="space-y-1.5">
            <Label htmlFor="change-reason">Reason</Label>
            <Textarea id="change-reason" rows={2} maxLength={500} value={reason} onChange={(e) => setReason(e.target.value)} />
          </div>
          <DialogFooter>
            <Button type="button" variant="outline" onClick={onClose} disabled={mutation.isPending}>Cancel</Button>
            <Button type="submit" variant={destructive ? 'destructive' : 'default'} disabled={mutation.isPending || reason.trim().length < 3}>
              {mutation.isPending ? 'Saving…' : confirmLabel}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}
