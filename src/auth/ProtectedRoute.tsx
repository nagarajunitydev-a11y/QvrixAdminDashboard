import { Navigate, Outlet, useLocation } from 'react-router-dom'
import { ShieldOff } from 'lucide-react'
import { useAuth } from '../api/AuthProvider'
import { useOrganization } from '../api/OrganizationProvider'
import { Button } from '@/components/ui/button'
import { ConsoleInvitations } from '@/components/ConsoleInvitations'
import { ErrorState } from '@/components/ui/states'
import { consoleAccessErrorMessage } from '@/lib/consoleAccess'

function FullScreenSpinner() {
  return (
    <div className="flex h-screen items-center justify-center">
      <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-primary"></div>
    </div>
  )
}

export function ProtectedRoute() {
  const { session, loading, isPasswordRecovery, signOut } = useAuth()
  const access = useOrganization()
  const location = useLocation()

  if (loading) return <FullScreenSpinner />

  if (isPasswordRecovery) {
    return <Navigate to="/reset-password" replace />
  }

  if (!session) {
    return <Navigate to="/login" state={{ from: location }} replace />
  }

  if (access.loading) return <FullScreenSpinner />

  if (access.error) {
    return (
      <div className="flex min-h-screen flex-col items-center justify-center gap-3 p-6">
        <ErrorState
          className="w-full max-w-lg"
          title="Console access could not be checked"
          description={consoleAccessErrorMessage(access.error)}
          onRetry={access.retry}
        />
        <Button variant="outline" onClick={() => void signOut()}>Sign out</Button>
      </div>
    )
  }

  // Signed in with open invitations but no organization yet: accept or decline first.
  if (!access.organization && access.invitations.length) {
    return (
      <div className="flex min-h-screen flex-col items-center justify-center gap-3 p-6">
        <ConsoleInvitations className="w-full max-w-lg" />
        <p className="max-w-lg text-center text-[11px] text-muted-foreground">
          Signed in as {session.user.email}. Accepting gives you Console access to that organization.
        </p>
        <Button variant="outline" onClick={() => void signOut()}>Sign out</Button>
      </div>
    )
  }

  // Signed in, but no organization role: field employees use the mobile app.
  if (!access.organization) {
    return (
      <div className="flex min-h-screen items-center justify-center p-6">
        <div className="flex w-full max-w-md flex-col items-center gap-4 rounded-xl border border-border bg-card p-8 text-center shadow-sm">
          <span className="flex h-12 w-12 items-center justify-center rounded-full bg-muted text-muted-foreground">
            <ShieldOff className="h-5 w-5" />
          </span>
          <div>
            <p className="font-headline text-headline-md text-foreground">No Console access</p>
            <p className="mt-1 text-body-sm text-muted-foreground">
              {session.user.email} has no role in any organization. Field employees sign in on the Crewtraxa
              Employee app. Ask an organization admin to add you if you manage a team.
            </p>
          </div>
          <Button variant="outline" onClick={() => void signOut()}>Sign out</Button>
        </div>
      </div>
    )
  }

  return <Outlet />
}
