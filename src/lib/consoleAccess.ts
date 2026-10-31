export type ConsoleRole = 'platform_admin' | 'org_admin' | 'manager' | 'supervisor'

export interface ConsoleOrganization {
  id: string
  name: string
  slug: string
  timezone: string
  is_active: boolean
  role: ConsoleRole
  /** Absent before migration 20261031000003. */
  country_code?: string | null
  /** The next setup step for the organization's admins; 'done' once setup is finished or skipped. */
  onboarding_step?: string
  onboarding_completed_at?: string | null
}

/** An open Console-role invitation for the signed-in account's confirmed email. */
export interface ConsoleInvitation {
  id: string
  organization_id: string
  organization_name: string
  role: Exclude<ConsoleRole, 'platform_admin'>
  expires_at: string
}

/** Shape returned by the `my_console_access` RPC. */
export interface ConsoleAccess {
  is_platform_admin: boolean
  organizations: ConsoleOrganization[]
  /** Absent before migration 20261030000002. */
  invitations?: ConsoleInvitation[]
  /** Whether this account may create its own organization (migration 20261031000003). */
  can_create_organization?: boolean
}

/** Organization admins finish (or skip) setup before using the workspace; other roles never see it. */
export function needsSetup(organization: ConsoleOrganization | null): boolean {
  return Boolean(organization && organization.role === 'org_admin'
    && organization.onboarding_step !== undefined && !organization.onboarding_completed_at)
}

/** Accounts may sign in to accept an invitation, create an organization, or use one they belong to. */
export function canEnterConsole(access: ConsoleAccess | null | undefined): boolean {
  return Boolean(access && (access.organizations.length || access.invitations?.length || access.can_create_organization))
}

export const roleLabels: Record<ConsoleRole, string> = {
  platform_admin: 'Platform admin',
  org_admin: 'Organization admin',
  manager: 'Manager',
  supervisor: 'Supervisor',
}

/**
 * Explains a failed access check. Supabase returns plain objects, not Error instances, so a
 * generic `instanceof Error` check would hide the real cause behind "something went wrong".
 */
export function consoleAccessErrorMessage(error: unknown): string {
  const { code, message } = (error ?? {}) as { code?: unknown; message?: unknown }
  // PGRST202: the my_console_access RPC does not exist, i.e. the organizations migration is not applied.
  if (code === 'PGRST202') {
    return 'This Console version needs the organization update, but the Supabase database has not been upgraded yet. Apply migration 20261030000000_organizations_identity_devices.sql, then sign in again.'
  }
  return typeof message === 'string' && message ? message : 'Console access could not be checked. Try again.'
}

/** Keep the stored choice only while the account can still open that organization. */
export function resolveActiveOrganization(
  access: ConsoleAccess | undefined,
  storedId: string | null,
): ConsoleOrganization | null {
  const organizations = access?.organizations ?? []
  return (
    organizations.find((organization) => organization.id === storedId) ??
    organizations.find((organization) => organization.is_active) ??
    organizations[0] ??
    null
  )
}

/** Mirrors the RLS role sets so the UI only offers actions the database will accept. */
export function consoleCapabilities(role: ConsoleRole | null, isPlatformAdmin: boolean) {
  const effective = isPlatformAdmin ? 'platform_admin' : role
  return {
    canManage: effective === 'platform_admin' || effective === 'org_admin' || effective === 'manager',
    isOrgAdmin: effective === 'platform_admin' || effective === 'org_admin',
  }
}

/** Accounts without an employee profile are labelled by their sign-in email, never a device or ID prefix. */
export function unlinkedAccountLabel(email: string | null | undefined): string {
  return email ? `Unlinked account · ${email}` : 'Unlinked account'
}

export interface DeviceHolderInput {
  user_id: string | null
  employee_id: string | null
}

/** Names a device holder only through a verified employee link. */
export function deviceHolderLabel(
  device: DeviceHolderInput,
  employeeNames: Map<string, string>,
  unlinkedEmails: Map<string, string>,
): { label: string; verified: boolean } {
  const name = device.employee_id ? employeeNames.get(device.employee_id) : undefined
  if (name) return { label: name, verified: true }
  if (device.user_id) return { label: unlinkedAccountLabel(unlinkedEmails.get(device.user_id)), verified: false }
  return { label: 'No holder', verified: false }
}
