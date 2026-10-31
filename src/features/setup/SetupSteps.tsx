import { useMemo, useState, type FormEvent, type ReactNode } from 'react'
import { useMutation, useQuery } from '@tanstack/react-query'
import { ArrowLeft, ArrowRight, Check, CheckCircle2, Info } from 'lucide-react'
import {
  createMyOrganization,
  fetchMyEmployeeInvitations,
  fetchOrganizationProfile,
  updateOrganizationSetup,
} from '@/api/organizations'
import { fetchTimeTrackingPolicies, saveTimeTrackingPolicy } from '@/api/services'
import { useOrganization } from '@/api/OrganizationProvider'
import { Alert, AlertDescription } from '@/components/ui/alert'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { InlineSpinner } from '@/components/ui/states'
import {
  INDUSTRIES,
  TEAM_SIZES,
  countryOptions,
  guessCountry,
  normalizeTimeZone,
  timeZoneOptions,
  validateOrganizationForm,
  type OrganizationForm,
  type SetupStepInfo,
} from '@/lib/setupWizard'
import { POLICY_OFF, policyFromForm, policyToForm, type PolicyForm } from '@/lib/timePolicy'
import { cn } from '@/lib/utils'

const errorText = (error: unknown, fallback: string) => (error instanceof Error ? error.message : fallback)

/**
 * One wizard step: heading, body and the Back / Skip / Continue row. Steps that contain their own form
 * (the map's address search) set `asForm={false}`, because forms cannot be nested.
 */
export function StepFrame({ info, children, errors = [], pending = false, onBack, onSkip, onSubmit, submitLabel = 'Continue', submitDisabled, asForm = true }: {
  info: SetupStepInfo
  children: ReactNode
  errors?: string[]
  pending?: boolean
  onBack?: () => void
  onSkip?: () => void
  onSubmit: () => void
  submitLabel?: string
  submitDisabled?: boolean
  asForm?: boolean
}) {
  const submit = (e: FormEvent) => {
    e.preventDefault()
    if (!pending) onSubmit()
  }
  const Container = asForm ? 'form' : 'div'
  return (
    <Container onSubmit={asForm ? submit : undefined} className="flex flex-col gap-6" noValidate={asForm || undefined}>
      <header>
        <h1 className="font-headline text-headline-lg text-foreground">{info.title}</h1>
        <p className="mt-1.5 max-w-xl text-body-md text-muted-foreground">{info.description}</p>
      </header>
      {errors.length > 0 && (
        <Alert variant="destructive">
          <AlertDescription>
            {errors.length === 1 ? errors[0] : (
              <ul className="list-disc space-y-0.5 pl-4">{errors.map((message) => <li key={message}>{message}</li>)}</ul>
            )}
          </AlertDescription>
        </Alert>
      )}
      <div className="flex flex-col gap-5">{children}</div>
      <footer className="flex flex-col-reverse gap-3 border-t border-border/70 pt-5 sm:flex-row sm:items-center sm:justify-between">
        <div>
          {onBack && (
            <Button type="button" variant="ghost" className="gap-2" onClick={onBack} disabled={pending}>
              <ArrowLeft className="h-4 w-4" />
              Back
            </Button>
          )}
        </div>
        <div className="flex flex-col-reverse gap-2 sm:flex-row">
          {onSkip && (
            <Button type="button" variant="outline" onClick={onSkip} disabled={pending}>Skip for now</Button>
          )}
          <Button type={asForm ? 'submit' : 'button'} onClick={asForm ? undefined : () => { if (!pending) onSubmit() }}
            className="gap-2" disabled={pending || submitDisabled}>
            {pending ? 'Saving…' : submitLabel}
            {!pending && <ArrowRight className="h-4 w-4" />}
          </Button>
        </div>
      </footer>
    </Container>
  )
}

