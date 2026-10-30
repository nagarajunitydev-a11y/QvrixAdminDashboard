import { supabase } from './supabase'
import { currentOrganizationId } from './organizationScope'
import { recentActivityEvents, type ActivityLocation, type ActivitySession } from '../lib/recentActivity'

export interface RecentActivitySnapshot {
  sessions: ActivitySession[]
  locations: ActivityLocation[]
}

export async function fetchRecentActivity(): Promise<RecentActivitySnapshot> {
  const organizationId = currentOrganizationId()
  // Query entry and exit independently: ordering only by check-in hides a
  // recent checkout from an older shift. Five of each cover a five-event feed.
  const [entries, checkouts] = await Promise.all([
    supabase.from('presence_sessions').select('id,user_id,site_id,entry_timestamp,exit_timestamp')
      .eq('organization_id', organizationId).order('entry_timestamp', { ascending: false }).order('id', { ascending: false }).limit(5),
    supabase.from('presence_sessions').select('id,user_id,site_id,entry_timestamp,exit_timestamp')
      .eq('organization_id', organizationId).not('exit_timestamp', 'is', null)
      .order('exit_timestamp', { ascending: false }).order('id', { ascending: false }).limit(5),
  ])
  if (entries.error) throw entries.error
  if (checkouts.error) throw checkouts.error
  const sessions: ActivitySession[] = [...entries.data, ...checkouts.data]
  const candidates = recentActivityEvents(sessions, [])
  const cutoff = candidates.length === 5 ? candidates[4].timestamp : 0
  const locations: ActivityLocation[] = []
  // GPS pings are observations, not events. Read the interval that could
  // affect the five newest events, including every page in that interval.
  for (let offset = 0; ; ) {
    let query = supabase.from('location_logs').select('id,user_id,site_id,timestamp,is_inside')
      .eq('organization_id', organizationId).order('timestamp', { ascending: false }).order('id', { ascending: false })
    if (cutoff) query = query.gte('timestamp', cutoff)
    const { data, error } = await query.range(offset, offset + 499)
    if (error) throw error
    if (!data.length) break
    locations.push(...data)
    offset += data.length
  }
  if (cutoff) {
    const pairs = new Map(locations.filter((location) => location.site_id).map((location) =>
      [JSON.stringify([location.user_id, location.site_id]), location]))
    // One observation before the interval establishes whether its first GPS
    // point is a real crossing rather than an already-outside device.
    const keys = [...pairs.values()]
    for (let offset = 0; offset < keys.length; offset += 10) {
      const previous = await Promise.all(keys.slice(offset, offset + 10).map(async (location) => {
        const { data, error } = await supabase.from('location_logs').select('id,user_id,site_id,timestamp,is_inside')
          .eq('organization_id', organizationId).eq('user_id', location.user_id).eq('site_id', location.site_id!)
          .lt('timestamp', cutoff).order('timestamp', { ascending: false }).order('id', { ascending: false }).limit(1)
        if (error) throw error
        return data
      }))
      locations.push(...previous.flat())
    }
  }
  return { sessions, locations }
}
