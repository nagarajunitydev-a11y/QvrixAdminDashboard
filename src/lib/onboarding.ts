/** Setup checklist for a new organization. Every step is derived from real records, never ticked by hand. */

export interface OnboardingCountsInput {
  sites: number
  departments: number
  shifts: number
  employees: number
  assignments: number
  linkedEmployees: number
}

export interface OnboardingStep {
  id: 'sites' | 'departments' | 'shifts' | 'employees' | 'assignments' | 'app' | 'team'
  title: string
  description: string
  detail: string
  done: boolean
  optional: boolean
  to: string
  action: string
}

export interface OnboardingStatus {
  steps: OnboardingStep[]
  completed: number
  total: number
  percent: number
  complete: boolean
  next: OnboardingStep | null
}

const plural = (count: number, word: string) => `${count} ${word}${count === 1 ? '' : 's'}`

/**
 * `teamSize` counts Console members plus pending invitations; pass null when the viewer cannot see
 * the team (only organization admins manage it), and the step is left out.
 */
export function onboardingStatus(counts: OnboardingCountsInput, teamSize: number | null): OnboardingStatus {
  const steps: OnboardingStep[] = [
    {
      id: 'sites',
      title: 'Add your work sites',
      description: 'Place each site on the map and set its geofence radius, so the app knows when people arrive and leave.',
      detail: counts.sites ? `${plural(counts.sites, 'site')} added` : 'No sites yet',
      done: counts.sites > 0,
      optional: false,
      to: '/sites',
      action: 'Add a site',
    },
    {
      id: 'departments',
      title: 'Organize departments',
      description: 'Group employees by team or trade to filter reports and assignments. Imports can create these for you.',
      detail: counts.departments ? `${plural(counts.departments, 'department')}` : 'Optional',
      done: counts.departments > 0,
      optional: true,
      to: '/departments',
      action: 'Add departments',
    },
    {
      id: 'shifts',
      title: 'Set working hours',
      description: 'Create the shifts people work, so attendance can be compared with planned hours.',
      detail: counts.shifts ? `${plural(counts.shifts, 'shift')}` : 'No shifts yet',
      done: counts.shifts > 0,
      optional: false,
      to: '/shifts',
      action: 'Create a shift',
    },
    {
      id: 'employees',
      title: 'Add your employees',
      description: 'Add people one at a time, or import a CSV file with everyone at once.',
      detail: counts.employees ? `${plural(counts.employees, 'employee')}` : 'No employees yet',
      done: counts.employees > 0,
      optional: false,
      to: '/employees?import=1',
      action: 'Import employees',
    },
    {
      id: 'assignments',
      title: 'Assign employees to sites',
      description: 'Choose where each person works. Their app only tracks the sites they are assigned to.',
      detail: counts.assignments ? `${plural(counts.assignments, 'assignment')}` : 'Nobody assigned yet',
      done: counts.assignments > 0,
      optional: false,
      to: '/assignments',
      action: 'Assign sites',
    },
    {
      id: 'app',
      title: 'Get employees on the Crewtraxa app',
      description: 'Employees sign in to the Android app with the email on their profile. Their device then appears under Devices.',
      detail: counts.employees
        ? `${counts.linkedEmployees} of ${counts.employees} signed in`
        : 'Add employees first',
      done: counts.linkedEmployees > 0,
      optional: false,
      to: '/devices',
      action: 'View devices',
    },
  ]
  if (teamSize !== null) {
    steps.push({
      id: 'team',
      title: 'Invite your Console team',
      description: 'Give managers and supervisors their own sign-in, with the access their role allows.',
      detail: teamSize > 1 ? `${plural(teamSize, 'member')} or invitations` : 'Only you so far',
      done: teamSize > 1,
      optional: false,
      to: '/users',
      action: 'Invite people',
    })
  }

  const required = steps.filter((step) => !step.optional)
  const completed = required.filter((step) => step.done).length
  return {
    steps,
    completed,
    total: required.length,
    percent: Math.round((completed / required.length) * 100),
    complete: completed === required.length,
    next: required.find((step) => !step.done) ?? null,
  }
}
