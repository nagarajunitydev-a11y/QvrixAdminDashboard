import { useState } from 'react'
import { useLocation, useNavigate } from 'react-router-dom'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { ArrowRight, Check, LogOut } from 'lucide-react'
import { useAuth } from '@/api/AuthProvider'
import { useOrganization } from '@/api/OrganizationProvider'
import { fetchOrganizationInvitations, fetchOrganizationProfile, updateOrganizationSetup } from '@/api/organizations'
import { fetchOnboardingCounts, fetchShifts, fetchTimeTrackingPolicies } from '@/api/services'
import { Alert, AlertDescription } from '@/components/ui/alert'
import { Button } from '@/components/ui/button'
import { InlineSpinner } from '@/components/ui/states'
import {
  SETUP_STEPS,
  furthestStep,
  industryLabel,
  resumeStep,
  stepAfter,
  stepBefore,
  stepIndex,
  type SetupStep,
} from '@/lib/setupWizard'
import { policySummary } from '@/lib/timePolicy'
import { scheduleSummary } from '@/lib/workSchedules'
import { cn } from '@/lib/utils'
import { CompanyStep, OrganizationStep, RulesStep, SummaryItem } from './SetupSteps'
import { ScheduleStep } from './ScheduleStep'
import { SitesStep } from './SitesStep'
import { TeamStep } from './TeamStep'

const errorText = (error: unknown, fallback: string) => (error instanceof Error ? error.message : fallback)
const info = (id: SetupStep) => SETUP_STEPS.find((step) => step.id === id)!
const plural = (count: number, word: string) => `${count} ${word}${count === 1 ? '' : 's'}`

function DoneStep({ onFinish, finishing, error }: { onFinish: () => void; finishing: boolean; error: string | null }) {
  const profile = useQuery({ queryKey: ['organization-profile'], queryFn: fetchOrganizationProfile })
  const counts = useQuery({ queryKey: ['onboarding-counts'], queryFn: fetchOnboardingCounts })
  const shifts = useQuery({ queryKey: ['shifts'], queryFn: fetchShifts })
  const policies = useQuery({ queryKey: ['time-policies'], queryFn: fetchTimeTrackingPolicies })
  const invitations = useQuery({ queryKey: ['organization-invitations'], queryFn: fetchOrganizationInvitations })
  if (profile.isLoading || counts.isLoading || shifts.isLoading || policies.isLoading) return <InlineSpinner />

  const schedule = shifts.data?.find((s) => s.is_default)
  const policy = policies.data?.find((p) => p.department_id === null)
  const c = counts.data
  const step = info('done')
  return (
    <div className="flex flex-col gap-6">
      <header>
        <h1 className="font-headline text-headline-lg text-foreground">{step.title}</h1>
        <p className="mt-1.5 text-body-md text-muted-foreground">{step.description}</p>
      </header>
      {error && <Alert variant="destructive"><AlertDescription>{error}</AlertDescription></Alert>}
      <ul className="divide-y divide-border/70 rounded-xl border border-border/80 px-4">
        <SummaryItem done title={profile.data?.name ?? 'Organization'}
          detail={[industryLabel(profile.data?.industry), profile.data?.team_size && `${profile.data.team_size} people`, profile.data?.timezone]
            .filter(Boolean).join(' · ')} />
        <SummaryItem done={Boolean(schedule)} title="Working hours"
          detail={schedule ? (() => { const s = scheduleSummary(schedule); return `${schedule.name}: ${s.days}, ${s.hours}` })() : 'Not set; add one under Work Schedules.'} />
        <SummaryItem done={Boolean(policy)} title="Work settings" detail={policy ? policySummary(policy) : 'No rules yet.'} />
        <SummaryItem done={Boolean(c?.sites)} title="Sites" detail={c?.sites ? `${plural(c.sites, 'site')} with geofences` : 'None yet; add them under Sites & Geofences.'} />
        <SummaryItem done={Boolean(c?.employees)} title="Team"
          detail={[c?.employees ? `${plural(c.employees, 'employee')} invited to the app` : 'No employees yet',
            invitations.data?.length ? plural(invitations.data.length, 'Console invitation') : null].filter(Boolean).join(' · ')} />
      </ul>
      <section className="rounded-xl bg-muted/50 p-4 text-body-sm text-muted-foreground">
        <p className="mb-1 font-semibold text-foreground">Next</p>
        <ul className="list-disc space-y-1 pl-5">
          <li>Employees install the Crewtraxa app and sign in with the email you added, then accept the invitation.</li>
          <li>Check that everyone is assigned to the right sites under Assignments; the app only tracks assigned sites.</li>
          <li>Add public holidays under Holidays, and watch hours arrive under Timesheets.</li>
        </ul>
      </section>
      <div className="flex justify-end border-t border-border/70 pt-5">
        <Button className="gap-2" onClick={onFinish} disabled={finishing}>
          {finishing ? 'Opening…' : 'Go to dashboard'}
          {!finishing && <ArrowRight className="h-4 w-4" />}
        </Button>
      </div>
    </div>
  )
}

