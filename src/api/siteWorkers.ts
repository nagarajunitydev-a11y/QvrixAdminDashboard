import { supabase } from './supabase'
import { currentOrganizationId } from './organizationScope'
import type { EmployeeWithRelations } from './services'
import type { EmployeeSite, Site } from '../types'

export interface SiteWorkerDirectory {
  employees: EmployeeWithRelations[]
  sites: Site[]
  assignments: EmployeeSite[]
}

// Read every visible row using the signed-in client's existing RLS permissions.
// Stable ordering prevents page boundaries from duplicating or skipping rows.
async function readAllRows<T>(
  page: (start: number, end: number) => PromiseLike<{ data: T[] | null; error: unknown }>,
): Promise<T[]> {
  const rows: T[] = []
  const pageSize = 500
  for (let start = 0; ; ) {
    const { data, error } = await page(start, start + pageSize - 1)
    if (error) throw error
    if (!data?.length) return rows
    rows.push(...data)
    // Advance by what the server returned, including when its row cap is lower
    // than our requested page size. An empty page confirms completion.
    start += data.length
  }
}

export async function fetchSiteWorkerDirectory(): Promise<SiteWorkerDirectory> {
  const organizationId = currentOrganizationId()
  const [employees, sites, assignments] = await Promise.all([
    readAllRows<EmployeeWithRelations>((start, end) => supabase.from('employees')
      .select('*, departments(name), designations(name), shifts(name)')
      .eq('organization_id', organizationId).order('id').range(start, end)),
    readAllRows<Site>((start, end) => supabase.from('sites')
      .select('*').eq('organization_id', organizationId).order('id').range(start, end)),
    readAllRows<EmployeeSite>((start, end) => supabase.from('employee_sites')
      .select('*').eq('organization_id', organizationId).order('employee_id').order('site_id').range(start, end)),
  ])
  return { employees, sites, assignments }
}
