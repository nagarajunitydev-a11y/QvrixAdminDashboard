import { Navigate, Outlet, useLocation } from 'react-router-dom'
import { ShieldOff } from 'lucide-react'
import { useAuth } from '../api/AuthProvider'
import { useOrganization } from '../api/OrganizationProvider'
import { Button } from '@/components/ui/button'
import { ErrorState } from '@/components/ui/states'

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
      <div className="flex min-h-screen items-center justify-center p-6">
        <ErrorState
          className="w-full max-w-lg"
          title="Console access could not be checked"
          description="Your organization roles could not be loaded. Check your connection and try again."
          onRetry={access.retry}
        />
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