export function Field({ id, label, hint, children, className }: { id: string; label: string; hint?: string; children: ReactNode; className?: string }) {
  return (
    <div className={cn('flex flex-col gap-1.5', className)}>
      <Label htmlFor={id}>{label}</Label>
      {children}
      {hint && <p className="text-label-sm text-muted-foreground">{hint}</p>}
    </div>
  )
}

export function ChoiceCard({ selected, onSelect, title, description, className }: {
  selected: boolean
  onSelect: () => void
  title: string
  description?: string
  className?: string
}) {
  return (
    <button
      type="button"
      role="radio"
      aria-checked={selected}
      onClick={onSelect}
      className={cn(
        'relative rounded-xl border px-3.5 py-3 text-left transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/40',
        selected ? 'border-primary bg-primary/5 ring-1 ring-primary/30' : 'border-border bg-card hover:bg-muted/60',
        className,
      )}
    >
      {selected && <Check className="absolute right-3 top-3 h-4 w-4 text-primary" aria-hidden />}
      <span className="block pr-5 font-label text-label-md font-semibold text-foreground">{title}</span>
      {description && <span className="mt-0.5 block text-label-sm text-muted-foreground">{description}</span>}
    </button>
  )
}

// ---------------------------------------------------------------------------
// 1. Create the organization
// ---------------------------------------------------------------------------

export function OrganizationStep({ info, onCreated }: { info: SetupStepInfo; onCreated: () => void }) {
  const { activateOrganization } = useOrganization()
  const [form, setForm] = useState<OrganizationForm>(() => ({
    name: '',
    countryCode: guessCountry(navigator.languages),
    timeZone: normalizeTimeZone(Intl.DateTimeFormat().resolvedOptions().timeZone || 'Asia/Kolkata'),
  }))
  const [errors, setErrors] = useState<string[]>([])
  const countries = useMemo(() => countryOptions(), [])
  const zones = useMemo(() => {
    const list = timeZoneOptions()
    return list.includes(form.timeZone) ? list : [form.timeZone, ...list]
  }, [form.timeZone])
  const invitations = useQuery({ queryKey: ['my-employee-invitations'], queryFn: fetchMyEmployeeInvitations, retry: false })

  const mutation = useMutation({
    mutationFn: async () => {
      const problems = validateOrganizationForm(form)
      setErrors(problems)
      if (problems.length) return false
      const id = await createMyOrganization(form.name.trim(), form.timeZone, form.countryCode)
      await activateOrganization(id)
      return true
    },
    onSuccess: (created) => { if (created) onCreated() },
  })

  return (
    <StepFrame info={info} errors={mutation.error ? [errorText(mutation.error, 'The organization could not be created.')] : errors}
      pending={mutation.isPending} onSubmit={() => mutation.mutate()} submitLabel="Create organization">
      {invitations.data && invitations.data.length > 0 && (
        <Alert>
          <AlertDescription>
            {invitations.data.map((i) => i.organization_name).join(', ')} added you as an employee. Employees check in with the
            Crewtraxa app and do not need an organization here. Continue only if you are setting up a new organization.
          </AlertDescription>
        </Alert>
      )}
      <Field id="org-name" label="Organization name" hint="Usually your company's name. Your team sees it in the app.">
        <Input id="org-name" value={form.name} maxLength={120} autoFocus placeholder="Acme Facility Services"
          onChange={(e) => setForm({ ...form, name: e.target.value })} />
      </Field>
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
        <Field id="org-country" label="Country">
          <Select value={form.countryCode} onValueChange={(countryCode) => setForm({ ...form, countryCode })}>
            <SelectTrigger id="org-country"><SelectValue /></SelectTrigger>
            <SelectContent className="max-h-72">
              {countries.map((c) => <SelectItem key={c.code} value={c.code}>{c.name}</SelectItem>)}
            </SelectContent>
          </Select>
        </Field>
        <Field id="org-zone" label="Time zone" hint="Attendance, schedules and timesheets use this time zone.">
          <Select value={form.timeZone} onValueChange={(timeZone) => setForm({ ...form, timeZone })}>
            <SelectTrigger id="org-zone"><SelectValue /></SelectTrigger>
            <SelectContent className="max-h-72">
              {zones.map((zone) => <SelectItem key={zone} value={zone}>{zone.replace(/_/g, ' ')}</SelectItem>)}
            </SelectContent>
          </Select>
        </Field>
      </div>
    </StepFrame>
  )
}

