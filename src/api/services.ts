import { supabase } from './supabase'
import type {
  Site,
  SiteInsert,
  SiteUpdate,
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

// Sites
export async function fetchSites(): Promise<Site[]> {
  const { data, error } = await from('sites').select('*')
  if (error) throw error
  return data
}

export async function createSite(payload: SiteInsert): Promise<Site> {
  const { data, error } = await from('sites').insert(payload).select().single()
  if (error) throw error
  return data
}

export async function updateSite(id: string, payload: SiteUpdate): Promise<Site> {
  const { data, error } = await from('sites')
    .update(payload)
    .eq('id', id)
    .select()
    .single()
  if (error) throw error
  return data
}

export async function deleteSite(id: string): Promise<void> {
  const { error } = await from('sites').delete().eq('id', id)
  if (error) throw error
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
  let query = from('location_logs').select('*')
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
  const { data, error } = await from('departments').select('*').order('name')
  if (error) throw error
  return data
}

export async function createDepartment(payload: DepartmentInsert): Promise<Department> {
  const { data, error } = await from('departments').insert(payload).select().single()
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
  const { error } = await from('departments').delete().eq('id', id)
  if (error) throw error
}

// Designations
export async function fetchDesignations(): Promise<Designation[]> {
  const { data, error } = await from('designations').select('*').order('name')
  if (error) throw error
  return data
}

export async function createDesignation(payload: DesignationInsert): Promise<Designation> {
  const { data, error } = await from('designations').insert(payload).select().single()
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
  const { error } = await from('designations').delete().eq('id', id)
  if (error) throw error
}

// Shifts
export async function fetchShifts(): Promise<ShiftWithDepartment[]> {
  const { data, error } = await from('shifts')
    .select('*, departments(name)')
    .order('name')
  if (error) throw error
  return data
}

export async function createShift(payload: ShiftInsert): Promise<Shift> {
  const { data, error } = await from('shifts').insert(payload).select().single()
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
  const { error } = await from('shifts').delete().eq('id', id)
  if (error) throw error
}

// Employees
export async function fetchEmployees(): Promise<EmployeeWithRelations[]> {
  const { data, error } = await from('employees')
    .select('*, departments(name), designations(name), shifts(name)')
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
  const { data, error } = await from('employees').insert(payload).select().single()
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

export async function deleteEmployee(id: string): Promise<void> {
  const { error } = await from('employees').delete().eq('id', id)
  if (error) throw error
}

// Employee-Sites
export async function fetchEmployeeSites(employeeId?: string): Promise<EmployeeSiteWithSite[]> {
  let query = from('employee_sites').select('*, sites(id,name)')
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
  const { error } = await from('employee_sites')
    .delete()
    .eq('employee_id', employeeId)
    .eq('site_id', siteId)
  if (error) throw error
}

// Audit Logs
export async function fetchAuditLogs(params?: {
  tableName?: string
  startDate?: string
  endDate?: string
  limit?: number
  offset?: number
}): Promise<AuditLog[]> {
  let query = from('audit_logs').select('*')
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
    .is('exit_timestamp', null)
  if (error) throw error
  return data
}
