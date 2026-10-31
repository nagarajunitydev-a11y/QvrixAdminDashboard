import { useMemo, useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { CalendarDays, ChevronLeft, ChevronRight, ClipboardPaste, Edit, Flag, Plus, Star, Trash2 } from 'lucide-react'
import {
  addHolidays,
  deleteHoliday,
  deleteHolidayCalendar,
  fetchDepartments,
  fetchEmployees,
  fetchHolidayCalendars,
  fetchHolidays,
  saveHolidayCalendar,
  updateHoliday,
} from '@/api/services'
import { useOrganization } from '@/api/OrganizationProvider'
import type { Holiday, HolidayCalendar } from '@/types'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Textarea } from '@/components/ui/textarea'
import { Alert, AlertDescription } from '@/components/ui/alert'
import { DataTable } from '@/components/ui/data-table'
import { PageHeader } from '@/components/ui/page-header'
import { EmptyState, PageSkeleton } from '@/components/ui/states'
import { useToast } from '@/components/ui/toast'
import { formatHolidayDate, indiaNationalHolidays, isoWeekday, parseHolidayList } from '@/lib/holidays'
import { cn } from '@/lib/utils'

const checkboxClass = 'h-4 w-4 rounded border-input accent-primary'
const errorText = (error: unknown, fallback: string) => (error instanceof Error ? error.message : fallback)

