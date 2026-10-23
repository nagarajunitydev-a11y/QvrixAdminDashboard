import { test, expect, type Page } from '@playwright/test'
import { loadEnv } from 'vite'
const env = loadEnv('test', process.cwd(), 'VITE_')
const backend = env.VITE_SUPABASE_URL
const project = new URL(backend).hostname.split('.')[0]
const uid = '00000000-0000-4000-8000-000000000011'
const A = '00000000-0000-4000-8000-000000000101'
const B = '00000000-0000-4000-8000-000000000102'
const now = new Date().toISOString()
const orgs = [A, B].map((id, i) => ({
  id,
  name: i ? 'Organization B' : 'Organization A',
  timezone: i ? 'America/New_York' : 'Asia/Kolkata',
  status: 'active',
  settings: {},
  branding: {},
  created_at: now,
  updated_at: now,
}))

async function bootstrap(
  page: Page,
  options: {
    role?: string
    platform?: boolean
    unavailable?: boolean
    orgs?: string[]
  } = {},
) {
  const role = options.role || 'organization_admin'
  const organizations = orgs.filter(
    (org) => !options.orgs || options.orgs.includes(org.id),
  )
  const traffic: Array<{
    table: string
    organization: string | null
    method: string
    body: Record<string, unknown> | null
  }> = []
  const errors: string[] = []
  page.on('pageerror', (error) => errors.push(error.message))
  let delayA = false
  const memberships = organizations.map((org) => ({
    organization_id: org.id,
    user_id: uid,
    role,
    status: 'active',
    created_at: now,
  }))
  const employees = orgs.map((org, i) => ({
    organization_id: org.id,
    id: `employee-${i}`,
    user_id: uid,
    first_name: i ? 'Brielle' : 'Ada',
    last_name: i ? 'B' : 'A',
    email: i ? 'b@example.test' : 'a@example.test',
    phone: '',
    department_id: null,
    designation_id: null,
    shift_id: null,
    is_active: true,
    hire_date: null,
    departments: null,
    designations: null,
    shifts: null,
    created_at: now,
    updated_at: now,
  }))
  const sites = orgs.map((org, i) => ({
    id: `site-${i}`,
    organization_id: org.id,
    name: i ? 'Site B' : 'Site A',
    latitude: 12 + i,
    longitude: 77 + i,
    radius_in_meters: 200,
    created_at: now,
    updated_at: now,
  }))
  await page.route(backend + '/**', async (route) => {
    const request = route.request(),
      url = new URL(request.url()),
      table = url.pathname.split('/').pop()!
    const body = request.postDataJSON()
    if (url.pathname.startsWith('/auth/'))
      return route.fulfill({
        json: {
          user: {
            id: uid,
            email: 'admin@example.test',
            email_confirmed_at: now,
          },
        },
      })
    if (url.pathname.includes('/rpc/')) {
      if (table === 'is_platform_admin')
        return route.fulfill({ json: options.platform === true })
      if (table === 'validate_organization_selection')
        return organizations.some((org) => org.id === body.org)
          ? route.fulfill({
              json: options.platform ? 'platform_super_admin' : role,
            })
          : route.fulfill({
              status: 403,
              json: { message: 'Organization unavailable' },
            })
      if (table === 'list_organization_members')
        return route.fulfill({
          json: memberships.filter(m => m.organization_id === body.org).map((m) => ({ ...m, email: 'admin@example.test' })),
        })
      if (table === 'create_organization_invitation')
        return route.fulfill({
          json: { id: 'invite-1', token: 'isolated-test-invitation' },
        })
      return route.fulfill({ json: null })
    }
    if (table === 'organizations')
      return options.unavailable
        ? route.fulfill({
            status: 404,
            json: { code: 'PGRST205', message: "Could not find the table 'public.organizations' in the schema cache" },
          })
        : route.fulfill({ json: organizations })
    if (table === 'organization_memberships')
      return route.fulfill({ json: memberships })
    const organization =
      url.searchParams.get('organization_id')?.replace(/^eq\./, '') ||
      (request.method() === 'POST' ? body?.organization_id : null) ||
      null
    traffic.push({ table, organization, method: request.method(), body })
    if (!organization)
      return route.fulfill({
        status: 400,
        json: { message: 'Test detected an unscoped business request' },
      })
    if (request.method() === 'POST' || request.method() === 'PATCH')
      return route.fulfill({ json: { ...employees[1], ...body } })
    if (table === 'employees' && organization === A && delayA)
      await new Promise((resolve) => setTimeout(resolve, 700))
    const records: Record<string, unknown[]> = {
      employees,
      sites,
      departments: [],
      designations: [],
      shifts: [],
      employee_sites: [],
      location_logs: [],
      presence_sessions: [],
      audit_logs: [],
      organization_site_access: [],
      organization_invitations: [],
    }
    return route.fulfill({
      json: (records[table] || []).filter(
        (row: any) => row.organization_id === organization,
      ),
    })
  })
  const token = [
    Buffer.from('{"alg":"HS256"}').toString('base64url'),
    Buffer.from(
      JSON.stringify({ sub: uid, exp: Math.floor(Date.now() / 1000) + 3600 }),
    ).toString('base64url'),
    'isolated-test-signature',
  ].join('.')
  await page.addInitScript(
    ({ key, userId, token, now }) => {
      localStorage.setItem(
        key,
        JSON.stringify({
          access_token: token,
          refresh_token: 'isolated-ui-test',
          expires_in: 3600,
          expires_at: Math.floor(Date.now() / 1000) + 3600,
          token_type: 'bearer',
          user: {
            id: userId,
            email: 'admin@example.test',
            created_at: now,
            email_confirmed_at: now,
            aud: 'authenticated',
            user_metadata: {
              role: 'platform_super_admin',
              full_name: 'Test Admin',
            },
          },
        }),
      )
    },
    { key: `sb-${project}-auth-token`, userId: uid, token, now },
  )
  return {
    traffic,
    errors,
    delay: () => {
      delayA = true
    },
  }
}