export function SetupWizardPage() {
  const { session, signOut } = useAuth()
  const { organization: activeOrganization, refreshAccess, canCreateOrganization } = useOrganization()
  const location = useLocation()
  const creatingOrganization = canCreateOrganization && new URLSearchParams(location.search).get('new') === '1'
  const organization = creatingOrganization ? null : activeOrganization
  const queryClient = useQueryClient()
  const navigate = useNavigate()
  // Saved progress: the furthest step reached, stored on the organization.
  const saved: SetupStep = organization ? resumeStep(organization.onboarding_step) : 'organization'
  const [step, setStep] = useState<SetupStep>(saved)
  const [progressError, setProgressError] = useState<string | null>(null)

  const goTo = async (next: SetupStep) => {
    setProgressError(null)
    const furthest = furthestStep(saved, next)
    try {
      if (organization && furthest !== saved) {
        await updateOrganizationSetup({ onboarding_step: furthest })
        await refreshAccess()
      }
      setStep(next)
    } catch (error) {
      setProgressError(errorText(error, 'Your progress could not be saved. Try again.'))
    }
  }
  const advance = () => void goTo(stepAfter(step))
  const back = () => setStep(stepBefore(step))

  const finish = useMutation({
    mutationFn: async () => {
      await updateOrganizationSetup({ onboarding_step: 'done', onboarding_completed_at: new Date().toISOString() })
      queryClient.invalidateQueries()
      await refreshAccess()
    },
    onSuccess: () => navigate('/', { replace: true }),
  })
  const skipSetup = () => {
    if (confirm('Skip the rest of setup? You can finish it from Getting Started on the dashboard.')) finish.mutate()
  }

  const current = info(step)
  const reachable = (id: SetupStep) => organization && id !== 'organization' && stepIndex(id) <= stepIndex(saved)
  const position = stepIndex(step)

  return (
    <div className="flex min-h-screen bg-background">
      <aside className="relative hidden w-[300px] shrink-0 flex-col justify-between bg-sidebar px-7 py-8 text-white lg:flex">
        <div>
          <div className="flex items-center gap-3">
            <div className="flex h-10 w-10 items-center justify-center overflow-hidden rounded-xl bg-white/95 ring-1 ring-inset ring-white/20">
              <img src="/crewtraxa-pin.png" alt="Crewtraxa" className="h-8 w-8 object-contain" />
            </div>
            <div>
              <p className="font-headline text-lg font-bold leading-tight">Crewtraxa</p>
              <p className="font-label text-[10px] uppercase tracking-[0.18em] text-sidebar-muted">Workspace setup</p>
            </div>
          </div>
          {organization && <p className="mt-8 truncate font-label text-label-md text-teal-200">{organization.name}</p>}
          <ol className={cn('space-y-1', organization ? 'mt-3' : 'mt-8')} aria-label="Setup steps">
            {SETUP_STEPS.map((item, index) => {
              const done = index < position || (organization !== null && item.id === 'organization')
              const active = item.id === step
              return (
                <li key={item.id}>
                  <button type="button" disabled={!reachable(item.id) || active} onClick={() => setStep(item.id)}
                    aria-current={active ? 'step' : undefined}
                    className={cn('flex w-full items-center gap-3 rounded-lg px-2.5 py-2 text-left transition-colors',
                      active ? 'bg-white/10' : reachable(item.id) ? 'hover:bg-white/[0.06]' : 'cursor-default')}>
                    <span className={cn('flex h-6 w-6 shrink-0 items-center justify-center rounded-full text-[11px] font-semibold ring-1 ring-inset',
                      done ? 'bg-primary text-primary-foreground ring-primary' : active ? 'bg-white text-sidebar ring-white' : 'text-sidebar-muted ring-white/20')}>
                      {done ? <Check className="h-3.5 w-3.5" /> : index + 1}
                    </span>
                    <span className={cn('font-label text-label-md', active ? 'font-semibold text-white' : done ? 'text-white/85' : 'text-sidebar-muted')}>
                      {item.label}
                      {item.optional && <span className="ml-1.5 text-[10px] uppercase tracking-wider text-sidebar-muted">optional</span>}
                    </span>
                  </button>
                </li>
              )
            })}
          </ol>
        </div>
        <div className="border-t border-white/10 pt-4 text-[12px] text-sidebar-muted">
          <p className="truncate">{session?.user.email}</p>
          <button type="button" className="mt-2 inline-flex items-center gap-1.5 hover:text-white" onClick={() => void signOut()}>
            <LogOut className="h-3.5 w-3.5" />
            Sign out
          </button>
        </div>
      </aside>

      <main className="flex min-w-0 flex-1 flex-col">
        <div className="flex items-center justify-between gap-3 border-b border-border/70 px-4 py-3 sm:px-8">
          <div className="flex items-center gap-2 lg:hidden">
            <img src="/crewtraxa-pin.png" alt="Crewtraxa" className="h-7 w-7 object-contain" />
            <span className="font-headline font-bold text-foreground">Crewtraxa</span>
          </div>
          <p className="font-label text-label-md text-muted-foreground">
            Step {position + 1} of {SETUP_STEPS.length} · {current.label}
          </p>
          <div className="flex items-center gap-1">
            {organization && step !== 'done' && (
              <Button variant="ghost" size="sm" onClick={skipSetup} disabled={finish.isPending}>Skip setup</Button>
            )}
            <Button variant="ghost" size="sm" className="lg:hidden" onClick={() => void signOut()}>Sign out</Button>
          </div>
        </div>
        <div className="h-1 bg-muted" aria-hidden>
          <div className="h-1 bg-primary transition-[width] duration-300" style={{ width: `${((position + 1) / SETUP_STEPS.length) * 100}%` }} />
        </div>

        <div className="flex-1 overflow-y-auto px-4 py-8 sm:px-8 lg:py-12">
          <div className="mx-auto w-full max-w-3xl">
            {progressError && <Alert variant="destructive" className="mb-5"><AlertDescription>{progressError}</AlertDescription></Alert>}
            <div key={step} className="animate-fade-in rounded-2xl border border-border/80 bg-card p-5 shadow-card sm:p-8">
              {step === 'organization' && <OrganizationStep info={current} onCreated={() => { navigate('/setup', { replace: true }); setStep('company') }} />}
              {step === 'company' && <CompanyStep info={current} onDone={advance} />}
              {step === 'schedule' && <ScheduleStep info={current} onBack={back} onDone={advance} />}
              {step === 'rules' && <RulesStep info={current} onBack={back} onDone={advance} />}
              {step === 'sites' && <SitesStep info={current} onBack={back} onDone={advance} />}
              {step === 'team' && <TeamStep info={current} onBack={back} onDone={advance} />}
              {step === 'done' && (
                <DoneStep onFinish={() => finish.mutate()} finishing={finish.isPending}
                  error={finish.error ? errorText(finish.error, 'Setup could not be finished. Try again.') : null} />
              )}
            </div>
          </div>
        </div>
      </main>
    </div>
  )
}
