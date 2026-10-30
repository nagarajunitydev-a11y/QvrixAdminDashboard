import { useMemo, useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import {
  Ban,
  Check,
  History,
  RotateCcw,
  ShieldAlert,
  Smartphone,
  UserCheck,
  Wifi,
  X,
} from 'lucide-react'
import { fetchEmployees } from '@/api/services'
import {
  assignDevice,
  fetchDeviceHistory,
  fetchDevices,
  fetchUnlinkedAccounts,
  reviewDeviceReassignment,
  setDeviceStatus,
} from '@/api/organizations'
import { useOrganization } from '@/api/OrganizationProvider'
import { PageHeader } from '@/components/ui/page-header'
import { StatCard } from '@/components/ui/stat-card'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { EmptyState, ErrorState, InlineSpinner, PageSkeleton } from '@/components/ui/states'
import { useToast } from '@/components/ui/toast'
import { deviceHolderLabel, unlinkedAccountLabel } from '@/lib/consoleAccess'
import { formatDateTime, timeAgo } from '@/lib/format'
import type { Device, DeviceAssignment, DeviceEvent } from '@/types/organizations'

const statusBadge: Record<Device['status'], { label: string; variant: 'success' | 'warning' | 'destructive' }> = {
  active: { label: 'Active', variant: 'success' },
  pending_review: { label: 'Needs review', variant: 'warning' },
  revoked: { label: 'Revoked', variant: 'destructive' },
}

const trackingLabels: Record<NonNullable<Device['tracking_status']>, string> = {
  tracking: 'Tracking',
  idle: 'Idle',
  permission_denied: 'Location permission off',
  location_disabled: 'Location services off',
  unknown: 'Unknown',
}

const eventLabels: Record<DeviceEvent['event_type'], string> = {
  registered: 'Registered',
  reinstalled: 'App reinstalled on this phone',
  unlinked_account: 'Signed in by an account with no employee profile',
  account_mismatch: 'Another account signed in',
  multiple_devices: 'Account also active on another phone',
  reassignment_approved: 'Account change approved',
  reassignment_rejected: 'Account change rejected',
  assigned: 'Assigned by a manager',
  revoked: 'Revoked',
  reactivated: 'Reactivated',
}

const methodLabels: Record<DeviceAssignment['method'], string> = {
  self_registration: 'Signed in on the app',
  admin_approval: 'Approved by a manager',
  admin_assignment: 'Assigned by a manager',
}

function deviceName(device: Device) {
  const model = [device.manufacturer, device.model].filter(Boolean).join(' ') || 'Unknown model'
  return device.os_version ? `${model} · Android ${device.os_version}` : model
}

/** A device counts as live only while it checked in recently and reports active tracking. */
function isLive(device: Device, now: number) {
  return device.tracking_status === 'tracking' && device.last_seen_at !== null && now - Date.parse(device.last_seen_at) < 15 * 60_000
}

export function DevicesPage() {
  const { canManage } = useOrganization()
  const queryClient = useQueryClient()
  const { toast } = useToast()
  const [selected, setSelected] = useState<Device | null>(null)
  const [assignTo, setAssignTo] = useState('')

  const devicesQuery = useQuery({ queryKey: ['devices'], queryFn: fetchDevices, refetchInterval: 30_000 })
  const employeesQuery = useQuery({ queryKey: ['employees'], queryFn: fetchEmployees })
  const unlinkedQuery = useQuery({ queryKey: ['unlinked-accounts'], queryFn: fetchUnlinkedAccounts })
  const historyQuery = useQuery({
    queryKey: ['device-history', selected?.id],
    queryFn: () => fetchDeviceHistory(selected!.id),
    enabled: Boolean(selected),
  })

  const devices = useMemo(() => devicesQuery.data ?? [], [devicesQuery.data])
  const employees = useMemo(() => employeesQuery.data ?? [], [employeesQuery.data])
  const names = useMemo(() => {
    const byEmployee = new Map<string, string>()
    const byUser = new Map<string, string>()
    for (const employee of employees) {
      const name = `${employee.first_name} ${employee.last_name}`.trim()
      byEmployee.set(employee.id, name)
      if (employee.user_id) byUser.set(employee.user_id, name)
    }
    const unlinked = new Map((unlinkedQuery.data ?? []).map((account) => [account.user_id, account.email ?? '']))
    return { byEmployee, byUser, unlinked }
  }, [employees, unlinkedQuery.data])
  const accountLabel = (userId: string | null) =>
    !userId ? 'No account' : names.byUser.get(userId) ?? unlinkedAccountLabel(names.unlinked.get(userId))

  // Freshness is judged against when this list was fetched, not the render time.
  const now = devicesQuery.dataUpdatedAt
  const pending = devices.filter((device) => device.pending_user_id)

  const refresh = () => Promise.all([
    queryClient.invalidateQueries({ queryKey: ['devices'] }),
    queryClient.invalidateQueries({ queryKey: ['device-history'] }),
  ])
  const onError = (error: Error) => toast({ title: 'Device not updated', description: error.message, variant: 'error' })
  const review = useMutation({
    mutationFn: (input: { device: Device; approve: boolean }) => reviewDeviceReassignment(input.device.id, input.approve),
    onSuccess: async (_, input) => {
      await refresh()
      toast({ title: input.approve ? 'Account change approved' : 'Account change rejected' })
    },
    onError,
  })
  const status = useMutation({
    mutationFn: (input: { device: Device; status: 'active' | 'revoked' }) => setDeviceStatus(input.device.id, input.status),
    onSuccess: async (_, input) => {
      await refresh()
      setSelected(null)
      toast({ title: input.status === 'revoked' ? 'Device revoked' : 'Device reactivated' })
    },
    onError,
  })
  const assign = useMutation({
    mutationFn: (input: { device: Device; employeeId: string }) => assignDevice(input.device.id, input.employeeId),
    onSuccess: async () => {
      await refresh()
      setAssignTo('')
      setSelected(null)
      toast({ title: 'Device assigned' })
    },
    onError,
  })
  const busy = review.isPending || status.isPending || assign.isPending

  if (devicesQuery.isLoading || employeesQuery.isLoading) return <PageSkeleton cards={4} rows={5} />

  const header = (
    <PageHeader
      eyebrow="Administration"
      title="Devices"
      description="Phones registered by Crewtraxa Employee, who verifiably holds each one, and account changes awaiting review."
      icon={Smartphone}
    />
  )

  if (devicesQuery.isError || employeesQuery.isError) {
    return (
      <div className="page-shell">
        {header}
        <ErrorState
          description="Devices could not be loaded from Supabase."
          onRetry={() => {
            devicesQuery.refetch()
            employeesQuery.refetch()
          }}
        />
      </div>
    )
  }

  const linkedEmployees = employees.filter((employee) => employee.user_id && employee.is_active)

  return (
    <div className="page-shell">
      {header}

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <StatCard label="Registered devices" value={devices.length} hint="Phones that signed in to the app" icon={Smartphone} tone="teal" />
        <StatCard
          label="Needs review"
          value={devices.filter((device) => device.status === 'pending_review').length}
          hint="Account changes or unlinked accounts"
          icon={ShieldAlert}
          tone={pending.length ? 'amber' : 'emerald'}
        />
        <StatCard
          label="Tracking now"
          value={devices.filter((device) => isLive(device, now)).length}
          hint="Reported tracking in the last 15 minutes"
          icon={Wifi}
          tone="sky"
        />
        <StatCard label="Revoked" value={devices.filter((device) => device.status === 'revoked').length} hint="Blocked by a manager" icon={Ban} tone="slate" />
      </div>

      {pending.length > 0 && (
        <section className="surface-panel overflow-hidden">
          <div className="border-b border-border/70 p-4">
            <h2 className="font-headline text-headline-sm text-foreground">Account changes to review</h2>
            <p className="mt-0.5 text-[11px] text-muted-foreground">
              A different account signed in on these phones. Their attendance is still recorded under the account that
              signed in; approving only changes who the phone belongs to.
            </p>
          </div>
          <ul className="divide-y divide-border/60">
            {pending.map((device) => (
              <li key={device.id} className="flex flex-col gap-3 px-4 py-3 sm:flex-row sm:items-center sm:justify-between">
                <div className="min-w-0 text-body-sm">
                  <p className="truncate font-label text-label-md text-foreground">{deviceName(device)}</p>
                  <p className="text-[11px] text-muted-foreground">
                    Held by <span className="text-foreground">{accountLabel(device.user_id)}</span> · now signed in as{' '}
                    <span className="text-foreground">{accountLabel(device.pending_user_id)}</span>
                  </p>
                </div>
                {canManage && (
                  <div className="flex shrink-0 gap-2">
                    <Button size="sm" variant="outline" className="gap-1" disabled={busy} onClick={() => review.mutate({ device, approve: false })}>
                      <X className="h-3.5 w-3.5" /> Keep current holder
                    </Button>
                    <Button size="sm" className="gap-1" disabled={busy} onClick={() => review.mutate({ device, approve: true })}>
                      <Check className="h-3.5 w-3.5" /> Approve change
                    </Button>
                  </div>
                )}
              </li>
            ))}
          </ul>
        </section>
      )}

      <section className="surface-panel overflow-hidden">
        {devices.length === 0 ? (
          <EmptyState
            className="m-4"
            icon={Smartphone}
            title="No devices registered yet"
            description="Phones appear here after an employee signs in on a Crewtraxa Employee version with device registration."
          />
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full border-collapse text-left">
              <thead>
                <tr className="border-b border-border/70 bg-muted/40 font-label text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
                  <th className="px-4 py-2.5">Holder</th>
                  <th className="px-4 py-2.5">Device</th>
                  <th className="hidden px-4 py-2.5 md:table-cell">App</th>
                  <th className="hidden px-4 py-2.5 lg:table-cell">Tracking</th>
                  <th className="px-4 py-2.5">Last seen</th>
                  <th className="px-4 py-2.5">Status</th>
                  <th className="px-4 py-2.5 text-right">Details</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border/60">
                {devices.map((device) => {
                  const holder = deviceHolderLabel(device, names.byEmployee, names.unlinked)
                  const badge = statusBadge[device.status]
                  return (
                    <tr key={device.id} className="row-hover">
                      <td className="px-4 py-3">
                        <p className={holder.verified ? 'font-label text-label-md text-foreground' : 'text-body-sm text-amber-600 dark:text-amber-400'}>
                          {holder.label}
                        </p>
                      </td>
                      <td className="px-4 py-3 text-body-sm text-muted-foreground">{deviceName(device)}</td>
                      <td className="hidden px-4 py-3 text-body-sm text-muted-foreground md:table-cell">{device.app_version ?? '—'}</td>
                      <td className="hidden px-4 py-3 lg:table-cell">
                        <span className="text-[11px] text-muted-foreground">
                          {device.tracking_status ? trackingLabels[device.tracking_status] : 'Not reported'}
                        </span>
                      </td>
                      <td className="px-4 py-3 text-[11px] text-muted-foreground" title={formatDateTime(device.last_seen_at)}>
                        {device.last_seen_at ? timeAgo(Date.parse(device.last_seen_at)) : 'Never'}
                      </td>
                      <td className="px-4 py-3"><Badge variant={badge.variant} dot>{badge.label}</Badge></td>
                      <td className="px-4 py-3 text-right">
                        <Button size="sm" variant="ghost" className="gap-1" onClick={() => { setAssignTo(''); setSelected(device) }}>
                          <History className="h-3.5 w-3.5" /> History
                        </Button>
                      </td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
        )}
        <div className="border-t border-border/70 px-4 py-2.5 text-[10px] text-muted-foreground">
          Attendance and locations are always attributed to the signed-in account, never to the phone. Device
          records describe the hardware and its verified holder.
        </div>
      </section>

      <Dialog open={Boolean(selected)} onOpenChange={(open) => !open && setSelected(null)}>
        <DialogContent className="max-w-2xl">
          {selected && (
            <>
              <DialogHeader>
                <DialogTitle>{deviceName(selected)}</DialogTitle>
                <DialogDescription>
                  Registered {formatDateTime(selected.registered_at)} · app {selected.app_version ?? 'version unknown'}
                </DialogDescription>
              </DialogHeader>

              {historyQuery.isLoading ? (
                <div className="flex justify-center py-8"><InlineSpinner /></div>
              ) : historyQuery.isError ? (
                <ErrorState description="Device history could not be loaded." onRetry={() => historyQuery.refetch()} />
              ) : (
                <div className="grid max-h-[50vh] grid-cols-1 gap-4 overflow-y-auto sm:grid-cols-2">
                  <div>
                    <h3 className="mb-2 font-label text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">Holders</h3>
                    <ol className="space-y-2">
                      {historyQuery.data?.assignments.map((assignment) => (
                        <li key={assignment.id} className="rounded-lg border border-border/70 p-2.5 text-[11px]">
                          <p className="font-label text-label-md text-foreground">{accountLabel(assignment.user_id)}</p>
                          <p className="text-muted-foreground">{methodLabels[assignment.method]}</p>
                          <p className="text-muted-foreground">
                            {formatDateTime(assignment.assigned_at)} → {assignment.ended_at ? formatDateTime(assignment.ended_at) : 'current'}
                          </p>
                        </li>
                      ))}
                    </ol>
                  </div>
                  <div>
                    <h3 className="mb-2 font-label text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">Events</h3>
                    <ol className="space-y-2">
                      {historyQuery.data?.events.map((event) => (
                        <li key={event.id} className="border-l-2 border-primary/30 pl-2.5 text-[11px]">
                          <p className="text-foreground">{eventLabels[event.event_type]}</p>
                          <p className="text-muted-foreground">{accountLabel(event.user_id)} · {formatDateTime(event.created_at)}</p>
                        </li>
                      ))}
                      {historyQuery.data?.events.length === 0 && <li className="text-[11px] text-muted-foreground">No events.</li>}
                    </ol>
                  </div>
                </div>
              )}

              {canManage && (
                <DialogFooter className="flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
                  {selected.status === 'revoked' ? (
                    <Button variant="outline" className="gap-1" disabled={busy} onClick={() => status.mutate({ device: selected, status: 'active' })}>
                      <RotateCcw className="h-3.5 w-3.5" /> Reactivate
                    </Button>
                  ) : (
                    <>
                      <div className="flex w-full gap-2 sm:w-auto">
                        <select
                          value={assignTo}
                          onChange={(event) => setAssignTo(event.target.value)}
                          aria-label="Assign to employee"
                          className="h-9 min-w-0 flex-1 rounded-md border border-input bg-card px-2.5 text-body-sm text-foreground"
                        >
                          <option value="">Assign to employee…</option>
                          {linkedEmployees.map((employee) => (
                            <option key={employee.id} value={employee.id}>{employee.first_name} {employee.last_name}</option>
                          ))}
                        </select>
                        <Button
                          variant="outline"
                          className="gap-1"
                          disabled={!assignTo || busy}
                          onClick={() => assign.mutate({ device: selected, employeeId: assignTo })}
                        >
                          <UserCheck className="h-3.5 w-3.5" /> Assign
                        </Button>
                      </div>
                      <Button
                        variant="destructive"
                        className="gap-1"
                        disabled={busy}
                        onClick={() => {
                          if (confirm('Revoke this device? It keeps its history and holder until a manager reactivates it.')) {
                            status.mutate({ device: selected, status: 'revoked' })
                          }
                        }}
                      >
                        <Ban className="h-3.5 w-3.5" /> Revoke
                      </Button>
                    </>
                  )}
                </DialogFooter>
              )}
            </>
          )}
        </DialogContent>
      </Dialog>
    </div>
  )
}
