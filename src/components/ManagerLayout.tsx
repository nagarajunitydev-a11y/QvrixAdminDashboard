import { Outlet } from 'react-router-dom'
import { Navbar, Sidebar, useSidebarState } from '../components/Sidebar'
import { useRouteDataRefresh } from '../hooks/useRouteDataRefresh'
import { cn } from '@/lib/utils'

export function ManagerLayout() {
  const sidebar = useSidebarState()

  // Refetch the selected page's data from Supabase on every menu click.
  useRouteDataRefresh()

  return (
    <div className="h-screen overflow-hidden bg-background">
      <Sidebar
        open={sidebar.open}
        collapsed={sidebar.collapsed}
        onClose={sidebar.close}
        onToggleCollapse={sidebar.toggleCollapse}
      />
      <div
        className={cn(
          'flex h-full flex-col transition-[padding] duration-300 ease-out',
          sidebar.collapsed ? 'lg:pl-[76px]' : 'lg:pl-[276px]'
        )}
      >
        <Navbar
          onToggleSidebar={sidebar.toggle}
          onToggleCollapse={sidebar.toggleCollapse}
          collapsed={sidebar.collapsed}
        />
        <main className="scrollbar-thin flex-1 overflow-y-auto px-4 py-5 sm:px-6 sm:py-6 lg:px-8">
          <div key="route" className="animate-fade-in">
            <Outlet />
          </div>
        </main>
      </div>
    </div>
  )
}
