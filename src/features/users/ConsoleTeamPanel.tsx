import { useState, type FormEvent } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { MailPlus, ShieldCheck, UserMinus, XCircle } from 'lucide-react'
import { useAuth } from '@/api/AuthProvider'
import { useOrganization } from '@/api/OrganizationProvider'
import {
  deactivateOrganizationMember,
  fetchOrganizationInvitations,
  fetchOrganizationMembers,
  inviteOrganizationMember,
  revokeOrganizationInvitation,
  setOrganizationMemberRole,
} from '@/api/organizations'
import { Alert, AlertDescription } from '@/components/ui/alert'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { ErrorState, InlineSpinner } from '@/components/ui/states'
import { useToast } from '@/components/ui/toast'
import { roleLabels } from '@/lib/consoleAccess'
import { formatDateTime } from '@/lib/format'
import type { OrganizationInvitation, OrganizationMember } from '@/types/organizations'

const assignableRoles: Array<OrganizationMember['role']> = ['org_admin', 'manager', 'supervisor']

function RoleSelect({ value, onChange, label, disabled }: {
  value: OrganizationMember['role']
  onChange: (role: OrganizationMember['role']) => void
  label: string
  disabled?: boolean
}) {
  return (
    <select
      value={value}
      onChange={(event) => onChange(event.target.value as OrganizationMember['role'])}
      aria-label={label}
      disabled={disabled}
      className="h-8 rounded-md border border-input bg-card px-2 text-[11px] text-foreground"
    >
      {assignableRoles.map((option) => <option key={option} value={option}>{roleLabels[option]}</option>)}
    </select>
  )
}