// ---------------------------------------------------------------------------
// 2. Company details
// ---------------------------------------------------------------------------

export function CompanyStep({ info, onBack, onDone }: { info: SetupStepInfo; onBack?: () => void; onDone: () => void }) {
  const profile = useQuery({ queryKey: ['organization-profile'], queryFn: fetchOrganizationProfile })
  const [industry, setIndustry] = useState<string | null>(null)
  const [teamSize, setTeamSize] = useState<string | null>(null)
  const chosenIndustry = industry ?? profile.data?.industry ?? null
  const chosenSize = teamSize ?? profile.data?.team_size ?? null
  const mutation = useMutation({
    mutationFn: () => updateOrganizationSetup({ industry: chosenIndustry, team_size: chosenSize }),
    onSuccess: onDone,
  })
  const missing = [!chosenIndustry && 'Choose your industry.', !chosenSize && 'Choose your team size.'].filter(Boolean) as string[]
  const [tried, setTried] = useState(false)

  if (profile.isLoading) return <InlineSpinner />
  return (
    <StepFrame info={info} onBack={onBack} pending={mutation.isPending}
      errors={mutation.error ? [errorText(mutation.error, 'Could not save the company details.')] : tried ? missing : []}
      onSubmit={() => { setTried(true); if (!missing.length) mutation.mutate() }}>
      <fieldset>
        <legend className="mb-2 font-label text-label-md font-semibold text-foreground">Industry</legend>
        <div role="radiogroup" aria-label="Industry" className="grid grid-cols-2 gap-2 sm:grid-cols-3">
          {INDUSTRIES.map((option) => (
            <ChoiceCard key={option.value} title={option.label} selected={chosenIndustry === option.value}
              onSelect={() => setIndustry(option.value)} />
          ))}
        </div>
      </fieldset>
      <fieldset>
        <legend className="mb-2 font-label text-label-md font-semibold text-foreground">How many people work for you?</legend>
        <div role="radiogroup" aria-label="Team size" className="flex flex-wrap gap-2">
          {TEAM_SIZES.map((size) => (
            <button key={size} type="button" role="radio" aria-checked={chosenSize === size} onClick={() => setTeamSize(size)}
              className={cn('h-10 min-w-20 rounded-full border px-4 font-label text-label-md transition-colors',
                chosenSize === size ? 'border-primary bg-primary text-primary-foreground' : 'border-border text-foreground hover:bg-muted/60')}>
              {size}
            </button>
          ))}
        </div>
      </fieldset>
    </StepFrame>
  )
}

// ---------------------------------------------------------------------------
// 4. Work settings: the organization's time-tracking policy
// ---------------------------------------------------------------------------

const RULES: Array<{ key: 'requireInsideSite' | 'lockDevice' | 'earlyLimit' | 'blockOutside' | 'autoAfter'; title: string; description: string }> = [
  { key: 'autoAfter', title: 'Check people out automatically', description: 'Closes a session still open after this many hours, for anyone who forgets to check out.' },
  { key: 'requireInsideSite', title: 'Check in only inside the site', description: 'The phone must be within the site\'s geofence.' },
  { key: 'lockDevice', title: 'Only from the employee\'s registered phone', description: 'Check-ins from any other phone are refused.' },
  { key: 'earlyLimit', title: 'Limit early check-ins', description: 'How many minutes before the scheduled start someone may check in.' },
  { key: 'blockOutside', title: 'No check-ins outside working hours', description: 'Uses the working hours you just set; rest days and holidays count as outside.' },
]

