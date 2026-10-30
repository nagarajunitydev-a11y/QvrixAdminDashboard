import { useMutation, useQueryClient } from '@tanstack/react-query'
import { Check, MailPlus, X } from 'lucide-react'
import { useOrganization } from '@/api/OrganizationProvider'
import { respondToConsoleInvitation } from '@/api/organizations'
import { Button } from '@/components/ui/button'
import { useToast } from '@/components/ui/toast'
import { roleLabels, type ConsoleInvitation } from '@/lib/consoleAccess'
import { formatDateTime } from '@/lib/format'
import { cn } from '@/lib/utils'

/**
 * Open Console-role invitations for the signed-in account. Membership starts only when the
 * account holder accepts here; an organization cannot add someone on its own.
 */
export function ConsoleInvitations({ className }: { className?: string }) {
  const { invitations } = useOrganization()
  const queryClient = useQueryClient()
  const { toast } = useToast()

  const respond = useMutation({
    mutationFn: (input: { invitation: ConsoleInvitation; accept: boolean }) =>
      respondToConsoleInvitation(input.invitation.id, input.accept),
    onSuccess: async (_, { invitation, accept }) => {
      await queryClient.invalidateQueries({ queryKey: ['console-access'] })
      toast(accept
        ? { title: `Joined ${invitation.organization_name}`, description: `Your role is ${roleLabels[invitation.role].toLowerCase()}. Switch organizations from the sidebar.` }
        : { title: 'Invitation declined', description: invitation.organization_name })
    },
    onError: (error) => toast({ title: 'Invitation not updated', description: error.message, variant: 'error' }),
  })

  if (!invitations.length) return null

  return (
    <section className={cn('surface-panel overflow-hidden', className)} aria-label="Console invitations">
      <div className="flex items-center gap-2 border-b border-border/70 px-4 py-3">
        <MailPlus className="h-4 w-4 text-primary" />
        <h2 className="font-headline text-headline-sm text-foreground">
          {invitations.length === 1 ? 'You have an invitation' : `You have ${invitations.length} invitations`}
        </h2>
      </div>
      <ul className="divide-y divide-border/60">
        {invitations.map((invitation) => (
          <li key={invitation.id} className="flex flex-col gap-2 px-4 py-3 sm:flex-row sm:items-center sm:justify-between">
            <div className="min-w-0">
              <p className="truncate font-label text-label-md text-foreground">
                {invitation.organization_name} · {roleLabels[invitation.role]}
              </p>
              <p className="text-[11px] text-muted-foreground">Expires {formatDateTime(invitation.expires_at)}</p>
            </div>
            <div className="flex shrink-0 gap-2">
              <Button
                size="sm"
                variant="outline"
                className="gap-1"
                disabled={respond.isPending}
                onClick={() => respond.mutate({ invitation, accept: false })}
              >
                <X className="h-3.5 w-3.5" /> Decline
              </Button>
              <Button
                size="sm"
                className="gap-1"
                disabled={respond.isPending}
                onClick={() => respond.mutate({ invitation, accept: true })}
              >
                <Check className="h-3.5 w-3.5" /> Accept
              </Button>
            </div>
          </li>
        ))}
      </ul>
    </section>
  )
}
