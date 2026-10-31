import { formatMinutes, hoursText, parseHours, toClock } from './workSchedules'

/**
 * Time-tracking policy form rules, shared by the Time Tracking Policy page and the setup wizard. The
 * database checks in migration 20261031000000 remain the final authority.
 */

export interface PolicyFields {
  require_inside_site: boolean
  lock_to_registered_device: boolean
  early_clock_in_minutes: number | null
  block_outside_schedule: boolean
  auto_clock_out_after_minutes: number | null
  auto_clock_out_at: string | null
}

export const POLICY_OFF: PolicyFields = {
  require_inside_site: false,
  lock_to_registered_device: false,
  early_clock_in_minutes: null,
  block_outside_schedule: false,
  auto_clock_out_after_minutes: null,
  auto_clock_out_at: null,
}

export interface PolicyForm {
  requireInsideSite: boolean
  lockDevice: boolean
  earlyLimit: boolean
  earlyMinutes: string
  blockOutside: boolean
  autoAfter: boolean
  autoAfterHours: string
  autoAt: boolean
  autoAtTime: string
}

export function policyToForm(policy: PolicyFields): PolicyForm {
  return {
    requireInsideSite: policy.require_inside_site,
    lockDevice: policy.lock_to_registered_device,
    earlyLimit: policy.early_clock_in_minutes !== null,
    earlyMinutes: String(policy.early_clock_in_minutes ?? 15),
    blockOutside: policy.block_outside_schedule,
    autoAfter: policy.auto_clock_out_after_minutes !== null,
    autoAfterHours: hoursText(policy.auto_clock_out_after_minutes) || '12',
    autoAt: policy.auto_clock_out_at !== null,
    autoAtTime: toClock(policy.auto_clock_out_at) ?? '23:59',
  }
}

export function policyFromForm(form: PolicyForm): { fields: PolicyFields | null; errors: string[] } {
  const errors: string[] = []
  const early = form.earlyLimit ? (/^\d{1,3}$/.test(form.earlyMinutes.trim()) ? Number(form.earlyMinutes) : NaN) : null
  if (early !== null && !(early >= 0 && early <= 720)) errors.push('The early check-in limit must be 0 to 720 minutes.')
  const after = form.autoAfter ? parseHours(form.autoAfterHours) : null
  if (form.autoAfter && !(after && after >= 30 && after <= 1440)) errors.push('Automatic check-out after a duration must be between 0.5 and 24 hours.')
  const at = form.autoAt ? toClock(form.autoAtTime) : null
  if (form.autoAt && !at) errors.push('Automatic check-out at a time needs a time such as 23:00.')
  if (errors.length) return { fields: null, errors }
  return {
    errors,
    fields: {
      require_inside_site: form.requireInsideSite,
      lock_to_registered_device: form.lockDevice,
      early_clock_in_minutes: early,
      block_outside_schedule: form.blockOutside,
      auto_clock_out_after_minutes: after,
      auto_clock_out_at: at,
    },
  }
}

export function policySummary(policy: PolicyFields): string {
  const parts = [
    policy.require_inside_site ? 'inside the site' : '',
    policy.lock_to_registered_device ? 'registered phone only' : '',
    policy.early_clock_in_minutes !== null ? `up to ${formatMinutes(policy.early_clock_in_minutes)} early` : '',
    policy.block_outside_schedule ? 'only during scheduled hours' : '',
    policy.auto_clock_out_after_minutes !== null ? `auto check-out after ${formatMinutes(policy.auto_clock_out_after_minutes)}` : '',
    policy.auto_clock_out_at ? `auto check-out at ${toClock(policy.auto_clock_out_at)}` : '',
  ].filter(Boolean)
  return parts.length ? parts.join(' · ') : 'No restrictions'
}
