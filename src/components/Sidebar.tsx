import { Link, useLocation } from 'react-router-dom'
import { useAuth } from '../api/AuthProvider'
import {
  LayoutDashboard,
  Users,
  Building2,
  Briefcase,
  Clock,
  MapPin,
  Route,
  ClipboardList,
  LogOut,
  Menu,
  Radar,
  X,
} from 'lucide-react'
import { useState } from 'react'

const navItems = [
  { label: 'Dashboard', to: '/', icon: LayoutDashboard },
  { label: 'Employees', to: '/employees', icon: Users },
  { label: 'Departments', to: '/departments', icon: Building2 },
  { label: 'Designations', to: '/designations', icon: Briefcase },
  { label: 'Shifts', to: '/shifts', icon: Clock },
  { label: 'Sites', to: '/sites', icon: MapPin },
  { label: 'Location Logs', to: '/location-logs', icon: Route },
  { label: 'Presence Sessions', to: '/presence', icon: Radar },
  { label: 'Assignments', to: '/assignments', icon: ClipboardList },
  { label: 'Audit Logs', to: '/audit', icon: ClipboardList },
]

function initials(email: string | undefined) {
  if (!email) return 'AD'
  const parts = email.split('@')[0].split(/[._-]+/).filter(Boolean)
  if (parts.length >= 2) return (parts[0][0] + parts[1][0]).toUpperCase()
  return email.slice(0, 2).toUpperCase()
}

export function Navbar({ onToggleSidebar }: { onToggleSidebar?: () => void }) {
  const { signOut, user } = useAuth()

  return (
    <header className="flex h-16 shrink-0 items-center justify-between gap-4 border-b border-border bg-card px-4 sm:px-6">
      <div className="flex items-center gap-3">
        <button
          onClick={onToggleSidebar}
          className="rounded-md p-2 text-muted-foreground transition-colors hover:bg-muted lg:hidden"
          aria-label="Toggle navigation"
        >
          <Menu className="h-5 w-5" />
        </button>
        <h1 className="font-headline text-headline-md font-semibold text-foreground">
          Admin Console
        </h1>
      </div>
      <div className="flex items-center gap-2 sm:gap-3">
        <span className="hidden font-label text-label-md text-muted-foreground md:block">
          {user?.email}
        </span>
        <div className="hidden h-6 w-px bg-border sm:block" />
        <button
          onClick={async () => {
            await signOut()
          }}
          className="flex items-center gap-2 rounded-md px-3 py-2 font-label text-label-md text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
        >
          <LogOut className="h-4 w-4" />
          <span className="hidden sm:inline">Sign Out</span>
        </button>
      </div>
    </header>
  )
}

export function Sidebar({
  open = false,
  onClose,
}: {
  open?: boolean
  onClose?: () => void
}) {
  const location = useLocation()
  const { user, role } = useAuth()

  const nav = (
    <nav className="flex h-full w-64 shrink-0 flex-col bg-sidebar">
      <div className="flex items-center gap-3 p-5 pb-4">
        <div className="flex h-9 w-9 items-center justify-center rounded-md bg-primary shadow-sm">
          <Radar className="h-5 w-5 text-primary-foreground" />
        </div>
        <div className="min-w-0 flex-1">
          <p className="font-headline text-headline-md font-bold leading-tight text-white">
            Mission Control
          </p>
          <p className="font-label text-label-sm text-sidebar-muted">
            Workforce Logistics
          </p>
        </div>
        {onClose && (
          <button
            onClick={onClose}
            className="rounded-md p-1.5 text-sidebar-muted transition-colors hover:bg-sidebar-hover hover:text-white lg:hidden"
            aria-label="Close navigation"
          >
            <X className="h-5 w-5" />
          </button>
        )}
      </div>
      <ul className="mt-2 flex flex-1 flex-col gap-1 overflow-y-auto px-3 pb-4">
        {navItems.map(({ label, to, icon: Icon }) => {
          const active =
            to === '/' ? location.pathname === '/' : location.pathname.startsWith(to)
          return (
            <li key={to}>
              <Link
                to={to}
                onClick={onClose}
                className={`flex items-center gap-3 rounded-sm border-l-4 px-3 py-2 font-label text-label-md transition-colors duration-200 ${
                  active
                    ? 'border-primary bg-sidebar-hover text-white'
                    : 'border-transparent text-sidebar-muted hover:bg-sidebar-hover hover:text-white'
                }`}
              >
                <Icon className="h-4 w-4 shrink-0" />
                <span className="truncate">{label}</span>
              </Link>
            </li>
          )
        })}
      </ul>
      <div className="border-t border-sidebar-hover p-4">
        <div className="flex items-center gap-3">
          <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full border border-sidebar-hover bg-sidebar-hover font-label text-label-md font-semibold text-white">
            {initials(user?.email)}
          </div>
          <div className="flex min-w-0 flex-col">
            <span className="truncate font-label text-label-md text-white">
              Admin User
            </span>
            <span className="truncate font-label text-label-sm capitalize text-sidebar-muted">
              {role ?? 'Operator'}
            </span>
          </div>
        </div>
      </div>
    </nav>
  )

  return (
    <>
      {/* Desktop */}
      <div className="fixed inset-y-0 left-0 z-40 hidden lg:block">{nav}</div>
      {/* Mobile off-canvas */}
      <div
        className={`fixed inset-0 z-50 lg:hidden ${
          open ? 'pointer-events-auto' : 'pointer-events-none'
        }`}
        aria-hidden={!open}
      >
        <div
          onClick={onClose}
          className={`absolute inset-0 bg-slate-900/50 backdrop-blur-sm transition-opacity duration-200 ${
            open ? 'opacity-100' : 'opacity-0'
          }`}
        />
        <div
          className={`absolute inset-y-0 left-0 transition-transform duration-200 ${
            open ? 'translate-x-0' : '-translate-x-full'
          }`}
        >
          {nav}
        </div>
      </div>
    </>
  )
}

export function useSidebarState() {
  const [open, setOpen] = useState(false)
  return {
    open,
    toggle: () => setOpen((o) => !o),
    close: () => setOpen(false),
  }
}
