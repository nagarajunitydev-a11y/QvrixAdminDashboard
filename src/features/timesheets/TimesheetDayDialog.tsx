import { useMemo, useState } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { Edit, History, MapPin, Plus, RotateCcw, Trash2 } from 'lucide-react'
import {
  fetchLocationTrail,
  fetchTimeCorrections,
  fetchTimesheetEntries,
  removeTimeEntry,
  restoreTimeEntry,
  type EmployeeWithRelations,
} from '@/api/services'
import { fetchOrganizationMembers } from '@/api/organizations'
import type { Site } from '@/types'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { Alert, AlertDescription } from '@/components/ui/alert'
import { InlineSpinner } from '@/components/ui/states'
import { MapCanvas, type MapCircle, type MapMarker } from '@/components/map/MapCanvas'
import { useToast } from '@/components/ui/toast'
import {
  DAY_TYPE_LABELS,
  FLAG_META,
  addDays,
  clockIn,
  dayLabel,
  hm,
  overtimeMinutes,
  zonedParts,
  type TimeEntryCorrection,
  type TimesheetDay,
  type TimesheetEntry,
} from '@/lib/timesheets'
import { ReasonDialog, TimeEntryDialog, type EntryDialogMode } from './TimeEntryDialogs'

const STATUS_LABELS: Record<TimesheetEntry['status'], { label: string; tone: 'secondary' | 'info' | 'warning' | 'destructive' }> = {
  recorded: { label: 'App', tone: 'secondary' },
  corrected: { label: 'Corrected', tone: 'info' },
  added: { label: 'Added by manager', tone: 'info' },
  removed: { label: 'Removed', tone: 'destructive' },
}

const END_STATE_LABELS: Partial<Record<TimesheetEntry['end_state'], string>> = {
  in_progress: 'Still checked in',
  missing_check_out: 'No check-out',
  auto_check_out: 'Automatic check-out',
}

const CORRECTION_LABELS: Record<TimeEntryCorrection['kind'], string> = {
  add: 'Added an entry',
  replace: 'Corrected the times',
  remove: 'Removed the entry',
}