export function ConsoleTeamPanel() {
  const { user } = useAuth()
  const { isOrgAdmin } = useOrganization()
  const queryClient = useQueryClient()
  const { toast } = useToast()
  const [email, setEmail] = useState('')
  const [role, setRole] = useState<OrganizationMember['role']>('manager')

  const membersQuery = useQuery({ queryKey: ['organization-members'], queryFn: fetchOrganizationMembers })
  const invitationsQuery = useQuery({ queryKey: ['organization-invitations'], queryFn: fetchOrganizationInvitations })
  const refresh = () => Promise.all([
    queryClient.invalidateQueries({ queryKey: ['organization-members'] }),
    queryClient.invalidateQueries({ queryKey: ['organization-invitations'] }),
  ])

  const invite = useMutation({
    mutationFn: (input: { email: string; role: OrganizationMember['role'] }) => inviteOrganizationMember(input.email, input.role),
    onSuccess: async (_, input) => {
      await refresh()
      setEmail('')
      // Same message for every address: whether it has an account is never revealed.
      toast({ title: 'Invitation saved', description: `${input.email} gets ${roleLabels[input.role].toLowerCase()} access after signing in and accepting.` })
    },
  })
  const revoke = useMutation({
    mutationFn: (invitation: OrganizationInvitation) => revokeOrganizationInvitation(invitation.id),
    onSuccess: async (_, invitation) => {
      await refresh()
      toast({ title: 'Invitation revoked', description: invitation.email })
    },
  })
  const changeRole = useMutation({
    mutationFn: (input: { member: OrganizationMember; role: OrganizationMember['role'] }) => setOrganizationMemberRole(input.member.user_id, input.role),
    onSuccess: async (_, input) => {
      await refresh()
      toast({ title: 'Role changed', description: `${input.member.email} is now ${roleLabels[input.role].toLowerCase()}.` })
    },
  })
  const remove = useMutation({
    mutationFn: (member: OrganizationMember) => deactivateOrganizationMember(member.user_id),
    onSuccess: async (_, member) => {
      await refresh()
      toast({ title: 'Console access removed', description: member.email })
    },
  })

  const submit = (event: FormEvent) => {
    event.preventDefault()
    if (email.trim()) invite.mutate({ email: email.trim(), role })
  }

  const members = membersQuery.data ?? []
  const invitations = invitationsQuery.data ?? []
  const error = invite.error ?? revoke.error ?? changeRole.error ?? remove.error
  const busy = invite.isPending || revoke.isPending || changeRole.isPending || remove.isPending

  return (
    <section className="surface-panel overflow-hidden">
      <div className="flex items-start justify-between gap-3 border-b border-border/70 p-4">
        <div>
          <h2 className="flex items-center gap-2 font-headline text-headline-sm text-foreground">
            <ShieldCheck className="h-4 w-4 text-primary" /> Console team
          </h2>
          <p className="mt-0.5 text-[11px] text-muted-foreground">
            People join by accepting an invitation after signing in. Roles are enforced by the database.
          </p>
        </div>
        {(membersQuery.isFetching || invitationsQuery.isFetching) && <InlineSpinner />}
      </div>

      {isOrgAdmin && (
        <form onSubmit={submit} className="flex flex-col gap-2 border-b border-border/70 p-4 sm:flex-row">
          <Input
            type="email"
            value={email}
            onChange={(event) => setEmail(event.target.value)}
            placeholder="Email to invite"
            aria-label="Email to invite"
            className="h-9 sm:flex-1"
          />
          <select
            value={role}
            onChange={(event) => setRole(event.target.value as OrganizationMember['role'])}
            aria-label="Role to offer"
            className="h-9 rounded-md border border-input bg-card px-2.5 text-body-sm text-foreground"
          >
            {assignableRoles.map((option) => <option key={option} value={option}>{roleLabels[option]}</option>)}
          </select>
          <Button type="submit" size="sm" className="h-9 gap-2" disabled={!email.trim() || busy}>
            <MailPlus className="h-4 w-4" />
            {invite.isPending ? 'Saving...' : 'Invite'}
          </Button>
        </form>
      )}

      {error && (
        <Alert variant="destructive" className="m-4">
          <AlertDescription>{error.message}</AlertDescription>
        </Alert>
      )}

      {invitations.length > 0 && (
        <div className="border-b border-border/70">
          <p className="px-4 pt-3 font-label text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
            Waiting for acceptance
          </p>
          <ul className="divide-y divide-border/60">
            {invitations.map((invitation) => {
              const expired = Date.parse(invitation.expires_at) <= invitationsQuery.dataUpdatedAt
              return (
                <li key={invitation.id} className="flex items-center justify-between gap-3 px-4 py-2.5">
                  <div className="min-w-0">
                    <p className="truncate font-label text-label-md text-foreground">{invitation.email}</p>
                    <p className="text-[10px] text-muted-foreground">
                      {expired ? 'Expired' : `Expires ${formatDateTime(invitation.expires_at)}`} · invite again to renew
                    </p>
                  </div>
                  <div className="flex shrink-0 items-center gap-2">
                    <Badge variant={expired ? 'secondary' : 'warning'}>{roleLabels[invitation.role]}</Badge>
                    {isOrgAdmin && (
                      <Button
                        size="icon"
                        variant="ghost"
                        title={`Revoke the invitation for ${invitation.email}`}
                        className="h-8 w-8 hover:text-destructive"
                        disabled={busy}
                        onClick={() => revoke.mutate(invitation)}
                      >
                        <XCircle className="h-4 w-4" />
                      </Button>
                    )}
                  </div>
                </li>
              )
            })}
          </ul>
        </div>
      )}

      {membersQuery.isError || invitationsQuery.isError ? (
        <ErrorState
          className="m-4"
          description="Console members could not be loaded."
          onRetry={() => {
            membersQuery.refetch()
            invitationsQuery.refetch()
          }}
        />
      ) : (
        <ul className="divide-y divide-border/60">
          {members.map((member) => (
            <li key={member.user_id} className="flex items-center justify-between gap-3 px-4 py-2.5">
              <div className="min-w-0">
                <p className="truncate font-label text-label-md text-foreground">{member.email}</p>
                <p className="text-[10px] text-muted-foreground">
                  Last sign in {member.last_sign_in_at ? formatDateTime(member.last_sign_in_at) : 'never'}
                </p>
              </div>
              <div className="flex shrink-0 items-center gap-2">
                {isOrgAdmin && member.is_active ? (
                  <RoleSelect
                    value={member.role}
                    label={`Role for ${member.email}`}
                    disabled={busy}
                    onChange={(next) => {
                      if (next !== member.role) changeRole.mutate({ member, role: next })
                    }}
                  />
                ) : (
                  <Badge variant={member.is_active ? (member.role === 'org_admin' ? 'success' : 'info') : 'secondary'}>
                    {member.is_active ? roleLabels[member.role] : 'Removed'}
                  </Badge>
                )}
                {isOrgAdmin && member.is_active && member.user_id !== user?.id && (
                  <Button
                    size="icon"
                    variant="ghost"
                    title={`Remove Console access for ${member.email}`}
                    className="h-8 w-8 hover:text-destructive"
                    disabled={busy}
                    onClick={() => {
                      if (confirm(`Remove Console access for ${member.email}? Their history is kept.`)) remove.mutate(member)
                    }}
                  >
                    <UserMinus className="h-4 w-4" />
                  </Button>
                )}
              </div>
            </li>
          ))}
          {!membersQuery.isLoading && members.length === 0 && (
            <li className="px-4 py-6 text-center text-body-sm text-muted-foreground">No Console members yet.</li>
          )}
        </ul>
      )}
    </section>
  )
}
