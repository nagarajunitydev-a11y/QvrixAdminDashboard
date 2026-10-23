import { useState } from 'react'
import { Link } from 'react-router-dom'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { supabase } from '@/api/supabase'
import { organizationRpc } from '@/api/organizations'
import { useOrganization } from '@/hooks/useOrganization'
import { useAuth } from '@/api/AuthProvider'
import { DataTable } from '@/components/ui/data-table'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Badge } from '@/components/ui/badge'
import type { Membership } from '@/types/organization'
import { PageSkeleton } from '@/components/PageState'
const roles = [
  'organization_admin',
  'manager',
  'supervisor',
  'employee',
] as const

export function OrganizationUsersPage() {
  const {
    activeOrganization,
    canAdminister,
    role,
    services,
    refreshOrganizations,
  } = useOrganization()
  const { user } = useAuth()
  const client = useQueryClient()
  const org = activeOrganization?.id || ''
  const [message, setMessage] = useState('')
  const [actionError, setActionError] = useState('')
  const [inviteUrl, setInviteUrl] = useState('')
  const [busy, setBusy] = useState(false)
  const members = useQuery({
    queryKey: ['organization-members'],
    enabled: canAdminister,
    queryFn: async () =>
      (await organizationRpc('list_organization_members', { org })) as Array<
        Membership & { email: string }
      >,
  })
  const sites = useQuery({
    queryKey: ['sites'],
    queryFn: services.fetchSites,
    enabled: canAdminister,
  })
  const scopes = useQuery({
    queryKey: ['organization-site-access'],
    enabled: canAdminister,
    queryFn: async () => {
      const { data, error } = await supabase
        .from('organization_site_access')
        .select('*')
        .eq('organization_id', org)
      if (error) throw error
      return data as Array<{ user_id: string; site_id: string }>
    },
  })
  const invitations = useQuery({
    queryKey: ['organization-invitations'],
    enabled: canAdminister,
    queryFn: async () => {
      const { data, error } = await supabase
        .from('organization_invitations')
        .select('id,email,role,expires_at,accepted_at,revoked_at')
        .eq('organization_id', org)
        .order('created_at', { ascending: false })
      if (error) throw error
      return data
    },
  })
  const action = async (operation: () => Promise<unknown>) => {
    setBusy(true)
    setMessage('')
    setActionError('')
    try {
      await operation()
      setMessage('Changes saved.')
      await client.invalidateQueries()
      await refreshOrganizations()
    } catch (error) {
      setActionError(
        error instanceof Error ? error.message : 'Changes could not be saved.',
      )
    } finally {
      setBusy(false)
    }
  }
  return (
    <div className="mx-auto max-w-7xl space-y-6">
      <div>
        <p className="eyebrow">{activeOrganization?.name}</p>
        <h1 className="page-heading mt-2">Users & roles</h1>
        <p className="page-subtitle">
          Your role: {role?.replaceAll('_', ' ')} · {user?.email}
        </p>
      </div>
      <p role="status" className="text-sm">
        {message}
      </p>
      {!canAdminister ? (
        <div className="card p-6">
          An organization administrator manages memberships, invitations, and
          permitted sites.
        </div>
      ) : (
        <>
          {actionError && <p role="alert" className="text-sm text-destructive">{actionError}</p>}
          {[members, sites, scopes, invitations].some(query => query.isError) && (
            <div role="alert" className="card space-y-3 p-4">
              <p>Membership data could not be loaded. Check your connection and organization permissions.</p>
              {[members, sites, scopes, invitations].filter(query => query.isError).map((query, index) => (
                <p key={index} className="text-sm text-destructive">{query.error?.message}</p>
              ))}
              <Button variant="outline" disabled={[members, sites, scopes, invitations].some(query => query.isFetching)} onClick={() => {
                for (const query of [members, sites, scopes, invitations]) if (query.isError) void query.refetch()
              }}>Retry membership data</Button>
            </div>
          )}
          <section className="card space-y-4 p-6">
            <h2 className="text-sm font-semibold">Assign an existing account</h2>
            <p className="text-xs text-muted-foreground">
              Enter the verified account UUID provided by your administrator. For new accounts, create an invitation below.
            </p>
            <form className="flex flex-wrap gap-3" onSubmit={event => {
              event.preventDefault()
              const form = new FormData(event.currentTarget)
              const element = event.currentTarget
              void action(async () => {
                await organizationRpc('manage_organization_member', {
                  org,
                  member: String(form.get('member')).trim(),
                  member_role: form.get('role'),
                  member_status: 'active',
                })
                element.reset()
              })
            }}>
              <Input name="member" aria-label="Existing account UUID" required
                pattern="[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}"
                placeholder="Account UUID" className="max-w-sm font-mono text-xs" />
              <select name="role" aria-label="Assigned member role" defaultValue="employee" className="rounded-lg border bg-card px-3 text-xs">
                {roles.map(role => <option key={role} value={role}>{role.replaceAll('_', ' ')}</option>)}
              </select>
              <Button disabled={busy}>Assign member</Button>
            </form>
          </section>
          <section className="card overflow-hidden">
            <div className="section-heading">
              <h2>Organization members</h2>
            </div>
            {members.isError ? <p className="p-6 text-sm">Members are unavailable until the access check succeeds.</p> : members.isPending ? (
              <PageSkeleton />
            ) : (
              <DataTable
                data={members.data || []}
                columns={[
                  { header: 'Email', accessor: 'email' },
                  {
                    header: 'UUID',
                    accessor: 'user_id',
                    className: 'text-xs font-mono',
                  },
                  {
                    header: 'Role',
                    accessor: (row) => (
                      <Badge variant="outline">
                        {row.role.replaceAll('_', ' ')}
                      </Badge>
                    ),
                  },
                  { header: 'Status', accessor: 'status' },
                  {
                    header: 'Actions',
                    accessor: (row) => (
                      <form
                        key={`${row.user_id}:${row.role}:${row.status}`}
                        className="flex flex-wrap gap-2"
                        onSubmit={(event) => {
                          event.preventDefault()
                          const form = new FormData(event.currentTarget)
                          void action(() =>
                            organizationRpc('manage_organization_member', {
                              org,
                              member: row.user_id,
                              member_role: form.get('role'),
                              member_status: form.get('status'),
                            }),
                          )
                        }}
                      >
                        <select
                          name="role"
                          aria-label={`Role for ${row.email}`}
                          defaultValue={row.role}
                          className="rounded border bg-card p-1 text-xs"
                        >
                          {roles.map((role) => (
                            <option key={role} value={role}>
                              {role.replaceAll('_', ' ')}
                            </option>
                          ))}
                        </select>
                        <select
                          name="status"
                          aria-label={`Membership status for ${row.email}`}
                          defaultValue={row.status}
                          className="rounded border bg-card p-1 text-xs"
                        >
                          <option value="active">Active</option>
                          <option value="suspended">Suspended</option>
                        </select>
                        <Button size="sm" disabled={busy}>
                          Save
                        </Button>
                      </form>
                    ),
                  },
                ]}
              />
            )}
          </section>
          <section className="card p-6">
            <h2 className="text-sm font-semibold">Invite a member</h2>
            <p className="mt-2 text-xs text-muted-foreground">
              Create a single-use link. The recipient must sign in with the
              invited, verified email address.
            </p>
            <form
              className="mt-4 flex flex-wrap gap-3"
              onSubmit={(event) => {
                event.preventDefault()
                const form = new FormData(event.currentTarget)
                void action(async () => {
                  const result = await organizationRpc(
                    'create_organization_invitation',
                    {
                      org,
                      invite_email: form.get('email'),
                      invite_role: form.get('role'),
                    },
                  )
                  setInviteUrl(
                    `${window.location.origin}/accept-invitation#token=${encodeURIComponent(result.token)}`,
                  )
                })
              }}
            >
              <Input
                className="max-w-xs"
                type="email"
                name="email"
                aria-label="Invitation email"
                required
                placeholder="member@company.com"
              />
              <select
                aria-label="Invited role"
                name="role"
                className="rounded-lg border bg-card px-3 text-xs"
              >
                {roles.map((role) => (
                  <option key={role} value={role}>
                    {role.replaceAll('_', ' ')}
                  </option>
                ))}
              </select>
              <Button disabled={busy}>Create invitation</Button>
            </form>
            {inviteUrl && (
              <label className="mt-4 block text-xs">
                Share this link securely. It is shown only after creation.
                <Input
                  aria-label="Invitation link"
                  readOnly
                  value={inviteUrl}
                  onFocus={(event) => event.currentTarget.select()}
                  className="mt-2"
                />
              </label>
            )}
          </section>
          <section className="card overflow-hidden">
            <div className="section-heading">
              <h2>Invitations</h2>
            </div>
            <DataTable
              data={invitations.data || []}
              columns={[
                { header: 'Email', accessor: 'email' },
                { header: 'Role', accessor: 'role' },
                {
                  header: 'Status',
                  accessor: (row) =>
                    row.revoked_at
                      ? 'Revoked'
                      : row.accepted_at
                        ? 'Accepted'
                        : new Date(row.expires_at) < new Date()
                          ? 'Expired'
                          : 'Pending',
                },
                {
                  header: 'Actions',
                  accessor: (row) => (
                    <Button
                      variant="ghost"
                      size="sm"
                      disabled={busy || !!row.accepted_at || !!row.revoked_at}
                      onClick={() =>
                        void action(() =>
                          organizationRpc('revoke_organization_invitation', {
                            invite: row.id,
                          }),
                        )
                      }
                    >
                      Revoke
                    </Button>
                  ),
                },
              ]}
            />
          </section>
          <section className="card p-6">
            <h2 className="text-sm font-semibold">Permitted sites</h2>
            <p className="mt-2 text-xs text-muted-foreground">
              Managers and supervisors only see employees and tracking within
              their permitted sites. Organization administrators can access the
              whole organization.
            </p>
            <form
              className="mt-4 flex flex-wrap gap-3"
              onSubmit={(event) => {
                event.preventDefault()
                const form = new FormData(event.currentTarget)
                void action(() =>
                  organizationRpc('set_organization_site_access', {
                    org,
                    member: form.get('member'),
                    site: form.get('site'),
                    enabled: form.get('action') === 'grant',
                  }),
                )
              }}
            >
              <select
                aria-label="Manager or supervisor"
                name="member"
                required
                className="max-w-full rounded-lg border bg-card p-2 text-xs"
              >
                <option value="">Select member</option>
                {members.data
                  ?.filter(
                    (m) =>
                      ['manager', 'supervisor'].includes(m.role) &&
                      m.status === 'active',
                  )
                  .map((m) => (
                    <option key={m.user_id} value={m.user_id}>
                      {m.email}
                    </option>
                  ))}
              </select>
              <select
                aria-label="Permitted site"
                name="site"
                required
                className="rounded-lg border bg-card p-2 text-xs"
              >
                <option value="">Select site</option>
                {sites.data?.map((site) => (
                  <option key={site.id} value={site.id}>
                    {site.name}
                  </option>
                ))}
              </select>
              <select
                aria-label="Site permission action"
                name="action"
                className="rounded-lg border bg-card p-2 text-xs"
              >
                <option value="grant">Grant access</option>
                <option value="revoke">Revoke access</option>
              </select>
              <Button disabled={busy}>Apply permission</Button>
            </form>
            <div className="mt-5">
              <DataTable
                data={(scopes.data || []).map((scope) => ({
                  ...scope,
                  email:
                    members.data?.find((m) => m.user_id === scope.user_id)
                      ?.email || scope.user_id,
                  site:
                    sites.data?.find((site) => site.id === scope.site_id)
                      ?.name || scope.site_id,
                }))}
                columns={[
                  { header: 'Member', accessor: 'email' },
                  { header: 'Permitted site', accessor: 'site' },
                ]}
              />
            </div>
          </section>
        </>
      )}
    </div>
  )
}

