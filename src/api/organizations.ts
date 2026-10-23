import { supabase } from './supabase'
import { OrganizationAccessError } from './organizationAccessError'
import type {
  Organization,
  Membership,
  OrganizationRole,
} from '@/types/organization'

export async function loadOrganizationAccess(userId: string) {
  const [organizations, memberships, platform] = await Promise.all([
    supabase.from('organizations').select('*').order('name'),
    supabase.from('organization_memberships').select('*').eq('user_id', userId),
    supabase.rpc('is_platform_admin'),
  ])
  for (const [operation, result] of [
    ['organizations', organizations],
    ['organization_memberships', memberships],
    ['is_platform_admin', platform],
  ] as const)
    if (result.error) throw new OrganizationAccessError(result.error.message, result.error.code, result.status, operation)
  return {
    organizations: organizations.data as Organization[],
    memberships: memberships.data as Membership[],
    isPlatformAdmin: platform.data === true,
  }
}

export async function validateOrganization(
  id: string,
): Promise<OrganizationRole> {
  const { data, error, status } = await supabase.rpc(
    'validate_organization_selection',
    { org: id },
  )
  if (error) throw new OrganizationAccessError(error.message, error.code, status, 'validate_organization_selection')
  return data as OrganizationRole
}

export async function saveOrganization(
  org: Partial<Organization> & {
    name: string
    timezone: string
    status: string
  },
) {
  const { data, error } = await supabase.rpc('save_organization', {
    org: org.id || null,
    org_name: org.name,
    org_status: org.status,
    org_timezone: org.timezone,
    org_settings: org.settings || {},
    org_branding: org.branding || {},
  })
  if (error) throw new Error(error.message)
  return data as Organization
}

export async function organizationRpc(
  name: string,
  params: Record<string, unknown>,
) {
  const { data, error } = await supabase.rpc(name, params)
  if (error) throw new Error(error.message)
  return data
}