test('switches organizations without reload, stale responses or shared table state', async ({
  page,
}) => {
  const fixture = await bootstrap(page)
  await page.goto('/employees')
  await expect(page.getByText('Ada A', { exact: true })).toBeVisible()
  await page.evaluate(() => {
    ;(window as any).__crewtraxaMarker = 'same document'
  })
  fixture.delay()
  await page
    .getByRole('button', { name: 'Refresh page data', exact: true })
    .click()
  await page.getByLabel('Switch organization').selectOption(B)
  await expect(page.getByText('Brielle B', { exact: true })).toBeVisible()
  await page.waitForTimeout(800)
  await expect(page.getByText('Ada A', { exact: true })).toHaveCount(0)
  expect(await page.evaluate(() => (window as any).__crewtraxaMarker)).toBe(
    'same document',
  )
  await page.getByRole('button', { name: 'Search workspace' }).click()
  await page
    .getByRole('textbox', { name: 'Search pages, employees and sites' })
    .fill('Ada')
  await expect(
    page.getByRole('dialog').getByRole('link').filter({ hasText: 'Ada A' }),
  ).toHaveCount(0)
  await page.keyboard.press('Escape')
  await page.getByLabel('Switch organization').selectOption(A)
  await expect(page.getByText('Ada A', { exact: true })).toBeVisible()
  expect(
    fixture.traffic.every(
      (request) => request.organization === A || request.organization === B,
    ),
  ).toBe(true)
  expect(fixture.errors).toEqual([])
})

