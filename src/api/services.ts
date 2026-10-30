import { supabase } from './supabase'
import { mutationError } from './mutationErrors'
import { currentOrganizationId } from './organizationScope'
import type {
  Site,
  SiteInsert,
  LocationLog,
  PresenceSession,
  Department,
  DepartmentInsert,
  DepartmentUpdate,
  Designation,
  DesignationInsert,
  DesignationUpdate,
  Shift,
  ShiftInsert,
  ShiftUpdate,
  Employee,
  EmployeeInsert,
  EmployeeUpdate,
  EmployeeSite,
  EmployeeSiteInsert,
  AuditLog,
} from '../types'

export type EmployeeWithRelations = Employee & {
  departments: Pick<Department, 'name'> | null
  designations: Pick<Designation, 'name'> | null
  shifts: Pick<Shift, 'name'> | null
}

export type ShiftWithDepartment = Shift & {
  departments: Pick<Department, 'name'> | null
}

export type EmployeeSiteWithSite = EmployeeSite & {
  sites: Pick<Site, 'id' | 'name'>
}

const from = (table: string) => supabase.from(table)

async function deleteRecord(table: string, id: string, label: string): Promise<void> {
  const { data, error } = await from(table).delete().eq('id', id).select('id')
  if (error) throw mutationError(error, `delete this ${label}`)
  if (!data?.length) {
    throw new Error(`The ${label} was not deleted. It may have already been removed, or your account does not have permission to delete it. Refresh to check the current record.`)
  }
}

// Sites
export async function fetchSites(): Promise<Site[]> {
  const { data, error } = await from('sites').select('*').eq('organization_id', currentOrganizationId())
  if (error) throw error
  return data
}

export async function createSite(payload: SiteInsert): Promise<Site> {
  const { data, error } = await from('sites').insert({ ...payload, organization_id: currentOrganizationId() }).select().single()
  if (error) throw mutationError(error, 'create this site')
  return data
}

type SiteFields = Pick<Site, 'name' | 'latitude' | 'longitude' | 'radius_in_meters'>

export async function updateSite(id: string, payload: SiteFields, original: Site): Promise<Site> {
  if (id !== original.id) throw new Error('The selected site does not match the record being edited. Reopen the site before saving.')
  // Compare the values read when editing began: updated_at has no update trigger.
  const { data, error } = await from('sites')
    .update({
      name: payload.name,
      latitude: payload.latitude,
      longitude: payload.longitude,
      radius_in_meters: payload.radius_in_meters,
    })
    .eq('id', id)
    .eq('name', original.name)
    .eq('latitude', original.latitude)
    .eq('longitude', original.longitude)
    .eq('radius_in_meters', original.radius_in_meters)
    .select()
    .maybeSingle()
  if (error) throw mutationError(error, 'update this site')
  if (!data) {
    throw new Error('This site changed, was removed, or you no longer have permission to edit it. Refresh and reopen the site before saving. Your changes have not been applied.')
  }
  return data
}

async function fetchSiteDeleteBlockers(id: string): Promise<string[]> {
  const references = [
    ['employee_sites', 'employee assignments'],
    ['location_logs', 'location history'],
    ['presence_sessions', 'attendance sessions'],
    ['site_visits', 'site visits'],
  ] as const
  return (await Promise.all(references.map(async ([table, label]) => {
    const { count, error } = await from(table).select('*', { count: 'exact', head: true }).eq('site_id', id)
    if (error) throw mutationError(error, 'check whether this site can be deleted')
    return count ? label : null
  }))).filter((label): label is NonNullable<typeof label> => label !== null)
}

export async function deleteSite(id: string): Promise<void> {
  const blockers = await fetchSiteDeleteBlockers(id)
  if (blockers.length) {
    throw new Error(`This site cannot be deleted because it is linked to ${blockers.join(', ')}. Keep the site to preserve its history and links. Employee assignments can be reviewed in the site panel.`)
  }
  // The foreign keys remain authoritative if a new reference appears after the check.
  await deleteRecord('sites', id, 'site')
}

