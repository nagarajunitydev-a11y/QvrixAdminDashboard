import { useEffect, useMemo, useState } from 'react'
import { Link, useLocation } from 'react-router-dom'
import { useIsFetching, useQueryClient } from '@tanstack/react-query'
import { useAuth } from '../api/AuthProvider'
import { useOrganization } from '../api/OrganizationProvider'
import { roleLabels } from '@/lib/consoleAccess'
import { refreshPageData } from '../hooks/useRouteDataRefresh'
import { useTheme } from './ThemeProvider'
import {
  BarChart3,
  BellRing,
  CalendarClock,
  CalendarDays,
  CalendarRange,
  Briefcase,
  Building2,
  CalendarCheck,
  ChevronLeft,
  ClipboardList,
  History,
  Landmark,
  LayoutDashboard,
  LogOut,
  MapPinned,
  Menu,
  Moon,
  Radar,
  Rocket,
  ScrollText,
  ShieldCheck,
  Settings,
  Smartphone,
  Sun,
  UserCog,
  Users,
  UsersRound,
  X,
} from 'lucide-react'
import { cn } from '@/lib/utils'

const COLLAPSE_KEY = 'crewtraxa-sidebar-collapsed'

const navGroups = [
  {
    label: 'Workspace',
    items: [
      { label: 'My account', to: '/account', icon: UsersRound },
      { label: 'Dashboard', to: '/', icon: LayoutDashboard },
      { label: 'Getting Started', to: '/getting-started', icon: Rocket },
      { label: 'Live Tracking', to: '/live-tracking', icon: Radar },
      { label: 'Employees', to: '/employees', icon: Users },
      { label: 'Sites & Geofences', to: '/sites', icon: MapPinned },
      { label: 'Site Workers', to: '/site-workers', icon: UsersRound },
    ],
  },
  {
    label: 'Operations',
    items: [
      { label: 'Attendance', to: '/attendance', icon: CalendarCheck },
      { label: 'Timesheets', to: '/timesheets', icon: CalendarRange },
      { label: 'Work Schedules', to: '/shifts', icon: CalendarClock },
      { label: 'Holidays', to: '/holidays', icon: CalendarDays },
      { label: 'History', to: '/history', icon: History },
      { label: 'Alerts', to: '/alerts', icon: BellRing },
    ],
  },
  {
    label: 'Insights',
    items: [{ label: 'Reports', to: '/reports', icon: BarChart3 }],
  },
  {
    label: 'Administration',
    items: [
      { label: 'Departments', to: '/departments', icon: Building2 },
      { label: 'Designations', to: '/designations', icon: Briefcase },
      { label: 'Assignments', to: '/assignments', icon: ClipboardList },
      { label: 'Users & Roles', to: '/users', icon: UserCog },
      { label: 'Devices', to: '/devices', icon: Smartphone },
      { label: 'Time Tracking Policy', to: '/time-policy', icon: ShieldCheck },
      { label: 'Organizations', to: '/organizations', icon: Landmark, platformOnly: true },
      { label: 'Audit Logs', to: '/audit', icon: ScrollText },
      { label: 'Settings', to: '/settings', icon: Settings },
    ],
  },
]

const routeTitles: Array<[string, string]> = [
  ['/getting-started', 'Getting Started'],
  ['/live-tracking', 'Live Tracking'],
  ['/employees', 'Employees'],
  ['/sites', 'Sites & Geofences'],
  ['/site-workers', 'Site Workers'],
  ['/attendance', 'Attendance'],
  ['/presence', 'Attendance'],
  ['/timesheets', 'Timesheets'],
  ['/shifts', 'Work Schedules'],
  ['/holidays', 'Holidays'],
  ['/time-policy', 'Time Tracking Policy'],
  ['/history', 'History'],
  ['/location-logs', 'History'],
  ['/alerts', 'Alerts'],
  ['/reports', 'Reports'],
  ['/departments', 'Departments'],
  ['/designations', 'Designations'],
  ['/assignments', 'Assignments'],
  ['/users', 'Users & Roles'],
  ['/devices', 'Devices'],
  ['/organizations', 'Organizations'],
  ['/audit', 'Audit Logs'],
  ['/settings', 'Settings'],
  ['/', 'Dashboard'],
]

export function routeTitle(pathname: string) {
  const match = routeTitles
    .filter(([path]) => (path === '/' ? pathname === '/' : pathname.startsWith(path)))
    .sort((a, b) => b[0].length - a[0].length)[0]
  return match?.[1] ?? 'Dashboard'
}

