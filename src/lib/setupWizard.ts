/**
 * Organization setup wizard: step order, choices and form checks. Each step saves to the database as
 * the admin moves on, and the organization stores the next step, so setup resumes after signing in.
 */

export type SetupStep = 'organization' | 'company' | 'schedule' | 'rules' | 'sites' | 'team' | 'done'

export interface SetupStepInfo {
  id: SetupStep
  label: string
  title: string
  description: string
  optional?: boolean
}

export const SETUP_STEPS: SetupStepInfo[] = [
  {
    id: 'organization',
    label: 'Organization',
    title: 'Create your organization',
    description: 'Your workspace for sites, schedules, attendance and people. You become its admin.',
  },
  {
    id: 'company',
    label: 'Company',
    title: 'Tell us about your company',
    description: 'This helps Crewtraxa suggest the right setup. You can change it later.',
  },
  {
    id: 'schedule',
    label: 'Working hours',
    title: 'When does your team work?',
    description: 'This becomes the organization\'s default work schedule. Add more schedules later for other teams.',
  },
  {
    id: 'rules',
    label: 'Work settings',
    title: 'How should check-ins work?',
    description: 'Rules for when and where people may check in and out. They apply to everyone unless a department has its own.',
  },
  {
    id: 'sites',
    label: 'Sites',
    title: 'Where does your team work?',
    description: 'Add your work sites. The app records arrivals and departures inside each site\'s geofence.',
    optional: true,
  },
  {
    id: 'team',
    label: 'Team',
    title: 'Invite your team',
    description: 'Add employees who check in with the Crewtraxa app, and managers who use this Console.',
    optional: true,
  },
  {
    id: 'done',
    label: 'Done',
    title: 'Your workspace is ready',
    description: 'Here is what was set up. Everything can be changed from the Console.',
  },
]

const ORDER = SETUP_STEPS.map((step) => step.id)

export const stepIndex = (step: SetupStep) => ORDER.indexOf(step)
export const stepAfter = (step: SetupStep): SetupStep => ORDER[Math.min(stepIndex(step) + 1, ORDER.length - 1)]
export const stepBefore = (step: SetupStep): SetupStep => ORDER[Math.max(stepIndex(step) - 1, 0)]

/** The step to open for an organization, from the progress stored on it. */
export function resumeStep(stored: string | null | undefined): SetupStep {
  return ORDER.includes(stored as SetupStep) && stored !== 'organization' ? (stored as SetupStep) : 'company'
}

/** Saved progress only moves forward, so going back to edit a step does not lose later steps. */
export function furthestStep(a: SetupStep, b: SetupStep): SetupStep {
  return stepIndex(a) >= stepIndex(b) ? a : b
}

export const INDUSTRIES = [
  { value: 'construction', label: 'Construction' },
  { value: 'facility_management', label: 'Facility management' },
  { value: 'security_services', label: 'Security services' },
  { value: 'manufacturing', label: 'Manufacturing' },
  { value: 'logistics', label: 'Logistics and delivery' },
  { value: 'retail', label: 'Retail' },
  { value: 'healthcare', label: 'Healthcare' },
  { value: 'hospitality', label: 'Hospitality' },
  { value: 'field_services', label: 'Field services' },
  { value: 'agriculture', label: 'Agriculture' },
  { value: 'education', label: 'Education' },
  { value: 'technology', label: 'Technology' },
  { value: 'other', label: 'Something else' },
] as const

export const TEAM_SIZES = ['1-10', '11-50', '51-200', '201-500', '500+'] as const

export const industryLabel = (value: string | null | undefined) =>
  INDUSTRIES.find((industry) => industry.value === value)?.label ?? null

// ISO 3166-1 alpha-2 country codes.
const COUNTRY_CODES = (
  'AD AE AF AG AI AL AM AO AQ AR AS AT AU AW AX AZ BA BB BD BE BF BG BH BI BJ BL BM BN BO BQ BR BS BT BV BW BY BZ '
  + 'CA CC CD CF CG CH CI CK CL CM CN CO CR CU CV CW CX CY CZ DE DJ DK DM DO DZ EC EE EG EH ER ES ET FI FJ FK FM FO '
  + 'FR GA GB GD GE GF GG GH GI GL GM GN GP GQ GR GS GT GU GW GY HK HM HN HR HT HU ID IE IL IM IN IO IQ IR IS IT JE '
  + 'JM JO JP KE KG KH KI KM KN KP KR KW KY KZ LA LB LC LI LK LR LS LT LU LV LY MA MC MD ME MF MG MH MK ML MM MN MO '
  + 'MP MQ MR MS MT MU MV MW MX MY MZ NA NC NE NF NG NI NL NO NP NR NU NZ OM PA PE PF PG PH PK PL PM PN PR PS PT PW '
  + 'PY QA RE RO RS RU RW SA SB SC SD SE SG SH SI SJ SK SL SM SN SO SR SS ST SV SX SY SZ TC TD TF TG TH TJ TK TL TM '
  + 'TN TO TR TT TV TW TZ UA UG UM US UY UZ VA VC VE VG VI VN VU WF WS YE YT ZA ZM ZW'
).split(' ')

