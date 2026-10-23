import { test, expect, type Page, type APIRequestContext } from '@playwright/test'
import { randomUUID } from 'node:crypto'
import { loadEnv } from 'vite'
import { writeFile } from 'node:fs/promises'

const env = loadEnv('test', process.cwd(), 'VITE_')
const backend = env.VITE_SUPABASE_URL.replace(/\/$/, '')
const key = env.VITE_SUPABASE_ANON_KEY

async function openAuthenticatedConsole(page: Page, request: APIRequestContext, token: string) {
  const identity = await request.get(`${backend}/auth/v1/user`, { headers: { apikey: key, Authorization: `Bearer ${token}` } })
  expect(identity.ok(), 'Test JWT must be accepted by the configured project').toBe(true)
  const user = await identity.json()
  const claims = JSON.parse(Buffer.from(token.split('.')[1], 'base64url').toString())
  expect(claims.role).toBe('authenticated')
  expect(claims.exp).toBeGreaterThan(Date.now() / 1000 + 180)
  await page.addInitScript(({ project, token, user, exp }) => {
    localStorage.setItem(`sb-${project}-auth-token`, JSON.stringify({
      access_token: token, refresh_token: '', token_type: 'bearer',
      expires_at: exp, expires_in: exp - Math.floor(Date.now() / 1000), user,
    }))
  }, { project: new URL(backend).hostname.split('.')[0], token, user, exp: claims.exp })
  return user
}

test('real configured Data API exposes organization objects', async ({ page }, info) => {
  const consoleErrors: string[] = []
  page.on('console', message => {
    if (message.type() === 'error') consoleErrors.push(message.text())
  })
  page.on('pageerror', error => consoleErrors.push(error.message))
  await page.goto('/employees')
  await expect(page).toHaveURL(/\/login/)
  // Real network requests from the Console origin; no route interception or fake JWT.
  // The nil UUID is only a filter and does not impersonate an authenticated user.
  const results = await page.evaluate(async ({ backend, key }) => {
    const paths = [
      'organizations?select=id&limit=0',
      'organization_memberships?select=*&user_id=eq.00000000-0000-0000-0000-000000000000',
      'rpc/is_platform_admin',
      'rpc/validate_organization_selection',
    ]
    return Promise.all(paths.map(async path => {
      const rpc = path.startsWith('rpc/')
      const response = await fetch(`${backend}/rest/v1/${path}`, {
        method: rpc ? 'POST' : 'GET',
        headers: { apikey: key, ...(key.startsWith('eyJ') ? { Authorization: `Bearer ${key}` } : {}), 'Content-Type': 'application/json' },
        ...(rpc ? { body: JSON.stringify(path.endsWith('validate_organization_selection')
          ? { org: '00000000-0000-0000-0000-000000000000' } : {}) } : {}),
      })
      return { path, status: response.status, body: await response.json() }
    }))
  }, { backend, key })
  const evidence = info.outputPath('real-data-api-responses.json')
  await writeFile(evidence, JSON.stringify({ project: new URL(backend).hostname, results, consoleErrors }, null, 2))
  await info.attach('real-data-api-responses', { path: evidence, contentType: 'application/json' })
  console.log(JSON.stringify({ project: new URL(backend).hostname, results, consoleErrors }, null, 2))
  for (const result of results) {
    // The checked-in migration revokes anon access to all four objects.
    // PostgREST maps 42501 to 401 for anon or 403 for authenticated requests.
    // Require the SQL error code too: an invalid-key/JWT 401 is not readiness.
    expect.soft([401, 403], result.path).toContain(result.status)
    expect.soft(result.body.code, result.path).toBe('42501')
  }
})

test('real authenticated member opens Console and cannot select another organization', async ({ page, request }) => {
  const token = process.env.CREWTRAXA_TEST_A_ADMIN_TOKEN
  const allowed = process.env.CREWTRAXA_TEST_ORG_A
  const denied = process.env.CREWTRAXA_TEST_ORG_B
  test.skip(!token || !allowed || !denied, 'Requires authenticated A admin JWT and dedicated organization A/B IDs; no session is fabricated.')
  const headers = { apikey: key, Authorization: `Bearer ${token}` }
  const identity = await request.get(`${backend}/auth/v1/user`, { headers })
  expect(identity.ok(), 'Test JWT must be accepted by the configured project').toBe(true)
  const user = await identity.json()
  const claims = JSON.parse(Buffer.from(token!.split('.')[1], 'base64url').toString())
  expect(claims.role).toBe('authenticated')
  expect(claims.exp).toBeGreaterThan(Date.now() / 1000 + 120)
  const membership = await request.get(`${backend}/rest/v1/organization_memberships?select=*&user_id=eq.${user.id}`, { headers })
  expect(membership.status()).toBe(200)
  const memberships = await membership.json()
  expect(memberships.some((m: { organization_id: string; status: string }) => m.organization_id === allowed && m.status === 'active')).toBe(true)
  expect(memberships.some((m: { organization_id: string }) => m.organization_id === denied)).toBe(false)
  const rejection = await request.post(`${backend}/rest/v1/rpc/validate_organization_selection`, { headers, data: { org: denied } })
  expect(rejection.status()).toBe(403)
  const hiddenOrganization = await request.get(`${backend}/rest/v1/organizations?select=id&id=eq.${denied}`, { headers })
  expect(hiddenOrganization.status()).toBe(200)
  expect(await hiddenOrganization.json()).toEqual([])
  const errors: string[] = []
  const failedRequests: string[] = []
  page.on('pageerror', error => errors.push(error.message))
  page.on('console', message => { if (message.type() === 'error') errors.push(message.text()) })
  page.on('response', response => {
    if (response.url().startsWith(`${backend}/rest/v1/`) && response.status() >= 400)
      failedRequests.push(`${response.status()} ${new URL(response.url()).pathname}`)
  })
  await page.addInitScript(({ project, token, user, exp, allowed }) => {
    localStorage.setItem(`sb-${project}-auth-token`, JSON.stringify({
      access_token: token, refresh_token: '', token_type: 'bearer',
      expires_at: exp, expires_in: exp - Math.floor(Date.now() / 1000), user,
    }))
    localStorage.setItem(`crewtraxa-organization:${user.id}`, allowed)
  }, { project: new URL(backend).hostname.split('.')[0], token: token!, user, exp: claims.exp, allowed: allowed! })
  await page.goto('/employees')
  await expect(page.getByRole('heading', { name: 'Employees', exact: true })).toBeVisible()
  await expect(page.getByLabel('Switch organization').locator(`option[value="${denied}"]`)).toHaveCount(0)
  expect(failedRequests).toEqual([])
  expect(errors).toEqual([])
})