function CalendarDialog({ calendar, isFirst, onClose, onSaved }: {
  calendar: HolidayCalendar | null
  isFirst: boolean
  onClose: () => void
  onSaved: (saved: HolidayCalendar) => void
}) {
  const [name, setName] = useState(calendar?.name ?? (isFirst ? 'Public holidays' : ''))
  const [isDefault, setIsDefault] = useState(calendar?.is_default ?? isFirst)
  const mutation = useMutation({
    mutationFn: () => saveHolidayCalendar(calendar?.id ?? null, { name: name.trim(), is_default: isDefault }),
    onSuccess: onSaved,
  })
  return (
    <Dialog open onOpenChange={(open) => !open && !mutation.isPending && onClose()}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{calendar ? 'Edit calendar' : 'New holiday calendar'}</DialogTitle>
        </DialogHeader>
        <form className="space-y-4" onSubmit={(e) => { e.preventDefault(); mutation.mutate() }}>
          {mutation.error && <Alert variant="destructive"><AlertDescription>{errorText(mutation.error, 'Could not save the calendar.')}</AlertDescription></Alert>}
          <div className="space-y-1.5">
            <Label htmlFor="calendar-name">Name</Label>
            <Input id="calendar-name" value={name} maxLength={80} onChange={(e) => setName(e.target.value)}
              placeholder="Public holidays, Karnataka sites, Head office…" />
            <p className="text-label-sm text-muted-foreground">Use one calendar per state or office when their holidays differ.</p>
          </div>
          <label className="flex items-start gap-2 text-body-sm">
            <input type="checkbox" className={cn(checkboxClass, 'mt-0.5')} checked={isDefault} onChange={(e) => setIsDefault(e.target.checked)} />
            <span><span className="font-semibold text-foreground">Organization default.</span> Applies to employees with no calendar of their own and none from their department.</span>
          </label>
          <DialogFooter>
            <Button type="button" variant="outline" onClick={onClose} disabled={mutation.isPending}>Cancel</Button>
            <Button type="submit" disabled={mutation.isPending || !name.trim()}>{mutation.isPending ? 'Saving…' : 'Save'}</Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}

function HolidayDialog({ calendar, holiday, defaultDate, onClose, onSaved }: {
  calendar: HolidayCalendar
  holiday: Holiday | null
  defaultDate: string
  onClose: () => void
  onSaved: () => void
}) {
  const [date, setDate] = useState(holiday?.holiday_date ?? defaultDate)
  const [name, setName] = useState(holiday?.name ?? '')
  const mutation = useMutation({
    mutationFn: async () => {
      if (holiday) await updateHoliday(holiday.id, { holiday_date: date, name: name.trim() })
      else await addHolidays(calendar.id, [{ date, name: name.trim() }])
    },
    onSuccess: onSaved,
  })
  return (
    <Dialog open onOpenChange={(open) => !open && !mutation.isPending && onClose()}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{holiday ? 'Edit holiday' : `Add a holiday to ${calendar.name}`}</DialogTitle>
        </DialogHeader>
        <form className="space-y-4" onSubmit={(e) => { e.preventDefault(); mutation.mutate() }}>
          {mutation.error && <Alert variant="destructive"><AlertDescription>{errorText(mutation.error, 'Could not save the holiday.')}</AlertDescription></Alert>}
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-[11rem_1fr]">
            <div className="space-y-1.5">
              <Label htmlFor="holiday-date">Date</Label>
              <Input id="holiday-date" type="date" value={date} onChange={(e) => setDate(e.target.value)} />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="holiday-name">Name</Label>
              <Input id="holiday-name" value={name} maxLength={80} onChange={(e) => setName(e.target.value)} placeholder="Ugadi" />
            </div>
          </div>
          <DialogFooter>
            <Button type="button" variant="outline" onClick={onClose} disabled={mutation.isPending}>Cancel</Button>
            <Button type="submit" disabled={mutation.isPending || !date || !name.trim()}>{mutation.isPending ? 'Saving…' : 'Save'}</Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}

function PasteDialog({ calendar, existing, onClose, onSaved }: {
  calendar: HolidayCalendar
  existing: Holiday[]
  onClose: () => void
  onSaved: (count: number) => void
}) {
  const [text, setText] = useState('')
  const preview = useMemo(() => parseHolidayList(text, new Set(existing.map((h) => h.holiday_date))), [text, existing])
  const mutation = useMutation({ mutationFn: () => addHolidays(calendar.id, preview.holidays), onSuccess: onSaved })
  return (
    <Dialog open onOpenChange={(open) => !open && !mutation.isPending && onClose()}>
      <DialogContent className="max-w-2xl">
        <DialogHeader>
          <DialogTitle>Paste holidays into {calendar.name}</DialogTitle>
        </DialogHeader>
        <div className="space-y-4">
          <p className="text-body-sm text-muted-foreground">
            One holiday per line: the date, then the name. Dates can be 2026-01-14 or 14/01/2026. Columns copied from a spreadsheet work too.
          </p>
          {mutation.error && <Alert variant="destructive"><AlertDescription>{errorText(mutation.error, 'Could not add the holidays.')}</AlertDescription></Alert>}
          <Textarea aria-label="Holiday list" rows={8} value={text} onChange={(e) => setText(e.target.value)}
            placeholder={'14/01/2026, Makara Sankranti\n2026-03-19, Ugadi\n2026-11-08\tDeepavali'} className="font-mono text-body-sm" />
          {text.trim() && (
            <div className="space-y-2 text-body-sm">
              <p className="font-semibold text-foreground">{preview.holidays.length} ready to add</p>
              {preview.problems.length > 0 && (
                <div className="rounded-xl border border-amber-500/30 bg-amber-500/5 p-3">
                  <p className="mb-1 font-semibold text-amber-700 dark:text-amber-400">{preview.problems.length} line{preview.problems.length === 1 ? '' : 's'} left out</p>
                  <ul className="max-h-36 space-y-0.5 overflow-y-auto text-label-sm text-muted-foreground">
                    {preview.problems.map((problem) => (
                      <li key={problem.line}>Line {problem.line} “{problem.text}”: {problem.message}</li>
                    ))}
                  </ul>
                </div>
              )}
            </div>
          )}
          <DialogFooter>
            <Button type="button" variant="outline" onClick={onClose} disabled={mutation.isPending}>Cancel</Button>
            <Button onClick={() => mutation.mutate()} disabled={mutation.isPending || preview.holidays.length === 0}>
              {mutation.isPending ? 'Adding…' : `Add ${preview.holidays.length} holiday${preview.holidays.length === 1 ? '' : 's'}`}
            </Button>
          </DialogFooter>
        </div>
      </DialogContent>
    </Dialog>
  )
}

type DialogState =
  | { kind: 'calendar'; calendar: HolidayCalendar | null }
  | { kind: 'holiday'; holiday: Holiday | null }
  | { kind: 'paste' }

export function HolidaysPage() {
  const queryClient = useQueryClient()
  const { toast } = useToast()
  const { canManage } = useOrganization()
  const { data: calendars = [], isLoading } = useQuery({ queryKey: ['holiday-calendars'], queryFn: fetchHolidayCalendars })
  const { data: departments = [] } = useQuery({ queryKey: ['departments'], queryFn: fetchDepartments })
  const { data: employees = [] } = useQuery({ queryKey: ['employees'], queryFn: fetchEmployees })
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const [year, setYear] = useState(() => new Date().getFullYear())
  const [dialog, setDialog] = useState<DialogState | null>(null)
  const [error, setError] = useState<string | null>(null)

  const selected = calendars.find((c) => c.id === selectedId) ?? calendars.find((c) => c.is_default) ?? calendars[0] ?? null
  const { data: holidays = [], isLoading: holidaysLoading } = useQuery({
    queryKey: ['holidays', selected?.id],
    queryFn: () => fetchHolidays(selected!.id),
    enabled: Boolean(selected),
  })
  const shown = holidays.filter((h) => h.holiday_date.startsWith(`${year}-`))
  const national = indiaNationalHolidays(year).filter((h) => !holidays.some((existing) => existing.holiday_date === h.date))

  const refreshCalendars = () => {
    queryClient.invalidateQueries({ queryKey: ['holiday-calendars'] })
    queryClient.invalidateQueries({ queryKey: ['onboarding-counts'] })
  }
  const refreshHolidays = () => queryClient.invalidateQueries({ queryKey: ['holidays', selected?.id] })

  const usage = (calendar: HolidayCalendar) => {
    const people = employees.filter((e) => e.holiday_calendar_id === calendar.id && !e.archived_at).length
    const teams = departments.filter((d) => d.holiday_calendar_id === calendar.id).map((d) => d.name)
    return { people, teams }
  }

  const addNational = useMutation({
    mutationFn: () => addHolidays(selected!.id, national),
    onSuccess: (count) => {
      refreshHolidays()
      toast({ title: `Added ${count} national holiday${count === 1 ? '' : 's'} for ${year}`, variant: 'success' })
    },
    onError: (err) => setError(errorText(err, 'Could not add the national holidays.')),
  })

  const makeDefault = useMutation({
    mutationFn: (calendar: HolidayCalendar) => saveHolidayCalendar(calendar.id, { name: calendar.name, is_default: true }),
    onSuccess: (saved) => {
      refreshCalendars()
      toast({ title: `${saved.name} is now the organization default`, variant: 'success' })
    },
    onError: (err) => setError(errorText(err, 'Could not change the default calendar.')),
  })

  const removeCalendar = async (calendar: HolidayCalendar) => {
    const { people, teams } = usage(calendar)
    if (people || teams.length) {
      setError(`${calendar.name} is still used by ${[
        people ? `${people} employee${people === 1 ? '' : 's'}` : '',
        teams.length ? `the ${teams.join(', ')} department${teams.length === 1 ? '' : 's'}` : '',
      ].filter(Boolean).join(' and ')}. Choose another calendar for them first.`)
      return
    }
    if (!confirm(`Delete ${calendar.name} and all of its holidays?`)) return
    try {
      await deleteHolidayCalendar(calendar.id)
      setError(null)
      setSelectedId(null)
      refreshCalendars()
      toast({ title: `Deleted ${calendar.name}`, variant: 'success' })
    } catch (err) {
      setError(errorText(err, 'Could not delete the calendar.'))
    }
  }

  const removeHoliday = async (holiday: Holiday) => {
    if (!confirm(`Remove ${holiday.name} on ${formatHolidayDate(holiday.holiday_date).date}?`)) return
    try {
      await deleteHoliday(holiday.id)
      setError(null)
      refreshHolidays()
    } catch (err) {
      setError(errorText(err, 'Could not remove the holiday.'))
    }
  }

  if (isLoading) return <PageSkeleton cards={0} rows={6} />

  const newCalendar = () => setDialog({ kind: 'calendar', calendar: null })

  return (
    <div className="page-shell">
      <PageHeader
        eyebrow="Scheduling"
        title="Holidays"
        description="Public and company holidays. Each employee follows their own calendar, otherwise their department's, otherwise the organization default."
        icon={CalendarDays}
        actions={canManage && calendars.length > 0 && (
          <Button onClick={newCalendar} variant="outline" className="shrink-0 gap-2">
            <Plus className="h-4 w-4" />
            New calendar
          </Button>
        )}
      />

      {error && <Alert variant="destructive"><AlertDescription>{error}</AlertDescription></Alert>}

      {calendars.length === 0 ? (
        <EmptyState
          icon={CalendarDays}
          title="No holiday calendars yet"
          description="Create a calendar, add your official holiday list, and make it the default. Add more calendars for states or offices with different holidays."
          action={canManage && <Button onClick={newCalendar} className="gap-2"><Plus className="h-4 w-4" />Create a calendar</Button>}
        />
      ) : (
        <div className="grid grid-cols-1 gap-5 lg:grid-cols-[18rem_1fr]">
          <Card>
            <CardHeader>
              <CardTitle>Calendars</CardTitle>
              <CardDescription>{calendars.find((c) => c.is_default) ? 'The starred calendar is the default.' : 'No default calendar is set.'}</CardDescription>
            </CardHeader>
            <CardContent className="space-y-1.5">
              {calendars.map((calendar) => {
                const { people, teams } = usage(calendar)
                return (
                  <button
                    key={calendar.id}
                    type="button"
                    onClick={() => setSelectedId(calendar.id)}
                    aria-current={selected?.id === calendar.id}
                    className={cn(
                      'w-full rounded-xl border px-3 py-2.5 text-left transition-colors',
                      selected?.id === calendar.id ? 'border-primary bg-primary/5' : 'border-transparent hover:bg-muted/60',
                    )}
                  >
                    <span className="flex items-center gap-2 font-semibold text-foreground">
                      {calendar.name}
                      {calendar.is_default && <Badge variant="info">Default</Badge>}
                    </span>
                    <span className="mt-0.5 block text-label-sm text-muted-foreground">
                      {[people ? `${people} employee${people === 1 ? '' : 's'}` : '', teams.join(', ')].filter(Boolean).join(' · ')
                        || (calendar.is_default ? 'Everyone else' : 'Not assigned')}
                    </span>
                  </button>
                )
              })}
            </CardContent>
          </Card>

          {selected && (
            <Card>
              <CardHeader className="gap-3 sm:flex-row sm:items-start sm:justify-between">
                <div>
                  <CardTitle>{selected.name}</CardTitle>
                  <CardDescription>{shown.length} holiday{shown.length === 1 ? '' : 's'} in {year}</CardDescription>
                </div>
                <div className="flex flex-wrap items-center gap-1">
                  <Button size="icon" variant="ghost" title="Previous year" onClick={() => setYear(year - 1)}><ChevronLeft className="h-4 w-4" /></Button>
                  <span className="min-w-12 text-center font-label text-label-md font-semibold">{year}</span>
                  <Button size="icon" variant="ghost" title="Next year" onClick={() => setYear(year + 1)}><ChevronRight className="h-4 w-4" /></Button>
                  {canManage && (
                    <>
                      {!selected.is_default && (
                        <Button size="icon" variant="ghost" title="Make organization default" disabled={makeDefault.isPending}
                          onClick={() => makeDefault.mutate(selected)}><Star className="h-4 w-4" /></Button>
                      )}
                      <Button size="icon" variant="ghost" title="Edit calendar" onClick={() => setDialog({ kind: 'calendar', calendar: selected })}><Edit className="h-4 w-4" /></Button>
                      <Button size="icon" variant="ghost" title="Delete calendar" className="hover:text-destructive" onClick={() => removeCalendar(selected)}><Trash2 className="h-4 w-4" /></Button>
                    </>
                  )}
                </div>
              </CardHeader>
              <CardContent className="space-y-4">
                {canManage && (
                  <div className="flex flex-wrap gap-2">
                    <Button size="sm" className="gap-2" onClick={() => setDialog({ kind: 'holiday', holiday: null })}><Plus className="h-4 w-4" />Add holiday</Button>
                    <Button size="sm" variant="outline" className="gap-2" onClick={() => setDialog({ kind: 'paste' })}><ClipboardPaste className="h-4 w-4" />Paste a list</Button>
                    <Button size="sm" variant="outline" className="gap-2" disabled={national.length === 0 || addNational.isPending}
                      title="Republic Day, Independence Day and Gandhi Jayanti" onClick={() => addNational.mutate()}>
                      <Flag className="h-4 w-4" />
                      {national.length ? `Add India national holidays ${year}` : `National holidays ${year} added`}
                    </Button>
                  </div>
                )}
                <DataTable
                  pageSize={25}
                  emptyMessage={holidaysLoading ? 'Loading…' : `No holidays in ${year}. Festival and state holidays change every year, so add them from your official list.`}
                  columns={[
                    {
                      header: 'Date',
                      accessor: (row) => {
                        const { weekday, date } = formatHolidayDate(row.holiday_date)
                        return <span className="font-label text-label-md"><span className="text-muted-foreground">{weekday}</span> {date}</span>
                      },
                    },
                    { header: 'Holiday', accessor: (row) => <span className="font-semibold text-foreground">{row.name}</span> },
                    {
                      header: '',
                      accessor: (row) => (isoWeekday(row.holiday_date) >= 6 ? <Badge variant="secondary">Weekend</Badge> : null),
                    },
                    ...(canManage ? [{
                      header: 'Actions',
                      className: 'text-right',
                      accessor: (row: Holiday) => (
                        <div className="flex justify-end gap-1">
                          <Button size="icon" variant="ghost" title="Edit" onClick={() => setDialog({ kind: 'holiday', holiday: row })}><Edit className="h-4 w-4" /></Button>
                          <Button size="icon" variant="ghost" title="Remove" className="hover:text-destructive" onClick={() => removeHoliday(row)}><Trash2 className="h-4 w-4" /></Button>
                        </div>
                      ),
                    }] : []),
                  ]}
                  data={shown}
                />
              </CardContent>
            </Card>
          )}
        </div>
      )}

      {dialog?.kind === 'calendar' && (
        <CalendarDialog
          calendar={dialog.calendar}
          isFirst={calendars.length === 0}
          onClose={() => setDialog(null)}
          onSaved={(saved) => {
            setDialog(null)
            setError(null)
            setSelectedId(saved.id)
            refreshCalendars()
            toast({ title: `Saved ${saved.name}`, variant: 'success' })
          }}
        />
      )}
      {dialog?.kind === 'holiday' && selected && (
        <HolidayDialog
          calendar={selected}
          holiday={dialog.holiday}
          defaultDate={`${year}-01-01`}
          onClose={() => setDialog(null)}
          onSaved={() => {
            setDialog(null)
            setError(null)
            refreshHolidays()
          }}
        />
      )}
      {dialog?.kind === 'paste' && selected && (
        <PasteDialog
          calendar={selected}
          existing={holidays}
          onClose={() => setDialog(null)}
          onSaved={(count) => {
            setDialog(null)
            setError(null)
            refreshHolidays()
            toast({ title: `Added ${count} holiday${count === 1 ? '' : 's'}`, variant: 'success' })
          }}
        />
      )}
    </div>
  )
}