test('all business routes send the selected organization, including newly added views', async ({
  page,
}) => {
  // Seventeen full navigations share this test's budget; keep each assertion at 5s.
  test.setTimeout(90000)
  const { traffic, errors } = await bootstrap(page)
  for (const route of [
    '/',
    '/employees',
    '/sites',
    '/presence',
    '/shifts',
    '/assignments',
    '/entry-exit',
    '/location-logs',
    '/alerts',
    '/reports',
    '/departments',
    '/designations',
    '/devices',
    '/users',
    '/audit',
    '/settings',
    '/live-tracking',
  ]) {
    await page.goto(route, { waitUntil: 'domcontentloaded' })
    await expect(page.locator('#main-content h1')).toBeVisible()
    await expect(
      page
        .getByRole('alert')
        .filter({ hasText: 'Some data couldn’t be loaded' }),
    ).toHaveCount(0)
  }
  expect(traffic.length).toBeGreaterThan(20)
  expect(traffic.every((request) => request.organization === A)).toBe(true)
  expect(errors).toEqual([])
})

test('editable auth metadata never displays the platform administrator module', async ({
  page,
}) => {
  await bootstrap(page, { role: 'supervisor', orgs: [A] })
  await page.goto('/employees')
  await expect(
    page.getByRole('button', { name: 'Add Employee', exact: true }),
  ).toBeDisabled()
  await expect(
    page
      .locator('aside.sidebar')
      .getByRole('link', { name: 'Organizations', exact: true }),
  ).toHaveCount(0)
  await page.goto('/organizations')
  await expect(
    page.getByRole('heading', {
      name: 'Platform administrator access required',
    }),
  ).toBeVisible()
})

test('platform administrator can see the Organizations module', async ({
  page,
}) => {
  await bootstrap(page, { platform: true })
  await page.goto('/organizations')
  await expect(
    page.getByRole('button', { name: 'Create organization' }),
  ).toBeVisible()
  await expect(
    page.getByRole('cell', { name: 'Organization B', exact: true }),
  ).toBeVisible()
})

test('platform organization creation, editing, lifecycle changes, refresh and RPC retry', async ({ page }) => {
  const { errors } = await bootstrap(page, { platform: true })
  const records = orgs.map(org => ({ ...org }))
  const C = '00000000-0000-4000-8000-000000000103'
  const writes: Record<string, unknown>[] = []
  let rejectSave = true
  await page.route(backend + '/rest/v1/organizations?**', route => route.fulfill({ json: records }))
  await page.route(backend + '/rest/v1/rpc/save_organization', route => {
    const body = route.request().postDataJSON()
    writes.push(body)
    if (rejectSave) return route.fulfill({ status: 403, json: { code: '42501', message: 'Platform administrator required' } })
    const row = { ...orgs[0], id: body.org || C, name: body.org_name, status: body.org_status, timezone: body.org_timezone }
    const index = records.findIndex(org => org.id === row.id)
    if (index >= 0) records[index] = row
    else records.push(row)
    return route.fulfill({ json: row })
  })
  await page.goto('/organizations')
  await page.getByRole('button', { name: 'Create organization' }).click()
  const dialog = page.getByRole('dialog')
  await dialog.getByLabel('Name', { exact: true }).fill('New organization')
  await dialog.getByLabel('Time zone', { exact: true }).fill('UTC')
  await dialog.getByRole('button', { name: 'Save organization' }).click()
  await expect(dialog.getByRole('alert')).toHaveText('Platform administrator required')
  rejectSave = false
  await dialog.getByRole('button', { name: 'Save organization' }).click()
  const row = page.getByRole('row').filter({ hasText: 'New organization' })
  await expect(row).toBeVisible()
  await row.getByRole('button', { name: 'Edit', exact: true }).click()
  await dialog.getByLabel('Name', { exact: true }).fill('Renamed organization')
  await dialog.getByLabel('Status', { exact: true }).selectOption('suspended')
  await dialog.getByRole('button', { name: 'Save organization' }).click()
  await page.getByRole('button', { name: 'Confirm', exact: true }).click()
  const renamed = page.getByRole('row').filter({ hasText: 'Renamed organization' })
  await expect(renamed).toContainText('suspended')
  await expect(renamed.getByRole('button', { name: 'Open workspace' })).toBeDisabled()
  await page.reload()
  await expect(renamed).toContainText('suspended')
  await renamed.getByRole('button', { name: 'Edit', exact: true }).click()
  await dialog.getByLabel('Status', { exact: true }).selectOption('active')
  await dialog.getByRole('button', { name: 'Save organization' }).click()
  await expect(renamed).toContainText('active')
  await expect(renamed.getByRole('button', { name: 'Open workspace' })).toBeEnabled()
  await page.getByRole('button', { name: 'Refresh organizations' }).click()
  await expect(renamed).toBeVisible()
  expect(writes.map(write => write.org)).toEqual([null, null, C, C])
  expect(errors).toEqual([])
})

