import { useState, type ReactNode } from 'react'
import { useMutation } from '@tanstack/react-query'
import { Plus, Trash2 } from 'lucide-react'
import { createShift, updateShift } from '@/api/services'
import type { Shift } from '@/types'
import { Button } from '@/components/ui/button'
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Alert, AlertDescription } from '@/components/ui/alert'
import { cn } from '@/lib/utils'
import {
  MAX_BREAKS,
  SCHEDULE_TYPES,
  WEEKDAYS,
  emptyScheduleForm,
  formFromSchedule,
  scheduleSummary,
  toClock,
  validateScheduleForm,
  type OvertimeRuleForm,
  type ScheduleForm,
} from '@/lib/workSchedules'

const checkboxClass = 'h-4 w-4 rounded border-input accent-primary'

function Section({ title, description, children }: { title: string; description?: string; children: ReactNode }) {
  return (
    <section className="space-y-3 border-t border-border/70 pt-4 first:border-t-0 first:pt-0">
      <div>
        <h3 className="font-label text-label-md font-semibold text-foreground">{title}</h3>
        {description && <p className="mt-0.5 text-body-sm text-muted-foreground">{description}</p>}
      </div>
      {children}
    </section>
  )
}

function Field({ id, label, hint, className, children }: { id: string; label: string; hint?: string; className?: string; children: ReactNode }) {
  return (
    <div className={cn('space-y-1.5', className)}>
      <Label htmlFor={id}>{label}</Label>
      {children}
      {hint && <p className="text-label-sm text-muted-foreground">{hint}</p>}
    </div>
  )
}

const endsNextDay = (start: string, end: string) => {
  const a = toClock(start)
  const b = toClock(end)
  return Boolean(a && b && b < a)
}

function OvertimeRow({
  id,
  label,
  unit,
  rule,
  disabled,
  onChange,
}: {
  id: string
  label: string
  unit: string
  rule: OvertimeRuleForm
  disabled?: boolean
  onChange: (rule: OvertimeRuleForm) => void
}) {
  return (
    <div className="grid grid-cols-1 items-end gap-3 sm:grid-cols-[1fr_8rem_7rem]">
      <label className={cn('flex items-center gap-2 pb-2 text-body-sm', disabled && 'opacity-60')}>
        <input type="checkbox" className={checkboxClass} checked={rule.enabled} disabled={disabled}
          onChange={(e) => onChange({ ...rule, enabled: e.target.checked })} />
        {label}
      </label>
      <Field id={`${id}-after`} label={`After (hours ${unit})`}>
        <Input id={`${id}-after`} inputMode="decimal" value={rule.afterHours} disabled={!rule.enabled}
          onChange={(e) => onChange({ ...rule, afterHours: e.target.value })} />
      </Field>
      <Field id={`${id}-rate`} label="Pay ×">
        <Input id={`${id}-rate`} inputMode="decimal" value={rule.rate} disabled={!rule.enabled}
          onChange={(e) => onChange({ ...rule, rate: e.target.value })} />
      </Field>
    </div>
  )
}

