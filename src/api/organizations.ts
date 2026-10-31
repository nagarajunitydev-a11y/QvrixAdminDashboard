import { supabase } from './supabase'
import { mutationError } from './mutationErrors'
import { currentOrganizationId } from './organizationScope'
import type {
  Device,
  DeviceAssignment,
  DeviceEvent,
  EmployeeAccountCandidate,
  OrganizationInvitation,
  OrganizationMember,
  UnlinkedAccount,
} from '../types/organizations'

// Organizations and console members ------------------------------------------

/** Self-service: creates an organization with the signed-in account as its admin. */
export async function createMyOrganization(name: string, timezone: string, countryCode: string): Promise<string> {
  const { data, error } = await supabase.rpc('create_my_organization', {
    p_name: name,
    p_timezone: timezone,
    p_country_code: countryCode,
  })
  if (error) throw mutationError(error, 'create this organization')
  return data as string
}

export interface OrganizationProfile {
  id: string
  name: string
  timezone: string
  country_code: string | null
  industry: string | null
  team_size: string | null
  onboarding_step: string
  onboarding_completed_at: string | null
}

export async function fetchOrganizationProfile(): Promise<OrganizationProfile> {
  const { data, error } = await supabase.from('organizations')
    .select('id, name, timezone, country_code, industry, team_size, onboarding_step, onboarding_completed_at')
    .eq('id', currentOrganizationId())
    .single()
  if (error) throw error
  return data as OrganizationProfile
}

export async function updateOrganizationSetup(
  fields: Partial<Pick<OrganizationProfile, 'industry' | 'team_size' | 'country_code' | 'onboarding_step' | 'onboarding_completed_at'>>,
): Promise<void> {
  const { data, error } = await supabase.from('organizations').update(fields).eq('id', currentOrganizationId()).select('id')
  if (error) throw mutationError(error, 'save the organization setup')
  if (!data?.length) throw new Error('Only organization admins can change the organization setup.')
}

/** Employee profiles waiting for this account to accept them in the Crewtraxa app. */
export async function fetchMyEmployeeInvitations(): Promise<Array<{ employee_id: string; organization_name: string }>> {
  const { data, error } = await supabase.rpc('my_employee_invitations')
  if (error) throw error
  return data as Array<{ employee_id: string; organization_name: string }>
}

export async function createOrganization(input: {
  name: string
  slug: string
  timezone: string
  adminEmail: string
}): Promise<string> {
  const { data, error } = await supabase.rpc('create_organization', {
    p_name: input.name,
    p_slug: input.slug,
    p_timezone: input.timezone,
    p_admin_email: input.adminEmail || null,
  })
  if (error) throw mutationError(error, 'create this organization')
  return data as string
}

export async function updateOrganization(id: string, fields: { name: string; timezone: string }): Promise<void> {
  const { data, error } = await supabase.from('organizations').update(fields).eq('id', id).select('id')
  if (error) throw mutationError(error, 'update this organization')
  if (!data?.length) throw new Error('Only organization admins can change these settings.')
}

export async function fetchOrganizationMembers(): Promise<OrganizationMember[]> {
  const { data, error } = await supabase.rpc('list_organization_members', {
    p_organization_id: currentOrganizationId(),
  })
  if (error) throw error
  return data as OrganizationMember[]
}

/**
 * Stores an invitation. The response is the same whether or not the email has an account;
 * membership starts only when that person signs in and accepts.
 */
export async function inviteOrganizationMember(email: string, role: OrganizationMember['role']): Promise<void> {
  const { error } = await supabase.rpc('invite_organization_member', {
    p_organization_id: currentOrganizationId(),
    p_email: email.trim(),
    p_role: role,
  })
  if (error) throw mutationError(error, 'send this invitation')
}

export async function fetchOrganizationInvitations(): Promise<OrganizationInvitation[]> {
  const { data, error } = await supabase.rpc('list_organization_invitations', {
    p_organization_id: currentOrganizationId(),
  })
  if (error) throw error
  return data as OrganizationInvitation[]
}