test('existing account assignment and role/status edits use the selected organization', async ({ page }) => {
  const { errors } = await bootstrap(page, { orgs: [A] })
  const member = '00000000-0000-4000-8000-000000000022'
  const rows = [{ organization_id: A, user_id: uid, email: 'admin@example.test', role: 'organization_admin', status: 'active', created_at: now }]
  const writes: Record<string, unknown>[] = []
  await page.route(backend + '/rest/v1/rpc/list_organization_members', route => route.fulfill({ json: rows }))
  await page.route(backend + '/rest/v1/rpc/manage_organization_member', route => {
    const body = route.request().postDataJSON()
    writes.push(body)
    const row = { organization_id: body.org, user_id: body.member, email: 'member@example.test', role: body.member_role, status: body.member_status, created_at: now }
    const index = rows.findIndex(member => member.user_id === body.member)
    if (index < 0) rows.push(row)
    else rows[index] = row
    return route.fulfill({ json: null })
  })
  await page.goto('/users')
  await page.getByLabel('Existing account UUID').fill(member)
  await page.getByLabel('Assigned member role').selectOption('manager')
  await page.getByRole('button', { name: 'Assign member', exact: true }).click()
  const row = page.getByRole('row').filter({ hasText: 'member@example.test' })
  await expect(row).toContainText('manager')
  await row.getByLabel('Role for member@example.test').selectOption('supervisor')
  await row.getByLabel('Membership status for member@example.test').selectOption('suspended')
  await row.getByRole('button', { name: 'Save', exact: true }).click()
  await expect(row).toContainText('suspended')
  await page.reload()
  await expect(row).toContainText('supervisor')
  await expect(row).toContainText('suspended')
  expect(writes).toEqual([
    { org: A, member, member_role: 'manager', member_status: 'active' },
    { org: A, member, member_role: 'supervisor', member_status: 'suspended' },
  ])
  expect(errors).toEqual([])
})

test('membership list errors remain visible and retry reloads real query state', async ({ page }) => {
  await bootstrap(page, { orgs: [A] })
  let unavailable = true
  await page.route(backend + '/rest/v1/rpc/list_organization_members', route => unavailable
    ? route.fulfill({ status: 403, json: { code: '42501', message: 'Organization administrator required' } })
    : route.fallback())
  await page.goto('/users')
  await expect(page.getByRole('alert').filter({ hasText: 'Membership data could not be loaded' })).toBeVisible()
  await expect(page.getByText('Members are unavailable until the access check succeeds.')).toBeVisible()
  unavailable = false
  await page.getByRole('button', { name: 'Retry membership data' }).click()
  await expect(page.getByRole('cell', { name: 'admin@example.test', exact: true })).toBeVisible()
  await expect(page.getByRole('button', { name: 'Retry membership data' })).toHaveCount(0)
})

test('missing migrations fail closed without issuing business requests', async ({
  page,
}) => {
  const { traffic } = await bootstrap(page, { unavailable: true })
  await page.goto('/employees')
  await expect(
    page.getByRole('heading', { name: 'Organization setup required' }),
  ).toBeVisible()
  expect(traffic).toEqual([])
})

