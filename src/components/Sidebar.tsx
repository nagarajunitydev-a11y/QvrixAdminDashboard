import { useOrganization } from '@/hooks/useOrganization'
import { Link, useLocation } from 'react-router-dom'
import { useIsFetching, useQuery, useQueryClient } from '@tanstack/react-query'
import { useAuth } from '../api/AuthProvider'
import { refreshPageData } from '../hooks/useRouteDataRefresh'
import { navigation } from '@/lib/navigation'

import { Brand } from './Brand'
import { Button } from './ui/button'
import {
  Dialog,
  DialogContent,
  DialogTitle,
  DialogDescription,
} from './ui/dialog'
import {
  Bell,
  Search,
  RefreshCw,
  Menu,
  ChevronDown,
  ChevronRight,
  Building2,
  PanelLeftClose,
  PanelLeftOpen,
  LogOut,
  Settings2,
  X,
  ArrowUpRight,
} from 'lucide-react'
import { useEffect, useState } from 'react'

function initials(email?: string) {
  return email?.slice(0, 2).toUpperCase() || 'TC'
}

export function Navbar({ onToggleSidebar }: { onToggleSidebar: () => void }) {
  const { fetchSites, fetchEmployees } = useOrganization().services

  const { user, signOut } = useAuth()
  const { role, activeOrganization, isPlatformAdmin } = useOrganization()
  const location = useLocation()
  const queryClient = useQueryClient()
  const isRefreshing = useIsFetching() > 0
  const [searchOpen, setSearchOpen] = useState(false)
  const [search, setSearch] = useState('')
  const [signOutError, setSignOutError] = useState(false)
  const page = navigation.find((item) => item.to === location.pathname)
  const { data: employees = [] } = useQuery({
    queryKey: ['employees'],
    queryFn: fetchEmployees,
    enabled: searchOpen && !!activeOrganization,
  })
  const { data: sites = [] } = useQuery({
    queryKey: ['sites'],
    queryFn: fetchSites,
    enabled: searchOpen && !!activeOrganization,
  })
  const term = search.trim().toLowerCase()
  const results = navigation
    .filter(
      (item) =>
        (item.to !== '/organizations' || isPlatformAdmin) &&
        (role !== 'employee' ||
          ['/presence', '/entry-exit', '/location-logs', '/settings'].includes(
            item.to,
          )),
    )
    .filter((item) => item.label.toLowerCase().includes(term))
  const matchingEmployees = term
    ? employees
        .filter((e) =>
          `${e.first_name} ${e.last_name} ${e.email}`
            .toLowerCase()
            .includes(term),
        )
        .slice(0, 5)
    : []
  const matchingSites = term
    ? sites.filter((s) => s.name.toLowerCase().includes(term)).slice(0, 5)
    : []
  useEffect(() => {
    const handleKey = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key === 'k') {
        e.preventDefault()
        setSearchOpen((v) => !v)
      }
      if (e.key === 'Escape')
        document
          .querySelectorAll('details[open]')
          .forEach((el) => el.removeAttribute('open'))
    }
    document.addEventListener('keydown', handleKey)
    return () => document.removeEventListener('keydown', handleKey)
  }, [])
  return (
    <>
      <header className="topbar">
        <div className="flex min-w-0 items-center gap-3">
          <Button
            size="icon"
            variant="ghost"
            onClick={onToggleSidebar}
            aria-label="Open navigation"
            className="lg:hidden"
          >
            <Menu className="h-5 w-5" />
          </Button>
          <span className="hidden max-w-48 truncate text-xs text-muted-foreground sm:block">
            {activeOrganization?.branding.display_name ||
              activeOrganization?.name ||
              'Platform'}
          </span>
          <ChevronRight className="hidden h-3.5 w-3.5 text-muted-foreground sm:block" />
          <span className="truncate text-sm font-medium">
            {page?.label || 'Overview'}
          </span>
        </div>
        <div className="flex items-center gap-1.5 sm:gap-3">
          <button
            onClick={() => setSearchOpen(true)}
            className="search-trigger"
            aria-label="Search workspace"
          >
            <Search className="h-4 w-4" />
            <span className="hidden md:inline">Search anything…</span>
            <kbd className="ml-8 hidden rounded border bg-card px-1.5 py-0.5 text-[10px] md:inline">
              Ctrl K
            </kbd>
          </button>
          <Button
            size="icon"
            variant="ghost"
            aria-label="Refresh page data"
            onClick={() => refreshPageData(queryClient, location.pathname)}
            disabled={isRefreshing}
          >
            <RefreshCw
              className={`h-4 w-4 ${isRefreshing ? 'animate-spin' : ''}`}
            />
          </Button>
          <Link
            to="/alerts"
            className="icon-button"
            aria-label="Open notification center"
          >
            <Bell className="h-4 w-4" />
          </Link>
          <span className="mx-1 hidden h-6 w-px bg-border sm:block" />
          <details className="relative">
            <summary
              className="flex cursor-pointer list-none items-center gap-2 rounded-full"
              aria-label="Profile menu"
            >
              <span className="avatar">{initials(user?.email)}</span>
              <ChevronDown className="hidden h-3.5 w-3.5 text-muted-foreground sm:block" />
            </summary>
            <div className="popover-panel right-0">
              <p className="truncate text-sm font-medium">{user?.email}</p>
              <p className="mt-1 text-xs capitalize text-muted-foreground">
                {role}
              </p>
              <Link to="/settings" className="menu-action">
                <Settings2 className="h-4 w-4" />
                Account settings
              </Link>
              <button
                className="menu-action w-full text-destructive"
                onClick={async () => {
                  try {
                    await signOut()
                  } catch {
                    setSignOutError(true)
                  }
                }}
              >
                <LogOut className="h-4 w-4" />
                Sign out
              </button>
              {signOutError && (
                <p role="alert" className="text-xs text-destructive">
                  Couldn’t sign out. Please try again.
                </p>
              )}
            </div>
          </details>
        </div>
      </header>
      <Dialog open={searchOpen} onOpenChange={setSearchOpen}>
        <DialogContent>
          <DialogTitle>Search your workspace</DialogTitle>
          <DialogDescription>
            Find pages, employees, and sites.
          </DialogDescription>
          <div className="relative">
            <Search className="absolute left-3 top-3 h-4 w-4 text-muted-foreground" />
            <input
              autoFocus
              aria-label="Search pages, employees and sites"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Search by name…"
              className="h-11 w-full rounded-lg border bg-background pl-10 pr-4 text-sm"
            />
          </div>
          <div className="max-h-80 overflow-y-auto">
            {results.map((item) => (
              <Link
                key={item.to}
                onClick={() => setSearchOpen(false)}
                to={item.to}
                className="menu-action"
              >
                <item.icon className="h-4 w-4 text-muted-foreground" />
                {item.label}
                <ArrowUpRight className="ml-auto h-3 w-3 text-muted-foreground" />
              </Link>
            ))}
            {matchingEmployees.map((e) => (
              <Link
                key={e.id}
                to={`/employees?q=${encodeURIComponent(e.email)}`}
                onClick={() => setSearchOpen(false)}
                className="menu-action"
              >
                <span className="avatar h-7 w-7 text-[10px]">
                  {e.first_name[0]}
                  {e.last_name[0]}
                </span>
                {e.first_name} {e.last_name}
                <span className="ml-auto text-xs text-muted-foreground">
                  Employee
                </span>
              </Link>
            ))}
            {matchingSites.map((s) => (
              <Link
                key={s.id}
                to={`/sites?q=${encodeURIComponent(s.name)}`}
                onClick={() => setSearchOpen(false)}
                className="menu-action"
              >
                <Building2 className="h-4 w-4" />
                {s.name}
                <span className="ml-auto text-xs text-muted-foreground">
                  Site
                </span>
              </Link>
            ))}
            {results.length +
              matchingEmployees.length +
              matchingSites.length ===
              0 && (
              <p className="p-6 text-center text-sm text-muted-foreground">
                No matches. Try a different name.
              </p>
            )}
          </div>
          <Button variant="outline" onClick={() => setSearchOpen(false)}>
            Close search
          </Button>
        </DialogContent>
      </Dialog>
    </>
  )
}

