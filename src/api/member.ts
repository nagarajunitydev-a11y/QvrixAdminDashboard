import { supabase } from './supabase'
import type { Site, PresenceSession } from '@/types'
import type { TimesheetDay, TimesheetEntry } from '@/lib/timesheets'

export async function acceptEmployeeInvitation(employeeId: string): Promise<void> {
  const { error } = await supabase.rpc('accept_employee_invitation', { p_employee_id: employeeId })
  if (error) throw new Error(error.message)
}

/** Personal queries never take the currently selected management organization as their scope. */
export async function fetchMySites(employeeId: string): Promise<Site[]> {
  const { data, error } = await supabase.from('employee_sites').select('sites(*)').eq('employee_id', employeeId)
  if (error) throw new Error(error.message)
  return (data ?? []).map(row => row.sites as unknown as Site).filter(Boolean)
}

export async function fetchMyOpenSession(userId: string): Promise<PresenceSession | null> {
  const { data, error } = await supabase.from('presence_sessions').select('*')
    .eq('user_id', userId).is('exit_timestamp', null).order('entry_timestamp', { ascending: false }).limit(1).maybeSingle()
  if (error) throw new Error(error.message)
  return data as PresenceSession | null
}

export async function fetchMyTimesheet(from: string, to: string): Promise<TimesheetDay[]> {
  const { data, error } = await supabase.rpc('my_timesheet', { p_from: from, p_to: to })
  if (error) throw new Error(error.message)
  return data as TimesheetDay[]
}

export async function fetchMyEntries(from: string, to: string): Promise<TimesheetEntry[]> {
  const { data, error } = await supabase.rpc('my_timesheet_entries', { p_from: from, p_to: to })
  if (error) throw new Error(error.message)
  return data as TimesheetEntry[]
}

export async function keepMyShiftActive(): Promise<null> {
  const { error } = await supabase.rpc('web_clock', { p_action: 'heartbeat' })
  if (error?.code === 'PGRST202') throw new Error('Keeping a web shift active needs the member workflow database update. Use the Employee app until the update is applied.')
  if (error) throw new Error(error.message)
  return null
}

export async function clockOnWeb(action: 'in' | 'out', siteId?: string): Promise<void> {
  // Location is requested only for clock-in. Clock-out always remains available to end an open shift.
  const position = action === 'in' ? await new Promise<GeolocationPosition>((resolve, reject) => {
    if (!navigator.geolocation) return reject(new Error('This browser does not support location. Use the Employee app to check in.'))
    navigator.geolocation.getCurrentPosition(resolve, error => reject(new Error(
      error.code === 1 ? 'Allow location access to check in, then try again.' : 'Your location could not be found. Try again where GPS reception is better.',
    )), { enableHighAccuracy: true, timeout: 15000, maximumAge: 0 })
  }) : null
  const { error } = await supabase.rpc('web_clock', {
    p_action: action, p_site_id: siteId ?? null,
    p_latitude: position?.coords.latitude ?? null, p_longitude: position?.coords.longitude ?? null,
    p_accuracy: position?.coords.accuracy ?? null,
  })
  if (error?.code === 'PGRST202') throw new Error('Web check-in needs the member workflow database update. Your attendance can still be recorded in the Employee app.')
  if (error) throw new Error(error.message)
}