// Location Logs
export async function fetchLocationLogs(params?: {
  userId?: string
  siteId?: string
  startDate?: number
  endDate?: number
  limit?: number
  offset?: number
}): Promise<LocationLog[]> {
  let query = from('location_logs').select('*').eq('organization_id', currentOrganizationId())
  if (params?.userId) query = query.eq('user_id', params.userId)
  if (params?.siteId) query = query.eq('site_id', params.siteId)
  if (params?.startDate) query = query.gte('timestamp', params.startDate)
  if (params?.endDate) query = query.lte('timestamp', params.endDate)
  query = query.order('timestamp', { ascending: false })
  if (params?.limit || params?.offset) {
    const start = params?.offset ?? 0
    const end = params?.limit ? start + params.limit - 1 : start + 10_000
    query = query.range(start, end)
  }
  const { data, error } = await query
  if (error) throw error
  return data
}

// Presence Sessions
export async function fetchPresenceSessions(params?: {
  userId?: string
  siteId?: string
  startDate?: string
  endDate?: string
}): Promise<Array<PresenceSession & { sites: Pick<Site, 'name' | 'latitude' | 'longitude'> | null }>> {
  let query = from('presence_sessions').select('*, sites(name,latitude,longitude)')
    .eq('organization_id', currentOrganizationId())
  if (params?.userId) query = query.eq('user_id', params.userId)
  if (params?.siteId) query = query.eq('site_id', params.siteId)
  if (params?.startDate) query = query.gte('created_at', params.startDate)
  if (params?.endDate) query = query.lte('created_at', params.endDate)
  query = query.order('entry_timestamp', { ascending: false })
  const { data, error } = await query
  if (error) throw error
  return data
}

// Departments
export async function fetchDepartments(): Promise<Department[]> {
  const { data, error } = await from('departments').select('*')
    .eq('organization_id', currentOrganizationId()).order('name')
  if (error) throw error
  return data
}

export async function createDepartment(payload: DepartmentInsert): Promise<Department> {
  const { data, error } = await from('departments').insert({ ...payload, organization_id: currentOrganizationId() }).select().single()
  if (error) throw error
  return data
}

export async function updateDepartment(id: string, payload: DepartmentUpdate): Promise<Department> {
  const { data, error } = await from('departments')
    .update(payload)
    .eq('id', id)
    .select()
    .single()
  if (error) throw error
  return data
}

export async function deleteDepartment(id: string): Promise<void> {
  await deleteRecord('departments', id, 'department')
}

// Designations
export async function fetchDesignations(): Promise<Designation[]> {
  const { data, error } = await from('designations').select('*')
    .eq('organization_id', currentOrganizationId()).order('name')
  if (error) throw error
  return data
}

export async function createDesignation(payload: DesignationInsert): Promise<Designation> {
  const { data, error } = await from('designations').insert({ ...payload, organization_id: currentOrganizationId() }).select().single()
  if (error) throw error
  return data
}

export async function updateDesignation(id: string, payload: DesignationUpdate): Promise<Designation> {
  const { data, error } = await from('designations')
    .update(payload)
    .eq('id', id)
    .select()
    .single()
  if (error) throw error
  return data
}

export async function deleteDesignation(id: string): Promise<void> {
  await deleteRecord('designations', id, 'designation')
}

// Shifts
export async function fetchShifts(): Promise<ShiftWithDepartment[]> {
  const { data, error } = await from('shifts')
    .select('*, departments(name)')
    .eq('organization_id', currentOrganizationId())
    .order('name')
  if (error) throw error
  return data
}

export async function createShift(payload: ShiftInsert): Promise<Shift> {
  const { data, error } = await from('shifts').insert({ ...payload, organization_id: currentOrganizationId() }).select().single()
  if (error) throw error
  return data
}

export async function updateShift(id: string, payload: ShiftUpdate): Promise<Shift> {
  const { data, error } = await from('shifts')
    .update(payload)
    .eq('id', id)
    .select()
    .single()
  if (error) throw error
  return data
}

export async function deleteShift(id: string): Promise<void> {
  await deleteRecord('shifts', id, 'shift')
}

