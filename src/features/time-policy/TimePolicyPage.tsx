import { useState, type ReactNode } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { Plus, ShieldCheck, Trash2 } from 'lucide-react'
import {
  deleteTimeTrackingPolicy,
  fetchDepartments,
  fetchTimeTrackingPolicies,
  saveTimeTrackingPolicy,
  type TimeTrackingPolicyFields,
} from '@/api/services'
import { useOrganization } from '@/api/OrganizationProvider'
import type { Department, TimeTrackingPolicy } from '@/types'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Alert, AlertDescription } from '@/components/ui/alert'
import { PageHeader } from '@/components/ui/page-header'
import { PageSkeleton } from '@/components/ui/states'
import { useToast } from '@/components/ui/toast'
import { formatMinutes, hoursText, parseHours, toClock } from '@/lib/workSchedules'
import { cn } from '@/lib/utils'

const checkboxClass = 'mt-0.5 h-4 w-4 rounded border-input accent-primary'

const OFF: TimeTrackingPolicyFields = {
  require_inside_site: false,
  lock_to_registered_device: false,
  early_clock_in_minutes: null,
  block_outside_schedule: false,
  auto_clock_out_after_minutes: null,
  auto_clock_out_at: null,
}

interface PolicyForm {
  requireInsideSite: boolean
  lockDevice: boolean
  earlyLimit: boolean
  earlyMinutes: string
  blockOutside: boolean
  autoAfter: boolean
  autoAfterHours: string
  autoAt: boolean
  autoAtTime: string
}

function toForm(policy: TimeTrackingPolicyFields): PolicyForm {
  return {
    requireInsideSite: policy.require_inside_site,
    lockDevice: policy.lock_to_registered_device,
    earlyLimit: policy.early_clock_in_minutes !== null,
    earlyMinutes: String(policy.early_clock_in_minutes ?? 15),
    blockOutside: policy.block_outside_schedule,
    autoAfter: policy.auto_clock_out_after_minutes !== null,
    autoAfterHours: hoursText(policy.auto_clock_out_after_minutes) || '12',
    autoAt: policy.auto_clock_out_at !== null,
    autoAtTime: toClock(policy.auto_clock_out_at) ?? '23:59',
  }
}

function fromForm(form: PolicyForm): { fields: TimeTrackingPolicyFields | null; errors: string[] } {
  const errors: string[] = []
  const early = form.earlyLimit ? (/^\d{1,3}$/.test(form.earlyMinutes.trim()) ? Number(form.earlyMinutes) : NaN) : null
  if (early !== null && !(early >= 0 && early <= 720)) errors.push('The early check-in limit must be 0 to 720 minutes.')
  const after = form.autoAfter ? parseHours(form.autoAfterHours) : null
  if (form.autoAfter && !(after && after >= 30 && after <= 1440)) errors.push('Automatic check-out after a duration must be between 0.5 and 24 hours.')
  const at = form.autoAt ? toClock(form.autoAtTime) : null
  if (form.autoAt && !at) errors.push('Automatic check-out at a time needs a time such as 23:00.')
  if (errors.length) return { fields: null, errors }
  return {
    errors,
    fields: {
      require_inside_site: form.requireInsideSite,
      lock_to_registered_device: form.lockDevice,
      early_clock_in_minutes: early,
      block_outside_schedule: form.blockOutside,
      auto_clock_out_after_minutes: after,
      auto_clock_out_at: at,
    },
  }
}

function policySummary(policy: TimeTrackingPolicyFields): string {
  const parts = [
    policy.require_inside_site ? 'inside the site' : '',
    policy.lock_to_registered_device ? 'registered phone only' : '',
    policy.early_clock_in_minutes !== null ? `up to ${formatMinutes(policy.early_clock_in_minutes)} early` : '',
    policy.block_outside_schedule ? 'only during scheduled hours' : '',
    policy.auto_clock_out_after_minutes !== null ? `auto check-out after ${formatMinutes(policy.auto_clock_out_after_minutes)}` : '',
    policy.auto_clock_out_at ? `auto check-out at ${toClock(policy.auto_clock_out_at)}` : '',
  ].filter(Boolean)
  return parts.length ? parts.join(' · ') : 'No restrictions'
}

function Rule({ id, checked, onChange, title, description, disabled, children }: {
  id: string
  checked: boolean
  onChange: (checked: boolean) => void
  title: string
  description: string
  disabled: boolean
  children?: ReactNode
}) {
  return (
    <div className="flex flex-col gap-3 border-t border-border/70 py-3.5 first:border-t-0 first:pt-0 sm:flex-row sm:items-start sm:justify-between">
      <label htmlFor={id} className={cn('flex items-start gap-2.5', disabled && 'cursor-default')}>
        <input id={id} type="checkbox" className={checkboxClass} checked={checked} disabled={disabled} onChange={(e) => onChange(e.target.checked)} />
        <span>
          <span className="block font-label text-label-md font-semibold text-foreground">{title}</span>
          <span className="mt-0.5 block text-body-sm text-muted-foreground">{description}</span>
        </span>
      </label>
      {children && <div className="shrink-0 pl-6 sm:pl-0">{children}</div>}
    </div>
  )
}