export function Sidebar({
  open,
  onClose,
  collapsed,
  onCollapse,
}: {
  open: boolean
  onClose: () => void
  collapsed: boolean
  onCollapse: () => void
}) {
  const location = useLocation()
  const { user } = useAuth()
  const {
    role,
    activeOrganization,
    organizations,
    isPlatformAdmin,
    switching,
    switchOrganization,
  } = useOrganization()
  const [switchError, setSwitchError] = useState('')
  const queryClient = useQueryClient()
  const content = (compact: boolean) => (
    <nav aria-label="Main navigation" className="flex h-full flex-col">
      <Link
        to="/"
        onClick={onClose}
        className={`flex h-[92px] shrink-0 items-center ${compact ? 'justify-center' : 'px-6'}`}
        aria-label="Crewtraxa Console home"
      >
        <Brand compact={compact} />
      </Link>
      {!compact && (
        <div className="mx-4 mb-5">
          <label
            htmlFor="organization-switch"
            className="mb-2 block px-1 text-[9px] uppercase tracking-wider text-sidebar-muted"
          >
            Organization
          </label>
          <div className="workspace-switcher">
            <Building2 className="h-4 w-4 shrink-0" />
            <select
              id="organization-switch"
              aria-label="Switch organization"
              disabled={switching}
              value={activeOrganization?.id || ''}
              className="min-w-0 flex-1 bg-transparent text-xs text-white [&_option]:text-foreground"
              onChange={async (event) => {
                setSwitchError('')
                try {
                  await switchOrganization(event.target.value)
                  onClose()
                } catch (error) {
                  setSwitchError(
                    error instanceof Error
                      ? error.message
                      : 'Could not switch organization',
                  )
                }
              }}
            >
              <option value="" disabled>
                Select organization
              </option>
              {organizations
                .filter((org) => org.status === 'active')
                .map((org) => (
                  <option key={org.id} value={org.id}>
                    {org.name}
                  </option>
                ))}
            </select>
          </div>
          {switchError && (
            <p role="alert" className="mt-2 text-xs text-red-300">
              {switchError}
            </p>
          )}
        </div>
      )}
      <div className="min-h-0 flex-1 overflow-y-auto px-3 pb-4">
        {['Workspace', 'Operations', 'Administration'].map((group) => (
          <div key={group} className="mb-5">
            {!compact && (
              <p className="mb-2 px-3 text-[9px] font-semibold uppercase tracking-[.15em] text-sidebar-muted/80">
                {group}
              </p>
            )}
            {navigation
              .filter(
                (item) =>
                  item.group === group &&
                  (item.to !== '/organizations' || isPlatformAdmin) &&
                  (role !== 'employee' ||
                    [
                      '/presence',
                      '/entry-exit',
                      '/location-logs',
                      '/settings',
                    ].includes(item.to)) &&
                  (item.to !== '/audit' ||
                    ['platform_super_admin', 'organization_admin'].includes(
                      role || '',
                    )),
              )
              .map(({ to, label, icon: Icon }) => (
                <Link
                  key={to}
                  title={compact ? label : undefined}
                  aria-label={compact ? label : undefined}
                  aria-current={location.pathname === to ? 'page' : undefined}
                  to={to}
                  onClick={() => {
                    if (location.pathname === to)
                      refreshPageData(queryClient, to)
                    onClose()
                  }}
                  className={`nav-item ${location.pathname === to ? 'active' : ''} ${compact ? 'justify-center px-0' : ''}`}
                >
                  <Icon className="h-[17px] w-[17px] shrink-0" />
                  {!compact && (
                    <>
                      <span className="flex-1">{label}</span>
                      {to === '/live-tracking' && (
                        <span className="h-1.5 w-1.5 rounded-full bg-teal-400" />
                      )}
                    </>
                  )}
                </Link>
              ))}
          </div>
        ))}
      </div>
      <div
        className={`border-t border-white/[.07] p-4 ${compact ? 'px-2' : ''}`}
      >
        <Link
          to="/settings"
          title="Account settings"
          onClick={onClose}
          className="flex items-center justify-center gap-3 rounded-lg p-1"
        >
          <span className="avatar shrink-0 bg-teal-300/10 text-teal-200">
            {initials(user?.email)}
          </span>
          {!compact && (
            <>
              <span className="min-w-0 flex-1">
                <span className="block truncate text-xs font-medium">
                  {user?.email}
                </span>
                <span className="mt-1 block text-[10px] capitalize text-sidebar-muted">
                  {role} account
                </span>
              </span>
              <Settings2 className="h-4 w-4 text-sidebar-muted" />
            </>
          )}
        </Link>
      </div>
      <button
        onClick={onCollapse}
        aria-label={collapsed ? 'Expand sidebar' : 'Collapse sidebar'}
        className="hidden h-10 shrink-0 items-center justify-center gap-2 border-t border-white/[.07] text-sidebar-muted transition hover:text-white lg:flex"
      >
        {collapsed ? (
          <PanelLeftOpen className="h-4 w-4" />
        ) : (
          <>
            <PanelLeftClose className="h-3.5 w-3.5" />
            <span className="text-[10px]">Collapse navigation</span>
          </>
        )}
      </button>
    </nav>
  )
  return (
    <>
      <aside
        className={`sidebar hidden lg:block ${collapsed ? 'w-[76px]' : 'w-[260px]'}`}
      >
        {content(collapsed)}
      </aside>
      <Dialog
        open={open}
        onOpenChange={(value) => {
          if (!value) onClose()
        }}
      >
        <DialogContent className="mobile-nav">
          <DialogTitle className="sr-only">Navigation</DialogTitle>
          <DialogDescription className="sr-only">
            Crewtraxa Console workspace navigation.
          </DialogDescription>
          <button
            onClick={onClose}
            aria-label="Close navigation"
            className="absolute right-2 top-2 rounded p-2 text-white/60"
          >
            <X className="h-4 w-4" />
          </button>
          {content(false)}
        </DialogContent>
      </Dialog>
    </>
  )
}