const STAMP = new Intl.DateTimeFormat('en-IN', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' })

function Figure({ label, value, hint }: { label: string; value: string; hint?: string }) {
  return (
    <div className="rounded-xl bg-muted/50 px-3 py-2">
      <p className="text-label-sm text-muted-foreground">{label}</p>
      <p className="font-headline text-body-lg font-semibold text-foreground">{value}</p>
      {hint && <p className="text-label-sm text-muted-foreground">{hint}</p>}
    </div>
  )
}

type Pending =
  | { kind: 'entry'; mode: EntryDialogMode }
  | { kind: 'remove'; entry: TimesheetEntry }
  | { kind: 'restore'; entry: TimesheetEntry }

export function TimesheetDayDialog({ employee, day, timeZone, sites, canManage, onClose }: {
  employee: EmployeeWithRelations
  day: TimesheetDay
  timeZone: string
  sites: Site[]
  canManage: boolean
  onClose: () => void
}) {
  const queryClient = useQueryClient()
  const { toast } = useToast()
  const [pending, setPending] = useState<Pending | null>(null)
  const name = `${employee.first_name} ${employee.last_name}`
  const siteName = (id: string | null) => (id ? sites.find((s) => s.id === id)?.name ?? 'Unknown site' : 'No site')

  const entriesQuery = useQuery({
    queryKey: ['timesheet-entries', employee.id, day.work_date],
    queryFn: () => fetchTimesheetEntries(employee.id, day.work_date, day.work_date),
  })
  const entries = useMemo(() => entriesQuery.data ?? [], [entriesQuery.data])
  const sessionIds = entries.flatMap((e) => (e.session_id === null ? [] : [e.session_id]))
  const historyQuery = useQuery({
    queryKey: ['time-corrections', employee.id, day.work_date, sessionIds.join(',')],
    queryFn: () => fetchTimeCorrections(employee.id, sessionIds,
      new Date(`${addDays(day.work_date, -1)}T00:00:00Z`), new Date(`${addDays(day.work_date, 2)}T00:00:00Z`)),
    enabled: entriesQuery.isSuccess,
  })
  // Added entries are fetched by a window around the day; keep only those placed on this day.
  const history = (historyQuery.data ?? []).filter((c) => c.session_id !== null
    || (c.start_at && zonedParts(c.start_at, timeZone).date === day.work_date)
    || entries.some((e) => e.correction_id === c.id))
  const membersQuery = useQuery({ queryKey: ['organization-members'], queryFn: fetchOrganizationMembers, enabled: canManage, retry: false })
  const who = (userId: string | null) => membersQuery.data?.find((m) => m.user_id === userId)?.email ?? 'a Console user'

  // A day still in progress shows the trail up to when the dialog opened.
  const [openedAt] = useState(() => Date.now())
  const trailFrom = day.first_in ? new Date(day.first_in).getTime() - 30 * 60_000 : null
  const trailTo = day.first_in ? (day.last_out ? new Date(day.last_out).getTime() : openedAt) + 30 * 60_000 : null
  const trailQuery = useQuery({
    queryKey: ['location-trail', employee.user_id, trailFrom, trailTo],
    queryFn: () => fetchLocationTrail(employee.user_id!, trailFrom!, trailTo!),
    enabled: Boolean(employee.user_id && trailFrom && trailTo),
  })

  const map = useMemo(() => {
    const points = trailQuery.data ?? []
    const step = Math.max(1, Math.ceil(points.length / 40))
    const markers: MapMarker[] = points.filter((_, i) => i % step === 0 || i === points.length - 1).map((p) => ({
      id: String(p.timestamp),
      position: { lat: p.latitude, lng: p.longitude },
      label: zonedParts(p.timestamp, timeZone).time,
      sublabel: p.is_inside ? 'Inside the site' : 'Outside the site',
      tone: p.is_inside ? 'primary' : 'danger',
    }))
    const usedSites = sites.filter((s) => entries.some((e) => e.site_id === s.id))
    const circles: MapCircle[] = usedSites.map((s) => ({
      id: s.id, center: { lat: s.latitude, lng: s.longitude }, radiusMeters: s.radius_in_meters, label: s.name, tone: 'saved',
    }))
    const center = markers[0]?.position ?? circles[0]?.center ?? null
    return { markers, circles, center }
  }, [trailQuery.data, sites, entries, timeZone])

  const refresh = () => {
    queryClient.invalidateQueries({ queryKey: ['timesheet'] })
    queryClient.invalidateQueries({ queryKey: ['timesheet-entries', employee.id] })
    queryClient.invalidateQueries({ queryKey: ['time-corrections', employee.id] })
  }
  const done = (title: string) => {
    setPending(null)
    refresh()
    toast({ title, variant: 'success' })
  }
  const targetOf = (entry: TimesheetEntry) => (entry.session_id !== null
    ? { sessionId: entry.session_id } : { correctionId: entry.correction_id! })

  const ot = overtimeMinutes(day)
  const otParts = [
    day.overtime_daily_minutes && `daily ${hm(day.overtime_daily_minutes)}`,
    day.overtime_double_minutes && `double ${hm(day.overtime_double_minutes)}`,
    day.overtime_weekly_minutes && `weekly ${hm(day.overtime_weekly_minutes)}`,
    day.overtime_rest_day_minutes && `rest day ${hm(day.overtime_rest_day_minutes)}`,
    day.overtime_holiday_minutes && `holiday ${hm(day.overtime_holiday_minutes)}`,
  ].filter(Boolean).join(' · ')

  return (
    <>
      <Dialog open={!pending} onOpenChange={(open) => !open && onClose()}>
        <DialogContent className="max-w-4xl">
          <DialogHeader>
            <DialogTitle>{name} · {dayLabel(day.work_date)}</DialogTitle>
          </DialogHeader>
          <div className="space-y-5">
            <div className="flex flex-wrap items-center gap-2 text-body-sm text-muted-foreground">
              <Badge variant={day.day_type === 'working' ? 'outline' : 'secondary'}>
                {day.holiday_name ? `Holiday: ${day.holiday_name}` : DAY_TYPE_LABELS[day.day_type]}
              </Badge>
              {day.schedule_name && <span>Schedule: {day.schedule_name}</span>}
              {day.flags.map((flag) => (
                <Badge key={flag} variant={FLAG_META[flag]?.tone ?? 'secondary'} title={FLAG_META[flag]?.description}>
                  {FLAG_META[flag]?.label ?? flag}
                </Badge>
              ))}
            </div>

            <div className="grid grid-cols-2 gap-2 sm:grid-cols-4 lg:grid-cols-6">
              <Figure label="First in" value={clockIn(day.first_in, timeZone, day.work_date)} hint={day.late_minutes ? `${hm(day.late_minutes)} late` : undefined} />
              <Figure label="Last out" value={day.flags.includes('in_progress') ? 'Checked in' : clockIn(day.last_out, timeZone, day.work_date)}
                hint={day.early_out_minutes ? `${hm(day.early_out_minutes)} early` : undefined} />
              <Figure label="Tracked" value={hm(day.tracked_minutes)} />
              <Figure label="Unpaid breaks" value={hm(day.break_minutes)} />
              <Figure label="Payroll" value={hm(day.payroll_minutes)} hint={day.planned_minutes !== null ? `of ${hm(day.planned_minutes)} planned` : undefined} />
              <Figure label="Overtime" value={hm(ot)} hint={otParts || undefined} />
            </div>

            <section className="space-y-2">
              <div className="flex items-center justify-between gap-2">
                <h3 className="font-label text-label-md font-semibold text-foreground">Time entries</h3>
                {canManage && (
                  <Button size="sm" variant="outline" className="gap-2"
                    onClick={() => setPending({ kind: 'entry', mode: { kind: 'add', employeeId: employee.id, date: day.work_date } })}>
                    <Plus className="h-4 w-4" />
                    Add entry
                  </Button>
                )}
              </div>
              {entriesQuery.isLoading ? <InlineSpinner /> : entriesQuery.error ? (
                <Alert variant="destructive"><AlertDescription>{entriesQuery.error instanceof Error ? entriesQuery.error.message : 'Could not load the entries.'}</AlertDescription></Alert>
              ) : entries.length === 0 ? (
                <p className="rounded-xl border border-dashed border-border px-3 py-4 text-center text-body-sm text-muted-foreground">
                  Nothing recorded on this day.
                </p>
              ) : (
                <ul className="divide-y divide-border/70 rounded-xl border border-border/80">
                  {entries.map((entry) => {
                    const status = STATUS_LABELS[entry.status]
                    const removed = entry.status === 'removed'
                    return (
                      <li key={entry.correction_id ?? `s${entry.session_id}`} className="flex flex-col gap-2 px-3 py-2.5 sm:flex-row sm:items-center sm:justify-between">
                        <div className={removed ? 'opacity-60' : undefined}>
                          <p className="flex flex-wrap items-center gap-2 font-semibold text-foreground">
                            <span className={removed ? 'line-through' : undefined}>
                              {clockIn(entry.start_at, timeZone, day.work_date)} – {entry.end_at ? clockIn(entry.end_at, timeZone, day.work_date) : '…'}
                            </span>
                            <Badge variant={status.tone}>{status.label}</Badge>
                            {END_STATE_LABELS[entry.end_state] && <Badge variant="warning">{END_STATE_LABELS[entry.end_state]}</Badge>}
                          </p>
                          <p className="text-label-sm text-muted-foreground">
                            <MapPin className="mr-1 inline h-3 w-3" />{siteName(entry.site_id)}
                            {entry.effective_end && !removed && <> · counts {hm(Math.round((new Date(entry.effective_end).getTime() - new Date(entry.start_at).getTime()) / 60_000))}</>}
                            {entry.status === 'corrected' && entry.recorded_start && (
                              <> · app recorded {clockIn(entry.recorded_start, timeZone, day.work_date)}–{entry.recorded_end ? clockIn(entry.recorded_end, timeZone, day.work_date) : 'no check-out'}</>
                            )}
                            {entry.end_state === 'auto_check_out' && entry.effective_end && <> · ended at {clockIn(entry.effective_end, timeZone, day.work_date)} by the policy</>}
                          </p>
                        </div>
                        {canManage && (
                          <div className="flex shrink-0 gap-1">
                            {removed ? (
                              <Button size="sm" variant="ghost" className="gap-1.5" onClick={() => setPending({ kind: 'restore', entry })}>
                                <RotateCcw className="h-4 w-4" />Restore
                              </Button>
                            ) : (
                              <>
                                <Button size="sm" variant="ghost" className="gap-1.5" onClick={() => setPending({ kind: 'entry', mode: { kind: 'edit', entry } })}>
                                  <Edit className="h-4 w-4" />{entry.end_state === 'missing_check_out' ? 'Add check-out' : 'Correct'}
                                </Button>
                                {entry.status === 'corrected' && (
                                  <Button size="sm" variant="ghost" className="gap-1.5" title="Use what the app recorded" onClick={() => setPending({ kind: 'restore', entry })}>
                                    <RotateCcw className="h-4 w-4" />Undo
                                  </Button>
                                )}
                                <Button size="sm" variant="ghost" className="gap-1.5 hover:text-destructive" onClick={() => setPending({ kind: 'remove', entry })}>
                                  <Trash2 className="h-4 w-4" />Remove
                                </Button>
                              </>
                            )}
                          </div>
                        )}
                      </li>
                    )
                  })}
                </ul>
              )}
            </section>

            {history.length > 0 && (
              <section className="space-y-2">
                <h3 className="flex items-center gap-2 font-label text-label-md font-semibold text-foreground"><History className="h-4 w-4" />Change history</h3>
                <ol className="space-y-2">
                  {history.map((change) => (
                    <li key={change.id} className="rounded-xl border border-border/70 px-3 py-2 text-body-sm">
                      <p className="text-foreground">
                        <span className={change.voided_at ? 'line-through opacity-70' : 'font-semibold'}>{CORRECTION_LABELS[change.kind]}</span>
                        {change.start_at && change.end_at && <> {clockIn(change.start_at, timeZone, day.work_date)}–{clockIn(change.end_at, timeZone, day.work_date)}</>}
                        {change.site_id && <> at {siteName(change.site_id)}</>}
                      </p>
                      <p className="text-muted-foreground">“{change.reason}” · {who(change.created_by)}, {STAMP.format(new Date(change.created_at))}</p>
                      {change.voided_at && (
                        <p className="text-label-sm text-muted-foreground">
                          No longer in force: {change.void_reason} ({who(change.voided_by)}, {STAMP.format(new Date(change.voided_at))})
                        </p>
                      )}
                    </li>
                  ))}
                </ol>
              </section>
            )}

            {map.center && (
              <section className="space-y-2">
                <h3 className="font-label text-label-md font-semibold text-foreground">
                  Location trail {trailQuery.data && <span className="font-normal text-muted-foreground">({trailQuery.data.length} points{trailQuery.data.length >= 500 ? ', first 500 shown' : ''})</span>}
                </h3>
                <div className="relative h-72 overflow-hidden rounded-xl border border-border/80">
                  <MapCanvas center={map.center} zoom={15} markers={map.markers} circles={map.circles} showSearch={false}
                    className="absolute inset-0 h-full" ariaLabel={`Locations recorded for ${name} on ${dayLabel(day.work_date)}`} />
                </div>
              </section>
            )}
          </div>
        </DialogContent>
      </Dialog>

      {pending?.kind === 'entry' && (
        <TimeEntryDialog
          mode={pending.mode}
          employeeName={name}
          sites={sites}
          timeZone={timeZone}
          onClose={() => setPending(null)}
          onSaved={() => done(pending.mode.kind === 'add' ? 'Entry added' : 'Entry corrected')}
        />
      )}
      {pending?.kind === 'remove' && (
        <ReasonDialog
          title="Remove this entry?"
          description={pending.entry.source === 'app'
            ? 'The app record is kept and shown as removed; it stops counting toward the timesheet. You can restore it later.'
            : 'The added entry stops counting. It stays in the change history.'}
          confirmLabel="Remove"
          destructive
          onClose={() => setPending(null)}
          onConfirm={async (reason) => {
            await removeTimeEntry(targetOf(pending.entry), reason)
            done('Entry removed')
          }}
        />
      )}
      {pending?.kind === 'restore' && pending.entry.session_id !== null && (
        <ReasonDialog
          title="Use what the app recorded?"
          description="The correction stops applying and the times the app recorded count again. The correction stays in the change history."
          confirmLabel="Restore"
          onClose={() => setPending(null)}
          onConfirm={async (reason) => {
            await restoreTimeEntry(pending.entry.session_id!, reason)
            done('App record restored')
          }}
        />
      )}
    </>
  )
}
