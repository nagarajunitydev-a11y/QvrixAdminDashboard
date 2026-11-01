import { useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { useMutation } from '@tanstack/react-query'
import { RefreshCw, ShieldCheck } from 'lucide-react'
import { useAuth } from '@/api/AuthProvider'
import { useOrganization } from '@/api/OrganizationProvider'
import type { ConsoleEntry } from '@/lib/consoleAccess'
import { Button } from './ui/button'
import { Alert, AlertDescription } from './ui/alert'
import { ConsoleInvitations } from './ConsoleInvitations'
import { acceptEmployeeInvitation } from '@/api/member'

const guidance: Partial<Record<ConsoleEntry, { title: string; description: string }>> = {
  upgrade: {
    title: 'Organization setup needs an update',
    description: 'You are signed in, but this server does not support organization setup yet. Ask the deployment administrator to update the database, then refresh access.',
  },
  employee: {
    title: 'Your employee account is ready',
    description: 'Use the Crewtraxa Employee app to record attendance and view your assigned sites. To manage a team here, ask your organization admin to invite this same email as a Console user.',
  },
  confirm_email: {
    title: 'Confirm your email to continue',
    description: 'Open the confirmation link sent to your email before creating an organization. Once confirmed, refresh access here.',
  },
  organization_unavailable: {
    title: 'Your organization needs attention',
    description: 'You have already created an organization, but it is no longer available to this account. Ask a platform administrator to check the organization and restore your admin membership.',
  },
  role_required: {
    title: 'Join your organization',
    description: 'You can use Crewtraxa as a team member. Ask your employer to add this email under Employees, then refresh to see your invitation. Accept it to open your personal workspace. You do not need a manager or admin role.',
  },
}

/** Authenticated recovery surface. It never grants access or creates membership on the client. */
export function ConsoleAccessHelp() {
  const { user, signOut } = useAuth()
  const { entry, retry, refreshing, canCreateOrganization, member, employeeInvitations, organization, refreshAccess } = useOrganization()
  const navigate = useNavigate()
  const [signingOut, setSigningOut] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const copy = guidance[entry ?? 'role_required'] ?? guidance.role_required!
  const join = useMutation({
    mutationFn: acceptEmployeeInvitation,
    onSuccess: async () => {
      await refreshAccess()
      navigate('/me', { replace: true })
    },
  })
  const hasChoices = Boolean(canCreateOrganization || member || organization || employeeInvitations.length)
  const changeAccount = async () => {
    setSigningOut(true)
    setError(null)
    try {
      await signOut()
    } catch (error) {
      setError(error instanceof Error ? error.message : 'Could not sign out. Please try again.')
    } finally {
      setSigningOut(false)
    }
  }

  return (
    <main className="flex min-h-screen items-center justify-center bg-background px-4 py-10 sm:px-8">
      <section className="w-full max-w-lg rounded-xl border border-border bg-card p-6 sm:p-8" aria-labelledby="access-title">
        <img src="/crewtraxa-pin.png" alt="Crewtraxa" className="mb-6 h-10 w-10 object-contain" />
        <p className="mb-4 flex items-center gap-2 text-body-sm text-muted-foreground" role="status">
          <ShieldCheck className="h-4 w-4 shrink-0 text-primary" aria-hidden /> Signed in successfully
        </p>
        <h1 id="access-title" className="font-headline text-headline-lg text-foreground">{hasChoices ? 'Your Crewtraxa account' : copy.title}</h1>
        <p className="mt-3 text-body-md leading-relaxed text-muted-foreground">{hasChoices ? 'Join your team, open a workspace, or create an organization of your own.' : copy.description}</p>
        <p className="mt-4 break-all text-body-sm font-medium text-foreground">{user?.email}</p>
        <div className="mt-6 flex flex-col gap-4">
          {member && (
            <div>
              <p className="mb-2 text-body-sm text-muted-foreground">Member of {member.organizations.name}</p>
              <Button asChild><Link to="/me">Open my workspace</Link></Button>
            </div>
          )}
          {organization && <Button asChild variant="outline"><Link to="/">Open {organization.name} Console</Link></Button>}
          <ConsoleInvitations />
          {employeeInvitations.length > 0 && (
            <section aria-label="Employee invitations" className="border-y border-border py-4">
              <h2 className="font-headline text-headline-sm">Your team invitations</h2>
              <ul className="mt-3 space-y-4">
                {employeeInvitations.map(invitation => (
                  <li key={invitation.employee_id} className="flex flex-wrap items-center justify-between gap-3">
                    <div className="min-w-0"><p className="break-words font-medium">{invitation.organization_name}</p><p className="text-body-sm text-muted-foreground">Join as a member</p></div>
                    <Button disabled={join.isPending} onClick={() => join.mutate(invitation.employee_id)}>Accept invitation</Button>
                  </li>
                ))}
              </ul>
            </section>
          )}
          {canCreateOrganization && (
            <section className="border-t border-border pt-4">
              <h2 className="font-headline text-headline-sm">Start your own team</h2>
              <p className="mb-3 mt-1 text-body-sm text-muted-foreground">Create an organization and become its owner. We will guide you through schedules, sites and inviting people.</p>
              <Button asChild variant="outline"><Link to="/setup?new=1">Create an organization</Link></Button>
            </section>
          )}
          <details className="text-body-sm text-muted-foreground">
            <summary className="cursor-pointer rounded-sm text-foreground focus-visible:ring-2 focus-visible:ring-ring">Join an organization</summary>
            <p className="mt-2 leading-relaxed">Ask your employer to add {user?.email} under Employees. Refresh access here and accept the invitation. Invitations are matched to your confirmed email; you do not need an admin role or another account.</p>
          </details>
        </div>
        {entry === 'upgrade' && (
          <details className="mt-5 text-body-sm text-muted-foreground">
            <summary className="cursor-pointer rounded-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring">Deployment details</summary>
            <p className="mt-2 break-words">Apply pending Supabase migrations, including 20261031000003_self_service_organizations.sql, and deploy the current Console build. Organization creation is enabled by the server.</p>
          </details>
        )}
        {error && <Alert variant="destructive" className="mt-5"><AlertDescription>{error}</AlertDescription></Alert>}
        {join.error && <Alert variant="destructive" className="mt-5"><AlertDescription>{join.error.message}</AlertDescription></Alert>}
        <div className="mt-6 flex flex-col gap-3 border-t border-border pt-5 sm:flex-row">
          <Button onClick={retry} disabled={refreshing || signingOut} className="gap-2">
            <RefreshCw className="h-4 w-4" aria-hidden />
            {refreshing ? 'Checking access…' : 'Refresh access'}
          </Button>
          <Button variant="outline" onClick={() => void changeAccount()} disabled={signingOut}>
            {signingOut ? 'Signing out…' : 'Use another account'}
          </Button>
        </div>
      </section>
    </main>
  )
}