function initials(email: string | undefined) {
  if (!email) return 'AD'
  const parts = email.split('@')[0].split(/[._-]+/).filter(Boolean)
  if (parts.length >= 2) return (parts[0][0] + parts[1][0]).toUpperCase()
  return email.slice(0, 2).toUpperCase()
}

function isActivePath(pathname: string, to: string) {
  if (to === '/') return pathname === '/'
  if (to === '/attendance') return pathname.startsWith('/attendance') || pathname.startsWith('/presence')
  if (to === '/history') return pathname.startsWith('/history') || pathname.startsWith('/location-logs')
  return pathname.startsWith(to)
}

export function Navbar({
  onToggleSidebar,
  onToggleCollapse,
  collapsed,
}: {
  onToggleSidebar?: () => void
  onToggleCollapse?: () => void
  collapsed?: boolean
}) {
  const { signOut, user } = useAuth()
  const { role } = useOrganization()
  const { resolvedTheme, toggleTheme } = useTheme()
  const location = useLocation()
  const isRefreshing = useIsFetching() > 0
  const title = routeTitle(location.pathname)

  return (
    <header className="sticky top-0 z-30 flex h-16 shrink-0 items-center justify-between gap-4 border-b border-border/80 bg-background/85 px-4 backdrop-blur-xl sm:px-6">
      <div className="flex min-w-0 items-center gap-3">
        <button
          onClick={onToggleSidebar}
          className="rounded-lg p-2 text-muted-foreground transition-colors hover:bg-muted hover:text-foreground lg:hidden"
          aria-label="Open navigation"
        >
          <Menu className="h-5 w-5" />
        </button>
        <button
          onClick={onToggleCollapse}
          className="hidden rounded-lg p-2 text-muted-foreground transition-colors hover:bg-muted hover:text-foreground lg:inline-flex"
          aria-label={collapsed ? 'Expand navigation' : 'Collapse navigation'}
          title={collapsed ? 'Expand navigation' : 'Collapse navigation'}
        >
          <Menu className="h-4 w-4" />
        </button>
        <div className="min-w-0">
          <div className="flex items-center gap-1.5 font-label text-label-sm text-muted-foreground">
            <img src="/crewtraxa-pin.png" alt="Crewtraxa" className="hidden h-4 w-4 object-contain sm:block" />
            <span className="hidden text-border sm:inline">/</span>
            <span className="truncate text-foreground">{title}</span>
          </div>
          <p className="hidden font-label text-[10px] uppercase tracking-[0.18em] text-muted-foreground/70 sm:block">
            Crew tracking console
          </p>
        </div>
      </div>

      <div className="flex items-center gap-1.5 sm:gap-2">
        {isRefreshing && (
          <span
            role="status"
            aria-live="polite"
            className="mr-1 flex items-center gap-2 rounded-full bg-primary/10 px-2.5 py-1 font-label text-label-sm text-primary"
          >
            <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-primary" />
            <span className="hidden sm:inline">Syncing</span>
          </span>
        )}
        <button
          onClick={toggleTheme}
          className="rounded-lg p-2 text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
          aria-label={resolvedTheme === 'dark' ? 'Switch to light theme' : 'Switch to dark theme'}
          title={resolvedTheme === 'dark' ? 'Light mode' : 'Dark mode'}
        >
          {resolvedTheme === 'dark' ? <Sun className="h-4 w-4" /> : <Moon className="h-4 w-4" />}
        </button>
        <div className="hidden h-6 w-px bg-border sm:block" />
        <div className="hidden items-center gap-2.5 sm:flex">
          <div className="flex h-8 w-8 items-center justify-center rounded-full bg-gradient-to-br from-primary to-teal-700 font-label text-label-sm font-semibold text-primary-foreground shadow-sm">
            {initials(user?.email)}
          </div>
          <div className="hidden min-w-0 flex-col md:flex">
            <span className="max-w-[180px] truncate font-label text-label-md text-foreground">
              {user?.email ?? 'Administrator'}
            </span>
            <span className="font-label text-[10px] uppercase tracking-[0.14em] text-muted-foreground">
              {role ? roleLabels[role] : 'Operator'}
            </span>
          </div>
        </div>
        <button
          onClick={async () => {
            await signOut()
          }}
          className="flex items-center gap-2 rounded-lg px-2.5 py-2 font-label text-label-md text-muted-foreground transition-colors hover:bg-destructive/10 hover:text-destructive"
          title="Sign out"
        >
          <LogOut className="h-4 w-4" />
          <span className="hidden lg:inline">Sign out</span>
        </button>
      </div>
    </header>
  )
}

