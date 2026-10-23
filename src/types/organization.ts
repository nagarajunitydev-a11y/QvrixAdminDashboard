export type OrganizationRole =
  | 'platform_super_admin'
  | 'organization_admin'
  | 'manager'
  | 'supervisor'
  | 'employee'
export type Organization = {
  id: string
  name: string
  status: 'active' | 'suspended'
  timezone: string
  settings: Record<string, unknown>
  branding: { display_name?: string; accent_color?: string }
  created_at: string
  updated_at: string
}
export type Membership = {
  organization_id: string
  user_id: string
  role: Exclude<OrganizationRole, 'platform_super_admin'>
  status: 'active' | 'suspended'
  created_at: string
}
