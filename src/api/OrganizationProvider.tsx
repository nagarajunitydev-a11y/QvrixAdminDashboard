import { createContext, useCallback, useContext, useState, type ReactNode } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { supabase } from './supabase'
import { useAuth } from './AuthProvider'
import { setCurrentOrganizationId } from './organizationScope'
import {
  consoleCapabilities,
  consoleEntry,
  resolveActiveOrganization,
  type ConsoleAccess,
  type ConsoleInvitation,
  type ConsoleOrganization,
  type ConsoleRole,
  type ConsoleEntry,
} from '@/lib/consoleAccess'

const ACTIVE_ORGANIZATION_KEY = 'crewtraxa-active-organization'

export const consoleAccessKey = (userId: string | undefined) => ['console-access', userId ?? null] as const

/** Console access comes from server-side organization membership, never editable user metadata. */
export async function fetchConsoleAccess(): Promise<ConsoleAccess> {
  const { data, error } = await supabase.rpc('my_console_access')
  if (error) throw error
  return data as ConsoleAccess
}

interface OrganizationContextValue {
  loading: boolean
  error: unknown
  retry: () => void
  organizations: ConsoleOrganization[]
  /** Open Console-role invitations waiting for this account to accept or decline. */
  invitations: ConsoleInvitation[]
  organization: ConsoleOrganization | null
  role: ConsoleRole | null
  isPlatformAdmin: boolean
  canManage: boolean
  isOrgAdmin: boolean
  /** The account may create its own organization (self-service setup). */
  canCreateOrganization: boolean
  entry: ConsoleEntry | null
  refreshing: boolean
  switchOrganization: (id: string) => void
  /** Reloads Console access, e.g. after setup progress changes; resolves with the new access. */
  refreshAccess: () => Promise<ConsoleAccess | undefined>
  /** Reloads access and opens an organization the account has just been given, such as one it created. */
  activateOrganization: (id: string) => Promise<void>
}

const OrganizationContext = createContext<OrganizationContextValue | undefined>(undefined)

export function useOrganization() {
  const context = useContext(OrganizationContext)
  if (!context) throw new Error('useOrganization must be used within OrganizationProvider')
  return context
}

export function OrganizationProvider({ children }: { children: ReactNode }) {
  const { user } = useAuth()
  const queryClient = useQueryClient()
  const [storedId, setStoredId] = useState(() => localStorage.getItem(ACTIVE_ORGANIZATION_KEY))
  const accessQuery = useQuery({
    queryKey: consoleAccessKey(user?.id),
    queryFn: fetchConsoleAccess,
    enabled: Boolean(user),
    staleTime: 60_000,
  })

  const access = accessQuery.data
  const organization = user ? resolveActiveOrganization(access, storedId) : null
  // Set during render so queries started by child pages already see the organization.
  setCurrentOrganizationId(organization?.id ?? null)

  const switchOrganization = useCallback((id: string) => {
    if (!access?.organizations.some((candidate) => candidate.id === id)) return
    setCurrentOrganizationId(id)
    // Drop every cached page so no data from the previous organization is shown.
    queryClient.removeQueries({ predicate: (query) => query.queryKey[0] !== 'console-access' })
    localStorage.setItem(ACTIVE_ORGANIZATION_KEY, id)
    setStoredId(id)
  }, [access, queryClient])

  const refreshAccess = useCallback(async () => (await accessQuery.refetch()).data, [accessQuery])

  const activateOrganization = useCallback(async (id: string) => {
    localStorage.setItem(ACTIVE_ORGANIZATION_KEY, id)
    setStoredId(id)
    setCurrentOrganizationId(id)
    await accessQuery.refetch()
  }, [accessQuery])

  const isPlatformAdmin = access?.is_platform_admin ?? false
  const role = organization?.role ?? null

  return (
    <OrganizationContext.Provider
      value={{
        loading: Boolean(user) && accessQuery.isPending,
        error: accessQuery.error,
        retry: () => void accessQuery.refetch(),
        organizations: access?.organizations ?? [],
        invitations: access?.invitations ?? [],
        organization,
        role,
        isPlatformAdmin,
        ...consoleCapabilities(role, isPlatformAdmin),
        canCreateOrganization: access?.can_create_organization ?? false,
        entry: access ? consoleEntry(access) : null,
        refreshing: accessQuery.isFetching,
        switchOrganization,
        refreshAccess,
        activateOrganization,
      }}
    >
      {children}
    </OrganizationContext.Provider>
  )
}
