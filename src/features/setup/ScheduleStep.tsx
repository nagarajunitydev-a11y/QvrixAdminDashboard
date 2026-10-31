import { useState } from 'react'
import { useMutation, useQuery } from '@tanstack/react-query'
import { createShift, fetchShifts, updateShift } from '@/api/services'
import { Input } from '@/components/ui/input'
import { InlineSpinner } from '@/components/ui/states'
import type { SetupStepInfo } from '@/lib/setupWizard'
import {
  WEEKDAYS,
  emptyScheduleForm,
  formFromSchedule,
  scheduleSummary,
  validateScheduleForm,
  type ScheduleForm,
} from '@/lib/workSchedules'
import { cn } from '@/lib/utils'
import { ChoiceCard, Field, StepFrame } from './SetupSteps'

const errorText = (error: unknown, fallback: string) => (error instanceof Error ? error.message : fallback)
const LUNCH = { name: 'Lunch', minutes: '60', paid: false, start: '13:00', end: '14:00' }

/** The organization's default work schedule, with the common settings; the rest stay as they are. */
export function ScheduleStep({ info, onBack, onDone }: { info: SetupStepInfo; onBack: () => void; onDone: () => void }) {
  const shifts = useQuery({ queryKey: ['shifts'], queryFn: fetchShifts })
  const existing = shifts.data?.find((shift) => shift.is_default) ?? null
  const [edited, setEdited] = useState<ScheduleForm | null>(null)
  const form = edited ?? (existing ? formFromSchedule(existing) : { ...emptyScheduleForm(), name: 'General shift', breaks: [LUNCH] })
  const set = (changes: Partial<ScheduleForm>) => setEdited({ ...form, ...changes })
  const [errors, setErrors] = useState<string[]>([])
  const lunch = form.breaks[0]
  const setLunch = (changes: Partial<typeof LUNCH>) => set({ breaks: [{ ...lunch, ...changes }, ...form.breaks.slice(1)] })
  const preview = validateScheduleForm({ ...form, isDefault: true }).payload

  const mutation = useMutation({
    mutationFn: async () => {
      const { payload, errors: problems } = validateScheduleForm({ ...form, isDefault: true })
      setErrors(problems)
      if (!payload) return false
      if (existing) await updateShift(existing.id, payload)
      else await createShift(payload)
      return true
    },
    onSuccess: (saved) => { if (saved) onDone() },
  })

  if (shifts.isLoading) return <InlineSpinner />
  return (
    <StepFrame info={info} onBack={onBack} pending={mutation.isPending} onSubmit={() => mutation.mutate()}
      errors={mutation.error ? [errorText(mutation.error, 'Could not save the working hours.')] : errors}>
      <div role="radiogroup" aria-label="Schedule type" className="grid grid-cols-1 gap-2 sm:grid-cols-2">
        <ChoiceCard title="Fixed hours" description="Everyone starts and finishes at set times." selected={form.type === 'fixed'}
          onSelect={() => set({ type: 'fixed' })} />
        <ChoiceCard title="Flexible hours" description="A number of hours each working day, at any time." selected={form.type === 'flexible'}
          onSelect={() => set({ type: 'flexible', dayTimes: {} })} />
      </div>

      <fieldset>
        <legend className="mb-2 font-label text-label-md font-semibold text-foreground">Working days</legend>
        <div className="flex flex-wrap gap-2" role="group" aria-label="Working days">
          {WEEKDAYS.map((day) => {
            const on = form.days.includes(day.value)
            return (
              <button key={day.value} type="button" aria-pressed={on} title={day.long}
                onClick={() => set({ days: on ? form.days.filter((d) => d !== day.value) : [...form.days, day.value].sort((a, b) => a - b) })}
                className={cn('h-10 min-w-14 rounded-lg border px-3 font-label text-label-md transition-colors',
                  on ? 'border-primary bg-primary text-primary-foreground' : 'border-border text-muted-foreground hover:bg-muted/60')}>
                {day.short}
              </button>
            )
          })}
        </div>
      </fieldset>

      <div className="grid grid-cols-2 gap-4 sm:grid-cols-3">
        <Field id="setup-start" label={form.type === 'fixed' ? 'Start' : 'Usual start'}>
          <Input id="setup-start" type="time" value={form.start} onChange={(e) => set({ start: e.target.value })} />
        </Field>
        <Field id="setup-end" label={form.type === 'fixed' ? 'End' : 'Usual end'}
          hint={form.end && form.start && form.end < form.start ? 'Ends the next day' : undefined}>
          <Input id="setup-end" type="time" value={form.end} onChange={(e) => set({ end: e.target.value })} />
        </Field>
        {form.type === 'flexible' && (
          <Field id="setup-daily" label="Hours per day" hint="For example 8 or 7.5">
            <Input id="setup-daily" inputMode="decimal" value={form.dailyHours} onChange={(e) => set({ dailyHours: e.target.value })} />
          </Field>
        )}
      </div>

      <div className="rounded-xl border border-border/80 p-4">
        <label className="flex items-start gap-3">
          <input type="checkbox" className="mt-0.5 h-4 w-4 rounded border-input accent-primary" checked={Boolean(lunch)}
            onChange={(e) => set({ breaks: e.target.checked ? [LUNCH, ...form.breaks] : form.breaks.slice(1) })} />
          <span>
            <span className="block font-label text-label-md font-semibold text-foreground">Unpaid lunch break</span>
            <span className="mt-0.5 block text-body-sm text-muted-foreground">Time worked during the break window is not paid.</span>
          </span>
        </label>
        {lunch && (
          <div className="mt-3 grid grid-cols-3 gap-3 pl-7">
            <Field id="setup-lunch-minutes" label="Minutes">
              <Input id="setup-lunch-minutes" inputMode="numeric" value={lunch.minutes} onChange={(e) => setLunch({ minutes: e.target.value })} />
            </Field>
            <Field id="setup-lunch-from" label="From">
              <Input id="setup-lunch-from" type="time" value={lunch.start} onChange={(e) => setLunch({ start: e.target.value })} />
            </Field>
            <Field id="setup-lunch-until" label="Until">
              <Input id="setup-lunch-until" type="time" value={lunch.end} onChange={(e) => setLunch({ end: e.target.value })} />
            </Field>
          </div>
        )}
      </div>

      <Field id="setup-schedule-name" label="Schedule name" hint="Overtime rules, per-day hours and more schedules are under Work Schedules.">
        <Input id="setup-schedule-name" value={form.name} maxLength={80} onChange={(e) => set({ name: e.target.value })} />
      </Field>

      {preview && (
        <p className="rounded-xl bg-muted/50 px-3 py-2 text-body-sm text-muted-foreground">
          {(() => {
            const summary = scheduleSummary(preview)
            return <><span className="font-semibold text-foreground">{summary.days}</span> · {summary.hours}{summary.weekly !== '—' ? ` · ${summary.weekly} planned` : ''}</>
          })()}
        </p>
      )}
    </StepFrame>
  )
}