export async function revokeOrganizationInvitation(invitationId: string): Promise<void> {
  const { error } = await supabase.rpc('revoke_organization_invitation', { p_invitation_id: invitationId })
  if (error) throw mutationError(error, 'revoke this invitation')
}

export async function setOrganizationMemberRole(userId: string, role: OrganizationMember['role']): Promise<void> {
  const { error } = await supabase.rpc('set_organization_member_role', {
    p_organization_id: currentOrganizationId(),
    p_user_id: userId,
    p_role: role,
  })
  if (error) throw mutationError(error, 'change this Console role')
}

/** The signed-in invitee accepts or declines; returns the invitation's organization. */
export async function respondToConsoleInvitation(invitationId: string, accept: boolean): Promise<string> {
  const { data, error } = await supabase.rpc('respond_to_console_invitation', {
    p_invitation_id: invitationId,
    p_accept: accept,
  })
  if (error) throw mutationError(error, accept ? 'accept this invitation' : 'decline this invitation')
  return data as string
}

export async function deactivateOrganizationMember(userId: string): Promise<void> {
  const { error } = await supabase.rpc('deactivate_organization_member', {
    p_organization_id: currentOrganizationId(),
    p_user_id: userId,
  })
  if (error) throw mutationError(error, 'remove this Console role')
}

// Verified employee account links ----------------------------------------------

export async function fetchEmployeeAccountCandidates(): Promise<EmployeeAccountCandidate[]> {
  const { data, error } = await supabase.rpc('employee_account_candidates', {
    p_organization_id: currentOrganizationId(),
  })
  if (error) throw error
  return data as EmployeeAccountCandidate[]
}

export async function linkEmployeeAccount(employeeId: string): Promise<void> {
  const { error } = await supabase.rpc('link_employee_account', { p_employee_id: employeeId })
  if (error) throw mutationError(error, 'link this employee account')
}

/** Accounts that used this organization's sites without an employee profile. */
export async function fetchUnlinkedAccounts(): Promise<UnlinkedAccount[]> {
  const { data, error } = await supabase.from('unlinked_devices')
    .select('user_id,email,status,site_id,last_location_timestamp,organization_id')
    .eq('organization_id', currentOrganizationId())
  if (error) throw error
  return data as UnlinkedAccount[]
}

// Devices -----------------------------------------------------------------------

export async function fetchDevices(): Promise<Device[]> {
  const { data, error } = await supabase.from('devices').select('*')
    .eq('organization_id', currentOrganizationId())
    .order('last_seen_at', { ascending: false, nullsFirst: false })
  if (error) throw error
  return data as Device[]
}

export async function fetchDeviceHistory(deviceId: string): Promise<{
  assignments: DeviceAssignment[]
  events: DeviceEvent[]
}> {
  const [assignments, events] = await Promise.all([
    supabase.from('device_assignments').select('*').eq('device_id', deviceId).order('assigned_at', { ascending: false }),
    supabase.from('device_events').select('*').eq('device_id', deviceId).order('created_at', { ascending: false }).limit(50),
  ])
  if (assignments.error) throw assignments.error
  if (events.error) throw events.error
  return { assignments: assignments.data as DeviceAssignment[], events: events.data as DeviceEvent[] }
}

export async function reviewDeviceReassignment(deviceId: string, approve: boolean, note?: string): Promise<void> {
  const { error } = await supabase.rpc('review_device_reassignment', {
    p_device_id: deviceId,
    p_approve: approve,
    p_note: note || null,
  })
  if (error) throw mutationError(error, approve ? 'approve this device change' : 'reject this device change')
}

export async function assignDevice(deviceId: string, employeeId: string, note?: string): Promise<void> {
  const { error } = await supabase.rpc('assign_device', {
    p_device_id: deviceId,
    p_employee_id: employeeId,
    p_note: note || null,
  })
  if (error) throw mutationError(error, 'assign this device')
}

export async function setDeviceStatus(deviceId: string, status: 'active' | 'revoked', note?: string): Promise<void> {
  const { error } = await supabase.rpc('set_device_status', {
    p_device_id: deviceId,
    p_status: status,
    p_note: note || null,
  })
  if (error) throw mutationError(error, status === 'revoked' ? 'revoke this device' : 'reactivate this device')
}
