import { useState, type FormEvent } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { ShieldCheck, UserMinus, UserPlus } from 'lucide-react'
import { useAuth } from '@/api/AuthProvider'
import { useOrganization } from '@/api/OrganizationProvider'
import {
  deactivateOrganizationMember,
  fetchOrganizationMembers,
  setOrganizationMember,
} from '@/api/organizations'
import { Alert, AlertDescription } from '@/components/ui/alert'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { ErrorState, InlineSpinner } from '@/components/ui/states'
import { useToast } from '@/components/ui/toast'
import { roleLabels } from '@/lib/consoleAccess'
import { formatDateTime } from '@/lib/format'
import type { OrganizationMember } from '@/types/organizations'

const assignableRoles: Array<OrganizationMember['role']> = ['org_admin', 'manager', 'supervisor']

export function ConsoleTeamPanel() {
  const { user } = useAuth()
  const { isOrgAdmin } = useOrganization()
  const queryClient = useQueryClient()
  const { toast } = useToast()
  const [email, setEmail] = useState('')
  const [role, setRole] = useState<OrganizationMember['role']>('manager')

  const membersQuery = useQuery({ queryKey: ['organization-members'], queryFn: fetchOrganizationMembers })
  const refresh = () => queryClient.invalidateQueries({ queryKey: ['organization-members'] })

  const save = useMutation({
    mutationFn: (input: { email: string; role: OrganizationMember['role'] }) => setOrganizationMember(input.email, input.role),
    onSuccess: async (_, input) => {
      await refresh()
      setEmail('')
      toast({ title: 'Console role saved', description: `${input.email} is now ${roleLabels[input.role].toLowerCase()}.` })
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
    if (email.trim()) save.mutate({ email: email.trim(), role })
  }

  const members = membersQuery.data ?? []
  const error = save.error ?? remove.error

  return (
    <section className="surface-panel overflow-hidden">
      <div className="flex items-start justify-between gap-3 border-b border-border/70 p-4">
        <div>
          <h2 className="flex items-center gap-2 font-headline text-headline-sm text-foreground">
            <ShieldCheck className="h-4 w-4 text-primary" /> Console team
          </h2>
          <p className="mt-0.5 text-[11px] text-muted-foreground">
            Who can open the Console for this organization. Roles are enforced by the database.
          </p>
        </div>
        {membersQuery.isFetching && <InlineSpinner />}
      </div>

      {isOrgAdmin && (
        <form onSubmit={submit} className="flex flex-col gap-2 border-b border-border/70 p-4 sm:flex-row">
          <Input
            type="email"
            value={email}
            onChange={(event) => setEmail(event.target.value)}
            placeholder="Confirmed account email"
            aria-label="Account email"
            className="h-9 sm:flex-1"
          />
          <select
            value={role}
            onChange={(event) => setRole(event.target.value as OrganizationMember['role'])}
            aria-label="Console role"
            className="h-9 rounded-md border border-input bg-card px-2.5 text-body-sm text-foreground"
          >
            {assignableRoles.map((option) => <option key={option} value={option}>{roleLabels[option]}</option>)}
          </select>
          <Button type="submit" size="sm" className="h-9 gap-2" disabled={!email.trim() || save.isPending}>
            <UserPlus className="h-4 w-4" />
            {save.isPending ? 'Saving...' : 'Grant role'}
          </Button>
        </form>
      )}

      {error && (
        <Alert variant="destructive" className="m-4">
          <AlertDescription>{error.message}</AlertDescription>
        </Alert>
      )}

      {membersQuery.isError ? (
        <ErrorState className="m-4" description="Console members could not be loaded." onRetry={() => membersQuery.refetch()} />
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
                <Badge variant={member.is_active ? (member.role === 'org_admin' ? 'success' : 'info') : 'secondary'}>
                  {member.is_active ? roleLabels[member.role] : 'Removed'}
                </Badge>
                {isOrgAdmin && member.is_active && member.user_id !== user?.id && (
                  <Button
                    size="icon"
                    variant="ghost"
                    title={`Remove Console access for ${member.email}`}
                    className="h-8 w-8 hover:text-destructive"
                    disabled={remove.isPending}
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
