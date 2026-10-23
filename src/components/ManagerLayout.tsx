import { Outlet } from 'react-router-dom'
import { Navbar, Sidebar } from '../components/Sidebar'
import { useSidebarState } from '@/hooks/useSidebarState'
import { useRouteDataRefresh } from '../hooks/useRouteDataRefresh'
import { useQueryClient } from '@tanstack/react-query'
import { Suspense, useSyncExternalStore } from 'react'
import { useLocation } from 'react-router-dom'
import { queryKeysForPath } from '@/api/pageQueries'
import { refreshPageData } from '@/hooks/useRouteDataRefresh'
import { ErrorState, PageSkeleton } from './PageState'
import { useOrganization } from '@/hooks/useOrganization'
import { Link } from 'react-router-dom'

export function ManagerLayout() {
  const sidebar = useSidebarState()
  const { activeOrganization, isPlatformAdmin, role } = useOrganization()
  const queryClient = useQueryClient()
  const { pathname } = useLocation()
  const keys = queryKeysForPath(pathname) || []
  const cache = queryClient.getQueryCache()
  const hasError = useSyncExternalStore(
    (onChange) => cache.subscribe(onChange),
    () =>
      cache
        .getAll()
        .some(
          (query) =>
            keys.includes(String(query.queryKey[0])) &&
            query.getObserversCount() > 0 &&
            query.state.status === 'error',
        ),
  )

  // Refetch the selected page's data from Supabase on every menu click.
  useRouteDataRefresh()

  return (
    <div className="h-screen overflow-hidden bg-background">
      <a className="skip-link" href="#main-content">
        Skip to content
      </a>
      <Sidebar
        open={sidebar.open}
        onClose={sidebar.close}
        collapsed={sidebar.collapsed}
        onCollapse={sidebar.collapse}
      />
      <div
        className={`flex h-full flex-col transition-[padding] duration-200 ${sidebar.collapsed ? 'lg:pl-[76px]' : 'lg:pl-[260px]'}`}
      >
        <Navbar onToggleSidebar={sidebar.toggle} />
        <main
          id="main-content"
          tabIndex={-1}
          className="page-content min-w-0 flex-1 overflow-y-auto p-4 sm:p-7 xl:px-9 xl:py-8"
        >
          {hasError && (
            <ErrorState
              onRetry={() => refreshPageData(queryClient, pathname)}
            />
          )}
          {!activeOrganization && pathname !== '/organizations' ? (
            <div className="card space-y-4 p-8">
              <h1 className="page-heading">Choose an organization</h1>
              <p className="text-sm text-muted-foreground">
                Select an active organization you belong to. If you have an
                invitation, accept it to get access.
              </p>
              <Link
                className="text-primary underline"
                to={isPlatformAdmin ? '/organizations' : '/accept-invitation'}
              >
                {isPlatformAdmin
                  ? 'Manage organizations'
                  : 'Accept an invitation'}
              </Link>
            </div>
          ) : role === 'employee' &&
            ![
              '/presence',
              '/entry-exit',
              '/location-logs',
              '/settings',
            ].includes(pathname) ? (
            <div className="card space-y-3 p-8">
              <h1 className="page-heading">Employee workspace</h1>
              <p className="text-sm text-muted-foreground">
                Your attendance and location history are available in this
                organization.
              </p>
              <Link className="text-primary underline" to="/presence">
                View my attendance
              </Link>
            </div>
          ) : (
            <Suspense fallback={<PageSkeleton />}>
              <Outlet />
            </Suspense>
          )}
        </main>
      </div>
    </div>
  )
}
