export type ConsoleRole = 'platform_admin' | 'org_admin' | 'manager' | 'supervisor'

export interface ConsoleOrganization {
  id: string
  name: string
  slug: string
  timezone: string
  is_active: boolean
  role: ConsoleRole
}

/** Shape returned by the `my_console_access` RPC. */
export interface ConsoleAccess {
  is_platform_admin: boolean
  organizations: ConsoleOrganization[]
}

export const roleLabels: Record<ConsoleRole, string> = {
  platform_admin: 'Platform admin',
  org_admin: 'Organization admin',
  manager: 'Manager',
  supervisor: 'Supervisor',
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
