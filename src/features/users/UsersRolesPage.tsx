import { useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import { useQuery } from '@tanstack/react-query'
import { fetchEmployeeSites, fetchEmployees } from '@/api/services'
import { useAuth } from '@/api/AuthProvider'
import { PageHeader } from '@/components/ui/page-header'
import { StatCard } from '@/components/ui/stat-card'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { ErrorState, PageSkeleton } from '@/components/ui/states'
import { formatDateTime, initialsFromName } from '@/lib/format'
import {
  ArrowRight,
  Check,
  KeyRound,
  Link2,
  Search,
  ShieldCheck,
  Smartphone,
  UserCog,
  UserX,
  Users,
} from 'lucide-react'
import { cn } from '@/lib/utils'

type AccountFilter = 'all' | 'linked' | 'unlinked' | 'active'

const consolePermissions = [
  'Open the manager console',
  'Manage employees and assignments',
  'Create and edit sites and geofences',
  'Review attendance and location history',
  'Export reports and audit logs',
  'Manage authentication roles',
]

const fieldPermissions = [
  'Sign in to the Crewtraxa mobile app',
  'Send GPS pings while checked in',
  'Create automatic entry and exit sessions',
  'View their own attendance history',
]

export function UsersRolesPage() {
  const { user, role } = useAuth()
  const [filter, setFilter] = useState<AccountFilter>('all')
  const [search, setSearch] = useState('')

  const employeesQuery = useQuery({ queryKey: ['employees'], queryFn: fetchEmployees })
  const assignmentsQuery = useQuery({ queryKey: ['employee-sites'], queryFn: () => fetchEmployeeSites() })

  const employees = employeesQuery.data ?? []
  const assignments = assignmentsQuery.data ?? []

  const sitesByEmployee = useMemo(() => {
    const map = new Map<string, string[]>()
    assignments.forEach((assignment) => {
      const list = map.get(assignment.employee_id) ?? []
      list.push(assignment.sites?.name ?? 'Unknown site')
      map.set(assignment.employee_id, list)
    })
    return map
  }, [assignments])

  const linked = employees.filter((employee) => employee.user_id)
  const unlinked = employees.filter((employee) => !employee.user_id)
  const active = employees.filter((employee) => employee.is_active)

  const visible = useMemo(() => {
    const query = search.trim().toLowerCase()
    return employees
      .filter((employee) => {
        if (filter === 'linked') return Boolean(employee.user_id)
        if (filter === 'unlinked') return !employee.user_id
        if (filter === 'active') return employee.is_active
        return true
      })
      .filter((employee) => {
        if (!query) return true
        return `${employee.first_name} ${employee.last_name} ${employee.email}`
          .toLowerCase()
          .includes(query)
      })
      .sort((a, b) => a.first_name.localeCompare(b.first_name))
  }, [employees, filter, search])

  const isLoading = employeesQuery.isLoading || assignmentsQuery.isLoading
  const isError = employeesQuery.isError || assignmentsQuery.isError

  if (isLoading) return <PageSkeleton cards={4} rows={6} />

  if (isError) {
    return (
      <div className="page-shell">
        <PageHeader
          title="Users & Roles"
          description="Workforce accounts, linking status, and console access."
          icon={UserCog}
        />
        <ErrorState
          description="Account data could not be loaded from Supabase."
          onRetry={() => {
            employeesQuery.refetch()
            assignmentsQuery.refetch()
          }}
        />
      </div>
    )
  }

  return (
    <div className="page-shell">
      <PageHeader
        eyebrow="Administration"
        title="Users & Roles"
        description="Review workforce accounts, mobile app linkage, and the console access model."
        icon={UserCog}
        actions={
          <Button asChild variant="outline" className="gap-2">
            <Link to="/employees">
              <Users className="h-4 w-4" />
              Manage employees
            </Link>
          </Button>
        }
      />

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <StatCard
          label="Workforce accounts"
          value={employees.length}
          hint={`${active.length} active employees`}
          icon={Users}
          tone="teal"
        />
        <StatCard
          label="Linked devices"
          value={linked.length}
          hint="Employees with an app account"
          icon={Smartphone}
          tone="sky"
        />
        <StatCard
          label="Not linked"
          value={unlinked.length}
          hint="Cannot send location or attendance data"
          icon={UserX}
          tone={unlinked.length > 0 ? 'amber' : 'emerald'}
        />
        <StatCard
          label="Console managers"
          value={role === 'manager' ? 1 : 0}
          hint="Manager role is assigned in Supabase Auth"
          icon={ShieldCheck}
          tone="emerald"
        />
      </div>

      <div className="grid grid-cols-1 gap-4 xl:grid-cols-[minmax(0,1fr)_340px]">
        <section className="surface-panel overflow-hidden">
          <div className="flex flex-col gap-3 border-b border-border/70 p-4 sm:flex-row sm:items-center sm:justify-between">
            <div className="flex flex-wrap gap-1">
              {(
                [
                  ['all', 'All', employees.length],
                  ['active', 'Active', active.length],
                  ['linked', 'Linked', linked.length],
                  ['unlinked', 'Not linked', unlinked.length],
                ] as const
              ).map(([value, label, count]) => (
                <button
                  key={value}
                  onClick={() => setFilter(value)}
                  className={cn(
                    'inline-flex items-center gap-1.5 rounded-full px-3 py-1.5 font-label text-[11px] transition-colors',
                    filter === value
                      ? 'bg-primary text-primary-foreground'
                      : 'bg-muted text-muted-foreground hover:text-foreground'
                  )}
                >
                  {label}
                  <span
                    className={cn(
                      'rounded-full px-1.5 text-[9px] tabular-nums',
                      filter === value ? 'bg-white/20' : 'bg-card'
                    )}
                  >
                    {count}
                  </span>
                </button>
              ))}
            </div>
            <div className="relative sm:w-60">
              <Search className="pointer-events-none absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground" />
              <Input
                value={search}
                onChange={(event) => setSearch(event.target.value)}
                placeholder="Search people or email…"
                className="h-8 pl-8 text-body-sm"
                aria-label="Search workforce accounts"
              />
            </div>
          </div>

          <div className="overflow-x-auto">
            <table className="w-full border-collapse text-left">
              <thead>
                <tr className="border-b border-border/70 bg-muted/40">
                  <th className="px-4 py-2.5 font-label text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
                    Team member
                  </th>
                  <th className="px-4 py-2.5 font-label text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
                    Account
                  </th>
                  <th className="hidden px-4 py-2.5 font-label text-[10px] font-semibold uppercase tracking-wider text-muted-foreground md:table-cell">
                    Department
                  </th>
                  <th className="hidden px-4 py-2.5 font-label text-[10px] font-semibold uppercase tracking-wider text-muted-foreground lg:table-cell">
                    Sites
                  </th>
                  <th className="px-4 py-2.5 font-label text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
                    Status
                  </th>
                  <th className="px-4 py-2.5 text-right font-label text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
                    Action
                  </th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border/60">
                {visible.map((employee) => {
                  const employeeSites = sitesByEmployee.get(employee.id) ?? []
                  return (
                    <tr key={employee.id} className="row-hover">
                      <td className="px-4 py-3">
                        <div className="flex items-center gap-2.5">
                          <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-primary/10 font-label text-[11px] font-semibold text-primary">
                            {initialsFromName(`${employee.first_name} ${employee.last_name}`)}
                          </span>
                          <div className="min-w-0">
                            <p className="truncate font-label text-label-md text-foreground">
                              {employee.first_name} {employee.last_name}
                            </p>
                            <p className="truncate text-[10px] text-muted-foreground">
                              {employee.designations?.name ?? 'No designation'}
                            </p>
                          </div>
                        </div>
                      </td>
                      <td className="px-4 py-3">
                        <p className="max-w-[200px] truncate text-body-sm text-muted-foreground">
                          {employee.email}
                        </p>
                        <span className="mt-0.5 inline-flex items-center gap-1 text-[10px] text-muted-foreground">
                          {employee.user_id ? (
                            <>
                              <Link2 className="h-3 w-3 text-emerald-500" /> App account linked
                            </>
                          ) : (
                            <>
                              <UserX className="h-3 w-3 text-amber-500" /> No app account
                            </>
                          )}
                        </span>
                      </td>
                      <td className="hidden max-w-[160px] truncate px-4 py-3 text-body-sm text-muted-foreground md:table-cell">
                        {employee.departments?.name ?? 'Unassigned'}
                      </td>
                      <td className="hidden px-4 py-3 lg:table-cell">
                        {employeeSites.length === 0 ? (
                          <span className="text-[11px] text-muted-foreground">None</span>
                        ) : (
                          <span className="text-[11px] text-muted-foreground">
                            {employeeSites.slice(0, 2).join(', ')}
                            {employeeSites.length > 2 ? ` +${employeeSites.length - 2}` : ''}
                          </span>
                        )}
                      </td>
                      <td className="px-4 py-3">
                        <Badge variant={employee.is_active ? 'success' : 'secondary'} dot>
                          {employee.is_active ? 'Active' : 'Inactive'}
                        </Badge>
                      </td>
                      <td className="px-4 py-3 text-right">
                        <Link
                          to={`/employees?q=${encodeURIComponent(employee.email)}`}
                          className="inline-flex items-center gap-1 text-[11px] font-medium text-primary hover:underline"
                        >
                          Manage <ArrowRight className="h-3 w-3" />
                        </Link>
                      </td>
                    </tr>
                  )
                })}
                {visible.length === 0 && (
                  <tr>
                    <td colSpan={6} className="px-4 py-10 text-center text-body-sm text-muted-foreground">
                      No accounts match this view.
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>

          <div className="border-t border-border/70 px-4 py-2.5 text-[10px] text-muted-foreground">
            Account linkage comes from the employee record&apos;s Supabase user ID. New auth users
            are managed in Supabase. Users can reset their password from the sign-in page.
          </div>
        </section>

        <aside className="space-y-4">
          <div className="surface-panel p-4">
            <div className="flex items-start justify-between gap-2">
              <div>
                <p className="font-label text-[10px] uppercase tracking-[0.16em] text-primary">
                  Current session
                </p>
                <h2 className="mt-0.5 font-headline text-headline-sm text-foreground">
                  {user?.email ?? 'Signed in manager'}
                </h2>
              </div>
              <span className="flex h-9 w-9 items-center justify-center rounded-lg bg-emerald-500/10 text-emerald-600 ring-1 ring-inset ring-emerald-500/15 dark:text-emerald-400">
                <KeyRound className="h-4 w-4" />
              </span>
            </div>
            <div className="mt-3 space-y-2 text-body-sm">
              <div className="flex items-center justify-between gap-2">
                <span className="text-muted-foreground">Console role</span>
                <Badge variant="success" dot>
                  {role ?? 'Unknown'}
                </Badge>
              </div>
              <div className="flex items-center justify-between gap-2">
                <span className="text-muted-foreground">Last sign in</span>
                <span className="text-[11px] text-foreground">
                  {formatDateTime(user?.last_sign_in_at)}
                </span>
              </div>
              <div className="flex items-center justify-between gap-2">
                <span className="text-muted-foreground">Account ID</span>
                <span className="max-w-[150px] truncate font-mono text-[10px] text-foreground">
                  {user?.id ?? '—'}
                </span>
              </div>
            </div>
          </div>

          <div className="surface-panel p-4">
            <h2 className="flex items-center gap-2 font-headline text-headline-sm text-foreground">
              <ShieldCheck className="h-4 w-4 text-primary" /> Access model
            </h2>
            <p className="mt-1 text-[11px] text-muted-foreground">
              Console access is restricted to the <span className="font-medium text-foreground">manager</span>{' '}
              role in Supabase Auth.
            </p>
            <div className="mt-3 rounded-lg border border-border/70 bg-muted/25 p-3">
              <div className="mb-2 flex items-center gap-2">
                <Badge variant="success">Manager</Badge>
                <span className="text-[10px] text-muted-foreground">Console</span>
              </div>
              <ul className="space-y-1.5">
                {consolePermissions.map((permission) => (
                  <li key={permission} className="flex items-start gap-2 text-[11px] text-muted-foreground">
                    <Check className="mt-0.5 h-3 w-3 shrink-0 text-emerald-500" />
                    {permission}
                  </li>
                ))}
              </ul>
            </div>
            <div className="mt-2 rounded-lg border border-border/70 bg-muted/25 p-3">
              <div className="mb-2 flex items-center gap-2">
                <Badge variant="info">Employee</Badge>
                <span className="text-[10px] text-muted-foreground">Mobile app</span>
              </div>
              <ul className="space-y-1.5">
                {fieldPermissions.map((permission) => (
                  <li key={permission} className="flex items-start gap-2 text-[11px] text-muted-foreground">
                    <Check className="mt-0.5 h-3 w-3 shrink-0 text-sky-500" />
                    {permission}
                  </li>
                ))}
              </ul>
            </div>
          </div>
        </aside>
      </div>

      <div className="flex flex-col gap-2 rounded-xl border border-border/70 bg-muted/30 px-4 py-3 text-[11px] text-muted-foreground sm:flex-row sm:items-center sm:justify-between">
        <p className="flex items-start gap-2">
          <UserCog className="mt-0.5 h-3.5 w-3.5 shrink-0 text-primary" />
          Role assignment and invitations are handled in Supabase Auth. This console does not modify
          authentication records.
        </p>
        <Link to="/audit" className="inline-flex shrink-0 items-center gap-1 font-medium text-primary hover:underline">
          Review audit trail <ArrowRight className="h-3 w-3" />
        </Link>
      </div>
    </div>
  )
}