function PolicyEditor({ policy, departmentId, base, readOnly, onSaved, onRemove }: {
  policy: TimeTrackingPolicy | null
  departmentId: string | null
  /** Values a new policy starts from. */
  base: TimeTrackingPolicyFields
  readOnly: boolean
  onSaved: () => void
  onRemove?: () => void
}) {
  const { toast } = useToast()
  const [form, setForm] = useState(() => toForm(policy ?? base))
  const [errors, setErrors] = useState<string[]>([])
  const set = (changes: Partial<PolicyForm>) => setForm((current) => ({ ...current, ...changes }))
  const mutation = useMutation({
    mutationFn: async () => {
      const { fields, errors: problems } = fromForm(form)
      setErrors(problems)
      if (!fields) return null
      return saveTimeTrackingPolicy(policy?.id ?? null, departmentId, fields)
    },
    onSuccess: (saved) => {
      if (!saved) return
      toast({ title: 'Policy saved', variant: 'success' })
      onSaved()
    },
  })

  return (
    <form onSubmit={(e) => { e.preventDefault(); mutation.mutate() }}>
      {(errors.length > 0 || mutation.error) && (
        <Alert variant="destructive" className="mb-4">
          <AlertDescription>{mutation.error instanceof Error ? mutation.error.message : errors.join(' ')}</AlertDescription>
        </Alert>
      )}
      <Rule id={`${departmentId ?? 'org'}-inside`} checked={form.requireInsideSite} disabled={readOnly}
        onChange={(requireInsideSite) => set({ requireInsideSite })}
        title="Check in only inside the site"
        description="The phone must be within the site's geofence radius. The current app allows check-in from anywhere and records whether the person was inside." />
      <Rule id={`${departmentId ?? 'org'}-device`} checked={form.lockDevice} disabled={readOnly}
        onChange={(lockDevice) => set({ lockDevice })}
        title="Only from the employee's registered phone"
        description="Check-ins from a phone that is not active for this employee under Devices are refused." />
      <Rule id={`${departmentId ?? 'org'}-early`} checked={form.earlyLimit} disabled={readOnly}
        onChange={(earlyLimit) => set({ earlyLimit })}
        title="Limit early check-ins"
        description="How long before the scheduled start someone may check in.">
        <div className="flex items-center gap-2">
          <div className="w-20">
            <Input aria-label="Minutes before the start" inputMode="numeric" value={form.earlyMinutes}
              disabled={readOnly || !form.earlyLimit} onChange={(e) => set({ earlyMinutes: e.target.value })} />
          </div>
          <span className="whitespace-nowrap text-body-sm text-muted-foreground">min before start</span>
        </div>
      </Rule>
      <Rule id={`${departmentId ?? 'org'}-outside`} checked={form.blockOutside} disabled={readOnly}
        onChange={(blockOutside) => set({ blockOutside })}
        title="Block check-ins outside scheduled hours"
        description="Uses the employee's work schedule; rest days and holidays count as outside." />
      <Rule id={`${departmentId ?? 'org'}-auto-after`} checked={form.autoAfter} disabled={readOnly}
        onChange={(autoAfter) => set({ autoAfter })}
        title="Automatic check-out after a duration"
        description="Closes a session that is still open after this long, for people who forget to check out.">
        <div className="flex items-center gap-2">
          <div className="w-20">
            <Input aria-label="Hours" inputMode="decimal" value={form.autoAfterHours}
              disabled={readOnly || !form.autoAfter} onChange={(e) => set({ autoAfterHours: e.target.value })} />
          </div>
          <span className="text-body-sm text-muted-foreground">hours</span>
        </div>
      </Rule>
      <Rule id={`${departmentId ?? 'org'}-auto-at`} checked={form.autoAt} disabled={readOnly}
        onChange={(autoAt) => set({ autoAt })}
        title="Automatic check-out at a time of day"
        description="Closes every open session at this time in the organization's time zone.">
        <div className="w-32">
          <Input aria-label="Check-out time" type="time" value={form.autoAtTime}
            disabled={readOnly || !form.autoAt} onChange={(e) => set({ autoAtTime: e.target.value })} />
        </div>
      </Rule>
      {!readOnly && (
        <div className="flex flex-wrap justify-end gap-2 border-t border-border/70 pt-4">
          {onRemove && (
            <Button type="button" variant="outline" className="gap-2 hover:text-destructive" onClick={onRemove} disabled={mutation.isPending}>
              <Trash2 className="h-4 w-4" />
              Use the organization policy
            </Button>
          )}
          <Button type="submit" disabled={mutation.isPending}>{mutation.isPending ? 'Saving…' : 'Save policy'}</Button>
        </div>
      )}
    </form>
  )
}

