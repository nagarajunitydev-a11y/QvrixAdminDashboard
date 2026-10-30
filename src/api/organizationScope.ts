// The organization every Console query is scoped to. RLS is the security boundary;
// this scope keeps a platform admin's view to one organization at a time.
let currentOrganization: string | null = null

export function setCurrentOrganizationId(id: string | null) {
  currentOrganization = id
}

export function currentOrganizationId(): string {
  if (!currentOrganization) throw new Error('Select an organization to continue.')
  return currentOrganization
}
