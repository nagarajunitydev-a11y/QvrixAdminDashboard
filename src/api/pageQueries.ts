/**
 * Maps each navigable page to the React Query keys that page renders.
 *
 * Used by `useRouteDataRefresh` so that opening (or re-clicking) a menu item
 * refetches only that page's data from Supabase, without reloading the app or
 * touching auth / navigation / filter state.
 *
 * Keys are matched by prefix, so `['employee-sites']` also refreshes
 * `['employee-sites', employeeId]` and `['location-logs', { ...filters }]`.
 */
export const PAGE_QUERY_KEYS: Record<string, string[]> = {
  '/': ['sites', 'employees', 'active-presence-sessions', 'recent-location-logs', 'presence-sessions', 'shifts'],
  '/live-tracking': ['sites', 'employees', 'recent-location-logs'],
  '/entry-exit': ['presence-sessions', 'sites', 'employees'],
  '/alerts': ['sites', 'employees', 'recent-location-logs'],
  '/reports': ['presence-sessions', 'sites', 'employees'],
  '/devices': ['sites', 'employees', 'recent-location-logs'],
  '/organizations': ['organizations'],
  '/users': ['organization-members','organization-invitations','organization-site-access','sites'],
  '/settings': [],
  '/employees': ['employees', 'departments', 'designations', 'shifts', 'sites', 'employee-sites'],
  '/departments': ['departments'],
  '/designations': ['designations'],
  '/shifts': ['shifts', 'departments'],
  '/sites': ['sites', 'employees', 'employee-sites'],
  '/location-logs': ['location-logs', 'sites', 'employees'],
  '/presence': ['presence-sessions', 'sites', 'employees'],
  '/assignments': ['employee-sites', 'employees', 'sites'],
  '/audit': ['audit-logs'],
}

/** Resolves a pathname to the query keys of the page it renders. */
export function queryKeysForPath(pathname: string): string[] | null {
  if (PAGE_QUERY_KEYS[pathname]) return PAGE_QUERY_KEYS[pathname]
  const match = Object.keys(PAGE_QUERY_KEYS)
    .filter((path) => path !== '/' && pathname.startsWith(path))
    .sort((a, b) => b.length - a.length)[0]
  return match ? PAGE_QUERY_KEYS[match] : null
}