test('real platform admin creates, edits, assigns members and changes organization lifecycle', async ({ page, request }) => {
  test.setTimeout(90000)
  const token = process.env.CREWTRAXA_TEST_PLATFORM_ADMIN_TOKEN
  const member = process.env.CREWTRAXA_TEST_MEMBER_UUID
  test.skip(!token || !member, 'Requires a real platform admin JWT and separate verified test member UUID. Creates a dedicated test organization, then suspends it for cleanup.')
  const user = await openAuthenticatedConsole(page, request, token!)
  expect(member).not.toBe(user.id)
  const headers = { apikey: key, Authorization: `Bearer ${token}` }
  const platform = await request.post(`${backend}/rest/v1/rpc/is_platform_admin`, { headers, data: {} })
  expect(platform.status()).toBe(200)
  expect(await platform.json()).toBe(true)
  const name = `Crewtraxa isolation test UI ${randomUUID()}`
  const browserErrors: string[] = []
  page.on('console', message => { if (message.type() === 'error') browserErrors.push(message.text()) })
  page.on('pageerror', error => browserErrors.push(error.message))
  let organizationId: string | undefined
  try {
    await page.goto('/organizations')
    await page.getByRole('button', { name: 'Create organization', exact: true }).click()
    const dialog = page.getByRole('dialog')
    await dialog.getByLabel('Name', { exact: true }).fill(name)
    await dialog.getByLabel('Time zone', { exact: true }).fill('UTC')
    const saved = page.waitForResponse(response => response.url().endsWith('/rpc/save_organization') && response.request().method() === 'POST')
    await dialog.getByRole('button', { name: 'Save organization' }).click()
    const response = await saved
    expect(response.status()).toBe(200)
    organizationId = (await response.json()).id
    expect(organizationId).toBeTruthy()
    // Search keeps the dedicated fixture visible when the platform has >10 orgs.
    await page.getByLabel('Search table records').fill(name)
    const row = page.getByRole('row').filter({ hasText: name })
    await expect(row).toBeVisible()
    await row.getByRole('button', { name: 'Edit', exact: true }).click()
    await dialog.getByLabel('Name', { exact: true }).fill(`${name} renamed`)
    await dialog.getByRole('button', { name: 'Save organization' }).click()
    await expect(row).toContainText('renamed')
    await row.getByRole('button', { name: 'Open workspace' }).click()
    await expect(page).toHaveURL(/\/$/)
    await page.goto('/users')
    await page.getByLabel('Existing account UUID').fill(member!)
    await page.getByLabel('Assigned member role').selectOption('organization_admin')
    await page.getByRole('button', { name: 'Assign member', exact: true }).click()
    await expect(page.getByRole('status')).toContainText('Changes saved.')
    await page.reload()
    const membership = await request.get(`${backend}/rest/v1/organization_memberships?organization_id=eq.${organizationId}&user_id=eq.${member}&select=role,status`, { headers })
    expect(membership.status()).toBe(200)
    expect(await membership.json()).toEqual([{ role: 'organization_admin', status: 'active' }])
    await page.goto('/organizations')
    await page.getByLabel('Search table records').fill(name)
    await row.getByRole('button', { name: 'Edit', exact: true }).click()
    await dialog.getByLabel('Status', { exact: true }).selectOption('suspended')
    await dialog.getByRole('button', { name: 'Save organization' }).click()
    await page.getByRole('button', { name: 'Confirm', exact: true }).click()
    await page.getByLabel('Search table records').fill(name)
    await expect(row).toContainText('suspended')
    await page.reload()
    await page.getByLabel('Search table records').fill(name)
    await expect(row.getByRole('button', { name: 'Open workspace' })).toBeDisabled()
    await row.getByRole('button', { name: 'Edit', exact: true }).click()
    await dialog.getByLabel('Status', { exact: true }).selectOption('active')
    await dialog.getByRole('button', { name: 'Save organization' }).click()
    await expect(row.getByRole('button', { name: 'Open workspace' })).toBeEnabled()
    expect(browserErrors).toEqual([])
  } finally {
    if (organizationId) {
      const cleanup = await request.post(`${backend}/rest/v1/rpc/save_organization`, { headers, data: {
        org: organizationId, org_name: name, org_status: 'suspended', org_timezone: 'UTC',
      } })
      expect(cleanup.ok(), 'Suspend dedicated test organization after the live lifecycle test').toBe(true)
    }
  }
})
