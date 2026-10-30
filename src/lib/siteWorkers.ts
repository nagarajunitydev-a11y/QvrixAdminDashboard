import type { SiteWorkerDirectory } from '../api/siteWorkers'
import type { EmployeeWithRelations } from '../api/services'
import type { Site } from '../types'
import type { TrackingState } from './workforce'

export type SiteWorkerStatus = 'Online' | 'Offline' | 'On Site' | 'Outside Site' | 'Checked Out'

export function siteWorkerStatus(state: TrackingState | undefined): SiteWorkerStatus {
  switch (state?.status) {
    case 'on-site': return 'On Site'
    case 'outside': return 'Outside Site'
    case 'recent': return 'Online'
    case 'checked-out': return 'Checked Out'
    default: return 'Offline'
  }
}

export interface SiteWorkerGroup {
  site: Site
  employees: EmployeeWithRelations[]
}

export function groupSiteWorkers({ employees, sites, assignments }: SiteWorkerDirectory): SiteWorkerGroup[] {
  const employeeById = new Map(employees.map((employee) => [employee.id, employee]))
  const groups = new Map(sites.map((site) => [site.id, {
    site, employees: new Map<string, EmployeeWithRelations>(),
  }]))
  for (const assignment of assignments) {
    const employee = employeeById.get(assignment.employee_id)
    if (employee) groups.get(assignment.site_id)?.employees.set(employee.id, employee)
  }
  return [...groups.values()]
    .sort((a, b) => a.site.name.localeCompare(b.site.name) || a.site.id.localeCompare(b.site.id))
    .map(({ site, employees }) => ({
      site,
      employees: [...employees.values()].sort((a, b) =>
        `${a.first_name} ${a.last_name}`.localeCompare(`${b.first_name} ${b.last_name}`) || a.id.localeCompare(b.id)),
    }))
}
