import { useEffect, useRef } from 'react'
import { useLocation } from 'react-router-dom'
import { useQueryClient, type QueryClient } from '@tanstack/react-query'
import { queryKeysForPath } from '../api/pageQueries'

/**
 * Marks the data behind `pathname` as stale and refetches whatever the mounted
 * page is currently observing.
 *
 * Only the query keys belonging to that page are touched, so unrelated cached
 * pages, filters, auth and navigation state are left alone and the app is never
 * reloaded. `cancelRefetch: false` means a repeated request while one is still
 * in flight reuses the running request instead of firing a duplicate, which
 * also rules out out-of-order responses from rapid menu clicks.
 */
export function refreshPageData(queryClient: QueryClient, pathname: string) {
  const keys = queryKeysForPath(pathname)

  if (!keys) {
    // Unmapped page: refresh whatever the mounted page is observing.
    queryClient.invalidateQueries({ refetchType: 'active' }, { cancelRefetch: false })
    return
  }

  keys.forEach((queryKey) => {
    queryClient.invalidateQueries(
      { queryKey: [queryKey], refetchType: 'active' },
      { cancelRefetch: false }
    )
  })
}

/**
 * Refetches the current page's data from Supabase whenever a menu item is
 * opened or re-clicked.
 *
 * Every navigation — including clicking the menu entry for the page you are
 * already on — produces a new `location.key`, which is what this hook keys off.
 * Existing data stays on screen while the refetch runs, and a failed refetch
 * leaves the previously loaded data in place.
 */
export function useRouteDataRefresh() {
  const { pathname, key } = useLocation()
  const queryClient = useQueryClient()
  const lastHandled = useRef<string | null>(null)

  useEffect(() => {
    const navigationId = `${key}:${pathname}`
    if (lastHandled.current === navigationId) return
    lastHandled.current = navigationId

    refreshPageData(queryClient, pathname)
  }, [pathname, key, queryClient])
}