export function OrganizationSettingsPage() {
  const {
    activeOrganization: org,
    canAdminister,
    refreshOrganizations,
  } = useOrganization()
  const [timezone, setTimezone] = useState(org?.timezone || 'Asia/Kolkata')
  const [displayName, setDisplayName] = useState(
    org?.branding.display_name || '',
  )
  const [accent, setAccent] = useState(org?.branding.accent_color || '#0d8178')
  const [settings, setSettings] = useState(
    JSON.stringify(org?.settings || {}, null, 2),
  )
  const [density, setDensity] = useState(
    () => localStorage.getItem('trackora-density') || 'comfortable',
  )
  const [message, setMessage] = useState('')
  const [busy, setBusy] = useState(false)
  return (
    <div className="mx-auto max-w-3xl space-y-6">
      <div>
        <p className="eyebrow">{org?.name}</p>
        <h1 className="page-heading mt-2">Organization settings</h1>
        <p className="page-subtitle">{org?.id}</p>
      </div>
      <p role="status" className="text-sm">
        {message}
      </p>
      <form
        className="card space-y-4 p-6"
        onSubmit={async (event) => {
          event.preventDefault()
          setBusy(true)
          setMessage('')
          try {
            await organizationRpc('update_organization_settings', {
              org: org?.id,
              org_timezone: timezone,
              org_settings: JSON.parse(settings),
              org_branding: {
                ...org?.branding,
                display_name: displayName,
                accent_color: accent,
              },
            })
            await refreshOrganizations()
            setMessage('Organization settings saved.')
          } catch (error) {
            setMessage(
              error instanceof Error
                ? error.message
                : 'Could not save settings.',
            )
          } finally {
            setBusy(false)
          }
        }}
      >
        <h2 className="text-sm font-semibold">Configuration & branding</h2>
        <fieldset disabled={!canAdminister || busy} className="space-y-4">
          <label className="block space-y-2 text-xs">
            Time zone
            <Input
              required
              value={timezone}
              onChange={(e) => setTimezone(e.target.value)}
            />
          </label>
          <label className="block space-y-2 text-xs">
            Organization display name
            <Input
              maxLength={160}
              value={displayName}
              onChange={(e) => setDisplayName(e.target.value)}
            />
          </label>
          <label className="block space-y-2 text-xs">
            Accent color
            <input
              type="color"
              value={accent}
              onChange={(e) => setAccent(e.target.value)}
              className="block h-10 w-20 rounded border bg-card"
            />
          </label>
          <label className="block space-y-2 text-xs">
            Organization settings (JSON object)
            <textarea
              className="min-h-32 w-full rounded-lg border bg-background p-3 font-mono text-xs"
              value={settings}
              onChange={(e) => setSettings(e.target.value)}
            />
          </label>
          <Button>{busy ? 'Saving…' : 'Save organization settings'}</Button>
        </fieldset>
        {!canAdminister && (
          <p className="text-xs text-muted-foreground">
            An organization administrator can change these settings.
          </p>
        )}
      </form>
      <form
        className="card space-y-4 p-6"
        onSubmit={(event) => {
          event.preventDefault()
          localStorage.setItem('trackora-density', density)
          document.documentElement.dataset.density = density
          setMessage('Display preferences saved on this browser.')
        }}
      >
        <h2 className="text-sm font-semibold">Display preferences</h2>
        <label className="block space-y-2 text-xs">
          Table density
          <select
            className="block h-10 rounded-lg border bg-card px-3"
            value={density}
            onChange={(e) => setDensity(e.target.value)}
          >
            <option value="comfortable">Comfortable</option>
            <option value="compact">Compact</option>
          </select>
        </label>
        <Button>Save display preferences</Button>
      </form>
    </div>
  )
}

