import { useQuery } from '@tanstack/react-query'
import { fetchOnboardingCounts } from '@/api/services'
import { fetchOrganizationInvitations, fetchOrganizationMembers } from '@/api/organizations'
import { useOrganization } from '@/api/OrganizationProvider'
import { onboardingStatus } from '@/lib/onboarding'

export function useOnboardingStatus() {
  const { isOrgAdmin } = useOrganization()
  const countsQuery = useQuery({ queryKey: ['onboarding-counts'], queryFn: fetchOnboardingCounts })
  // Only organization admins can list the Console team, so only they see the team step.
  const teamQuery = useQuery({
    queryKey: ['onboarding-team'],
    queryFn: async () => {
      const [members, invitations] = await Promise.all([fetchOrganizationMembers(), fetchOrganizationInvitations()])
      return members.filter((member) => member.is_active).length + invitations.length
    },
    enabled: isOrgAdmin,
  })

  const teamSize = isOrgAdmin ? teamQuery.data ?? null : null
  const waitingForTeam = isOrgAdmin && teamQuery.isLoading
  return {
    status: countsQuery.data && !waitingForTeam ? onboardingStatus(countsQuery.data, teamSize) : null,
    isLoading: countsQuery.isLoading || waitingForTeam,
    isError: countsQuery.isError,
    refetch: () => {
      void countsQuery.refetch()
      if (isOrgAdmin) void teamQuery.refetch()
    },
  }
}