// Employees
export async function fetchEmployees(): Promise<EmployeeWithRelations[]> {
  const { data, error } = await from('employees')
    .select('*, departments(name), designations(name), shifts(name)')
    .eq('organization_id', currentOrganizationId())
    .order('last_name')
  if (error) throw error
  return data
}

export async function fetchEmployee(id: string): Promise<EmployeeWithRelations> {
  const { data, error } = await from('employees')
    .select('*, departments(name), designations(name), shifts(name)')
    .eq('id', id)
    .single()
  if (error) throw error
  return data
}

export async function createEmployee(payload: EmployeeInsert): Promise<Employee> {
  const { data, error } = await from('employees').insert({ ...payload, organization_id: currentOrganizationId() }).select().single()
  if (error) throw error
  return data
}

export async function updateEmployee(id: string, payload: EmployeeUpdate): Promise<Employee> {
  const { data, error } = await from('employees')
    .update(payload)
    .eq('id', id)
    .select()
    .single()
  if (error) throw error
  return data
}

// Employees are never deleted: their attendance and location history stays attached. Archiving makes
// the profile inactive (ending app access) and is reversible; the server stamps who and when.
export async function archiveEmployees(ids: string[]): Promise<number> {
  const { data, error } = await from('employees')
    .update({ archived_at: new Date().toISOString() })
    .in('id', ids)
    .is('archived_at', null)
    .select('id')
  if (error) throw mutationError(error, 'archive employees')
  return data.length
}

export async function restoreEmployees(ids: string[]): Promise<number> {
  const { data, error } = await from('employees')
    .update({ archived_at: null, is_active: true })
    .in('id', ids)
    .not('archived_at', 'is', null)
    .select('id')
  if (error) throw mutationError(error, 'restore employees')
  return data.length
}

/** One statement, so a bulk change applies to every selected employee or to none. */
export async function updateEmployees(ids: string[], payload: EmployeeUpdate): Promise<number> {
  const { data, error } = await from('employees').update(payload).in('id', ids).select('id')
  if (error) throw mutationError(error, 'update employees')
  if (data.length !== ids.length) {
    throw new Error(`Updated ${data.length} of ${ids.length} employees. Refresh to see the current records.`)
  }
  return data.length
}

export async function assignEmployeesToSite(employeeIds: string[], siteId: string): Promise<number> {
  const { data, error } = await from('employee_sites')
    .upsert(
      employeeIds.map((employee_id) => ({ employee_id, site_id: siteId, organization_id: currentOrganizationId() })),
      { onConflict: 'employee_id,site_id', ignoreDuplicates: true },
    )
    .select('employee_id')
  if (error) throw mutationError(error, 'assign employees to this site')
  return data.length
}

export interface EmployeeImportRow {
  first_name: string
  last_name: string
  email: string
  phone: string | null
  employee_code: string | null
  employment_type: string | null
  department: string | null
  designation: string | null
  shift_id: string | null
  hire_date: string | null
}

/**
 * Creates the departments and designations the file names but the organization lacks, then inserts
 * every employee in a single request, so the employees are imported all together or not at all.
 */
export async function importEmployees(rows: EmployeeImportRow[], newDepartments: string[], newDesignations: string[]): Promise<number> {
  const organization_id = currentOrganizationId()
  const createNamed = async (table: 'departments' | 'designations', names: string[]) => {
    if (names.length) {
      const { error } = await from(table).insert(names.map((name) => ({ name, organization_id })))
      if (error) throw mutationError(error, `create ${table}`)
    }
    const { data, error } = await from(table).select('id, name').eq('organization_id', organization_id)
    if (error) throw error
    return new Map((data as Array<{ id: string; name: string }>).map((row) => [row.name.trim().toLowerCase(), row.id]))
  }
  const departmentIds = await createNamed('departments', newDepartments)
  const designationIds = await createNamed('designations', newDesignations)
  const lookup = (ids: Map<string, string>, name: string | null) => {
    if (!name) return null
    const id = ids.get(name.trim().toLowerCase())
    if (!id) throw new Error(`"${name}" could not be found after creating it. Refresh and try the import again.`)
    return id
  }

  const { data, error } = await from('employees')
    .insert(rows.map(({ department, designation, ...row }) => ({
      ...row,
      organization_id,
      is_active: true,
      department_id: lookup(departmentIds, department),
      designation_id: lookup(designationIds, designation),
    })))
    .select('id')
  if (error) throw mutationError(error, 'import these employees')
  return data.length
}

