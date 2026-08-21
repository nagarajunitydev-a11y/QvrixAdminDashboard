import { Outlet } from 'react-router-dom'
import { Navbar, Sidebar, useSidebarState } from '../components/Sidebar'

export function ManagerLayout() {
  const sidebar = useSidebarState()

  return (
    <div className="h-screen overflow-hidden bg-background">
      <Sidebar open={sidebar.open} onClose={sidebar.close} />
      <div className="flex h-full flex-col lg:pl-64">
        <Navbar onToggleSidebar={sidebar.toggle} />
        <main className="flex-1 overflow-y-auto p-4 sm:p-6">
          <Outlet />
        </main>
      </div>
    </div>
  )
}