export function AcceptInvitationPage() {
  const { user, signOut } = useAuth()
  const [token, setToken] = useState(
    () =>
      new URLSearchParams(window.location.hash.slice(1)).get('token') ||
      sessionStorage.getItem('crewtraxa-pending-invitation') ||
      '',
  )
  const [message, setMessage] = useState('')
  const [busy, setBusy] = useState(false)
  return (
    <main className="mx-auto max-w-lg space-y-5 p-8">
      <h1 className="page-heading">Join Crewtraxa Workforce</h1>
      <p className="page-subtitle">Every Team. Every Site. In Sync.</p>
      <label className="block space-y-2 text-xs">
        Invitation token
        <Input
          aria-label="Invitation token"
          autoComplete="off"
          value={token}
          onChange={(e) => setToken(e.target.value)}
        />
      </label>
      {user ? (
        <>
          <p className="text-sm">
            Signed in as {user.email}. Your verified email must match the
            invitation.
          </p>
          <Button
            disabled={busy || !token}
            onClick={async () => {
              setBusy(true)
              try {
                await organizationRpc('accept_organization_invitation', {
                  token,
                })
                sessionStorage.removeItem('crewtraxa-pending-invitation')
                window.history.replaceState(null, '', '/accept-invitation')
                setToken('')
                setMessage(
                  'Invitation accepted. Open your workspace to choose the organization.',
                )
              } catch (error) {
                setMessage(
                  error instanceof Error
                    ? error.message
                    : 'Invitation could not be accepted.',
                )
              } finally {
                setBusy(false)
              }
            }}
          >
            Accept invitation
          </Button>
          <Button variant="outline" onClick={() => void signOut()}>
            Use a different account
          </Button>
          <Link to="/" className="block text-sm text-primary underline">
            Open workspace
          </Link>
        </>
      ) : (
        <>
          <Link
            to="/login"
            state={{ from: { pathname: '/accept-invitation' } }}
            onClick={() =>
              sessionStorage.setItem('crewtraxa-pending-invitation', token)
            }
            className="block text-primary underline"
          >
            Sign in to accept
          </Link>
          <form
            className="card space-y-4 p-5"
            onSubmit={async (event) => {
              event.preventDefault()
              setBusy(true)
              const form = new FormData(event.currentTarget)
              try {
                sessionStorage.setItem('crewtraxa-pending-invitation', token)
                const { error } = await supabase.auth.signUp({
                  email: String(form.get('email')),
                  password: String(form.get('password')),
                })
                if (error) throw error
                setMessage(
                  'Check your email to verify your account, then sign in and accept your invitation.',
                )
              } catch (error) {
                setMessage(
                  error instanceof Error
                    ? error.message
                    : 'Account could not be created.',
                )
              } finally {
                setBusy(false)
              }
            }}
          >
            <h2 className="text-sm font-semibold">Create your account</h2>
            <Input
              name="email"
              aria-label="Account email"
              type="email"
              required
              placeholder="Invited email"
            />
            <Input
              name="password"
              aria-label="Account password"
              type="password"
              autoComplete="new-password"
              minLength={12}
              required
              placeholder="Password (at least 12 characters)"
            />
            <Button disabled={busy}>Create account</Button>
          </form>
        </>
      )}
      <p role="status" className="text-sm">
        {message}
      </p>
    </main>
  )
}