export interface OnboardingCounts {
  sites: number
  departments: number
  shifts: number
  employees: number
  assignments: number
  linkedEmployees: number
}

export async function fetchOnboardingCounts(): Promise<OnboardingCounts> {
  const organization_id = currentOrganizationId()
  const count = async (table: string, filter?: (query: any) => any) => {
    let query = from(table).select('*', { count: 'exact', head: true }).eq('organization_id', organization_id)
    if (filter) query = filter(query)
    const { count: total, error } = await query
    if (error) throw error
    return total ?? 0
  }
  const [sites, departments, shifts, employees, assignments, linkedEmployees] = await Promise.all([
    count('sites'),
    count('departments'),
    count('shifts'),
    count('employees', (q) => q.is('archived_at', null)),
    count('employee_sites'),
    count('employees', (q) => q.is('archived_at', null).not('user_id', 'is', null)),
  ])
  return { sites, departments, shifts, employees, assignments, linkedEmployees }
}

// Employee-Sites
export async function fetchEmployeeSites(employeeId?: string): Promise<EmployeeSiteWithSite[]> {
  let query = from('employee_sites')
    .select('*, sites(id,name)')
    .eq('organization_id', currentOrganizationId())
    .order('assigned_at', { ascending: false })
  if (employeeId) query = query.eq('employee_id', employeeId)
  const { data, error } = await query
  if (error) throw error
  return data
}

export async function assignEmployeeToSite(payload: EmployeeSiteInsert): Promise<void> {
  const { error } = await from('employee_sites').insert(payload)
  if (error) throw error
}

export async function unassignEmployeeFromSite(employeeId: string, siteId: string): Promise<void> {
  const { data, error } = await from('employee_sites')
    .delete()
    .eq('employee_id', employeeId)
    .eq('site_id', siteId)
    .select('employee_id')
  if (error) throw error
  if (!data || data.length === 0) {
    throw new Error(
      'Assignment could not be deleted. It may have already been removed, or you lack permission to delete assignments.'
    )
  }
}

// Audit Logs
export async function fetchAuditLogs(params?: {
  tableName?: string
  startDate?: string
  endDate?: string
  limit?: number
  offset?: number
}): Promise<AuditLog[]> {
  let query = from('audit_logs').select('*').eq('organization_id', currentOrganizationId())
  if (params?.tableName) query = query.eq('table_name', params.tableName)
  if (params?.startDate) query = query.gte('created_at', params.startDate)
  if (params?.endDate) query = query.lte('created_at', params.endDate)
  query = query.order('created_at', { ascending: false })
  if (params?.limit || params?.offset) {
    const start = params?.offset ?? 0
    const end = params?.limit ? start + params.limit - 1 : start + 10_000
    query = query.range(start, end)
  }
  const { data, error } = await query
  if (error) throw error
  return data
}

export async function fetchEmployeeLocations(): Promise<
  Array<{
    id: string
    first_name: string
    last_name: string
    sites: Array<Pick<Site, 'id' | 'name' | 'latitude' | 'longitude' | 'radius_in_meters'>>
  }>
> {
  const { data, error } = await supabase
    .from('employees')
    .select('id,first_name,last_name,sites!employee_sites_sites!inner(id,name,latitude,longitude,radius_in_meters)')
    .eq('organization_id', currentOrganizationId())
  if (error) throw error
  return data
}

export async function fetchActivePresenceSessions(): Promise<PresenceSession[]> {
  // NOTE: no embedded relations here - presence_sessions has no FK to
  // employees (both reference auth.users), so embedding employees(...) fails
  // with PGRST200. Consumers match by user_id instead.
  const { data, error } = await supabase
    .from('presence_sessions')
    .select('*')
    .eq('organization_id', currentOrganizationId())
    .is('exit_timestamp', null)
  if (error) throw error
  return data
}