export function TimePolicyPage() {
  const queryClient = useQueryClient()
  const { toast } = useToast()
  const { isOrgAdmin } = useOrganization()
  const { data: policies = [], isLoading } = useQuery({ queryKey: ['time-policies'], queryFn: fetchTimeTrackingPolicies })
  const { data: departments = [] } = useQuery({ queryKey: ['departments'], queryFn: fetchDepartments })
  const [adding, setAdding] = useState<string>('')
  const [error, setError] = useState<string | null>(null)

  const refresh = () => queryClient.invalidateQueries({ queryKey: ['time-policies'] })
  const orgPolicy = policies.find((p) => p.department_id === null) ?? null
  const overrides = policies.filter((p) => p.department_id !== null)
  const departmentName = (id: string | null) => departments.find((d) => d.id === id)?.name ?? 'Department'
  const available = departments.filter((d: Department) => !overrides.some((p) => p.department_id === d.id))
  const base = orgPolicy ?? OFF

  const remove = async (policy: TimeTrackingPolicy) => {
    if (!confirm(`${departmentName(policy.department_id)} will follow the organization policy again. Continue?`)) return
    try {
      await deleteTimeTrackingPolicy(policy.id)
      setError(null)
      refresh()
      toast({ title: `${departmentName(policy.department_id)} now follows the organization policy`, variant: 'success' })
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not remove the department policy.')
    }
  }

  if (isLoading) return <PageSkeleton cards={0} rows={6} />

  return (
    <div className="page-shell">
      <PageHeader
        eyebrow="Administration"
        title="Time Tracking Policy"
        description="Rules for when and where employees may check in and out. A department can have its own policy, which replaces the organization policy for its employees."
        icon={ShieldCheck}
      />

      <Alert>
        <AlertDescription>
          These rules are saved for the Crewtraxa Android app, which applies them from its next update. The app in use today
          still allows check-in at any time. Timesheets will also flag entries that break them.
          {!isOrgAdmin && ' Only organization admins can change the policy.'}
        </AlertDescription>
      </Alert>

      {error && <Alert variant="destructive"><AlertDescription>{error}</AlertDescription></Alert>}

      <Card>
        <CardHeader>
          <CardTitle>Organization policy</CardTitle>
          <CardDescription>{orgPolicy ? policySummary(orgPolicy) : 'Not set yet: no restrictions apply.'}</CardDescription>
        </CardHeader>
        <CardContent>
          <PolicyEditor key={orgPolicy?.updated_at ?? 'new'} policy={orgPolicy} departmentId={null} base={OFF} readOnly={!isOrgAdmin} onSaved={refresh} />
        </CardContent>
      </Card>

      <Card>
        <CardHeader className="gap-3 sm:flex-row sm:items-end sm:justify-between">
          <div>
            <CardTitle>Department policies</CardTitle>
            <CardDescription>
              {overrides.length
                ? `${overrides.length} department${overrides.length === 1 ? ' has its' : 's have their'} own policy. Everyone else follows the organization policy.`
                : 'Every department follows the organization policy.'}
            </CardDescription>
          </div>
          {isOrgAdmin && available.length > 0 && (
            <div className="flex items-end gap-2">
              <div className="space-y-1.5">
                <Label htmlFor="policy-department">Department</Label>
                <Select value={adding} onValueChange={setAdding}>
                  <SelectTrigger id="policy-department" className="w-52"><SelectValue placeholder="Choose a department" /></SelectTrigger>
                  <SelectContent>
                    {available.map((d) => <SelectItem key={d.id} value={d.id}>{d.name}</SelectItem>)}
                  </SelectContent>
                </Select>
              </div>
              <Button className="gap-2" disabled={!adding} onClick={async () => {
                try {
                  await saveTimeTrackingPolicy(null, adding, {
                    require_inside_site: base.require_inside_site,
                    lock_to_registered_device: base.lock_to_registered_device,
                    early_clock_in_minutes: base.early_clock_in_minutes,
                    block_outside_schedule: base.block_outside_schedule,
                    auto_clock_out_after_minutes: base.auto_clock_out_after_minutes,
                    auto_clock_out_at: base.auto_clock_out_at,
                  })
                  setAdding('')
                  setError(null)
                  refresh()
                } catch (err) {
                  setError(err instanceof Error ? err.message : 'Could not add the department policy.')
                }
              }}>
                <Plus className="h-4 w-4" />
                Add
              </Button>
            </div>
          )}
        </CardHeader>
        {overrides.length > 0 && (
          <CardContent className="space-y-4">
            {overrides.map((policy) => (
              <div key={policy.id} className="rounded-xl border border-border/80 p-4">
                <p className="mb-3 font-label text-label-md font-semibold text-foreground">{departmentName(policy.department_id)}</p>
                <PolicyEditor key={policy.updated_at} policy={policy} departmentId={policy.department_id} base={base}
                  readOnly={!isOrgAdmin} onSaved={refresh} onRemove={() => remove(policy)} />
              </div>
            ))}
          </CardContent>
        )}
      </Card>
    </div>
  )
}
