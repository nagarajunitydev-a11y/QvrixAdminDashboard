import {
  Fragment,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from 'react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { useAuth } from '@/api/AuthProvider'
import {
  loadOrganizationAccess,
  validateOrganization,
} from '@/api/organizations'
import { createOrganizationServices } from '@/api/services'
import type { Organization, OrganizationRole } from '@/types/organization'
import { OrganizationContext } from '@/hooks/useOrganization'
import { PageSkeleton } from './PageState'
import { Button } from './ui/button'
import { describeOrganizationAccessError, OrganizationAccessError } from '@/api/organizationAccessError'

export function OrganizationBoundary({ children }: { children: ReactNode }) {
  const { user } = useAuth()
  return user ? (
    <OrganizationProvider key={user.id} userId={user.id}>
      {children}
    </OrganizationProvider>
  ) : null
}

function OrganizationProvider({
  userId,
  children,
}: {
  userId: string
  children: ReactNode
}) {
  const [access, setAccess] = useState<Awaited<
    ReturnType<typeof loadOrganizationAccess>
  > | null>(null)
  const [selection, setSelection] = useState<{
    organization: Organization
    role: OrganizationRole
  } | null>(null)
  const [loading, setLoading] = useState(true)
  const [switching, setSwitching] = useState(false)
  const [error, setError] = useState<Error | null>(null)
  const [checking, setChecking] = useState(false)
  const [signOutError, setSignOutError] = useState('')
  const current = useRef(selection)
  const generation = useRef(0)
  const switchInProgress = useRef(false)
  const { signOut } = useAuth()
  const queryClient = useMemo(
    () =>
      new QueryClient({
        defaultOptions: {
          queries: {
            meta: {
              organizationId: selection?.organization.id,
              role: selection?.role,
            },
            staleTime: 60000,
            gcTime: 300000,
            retry: 1,
            refetchOnWindowFocus: false,
          },
        },
      }),
    [selection?.organization.id, selection?.role],
  )
  useEffect(
    () => () => {
      void queryClient.cancelQueries()
      queryClient.clear()
    },
    [queryClient],
  )
  const refreshOrganizations = useCallback(async () => {
    if (switchInProgress.current) return
    const request = ++generation.current
    setChecking(true)
    try {
      const next = await loadOrganizationAccess(userId)
      const remembered =
        current.current?.organization.id ||
        localStorage.getItem(`crewtraxa-organization:${userId}`)
      const org =
        next.organizations.find(
          (o) => o.id === remembered && o.status === 'active',
        ) || next.organizations.find((o) => o.status === 'active')
      const role = org ? await validateOrganization(org.id) : null
      if (request !== generation.current) return
      setAccess(next)
      const selected = org && role ? { organization: org, role } : null
      current.current = selected
      setSelection(selected)
      setError(null)
    } catch (cause) {
      if (request !== generation.current) return
      setError(
        cause instanceof Error
          ? cause
          : new Error('Organization access could not be loaded.'),
      )
      current.current = null
      setSelection(null)
    } finally {
      if (request === generation.current) {
        setLoading(false)
        setChecking(false)
      }
    }
  }, [userId])
  useEffect(() => {
    let disposed = false
    queueMicrotask(() => {
      if (!disposed) void refreshOrganizations()
    })
    const interval = setInterval(() => void refreshOrganizations(), 60000)
    const focus = () => void refreshOrganizations()
    window.addEventListener('focus', focus)
    const invalidateRequests = () => {
      generation.current++
    }
    return () => {
      disposed = true
      invalidateRequests()
      clearInterval(interval)
      window.removeEventListener('focus', focus)
    }
  }, [refreshOrganizations])
  const switchOrganization = async (id: string) => {
    const request = ++generation.current
    switchInProgress.current = true
    setSwitching(true)
    try {
      const role = await validateOrganization(id)
      const next = await loadOrganizationAccess(userId)
      const organization = next.organizations.find(
        (o) => o.id === id && o.status === 'active',
      )
      if (!organization) throw new Error('Organization is no longer available.')
      await queryClient.cancelQueries()
      if (request !== generation.current) return
      setAccess(next)
      current.current = { organization, role }
      setSelection(current.current)
      localStorage.setItem(`crewtraxa-organization:${userId}`, id)
    } finally {
      if (request === generation.current) {
        switchInProgress.current = false
        setSwitching(false)
      }
    }
  }
  const services = useMemo(
    () => createOrganizationServices(selection?.organization.id || ''),
    [selection?.organization.id],
  )
  useEffect(() => {
    const hex = selection?.organization.branding.accent_color
    if (!hex || !/^#[0-9a-f]{6}$/i.test(hex)) return
    const [r, g, b] = [1, 3, 5].map(
      (index) => parseInt(hex.slice(index, index + 2), 16) / 255,
    )
    const max = Math.max(r, g, b),
      min = Math.min(r, g, b),
      delta = max - min,
      light = (max + min) / 2
    const saturation = delta === 0 ? 0 : delta / (1 - Math.abs(2 * light - 1))
    const hue =
      delta === 0
        ? 0
        : max === r
          ? ((g - b) / delta + 6) % 6
          : max === g
            ? (b - r) / delta + 2
            : (r - g) / delta + 4
    const color = `${hue * 60} ${saturation * 100}% ${light * 100}%`
    document.documentElement.style.setProperty('--primary', color)
    document.documentElement.style.setProperty('--ring', color)
    return () => {
      document.documentElement.style.removeProperty('--primary')
      document.documentElement.style.removeProperty('--ring')
    }
  }, [selection?.organization.branding.accent_color])
  if (loading)
    return (
      <div className="p-8">
        <PageSkeleton />
      </div>
    )
  if (error || !access) {
    const failure = describeOrganizationAccessError(error || new Error('Access check incomplete'))
    return (
      <main aria-busy={checking} className="mx-auto max-w-xl space-y-4 p-8">
        <h1 className="page-heading">{failure.title}</h1>
        <p className="text-sm text-muted-foreground">
          {failure.description}
        </p>
        <p role="alert" className="text-sm text-destructive">
          {error?.message}
        </p>
        {error instanceof OrganizationAccessError && (
          <p className="text-xs text-muted-foreground">Check: {error.operation} · {error.code || error.status}</p>
        )}
        {signOutError && <p role="alert" className="text-sm text-destructive">{signOutError}</p>}
        <div className="flex gap-2">
          <Button disabled={checking} onClick={() => void refreshOrganizations()}>
            {checking ? 'Checking access…' : 'Retry access check'}
          </Button>
          <Button variant="outline" onClick={() => {
            setSignOutError('')
            void signOut().catch(() => setSignOutError('Sign out failed. Check your connection and try again.'))
          }}>
            Sign out
          </Button>
        </div>
      </main>
    )
  }
  const role = selection?.role || null
  return (
    <OrganizationContext.Provider
      value={{
        ...access,
        activeOrganization: selection?.organization || null,
        role,
        switching,
        services,
        canManage:
          role === 'manager' ||
          role === 'organization_admin' ||
          role === 'platform_super_admin',
        canAdminister:
          role === 'organization_admin' || role === 'platform_super_admin',
        switchOrganization,
        refreshOrganizations,
      }}
    >
      <QueryClientProvider client={queryClient}>
        <Fragment
          key={`${selection?.organization.id || 'no-organization'}:${selection?.role || ''}`}
        >
          {children}
        </Fragment>
      </QueryClientProvider>
    </OrganizationContext.Provider>
  )
}
