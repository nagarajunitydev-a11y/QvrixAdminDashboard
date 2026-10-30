import { supabase } from './supabase'
import { currentOrganizationId } from './organizationScope'
import type { LocationLog } from '../types'
import type { PresenceSessionWithHeartbeat } from '../lib/workforce'

export interface WorkforceSnapshot {
  sessions: PresenceSessionWithHeartbeat[]
  locations: LocationLog[]
}

export async function fetchWorkforceSnapshot(employeeUserIds: string[]): Promise<WorkforceSnapshot> {
  // Retain discovery of unlinked devices without treating them as employees.
  // Page through open sessions so Supabase's row cap cannot hide a device.
  const organizationId = currentOrganizationId()
  const userIds = new Set(employeeUserIds)
  const pageSize = 500
  for (let offset = 0; ; offset += pageSize) {
    const { data, error } = await supabase.from('presence_sessions').select('user_id')
      .eq('organization_id', organizationId).is('exit_timestamp', null).order('id').range(offset, offset + pageSize - 1)
    if (error) throw error
    for (const session of data) userIds.add(session.user_id)
    if (data.length < pageSize) break
  }

  const snapshot: WorkforceSnapshot = { sessions: [], locations: [] }
  const ids = [...userIds]
  // Latest-per-user queries avoid the old global 12/300 log limit, which could
  // omit quiet devices. Include closed sessions to recognize checkout/re-entry.
  for (let offset = 0; offset < ids.length; offset += 10) {
    const results = await Promise.all(ids.slice(offset, offset + 10).map(async (userId) => {
      const [sessions, locations] = await Promise.all([
        supabase.from('presence_sessions').select('*').eq('organization_id', organizationId).eq('user_id', userId)
          .order('entry_timestamp', { ascending: false })
          .order('exit_timestamp', { ascending: false, nullsFirst: false })
          .order('id', { ascending: false }).limit(1),
        supabase.from('location_logs').select('*').eq('organization_id', organizationId).eq('user_id', userId)
          .order('timestamp', { ascending: false }).order('id', { ascending: false }).limit(1),
      ])
      if (sessions.error) throw sessions.error
      if (locations.error) throw locations.error
      return { sessions: sessions.data, locations: locations.data }
    }))
    for (const result of results) {
      snapshot.sessions.push(...result.sessions)
      snapshot.locations.push(...result.locations)
    }
  }
  return snapshot
}
