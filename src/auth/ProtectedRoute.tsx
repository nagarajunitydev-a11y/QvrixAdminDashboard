import { Link, Navigate, Outlet, useLocation } from 'react-router-dom'
import { useAuth } from '../api/AuthProvider'
import { useOrganization } from '../api/OrganizationProvider'
import { Button } from '@/components/ui/button'
import { ConsoleInvitations } from '@/components/ConsoleInvitations'
import { ErrorState } from '@/components/ui/states'
import { consoleAccessErrorMessage, needsSetup } from '@/lib/consoleAccess'

function FullScreenSpinner() {
  return (
    <div className="flex h-screen items-center justify-center">
      <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-primary"></div>
    </div>
  )
}

export function ProtectedRoute({ accountPage = false }: { accountPage?: boolean }) {
  const { session, loading, isPasswordRecovery, signOut } = useAuth()
  const access = useOrganization()
  const location = useLocation()
  const onSetup = location.pathname === '/setup'

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

  // Account and personal workspace routes require authentication, not a management role.
  if (accountPage) return <Outlet />
  if (onSetup && new URLSearchParams(location.search).get('new') === '1' && access.canCreateOrganization) return <Outlet />

  // Signed in with open invitations but no organization yet: accept or decline, or create one instead.
  if (!access.organization && access.invitations.length && !(onSetup && access.canCreateOrganization)) {
    return (
      <div className="flex min-h-screen flex-col items-center justify-center gap-3 p-6">
        <ConsoleInvitations className="w-full max-w-lg" />
        <p className="max-w-lg text-center text-[11px] text-muted-foreground">
          Signed in as {session.user.email}. Accepting gives you Console access to that organization.
        </p>
        <div className="flex flex-wrap justify-center gap-2">
          {access.canCreateOrganization && (
            <Button asChild variant="outline"><Link to="/setup">Create my own organization instead</Link></Button>
          )}
          <Button variant="outline" onClick={() => void signOut()}>Sign out</Button>
        </div>
      </div>
    )
  }

  // No organization yet, but allowed to create one: the setup wizard starts there.
  if (!access.organization && access.canCreateOrganization) {
    return onSetup ? <Outlet /> : <Navigate to={access.member ? '/me' : '/account'} replace />
  }

  // A platform admin can create the first organization even when none exist yet.
  if (!access.organization && access.isPlatformAdmin) {
    return location.pathname === '/organizations' ? <Outlet /> : <Navigate to="/organizations" replace />
  }

  // Authentication succeeded. Keep the session so invitations or restored roles can be rechecked.
  if (!access.organization) return <Navigate to={access.member ? '/me' : '/account'} replace />

  // Organization admins finish or skip setup before the workspace opens; setup resumes where it was left.
  if (needsSetup(access.organization)) {
    return onSetup ? <Outlet /> : <Navigate to="/setup" replace />
  }
  if (onSetup) return <Navigate to="/" replace />

  return <Outlet />
}
