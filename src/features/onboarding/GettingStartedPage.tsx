import { Link } from 'react-router-dom'
import { ArrowRight, CheckCircle2, Circle, Rocket } from 'lucide-react'
import { useOrganization } from '@/api/OrganizationProvider'
import { PageHeader } from '@/components/ui/page-header'
import { Card, CardContent } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { ErrorState, PageSkeleton } from '@/components/ui/states'
import { cn } from '@/lib/utils'
import type { OnboardingStatus } from '@/lib/onboarding'
import { useOnboardingStatus } from './useOnboardingStatus'

export function OnboardingProgress({ status }: { status: OnboardingStatus }) {
  return (
    <div className="flex items-center gap-3">
      <div
        className="h-2 flex-1 overflow-hidden rounded-full bg-muted"
        role="progressbar"
        aria-valuemin={0}
        aria-valuemax={status.total}
        aria-valuenow={status.completed}
        aria-label="Setup progress"
      >
        <div className="h-full rounded-full bg-primary transition-[width] duration-500" style={{ width: `${status.percent}%` }} />
      </div>
      <span className="shrink-0 font-label text-label-md text-muted-foreground">
        {status.completed} of {status.total} done
      </span>
    </div>
  )
}

export function GettingStartedPage() {
  const { organization, canManage } = useOrganization()
  const { status, isLoading, isError, refetch } = useOnboardingStatus()

  if (isLoading) return <PageSkeleton cards={0} rows={6} />
  if (isError || !status) {
    return <ErrorState title="Setup progress unavailable" description="The checklist could not be loaded." onRetry={refetch} />
  }

  return (
    <div className="page-shell">
      <PageHeader
        eyebrow="Workspace setup"
        title="Getting started"
        description={`Set up ${organization?.name ?? 'your organization'} so crews can start checking in. Each step completes on its own once the records exist.`}
        icon={Rocket}
      />

      <Card>
        <CardContent className="space-y-3 p-5">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <p className="font-headline text-headline-sm text-foreground">
              {status.complete ? 'Your workspace is ready' : `Next: ${status.next?.title}`}
            </p>
            {status.complete && <Badge variant="success" dot>Setup complete</Badge>}
          </div>
          <OnboardingProgress status={status} />
        </CardContent>
      </Card>

      <ol className="space-y-3">
        {status.steps.map((step, index) => {
          const isNext = status.next?.id === step.id
          return (
            <li key={step.id}>
              <Card className={cn(isNext && 'border-primary/40 ring-1 ring-primary/20')}>
                <CardContent className="flex flex-col gap-4 p-5 sm:flex-row sm:items-center">
                  <div className="flex flex-1 items-start gap-3">
                    {step.done ? (
                      <CheckCircle2 className="mt-0.5 h-5 w-5 shrink-0 text-emerald-600" aria-label="Done" />
                    ) : (
                      <Circle className="mt-0.5 h-5 w-5 shrink-0 text-muted-foreground" aria-label="Not done" />
                    )}
                    <div className="min-w-0">
                      <div className="flex flex-wrap items-center gap-2">
                        <span className="font-label text-label-sm text-muted-foreground">Step {index + 1}</span>
                        <h2 className="font-headline text-headline-sm text-foreground">{step.title}</h2>
                        {step.optional && <Badge variant="secondary">Optional</Badge>}
                      </div>
                      <p className="mt-1 text-body-sm text-muted-foreground">{step.description}</p>
                      <p className="mt-1.5 font-label text-label-md text-foreground">{step.detail}</p>
                    </div>
                  </div>
                  {(canManage || step.id === 'app') && (
                    <Button asChild variant={isNext ? 'default' : 'outline'} className="shrink-0 gap-2">
                      {/* Reviewing a finished step opens the page itself, not the step's shortcut (e.g. ?import=1). */}
                      <Link to={step.done ? step.to.split('?')[0] : step.to}>
                        {step.done ? 'Review' : step.action}
                        <ArrowRight className="h-4 w-4" />
                      </Link>
                    </Button>
                  )}
                </CardContent>
              </Card>
            </li>
          )
        })}
      </ol>
    </div>
  )
}

/** Compact checklist for the dashboard; hidden once setup is complete. */
export function OnboardingCard() {
  const { status } = useOnboardingStatus()
  if (!status || status.complete) return null
  return (
    <Card className="border-primary/30 bg-primary/5">
      <CardContent className="flex flex-col gap-4 p-5 md:flex-row md:items-center">
        <span className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl bg-primary/10 text-primary">
          <Rocket className="h-5 w-5" />
        </span>
        <div className="min-w-0 flex-1 space-y-2">
          <div>
            <p className="font-headline text-headline-sm text-foreground">Finish setting up your workspace</p>
            <p className="text-body-sm text-muted-foreground">
              Next: {status.next?.title}. {status.next?.description}
            </p>
          </div>
          <OnboardingProgress status={status} />
        </div>
        <Button asChild className="shrink-0 gap-2">
          <Link to="/getting-started">
            Continue setup
            <ArrowRight className="h-4 w-4" />
          </Link>
        </Button>
      </CardContent>
    </Card>
  )
}
