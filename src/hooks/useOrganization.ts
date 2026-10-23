import { createContext, useContext } from 'react'
import type { createOrganizationServices } from '@/api/services'
import type {
  Membership,
  Organization,
  OrganizationRole,
} from '@/types/organization'

export interface OrganizationContextValue {
  organizations: Organization[]
  memberships: Membership[]
  activeOrganization: Organization | null
  role: OrganizationRole | null
  isPlatformAdmin: boolean
  switching: boolean
  canManage: boolean
  canAdminister: boolean
  services: ReturnType<typeof createOrganizationServices>
  switchOrganization: (id: string) => Promise<void>
  refreshOrganizations: () => Promise<void>
}
export const OrganizationContext =
  createContext<OrganizationContextValue | null>(null)
export function useOrganization() {
  const value = useContext(OrganizationContext)
  if (!value) throw new Error('Organization context is required')
  return value
}