export function countryOptions(locale = 'en'): Array<{ code: string; name: string }> {
  const names = new Intl.DisplayNames([locale], { type: 'region' })
  return COUNTRY_CODES.map((code) => ({ code, name: names.of(code) ?? code })).sort((a, b) => a.name.localeCompare(b.name))
}

/** The region in the browser's language settings ("en-IN" -> "IN"), or India. */
export function guessCountry(languages: readonly string[]): string {
  for (const language of languages) {
    const region = /^[a-z]{2,3}[-_]([A-Z]{2})\b/i.exec(language)?.[1]?.toUpperCase()
    if (region && COUNTRY_CODES.includes(region)) return region
  }
  return 'IN'
}

// Older names some browsers still report.
const TIME_ZONE_ALIASES: Record<string, string> = {
  'Asia/Calcutta': 'Asia/Kolkata',
  'Asia/Katmandu': 'Asia/Kathmandu',
  'Asia/Rangoon': 'Asia/Yangon',
  'Asia/Saigon': 'Asia/Ho_Chi_Minh',
}

export const normalizeTimeZone = (zone: string) => TIME_ZONE_ALIASES[zone] ?? zone

export function timeZoneOptions(): string[] {
  const supported = typeof Intl.supportedValuesOf === 'function' ? Intl.supportedValuesOf('timeZone') : []
  return [...new Set(['Asia/Kolkata', 'UTC', ...supported.map(normalizeTimeZone)])].sort()
}

export interface OrganizationForm {
  name: string
  countryCode: string
  timeZone: string
}

export function validateOrganizationForm(form: OrganizationForm): string[] {
  const errors: string[] = []
  const name = form.name.trim()
  if (name.length < 2 || name.length > 120) errors.push('Enter your organization\'s name (2 to 120 characters).')
  if (!COUNTRY_CODES.includes(form.countryCode)) errors.push('Choose your country.')
  if (!form.timeZone) errors.push('Choose your time zone.')
  return errors
}

// ---------------------------------------------------------------------------
// People to invite
// ---------------------------------------------------------------------------

export interface EmployeeInviteRow {
  firstName: string
  lastName: string
  email: string
  phone: string
}

export interface ManagerInviteRow {
  email: string
  role: 'org_admin' | 'manager' | 'supervisor'
}

export interface EmployeeInvite {
  first_name: string
  last_name: string
  email: string
  phone: string | null
}

const EMAIL = /^[^@\s]+@[^@\s]+\.[^@\s]+$/
const PHONE = /^\+?[0-9][0-9 ()-]{5,18}[0-9]$/

const blankEmployee = (row: EmployeeInviteRow) => !row.firstName.trim() && !row.lastName.trim() && !row.email.trim() && !row.phone.trim()

/** Empty rows are ignored; every other row must be complete, with emails new to the organization and the list. */
export function validateInvites(
  employees: readonly EmployeeInviteRow[],
  managers: readonly ManagerInviteRow[],
  existingEmployeeEmails: ReadonlySet<string>,
): { employees: EmployeeInvite[]; managers: ManagerInviteRow[]; errors: string[] } {
  const errors: string[] = []
  const seen = new Set<string>()
  const employeeInvites: EmployeeInvite[] = []
  employees.forEach((row, index) => {
    if (blankEmployee(row)) return
    const label = `Employee ${index + 1}`
    const email = row.email.trim().toLowerCase()
    const problems: string[] = []
    if (!row.firstName.trim()) problems.push('a first name')
    if (!row.lastName.trim()) problems.push('a last name')
    if (!EMAIL.test(email)) problems.push('a valid email')
    if (row.phone.trim() && !PHONE.test(row.phone.trim())) problems.push('a phone number with 7 to 20 digits, or none')
    if (problems.length) {
      errors.push(`${label} needs ${problems.join(', ')}.`)
      return
    }
    if (existingEmployeeEmails.has(email)) errors.push(`${label}: ${email} is already an employee here.`)
    else if (seen.has(email)) errors.push(`${label}: ${email} is listed twice.`)
    else {
      seen.add(email)
      employeeInvites.push({ first_name: row.firstName.trim(), last_name: row.lastName.trim(), email, phone: row.phone.trim() || null })
    }
  })

  const managerSeen = new Set<string>()
  const managerInvites: ManagerInviteRow[] = []
  managers.forEach((row, index) => {
    const email = row.email.trim().toLowerCase()
    if (!email) return
    if (!EMAIL.test(email)) errors.push(`Console user ${index + 1} needs a valid email.`)
    else if (managerSeen.has(email)) errors.push(`Console user ${index + 1}: ${email} is listed twice.`)
    else {
      managerSeen.add(email)
      managerInvites.push({ email, role: row.role })
    }
  })
  return { employees: employeeInvites, managers: managerInvites, errors }
}
