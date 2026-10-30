import type { Json } from './database.types'

export interface Organization {
  id: string
  name: string
  slug: string
  timezone: string
  is_active: boolean
  created_at: string
  updated_at: string
}

export interface OrganizationMember {
  user_id: string
  email: string
  role: 'org_admin' | 'manager' | 'supervisor'
  is_active: boolean
  created_at: string
  last_sign_in_at: string | null
}

export type DeviceStatus = 'active' | 'pending_review' | 'revoked'
export type DeviceTrackingStatus = 'tracking' | 'idle' | 'permission_denied' | 'location_disabled' | 'unknown'

export interface Device {
  id: string
  organization_id: string | null
  install_id: string
  platform: 'android' | 'ios'
  manufacturer: string | null
  model: string | null
  os_version: string | null
  app_version: string | null
  app_build: number | null
  user_id: string | null
  employee_id: string | null
  pending_user_id: string | null
  status: DeviceStatus
  tracking_status: DeviceTrackingStatus | null
  last_seen_at: string | null
  registered_at: string
  updated_at: string
}

export interface DeviceAssignment {
  id: number
  device_id: string
  organization_id: string | null
  user_id: string
  employee_id: string | null
  method: 'self_registration' | 'admin_approval' | 'admin_assignment'
  assigned_by: string | null
  assigned_at: string
  ended_at: string | null
  end_reason: 'reassigned' | 'revoked' | null
}

export interface DeviceEvent {
  id: number
  device_id: string
  organization_id: string | null
  user_id: string | null
  event_type:
    | 'registered'
    | 'reinstalled'
    | 'unlinked_account'
    | 'account_mismatch'
    | 'multiple_devices'
    | 'reassignment_approved'
    | 'reassignment_rejected'
    | 'assigned'
    | 'revoked'
    | 'reactivated'
  details: Json
  created_by: string | null
  created_at: string
}

/** Row of the `unlinked_devices` view: a signed-in account with no employee profile. */
export interface UnlinkedAccount {
  user_id: string
  email: string | null
  status: string
  site_id: string | null
  last_location_timestamp: number | null
  organization_id: string | null
}

/** Row of the platform-admin-only `employee_account_candidates` RPC. */
export interface EmployeeAccountCandidate {
  employee_id: string
  user_id: string
  email: string
}