export function WorkScheduleDialog({
  open,
  schedule,
  onClose,
  onSaved,
}: {
  open: boolean
  /** The schedule being edited, or null to create one. */
  schedule: Shift | null
  onClose: () => void
  onSaved: (saved: Shift) => void
}) {
  const [form, setForm] = useState<ScheduleForm>(() => (schedule ? formFromSchedule(schedule) : emptyScheduleForm()))
  const [errors, setErrors] = useState<string[]>([])
  const set = (changes: Partial<ScheduleForm>) => setForm((current) => ({ ...current, ...changes }))

  const mutation = useMutation({
    mutationFn: async () => {
      const result = validateScheduleForm(form)
      setErrors(result.errors)
      if (!result.payload) return null
      return schedule ? updateShift(schedule.id, result.payload) : createShift(result.payload)
    },
    onSuccess: (saved) => {
      if (saved) onSaved(saved)
    },
  })

  const preview = validateScheduleForm(form).payload
  const summary = preview ? scheduleSummary(preview) : null

  const toggleDay = (day: number) => {
    const days = form.days.includes(day) ? form.days.filter((d) => d !== day) : [...form.days, day].sort((a, b) => a - b)
    set({ days })
  }
  const setOwnHours = (day: number, own: { start: string; end: string } | null) => {
    const dayTimes = { ...form.dayTimes }
    if (own) dayTimes[day] = own
    else delete dayTimes[day]
    set({ dayTimes })
  }
  const setBreak = (index: number, changes: Partial<ScheduleForm['breaks'][number]>) =>
    set({ breaks: form.breaks.map((item, i) => (i === index ? { ...item, ...changes } : item)) })

  const hoursLabel = form.type === 'fixed' ? 'Hours' : 'Usual hours'

  return (
    <Dialog open={open} onOpenChange={(next) => !next && !mutation.isPending && onClose()}>
      <DialogContent className="max-w-3xl">
        <DialogHeader>
          <DialogTitle>{schedule ? `Edit ${schedule.name}` : 'New work schedule'}</DialogTitle>
        </DialogHeader>

        <form
          className="space-y-5"
          onSubmit={(e) => {
            e.preventDefault()
            mutation.mutate()
          }}
        >
          {(errors.length > 0 || mutation.error) && (
            <Alert variant="destructive">
              <AlertDescription>
                {mutation.error instanceof Error ? mutation.error.message : null}
                {errors.length > 0 && (
                  <ul className="list-disc space-y-0.5 pl-4">
                    {errors.map((message) => <li key={message}>{message}</li>)}
                  </ul>
                )}
              </AlertDescription>
            </Alert>
          )}

          <Section title="Schedule">
            <Field id="schedule-name" label="Name">
              <Input id="schedule-name" value={form.name} maxLength={80} onChange={(e) => set({ name: e.target.value })}
                placeholder="General shift, Night shift, Site supervisors…" />
            </Field>
            <div role="radiogroup" aria-label="Schedule type" className="grid grid-cols-1 gap-2 sm:grid-cols-3">
              {SCHEDULE_TYPES.map((option) => (
                <button
                  key={option.value}
                  type="button"
                  role="radio"
                  aria-checked={form.type === option.value}
                  onClick={() => set({ type: option.value })}
                  className={cn(
                    'rounded-xl border px-3 py-2.5 text-left transition-colors',
                    form.type === option.value
                      ? 'border-primary bg-primary/5 ring-1 ring-primary/30'
                      : 'border-border hover:bg-muted/60',
                  )}
                >
                  <span className="block font-label text-label-md font-semibold text-foreground">{option.label}</span>
                  <span className="mt-0.5 block text-label-sm text-muted-foreground">{option.description}</span>
                </button>
              ))}
            </div>
          </Section>

          <Section title="Working days" description="Days outside this list count as rest days.">
            <div className="flex flex-wrap gap-2" role="group" aria-label="Working days">
              {WEEKDAYS.map((day) => (
                <button
                  key={day.value}
                  type="button"
                  aria-pressed={form.days.includes(day.value)}
                  title={day.long}
                  onClick={() => toggleDay(day.value)}
                  className={cn(
                    'h-9 min-w-12 rounded-lg border px-3 font-label text-label-md transition-colors',
                    form.days.includes(day.value)
                      ? 'border-primary bg-primary text-primary-foreground'
                      : 'border-border text-muted-foreground hover:bg-muted/60',
                  )}
                >
                  {day.short}
                </button>
              ))}
            </div>
          </Section>

          <Section
            title={hoursLabel}
            description={form.type === 'fixed'
              ? 'An end time earlier than the start means the shift ends the next day.'
              : 'Employees may work any time. These usual hours drive reminders and the outside-schedule rule in the time-tracking policy.'}
          >
            <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
              <Field id="schedule-start" label="Start">
                <Input id="schedule-start" type="time" value={form.start} onChange={(e) => set({ start: e.target.value })} />
              </Field>
              <Field id="schedule-end" label="End" hint={endsNextDay(form.start, form.end) ? 'Ends the next day' : undefined}>
                <Input id="schedule-end" type="time" value={form.end} onChange={(e) => set({ end: e.target.value })} />
              </Field>
              {form.type === 'flexible' && (
                <Field id="schedule-daily" label="Hours per day" hint="For example 8 or 7.5">
                  <Input id="schedule-daily" inputMode="decimal" value={form.dailyHours} onChange={(e) => set({ dailyHours: e.target.value })} />
                </Field>
              )}
              {form.type === 'weekly_flexible' && (
                <Field id="schedule-weekly" label="Hours per week" hint="For example 40 or 48">
                  <Input id="schedule-weekly" inputMode="decimal" value={form.weeklyHours} onChange={(e) => set({ weeklyHours: e.target.value })} />
                </Field>
              )}
            </div>

            {form.type === 'fixed' && form.days.length > 0 && (
              <div className="rounded-xl border border-border/80 bg-muted/30 p-3">
                <p className="mb-2 text-label-sm font-semibold text-muted-foreground">Different hours on particular days (for example a Saturday half day)</p>
                <div className="space-y-2">
                  {form.days.map((day) => {
                    const own = form.dayTimes[day]
                    const label = WEEKDAYS[day - 1].long
                    return (
                      <div key={day} className="grid grid-cols-[8rem_1fr_1fr] items-center gap-3">
                        <label className="flex items-center gap-2 text-body-sm">
                          <input type="checkbox" className={checkboxClass} checked={Boolean(own)}
                            onChange={(e) => setOwnHours(day, e.target.checked ? { start: form.start, end: form.end } : null)} />
                          {label}
                        </label>
                        {own ? (
                          <>
                            <Input type="time" aria-label={`${label} start`} value={own.start}
                              onChange={(e) => setOwnHours(day, { ...own, start: e.target.value })} />
                            <Input type="time" aria-label={`${label} end`} value={own.end}
                              onChange={(e) => setOwnHours(day, { ...own, end: e.target.value })} />
                          </>
                        ) : (
                          <span className="col-span-2 text-label-sm text-muted-foreground">{form.start}–{form.end}</span>
                        )}
                      </div>
                    )
                  })}
                </div>
              </div>
            )}
          </Section>

          <Section title="Breaks" description="Unpaid breaks are taken off worked time. A time window is optional.">
            {form.breaks.length > 0 && (
              <div className="space-y-2">
                {form.breaks.map((item, index) => (
                  <div key={index} className="grid grid-cols-2 items-end gap-2 sm:grid-cols-[1fr_5.5rem_7rem_6.5rem_6.5rem_auto]">
                    <Field id={`break-${index}-name`} label="Name" className="col-span-2 sm:col-span-1">
                      <Input id={`break-${index}-name`} value={item.name} maxLength={40} placeholder="Lunch"
                        onChange={(e) => setBreak(index, { name: e.target.value })} />
                    </Field>
                    <Field id={`break-${index}-minutes`} label="Minutes">
                      <Input id={`break-${index}-minutes`} inputMode="numeric" value={item.minutes}
                        onChange={(e) => setBreak(index, { minutes: e.target.value })} />
                    </Field>
                    <Field id={`break-${index}-paid`} label="Pay">
                      <Select value={item.paid ? 'paid' : 'unpaid'} onValueChange={(value) => setBreak(index, { paid: value === 'paid' })}>
                        <SelectTrigger id={`break-${index}-paid`}><SelectValue /></SelectTrigger>
                        <SelectContent>
                          <SelectItem value="unpaid">Unpaid</SelectItem>
                          <SelectItem value="paid">Paid</SelectItem>
                        </SelectContent>
                      </Select>
                    </Field>
                    <Field id={`break-${index}-start`} label="From">
                      <Input id={`break-${index}-start`} type="time" value={item.start} onChange={(e) => setBreak(index, { start: e.target.value })} />
                    </Field>
                    <Field id={`break-${index}-end`} label="Until">
                      <Input id={`break-${index}-end`} type="time" value={item.end} onChange={(e) => setBreak(index, { end: e.target.value })} />
                    </Field>
                    <Button type="button" variant="ghost" size="icon" title="Remove break" className="hover:text-destructive"
                      onClick={() => set({ breaks: form.breaks.filter((_, i) => i !== index) })}>
                      <Trash2 className="h-4 w-4" />
                    </Button>
                  </div>
                ))}
              </div>
            )}
            <Button type="button" variant="outline" size="sm" className="gap-2" disabled={form.breaks.length >= MAX_BREAKS}
              onClick={() => set({ breaks: [...form.breaks, { name: form.breaks.length ? '' : 'Lunch', minutes: form.breaks.length ? '15' : '60', paid: false, start: '', end: '' }] })}>
              <Plus className="h-4 w-4" />
              Add break
            </Button>
            <div className="grid grid-cols-1 items-end gap-3 sm:grid-cols-[1fr_8rem_8rem]">
              <label className="flex items-center gap-2 pb-2 text-body-sm">
                <input type="checkbox" className={checkboxClass} checked={form.autoBreak.enabled}
                  onChange={(e) => set({ autoBreak: { ...form.autoBreak, enabled: e.target.checked } })} />
                Deduct an automatic unpaid break on long days
              </label>
              <Field id="auto-break-minutes" label="Minutes">
                <Input id="auto-break-minutes" inputMode="numeric" value={form.autoBreak.minutes} disabled={!form.autoBreak.enabled}
                  onChange={(e) => set({ autoBreak: { ...form.autoBreak, minutes: e.target.value } })} />
              </Field>
              <Field id="auto-break-after" label="After (hours)">
                <Input id="auto-break-after" inputMode="decimal" value={form.autoBreak.afterHours} disabled={!form.autoBreak.enabled}
                  onChange={(e) => set({ autoBreak: { ...form.autoBreak, afterHours: e.target.value } })} />
              </Field>
            </div>
          </Section>

          <Section title="Overtime" description="Hours past each threshold are paid at the multiplier. Leave a rule off if it does not apply.">
            <OvertimeRow id="ot-daily" label="Daily overtime" unit="a day" rule={form.overtimeDaily}
              onChange={(overtimeDaily) => set({ overtimeDaily, overtimeDouble: overtimeDaily.enabled ? form.overtimeDouble : { ...form.overtimeDouble, enabled: false } })} />
            <OvertimeRow id="ot-double" label="Daily double overtime" unit="a day" rule={form.overtimeDouble}
              disabled={!form.overtimeDaily.enabled} onChange={(overtimeDouble) => set({ overtimeDouble })} />
            <OvertimeRow id="ot-weekly" label="Weekly overtime" unit="a week" rule={form.overtimeWeekly}
              onChange={(overtimeWeekly) => set({ overtimeWeekly })} />
            <div className="grid grid-cols-2 gap-3 sm:w-2/3">
              <Field id="ot-rest-day" label="Rest-day work, pay ×" hint="Empty: no extra rate">
                <Input id="ot-rest-day" inputMode="decimal" value={form.restDayRate} placeholder="—"
                  onChange={(e) => set({ restDayRate: e.target.value })} />
              </Field>
              <Field id="ot-holiday" label="Public holiday work, pay ×" hint="Empty: no extra rate">
                <Input id="ot-holiday" inputMode="decimal" value={form.holidayRate} placeholder="—"
                  onChange={(e) => set({ holidayRate: e.target.value })} />
              </Field>
            </div>
          </Section>

          <Section title="Advanced">
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-[10rem_1fr] sm:items-start">
              <Field id="split-time" label="Day split time">
                <Input id="split-time" type="time" value={form.splitTime} onChange={(e) => set({ splitTime: e.target.value })} />
              </Field>
              <p className="text-body-sm text-muted-foreground sm:pt-7">
                When one workday ends and the next begins. For a 22:00–06:00 night shift, a split at 12:00 keeps the whole shift on the day it started.
              </p>
            </div>
            <label className="flex items-start gap-2 text-body-sm">
              <input type="checkbox" className={cn(checkboxClass, 'mt-0.5')} checked={form.isDefault}
                onChange={(e) => set({ isDefault: e.target.checked })} />
              <span>
                <span className="font-semibold text-foreground">Organization default.</span>{' '}
                Applies to employees with no schedule of their own and none from their department. Only one schedule can be the default.
              </span>
            </label>
          </Section>

          {summary && (
            <p className="rounded-xl bg-muted/50 px-3 py-2 text-body-sm text-muted-foreground">
              <span className="font-semibold text-foreground">{summary.type}</span> · {summary.days} · {summary.hours}
              {summary.weekly !== '—' && <> · {summary.weekly} planned</>}
              {preview?.breaks.length ? <> · breaks {summary.breaks}</> : null}
            </p>
          )}

          <DialogFooter>
            <Button type="button" variant="outline" onClick={onClose} disabled={mutation.isPending}>Cancel</Button>
            <Button type="submit" disabled={mutation.isPending}>{mutation.isPending ? 'Saving…' : 'Save schedule'}</Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}
