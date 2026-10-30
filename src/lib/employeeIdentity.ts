import type { Employee } from '../types'

type EmployeeIdentity = Pick<Employee, 'user_id' | 'first_name' | 'last_name'>

/** Resolve attendance auth-user IDs only through confirmed employee links. */
export function employeeNamesByUserId(employees: EmployeeIdentity[]): Map<string, string> {
  const names = new Map<string, string>()
  const seen = new Set<string>()
  for (const employee of employees) {
    if (!employee.user_id) continue
    // A corrupt/ambiguous link must not silently choose an employee identity.
    if (seen.has(employee.user_id)) {
      names.delete(employee.user_id)
      continue
    }
    seen.add(employee.user_id)
    const name = [employee.first_name.trim(), employee.last_name.trim()].filter(Boolean).join(' ')
    if (name) names.set(employee.user_id, name)
  }
  return names
}