test('retry recovers after schema setup without reloading the document', async ({ page }) => {
  await bootstrap(page)
  let missing = true
  await page.route(backend + '/rest/v1/organizations?**', async route => {
    if (!missing) return route.fallback()
    return route.fulfill({ status: 404, json: { code: 'PGRST205', message: 'Missing organizations' } })
  })
  await page.goto('/employees')
  await expect(page.getByRole('heading', { name: 'Organization setup required' })).toBeVisible()
  await page.evaluate(() => { Object.assign(window, { accessRetryMarker: 'same-document' }) })
  missing = false
  await page.getByRole('button', { name: 'Retry access check' }).click()
  await expect(page.getByRole('heading', { name: 'Employees', exact: true })).toBeVisible()
  expect(await page.evaluate(() => Reflect.get(window, 'accessRetryMarker'))).toBe('same-document')
})

test('membership PGRST205 preserves the network error and recovers only after the endpoint succeeds', async ({ page }) => {
  const { traffic, errors } = await bootstrap(page)
  const message = "Could not find the table 'public.organization_memberships' in the schema cache"
  let missing = true
  await page.route(backend + '/rest/v1/organization_memberships?**', route => missing
    ? route.fulfill({ status: 404, json: { code: 'PGRST205', message } })
    : route.fallback())
  const failure = page.waitForResponse(response => response.url().includes('/rest/v1/organization_memberships?') && response.status() === 404)
  await page.goto('/employees')
  expect(await (await failure).json()).toEqual({ code: 'PGRST205', message })
  await expect(page.getByRole('heading', { name: 'Organization setup required' })).toBeVisible()
  await expect(page.getByRole('alert')).toHaveText(message)
  await expect(page.getByText(/Check: organization_memberships/)).toBeVisible()
  expect(traffic).toEqual([])
  await page.getByRole('button', { name: 'Retry access check' }).click()
  await expect(page.getByRole('alert')).toHaveText(message)
  expect(traffic).toEqual([])
  missing = false
  await page.getByRole('button', { name: 'Retry access check' }).click()
  await expect(page.getByText('Ada A', { exact: true })).toBeVisible()
  expect(errors).toEqual([])
})

test('successful empty memberships cannot use a remembered organization or spoofed admin metadata', async ({ page }) => {
  const { traffic, errors } = await bootstrap(page, { orgs: [] })
  await page.addInitScript(({ uid, org }) => {
    localStorage.setItem(`crewtraxa-organization:${uid}`, org)
  }, { uid, org: A })
  await page.goto('/employees')
  await expect(page.getByRole('heading', { name: 'Choose an organization' })).toBeVisible()
  expect(traffic).toEqual([])
  expect(errors).toEqual([])
})

test('server refusal of organization selection blocks business requests', async ({ page }) => {
  const { traffic } = await bootstrap(page, { orgs: [A] })
  await page.route(backend + '/rest/v1/rpc/validate_organization_selection', route => route.fulfill({
    status: 403, json: { code: '42501', message: 'Organization unavailable or access revoked' },
  }))
  await page.goto('/employees')
  await expect(page.getByRole('heading', { name: 'Organization permission required' })).toBeVisible()
  expect(traffic).toEqual([])
})

for (const failure of [
  { status: 401, code: 'PGRST301', title: 'Session could not be verified' },
  { status: 403, code: '42501', title: 'Organization permission required' },
  { status: 503, code: 'PGRST000', title: 'Organization access unavailable' },
  { status: 404, code: 'PGRST202', title: 'Organization setup required' },
]) {
  test(`access error ${failure.code} is classified and sign out works`, async ({ page }) => {
    const { traffic } = await bootstrap(page)
    await page.route(backend + '/rest/v1/rpc/is_platform_admin', route =>
      route.fulfill({ status: failure.status, json: { code: failure.code, message: 'Access check failed' } }),
    )
    await page.goto('/employees')
    await expect(page.getByRole('heading', { name: failure.title })).toBeVisible()
    expect(traffic).toEqual([])
    await page.getByRole('button', { name: 'Sign out', exact: true }).click()
    await expect(page).toHaveURL(/\/login/)
  })
}