export function Sidebar({
  open = false,
  collapsed = false,
  onClose,
  onToggleCollapse,
}: {
  open?: boolean
  collapsed?: boolean
  onClose?: () => void
  onToggleCollapse?: () => void
}) {
  const location = useLocation()
  const { user } = useAuth()
  const { organization, organizations, role, isPlatformAdmin, switchOrganization } = useOrganization()
  const queryClient = useQueryClient()
  const [isDesktop, setIsDesktop] = useState(false)

  useEffect(() => {
    const media = window.matchMedia('(min-width: 1024px)')
    const update = () => setIsDesktop(media.matches)
    update()
    media.addEventListener('change', update)
    return () => media.removeEventListener('change', update)
  }, [])

  const isCollapsed = isDesktop && collapsed

  const nav = (
    <nav
      className={cn(
        'flex h-full shrink-0 flex-col bg-sidebar text-white transition-[width] duration-300 ease-out',
        isCollapsed ? 'w-[76px]' : 'w-[276px]'
      )}
      aria-label="Primary navigation"
    >
      <div
        className={cn(
          'flex h-16 items-center gap-3 border-b border-sidebar-border',
          isCollapsed ? 'justify-center px-3' : 'px-5'
        )}
      >
        <div className={cn('relative flex shrink-0 items-center justify-center', isCollapsed ? 'h-9 w-9' : 'h-9 w-9')}>
          <div className="rounded-lg bg-sidebar-hover/50 p-2 flex items-center justify-center">
            <img src="/crewtraxa-pin.png" alt="Crewtraxa" className={cn('object-contain', isCollapsed ? 'h-7 w-7' : 'h-7 w-7')} />
          </div>
        </div>
        {!isCollapsed && (
          <div className="min-w-0 flex-1 flex flex-col justify-center">
            <span className="font-headline text-sm font-bold text-white truncate">Crewtraxa</span>
            <span className="font-label text-[10px] uppercase tracking-[0.18em] text-sidebar-muted">Crew Tracking Console</span>
          </div>
        )}
        {onClose && !isDesktop && (
          <button
            onClick={onClose}
            className="rounded-lg p-1.5 text-sidebar-muted transition-colors hover:bg-sidebar-hover hover:text-white"
            aria-label="Close navigation"
          >
            <X className="h-5 w-5" />
          </button>
        )}
      </div>

      {!isCollapsed && organization && (
        <div className="border-b border-sidebar-border px-4 py-3">
          <label
            htmlFor="active-organization"
            className="mb-1 block font-label text-[10px] font-semibold uppercase tracking-[0.16em] text-sidebar-muted/70"
          >
            Organization
          </label>
          {organizations.length > 1 ? (
            <select
              id="active-organization"
              value={organization.id}
              onChange={(event) => switchOrganization(event.target.value)}
              className="w-full truncate rounded-lg border border-white/10 bg-sidebar-hover/60 px-2.5 py-1.5 font-label text-label-md text-white focus:outline-none focus:ring-2 focus:ring-sidebar-active/50"
            >
              {organizations.map((option) => (
                <option key={option.id} value={option.id} className="text-foreground">
                  {option.name}{option.is_active ? '' : ' (inactive)'}
                </option>
              ))}
            </select>
          ) : (
            <p id="active-organization" className="truncate font-label text-label-md text-white">{organization.name}</p>
          )}
        </div>
      )}

      <div className="scrollbar-thin flex-1 overflow-y-auto overflow-x-hidden px-3 py-4">
        {navGroups.map((group) => ({ ...group, items: group.items.filter((item) => !('platformOnly' in item) || isPlatformAdmin) })).map((group) => (
          <div key={group.label} className="mb-4 last:mb-0">
            <p
              className={cn(
                'mb-1.5 px-3 font-label text-[10px] font-semibold uppercase tracking-[0.16em] text-sidebar-muted/70',
                isCollapsed && 'sr-only'
              )}
            >
              {group.label}
            </p>
            <ul className="flex flex-col gap-0.5">
              {group.items.map(({ label, to, icon: Icon }) => {
                const active = isActivePath(location.pathname, to)
                return (
                  <li key={to}>
                    <Link
                      to={to}
                      title={isCollapsed ? label : undefined}
                      onClick={() => {
                        if (active) refreshPageData(queryClient, location.pathname)
                        onClose?.()
                      }}
                      className={cn(
                        'group relative flex items-center gap-3 rounded-lg py-2 font-label text-label-md transition-all duration-200',
                        isCollapsed ? 'justify-center px-2' : 'px-3',
                        active
                          ? 'bg-sidebar-hover text-white shadow-sm'
                          : 'text-sidebar-muted hover:bg-sidebar-hover/70 hover:text-white'
                      )}
                    >
                      {active && (
                        <span className="absolute left-0 top-1/2 h-5 w-[3px] -translate-y-1/2 rounded-r-full bg-sidebar-active" />
                      )}
                      <Icon
                        className={cn(
                          'h-[18px] w-[18px] shrink-0 transition-colors',
                          active ? 'text-sidebar-active' : 'text-sidebar-muted group-hover:text-white'
                        )}
                      />
                      {!isCollapsed && <span className="truncate">{label}</span>}
                    </Link>
                  </li>
                )
              })}
            </ul>
          </div>
        ))}
      </div>

      <div className="border-t border-sidebar-border p-3">
        <div className={cn('flex items-center gap-3 rounded-xl bg-sidebar-hover/60 p-2.5', isCollapsed && 'justify-center bg-transparent p-0')}>
          <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full border border-white/10 bg-gradient-to-br from-sidebar-hover to-slate-800 font-label text-label-md font-semibold text-white">
            {initials(user?.email)}
          </div>
          {!isCollapsed && (
            <div className="flex min-w-0 flex-1 flex-col">
              <span className="truncate font-label text-label-md text-white">
                {user?.email?.split('@')[0] ?? 'Admin User'}
              </span>
              <span className="truncate font-label text-[10px] uppercase tracking-[0.14em] text-sidebar-muted">
                {role ? roleLabels[role] : 'Operator'}
              </span>
            </div>
          )}
          {!isCollapsed && onToggleCollapse && (
            <button
              onClick={onToggleCollapse}
              className="rounded-md p-1.5 text-sidebar-muted transition-colors hover:bg-sidebar-hover hover:text-white"
              aria-label="Collapse navigation"
              title="Collapse navigation"
            >
              <ChevronLeft className="h-4 w-4" />
            </button>
          )}
        </div>
        {isCollapsed && onToggleCollapse && (
          <button
            onClick={onToggleCollapse}
            className="mt-2 flex w-full items-center justify-center rounded-lg p-2 text-sidebar-muted transition-colors hover:bg-sidebar-hover hover:text-white"
            aria-label="Expand navigation"
            title="Expand navigation"
          >
            <ChevronLeft className="h-4 w-4 rotate-180" />
          </button>
        )}
      </div>
    </nav>
  )

  return (
    <>
      <div
        className={cn(
          'fixed inset-y-0 left-0 z-40 hidden transition-[width] duration-300 lg:block',
          isCollapsed ? 'w-[76px]' : 'w-[276px]'
        )}
      >
        {nav}
      </div>
      <div
        className={cn(
          'fixed inset-0 z-50 lg:hidden',
          open ? 'pointer-events-auto' : 'pointer-events-none'
        )}
        aria-hidden={!open}
      >
        <div
          onClick={onClose}
          className={cn(
            'absolute inset-0 bg-slate-950/50 backdrop-blur-sm transition-opacity duration-200',
            open ? 'opacity-100' : 'opacity-0'
          )}
        />
        <div
          className={cn(
            'absolute inset-y-0 left-0 transition-transform duration-300 ease-out',
            open ? 'translate-x-0' : '-translate-x-full'
          )}
        >
          {nav}
        </div>
      </div>
    </>
  )
}

export function useSidebarState() {
  const [open, setOpen] = useState(false)
  const [collapsed, setCollapsed] = useState(() => {
    try {
      return window.localStorage.getItem(COLLAPSE_KEY) === 'true'
    } catch {
      return false
    }
  })

  const toggleCollapse = () => {
    setCollapsed((current) => {
      const next = !current
      try {
        window.localStorage.setItem(COLLAPSE_KEY, String(next))
      } catch {
        // localStorage may be unavailable in private mode
      }
      return next
    })
  }

  const value = useMemo(
    () => ({
      open,
      collapsed,
      toggle: () => setOpen((current) => !current),
      close: () => setOpen(false),
      toggleCollapse,
    }),
    [open, collapsed]
  )

  return value
}