export function RulesStep({ info, onBack, onDone }: { info: SetupStepInfo; onBack: () => void; onDone: () => void }) {
  const policies = useQuery({ queryKey: ['time-policies'], queryFn: fetchTimeTrackingPolicies })
  const existing = policies.data?.find((p) => p.department_id === null) ?? null
  const [edited, setEdited] = useState<PolicyForm | null>(null)
  // A new organization starts with automatic check-out after 12 hours and everything else off.
  const form = edited ?? (existing ? policyToForm(existing) : { ...policyToForm(POLICY_OFF), autoAfter: true, autoAfterHours: '12' })
  const set = (changes: Partial<PolicyForm>) => setEdited({ ...form, ...changes })
  const [errors, setErrors] = useState<string[]>([])
  const mutation = useMutation({
    mutationFn: async () => {
      const { fields, errors: problems } = policyFromForm(form)
      setErrors(problems)
      if (!fields) return false
      await saveTimeTrackingPolicy(existing?.id ?? null, null, fields)
      return true
    },
    onSuccess: (saved) => { if (saved) onDone() },
  })

  if (policies.isLoading) return <InlineSpinner />
  return (
    <StepFrame info={info} onBack={onBack} pending={mutation.isPending} onSubmit={() => mutation.mutate()}
      errors={mutation.error ? [errorText(mutation.error, 'Could not save the rules.')] : errors}>
      <ul className="divide-y divide-border/70 rounded-xl border border-border/80">
        {RULES.map((rule) => (
          <li key={rule.key} className="flex flex-col gap-3 px-4 py-3.5 sm:flex-row sm:items-center sm:justify-between">
            <label className="flex items-start gap-3">
              <input type="checkbox" className="mt-0.5 h-4 w-4 rounded border-input accent-primary" checked={form[rule.key]}
                onChange={(e) => set({ [rule.key]: e.target.checked } as Partial<PolicyForm>)} />
              <span>
                <span className="block font-label text-label-md font-semibold text-foreground">{rule.title}</span>
                <span className="mt-0.5 block text-body-sm text-muted-foreground">{rule.description}</span>
              </span>
            </label>
            {rule.key === 'autoAfter' && (
              <div className="flex items-center gap-2 pl-7 sm:pl-0">
                <div className="w-20">
                  <Input aria-label="Hours before automatic check-out" inputMode="decimal" value={form.autoAfterHours}
                    disabled={!form.autoAfter} onChange={(e) => set({ autoAfterHours: e.target.value })} />
                </div>
                <span className="text-body-sm text-muted-foreground">hours</span>
              </div>
            )}
            {rule.key === 'earlyLimit' && (
              <div className="flex items-center gap-2 pl-7 sm:pl-0">
                <div className="w-20">
                  <Input aria-label="Minutes before the start" inputMode="numeric" value={form.earlyMinutes}
                    disabled={!form.earlyLimit} onChange={(e) => set({ earlyMinutes: e.target.value })} />
                </div>
                <span className="whitespace-nowrap text-body-sm text-muted-foreground">minutes</span>
              </div>
            )}
          </li>
        ))}
      </ul>
      <p className="flex items-start gap-2 text-body-sm text-muted-foreground">
        <Info className="mt-0.5 h-4 w-4 shrink-0" />
        Timesheets apply the automatic check-out and flag check-ins that break these rules. The Crewtraxa app enforces them on
        the phone from its next update. Change them any time under Time Tracking Policy.
      </p>
    </StepFrame>
  )
}

// ---------------------------------------------------------------------------
// Done
// ---------------------------------------------------------------------------

export function SummaryItem({ title, detail, done }: { title: string; detail: string; done: boolean }) {
  return (
    <li className="flex items-start gap-3 py-3">
      <CheckCircle2 className={cn('mt-0.5 h-5 w-5 shrink-0', done ? 'text-emerald-500' : 'text-muted-foreground/40')} />
      <div>
        <p className="font-label text-label-md font-semibold text-foreground">{title}</p>
        <p className="text-body-sm text-muted-foreground">{detail}</p>
      </div>
    </li>
  )
}