test('employee UI allows own attendance and blocks management pages', async ({
  page,
}) => {
  await bootstrap(page, { role: 'employee', orgs: [A] })
  await page.goto('/employees')
  await expect(
    page.getByRole('heading', { name: 'Employee workspace' }),
  ).toBeVisible()
  await page.getByRole('link', { name: 'View my attendance' }).click()
  await expect(
    page.getByRole('heading', { name: 'Attendance & Presence' }),
  ).toBeVisible()
})

test('membership administration and invitation links remain scoped', async ({
  page,
}) => {
  const { traffic, errors } = await bootstrap(page)
  await page.goto('/users')
  await page
    .getByRole('textbox', { name: 'Invitation email' })
    .fill('invitee@example.test')
  await page
    .getByRole('button', { name: 'Create invitation', exact: true })
    .click()
  await expect(
    page.getByRole('textbox', { name: 'Invitation link' }),
  ).toHaveValue(/\/accept-invitation#token=isolated-test-invitation/)
  await expect(page.getByRole('status')).toContainText('Changes saved.')
  expect(traffic.every((request) => request.organization === A)).toBe(true)
  expect(errors).toEqual([])
})

test('mobile organization switcher is accessible in the navigation drawer', async ({
  page,
}) => {
  await page.setViewportSize({ width: 390, height: 844 })
  const { errors } = await bootstrap(page)
  await page.goto('/employees')
  await expect(page.getByText('Ada A', { exact: true })).toBeVisible()
  await page.getByRole('button', { name: 'Open navigation' }).click()
  await page
    .getByRole('dialog')
    .getByLabel('Switch organization')
    .selectOption(B)
  await expect(page.getByText('Brielle B', { exact: true })).toBeVisible()
  expect(
    await page
      .locator('body')
      .evaluate((el) => el.scrollWidth > innerWidth + 1),
  ).toBe(false)
  expect(errors).toEqual([])
})

test('employee mutations keep the captured organization in payloads and filters', async ({
  page,
}) => {
  const { traffic, errors } = await bootstrap(page)
  await page.goto('/employees')
  await expect(page.getByText('Ada A', { exact: true })).toBeVisible()
  await page.getByLabel('Switch organization').selectOption(B)
  await expect(page.getByText('Brielle B', { exact: true })).toBeVisible()
  await page.getByRole('button', { name: 'Add Employee', exact: true }).click()
  await page.locator('#first_name').fill('New')
  await page.locator('#last_name').fill('Employee')
  await page.locator('#email').fill('new@example.test')
  await page.getByRole('button', { name: 'Save Changes', exact: true }).click()
  await expect(page.getByRole('dialog')).toHaveCount(0)
  await page.getByTitle('Edit', { exact: true }).click()
  await page.locator('#first_name').fill('Updated')
  await page.getByRole('button', { name: 'Save Changes', exact: true }).click()
  await expect(page.getByRole('dialog')).toHaveCount(0)
  await page.getByTitle('Delete', { exact: true }).click()
  await page.getByRole('button', { name: 'Confirm', exact: true }).click()
  await expect
    .poll(() => traffic.filter((request) => request.method === 'DELETE').length)
    .toBe(1)
  const writes = traffic.filter((request) => request.method !== 'GET')
  expect(writes.map((request) => request.method)).toEqual([
    'POST',
    'PATCH',
    'DELETE',
  ])
  expect(writes.every((request) => request.organization === B)).toBe(true)
  expect(
    writes
      .filter((request) => request.body)
      .every((request) => request.body!.organization_id === B),
  ).toBe(true)
  expect(errors).toEqual([])
})
