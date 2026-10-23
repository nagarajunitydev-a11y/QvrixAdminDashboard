export class OrganizationAccessError extends Error {
  code: string
  status: number
  operation: string
  constructor(message: string, code: string, status: number, operation: string) {
    super(message)
    this.name = 'OrganizationAccessError'
    this.code = code
    this.status = status
    this.operation = operation
  }
}

export function describeOrganizationAccessError(error: Error) {
  const code = error instanceof OrganizationAccessError ? error.code : ''
  const status = error instanceof OrganizationAccessError ? error.status : 0
  if (['PGRST205', 'PGRST202', '42P01', '42883'].includes(code))
    return {
      title: 'Organization setup required',
      description: 'The connected database is missing an organization table or function from its API schema. An administrator must verify the organization migration and refresh the schema cache. Retry after setup is complete.',
    }
  if (status === 401 || ['PGRST301', 'PGRST303'].includes(code))
    return {
      title: 'Session could not be verified',
      description: 'Your session may have expired. Retry to check your session again, or sign out and sign in again. If this continues, an administrator should check the project authentication configuration.',
    }
  if (status === 403 || code === '42501')
    return {
      title: 'Organization permission required',
      description: 'The server denied this access check. Ask your organization administrator to verify your active membership and permissions, then retry.',
    }
  return {
    title: 'Organization access unavailable',
    description: 'The organization access check could not complete. Check your connection and retry. If the problem continues, contact your administrator.',
  }
}
