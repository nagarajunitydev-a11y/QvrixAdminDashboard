// Browser regressions for authentication -> server-authorized workspace entry.
// All Auth and REST calls are intercepted. No live users or records are accessed.
import assert from 'node:assert/strict'
import { spawn } from 'node:child_process'
import { mkdir } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { chromium } from 'playwright'

const origin = 'http://127.0.0.1:5184'
const server = spawn(process.execPath, ['node_modules/vite/bin/vite.js', '--host', '127.0.0.1', '--port', '5184', '--strictPort'], { stdio: 'pipe' })
let serverOutput = ''
server.stdout.on('data', data => { serverOutput += data })
server.stderr.on('data', data => { serverOutput += data })
const screenshots = join(tmpdir(), 'crewtraxa-console-access')
let browser
const user = { id: '00000000-0000-4000-8000-000000000099', aud: 'authenticated', role: 'authenticated', email: 'manager@example.test', email_confirmed_at: '2026-10-31T00:00:00Z', app_metadata: {}, user_metadata: {}, created_at: '2026-10-31T00:00:00Z' }
const jwt = data => Buffer.from(JSON.stringify(data)).toString('base64url')
const session = {
  access_token: `${jwt({ alg: 'HS256', typ: 'JWT' })}.${jwt({ sub: user.id, role: 'authenticated', exp: Math.floor(Date.now() / 1000) + 3600 })}.synthetic`,
  refresh_token: 'synthetic-refresh-token', token_type: 'bearer', expires_in: 3600, user,
}
const empty = { is_platform_admin: false, organizations: [], invitations: [], can_create_organization: false }
const organization = { id: '00000000-0000-4000-8000-000000000100', name: 'Test Operations', slug: 'test-operations', timezone: 'Asia/Kolkata', is_active: true, role: 'org_admin', onboarding_step: 'company', onboarding_completed_at: null }
const member = { id: '00000000-0000-4000-8000-000000000101', organization_id: organization.id, first_name: 'Test', last_name: 'Member', organizations: organization }
let passed = 0

async function scenario(name, initialAccess, run, options = {}) {
  if (process.env.CREWTRAXA_ACCESS_SCENARIO && !name.includes(process.env.CREWTRAXA_ACCESS_SCENARIO)) return
  const context = await browser.newContext({ viewport: options.mobile ? { width: 390, height: 844 } : { width: 1366, height: 900 } })
  await context.grantPermissions(['geolocation'], { origin })
  await context.setGeolocation({ latitude: 12.9, longitude: 77.6, accuracy: 5 })
  const page = await context.newPage()
  const errors = []
  page.on('pageerror', error => errors.push(error.message))
  const state = { access: initialAccess, accessCalls: 0, signOutCalls: 0, tokenCalls: 0, failAccess: false, otherRestCalls: [], openSession: null, failClock: false, clockCalls: [] }
  await page.route('**/*', async route => {
    const url = new URL(route.request().url())
    const reply = (data, status = 200) => route.fulfill({ status, contentType: 'application/json', body: JSON.stringify(data) })
    if (url.pathname.startsWith('/auth/v1/')) {
      if (url.pathname.endsWith('/token')) {
        state.tokenCalls++
        return options.invalidPassword
          ? reply({ error: 'invalid_grant', error_description: 'Invalid login credentials', msg: 'Invalid login credentials' }, 400)
          : reply(session)
      }
      if (url.pathname.endsWith('/logout')) { state.signOutCalls++; return reply({}) }
      return reply(user)
    }
    if (url.pathname.startsWith('/rest/v1/')) {
      if (url.pathname.endsWith('/my_console_access')) {
        state.accessCalls++
        return state.failAccess ? reply({ code: 'XX000', message: 'Access service temporarily unavailable' }, 503) : reply(state.access)
      }
      state.otherRestCalls.push(url.pathname)
      if (url.pathname.endsWith('/employees')) return reply(state.access.member ? [state.access.member] : [])
      if (url.pathname.endsWith('/my_employee_invitations')) return reply(state.access.employee_invitations ?? [])
      if (url.pathname.endsWith('/accept_employee_invitation')) {
        state.access = { ...empty, member, employee_invitations: [] }
        return reply(organization.id)
      }
      if (url.pathname.endsWith('/create_my_organization')) {
        const input = route.request().postDataJSON()
        const created = { ...organization, id: 'new-organization', name: input.p_name }
        state.access = { ...state.access, organizations: [created], can_create_organization: false }
        return reply(created.id)
      }
      if (url.pathname.endsWith('/employee_sites')) return reply([{ sites: { id: 'site-1', name: 'Main site', organization_id: organization.id } }])
      if (url.pathname.endsWith('/presence_sessions')) return reply(state.openSession ? [state.openSession] : [])
      if (url.pathname.endsWith('/my_timesheet')) return reply([])
      if (url.pathname.endsWith('/my_timesheet_entries')) return reply([])
      if (url.pathname.endsWith('/web_clock')) {
        const input = route.request().postDataJSON()
        state.clockCalls.push(input)
        if (input.p_action === 'heartbeat') return reply(state.openSession?.id ?? null)
        if (state.failClock) return reply({ code: '42501', message: 'Your team requires your registered Employee app for clock-in' }, 403)
        state.openSession = input.p_action === 'in' ? { id: 1, user_id: user.id, site_id: input.p_site_id, entry_timestamp: Date.now(), exit_timestamp: null } : null
        return reply(1)
      }
      if (url.pathname.endsWith('/respond_to_console_invitation')) {
        state.access = { ...empty, organizations: [organization] }
        return reply(organization.id)
      }
      if (url.pathname.endsWith('/organizations') && url.searchParams.has('select')) return reply({ ...state.access.organizations[0] ?? organization, country_code: 'IN', industry: null, team_size: null })
      return reply([])
    }
    if (url.origin === origin) return route.continue()
    return route.abort()
  })
  try {
    await page.goto(`${origin}/login`)
    await page.getByLabel('Email address').fill('manager@example.test')
    await page.getByLabel('Password', { exact: true }).fill('test-password-123')
    await page.getByRole('button', { name: 'Sign in', exact: true }).click()
    await run(page, state)
    assert.deepEqual(errors, [], 'no uncaught browser errors')
    console.log(`PASS ${name}`)
    passed++
  } finally { await context.close() }
}

async function heading(page, name) {
  await page.getByRole('heading', { name, exact: true }).waitFor()
}
async function noOverflow(page) {
  assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true, 'no horizontal page overflow')
}

try {
  await mkdir(screenshots, { recursive: true })
  let ready = false
  for (let attempt = 0; attempt < 100; attempt++) {
    if (server.exitCode !== null) throw new Error(`Vite exited: ${serverOutput}`)
    try { if ((await fetch(origin)).ok) { ready = true; break } } catch { /* server starting */ }
    await new Promise(resolve => setTimeout(resolve, 100))
  }
  assert.ok(ready, `Vite ready: ${serverOutput}`)
  browser = await chromium.launch({ headless: true })

  await scenario('new account chooses create or join before setup', { ...empty, can_create_organization: true }, async page => {
    await heading(page, 'Your Crewtraxa account')
    assert.equal(new URL(page.url()).pathname, '/account')
    await page.getByText('Join an organization', { exact: true }).click()
    await page.getByRole('link', { name: 'Create an organization', exact: true }).click()
    await heading(page, 'Create your organization')
    assert.equal(new URL(page.url()).pathname, '/setup')
  })
  await scenario('existing admin resumes organization setup', { ...empty, organizations: [organization] }, async page => {
    await heading(page, 'Tell us about your company')
    assert.equal(new URL(page.url()).pathname, '/setup')
  })
  await scenario('employee keeps session and can refresh into an invitation', { ...empty, access_block_reason: 'employee' }, async (page, state) => {
    await heading(page, 'Your employee account is ready')
    assert.equal(state.signOutCalls, 0)
    await noOverflow(page)
    await page.screenshot({ path: join(screenshots, 'employee-desktop.png'), fullPage: true })
    await page.reload()
    await heading(page, 'Your employee account is ready')
    assert.equal(state.tokenCalls, 1, 'restored session does not require another sign-in')
    for (const path of ['/employees', '/setup']) {
      await page.goto(`${origin}${path}`)
      await heading(page, 'Your employee account is ready')
    }
    assert.ok(state.otherRestCalls.every(path => path.endsWith('/employees') || path.endsWith('/my_employee_invitations')), 'denied routes only load the caller profile and invitations')
    state.access = { ...empty, access_block_reason: 'employee', invitations: [{ id: 'invite-1', organization_id: organization.id, organization_name: organization.name, role: 'manager', expires_at: '2030-01-01T00:00:00Z' }] }
    await page.getByRole('button', { name: 'Refresh access', exact: true }).click()
    await heading(page, 'You have an invitation')
    await page.getByRole('button', { name: 'Accept', exact: true }).click()
    await heading(page, 'Tell us about your company')
  })
  await scenario('legacy server shows deployment help instead of employee error', { is_platform_admin: false, organizations: [] }, async (page, state) => {
    await heading(page, 'Organization setup needs an update')
    await page.getByText('Deployment details', { exact: true }).click()
    await page.getByText(/20261031000003_self_service_organizations.sql/).waitFor()
    await noOverflow(page)
    await page.screenshot({ path: join(screenshots, 'upgrade-mobile.png'), fullPage: true })
    state.access = { ...empty, can_create_organization: true }
    await page.getByRole('button', { name: 'Refresh access', exact: true }).click()
    await heading(page, 'Your Crewtraxa account')
  }, { mobile: true })
  await scenario('employee mobile has a working account switch', { ...empty, access_block_reason: 'employee' }, async (page, state) => {
    await heading(page, 'Your employee account is ready')
    await noOverflow(page)
    await page.screenshot({ path: join(screenshots, 'employee-mobile.png'), fullPage: true })
    await page.getByRole('button', { name: 'Use another account', exact: true }).click()
    await heading(page, 'Welcome back')
    assert.equal(new URL(page.url()).pathname, '/login')
    assert.equal(state.signOutCalls, 1)
  }, { mobile: true })
  for (const [reason, title] of [
    ['confirm_email', 'Confirm your email to continue'],
    ['organization_unavailable', 'Your organization needs attention'],
    ['role_required', 'Join your organization'],
  ]) {
    await scenario(reason, { ...empty, access_block_reason: reason }, async page => heading(page, title))
  }
  await scenario('older guidance response remains actionable', empty, async page => heading(page, 'Join your organization'))
  await scenario('access failures retry without signing out', { ...empty, access_block_reason: 'employee' }, async (page, state) => {
    await heading(page, 'Your employee account is ready')
    state.failAccess = true
    await page.getByRole('button', { name: 'Refresh access', exact: true }).click()
    await page.getByRole('alert').filter({ hasText: 'Console access could not be checked' }).waitFor()
    assert.equal(state.signOutCalls, 0)
    state.failAccess = false
    await page.getByRole('button', { name: /try again|retry/i }).click()
    await heading(page, 'Your employee account is ready')
  })
  await scenario('platform admin can create first organization', { ...empty, is_platform_admin: true }, async page => {
    await heading(page, 'Organizations')
    assert.equal(new URL(page.url()).pathname, '/organizations')
  })
  await scenario('invalid credentials stay on sign-in', empty, async page => {
    await page.getByRole('alert').filter({ hasText: 'Invalid login credentials' }).waitFor()
    assert.equal(new URL(page.url()).pathname, '/login')
  }, { invalidPassword: true })
  await scenario('normal member signs in without a Console role', { ...empty, member }, async (page, state) => {
    await heading(page, 'My workspace')
    assert.equal(new URL(page.url()).pathname, '/me')
    await page.getByText('No attendance records for this week.', { exact: true }).waitFor()
    await noOverflow(page)
    await page.screenshot({ path: join(screenshots, 'member-desktop.png'), fullPage: true })
    await page.reload()
    await heading(page, 'My workspace')
    assert.equal(state.tokenCalls, 1)
    await page.getByRole('button', { name: 'Clock in', exact: true }).click()
    await page.getByRole('button', { name: 'Clock out', exact: true }).waitFor()
    assert.equal(state.clockCalls[0].p_latitude, 12.9)
    assert.equal(state.clockCalls[0].p_user_id, undefined)
    await page.getByRole('button', { name: 'Clock out', exact: true }).click()
    await page.getByRole('button', { name: 'Clock in', exact: true }).waitFor()
    await page.goto(`${origin}/employees`)
    await heading(page, 'My workspace')
    assert.equal(new URL(page.url()).pathname, '/me', 'member does not enter the management directory')
  })
  await scenario('member can join by accepting an employee invitation', { ...empty, can_create_organization: true, employee_invitations: [{ employee_id: member.id, organization_id: organization.id, organization_name: organization.name, first_name: 'Test', last_name: 'Member' }] }, async page => {
    await heading(page, 'Your team invitations')
    await page.getByRole('button', { name: 'Accept invitation', exact: true }).click()
    await heading(page, 'My workspace')
    assert.equal(new URL(page.url()).pathname, '/me')
  })
  await scenario('member has both personal and organization-creation choices on mobile', { ...empty, member, can_create_organization: true }, async page => {
    await heading(page, 'My workspace')
    await noOverflow(page)
    await page.screenshot({ path: join(screenshots, 'member-mobile.png'), fullPage: true })
    await page.getByRole('link', { name: 'My account', exact: true }).click()
    await heading(page, 'Your Crewtraxa account')
    await page.getByRole('link', { name: 'Open my workspace', exact: true }).waitFor()
    await noOverflow(page)
    await page.screenshot({ path: join(screenshots, 'account-mobile.png'), fullPage: true })
    await page.getByRole('link', { name: 'Create an organization', exact: true }).click()
    await heading(page, 'Create your organization')
  }, { mobile: true })
  await scenario('clock-in policy errors remain actionable', { ...empty, member }, async (page, state) => {
    await heading(page, 'My workspace')
    state.failClock = true
    await page.getByRole('button', { name: 'Clock in', exact: true }).click()
    await page.getByRole('alert').filter({ hasText: 'registered Employee app' }).waitFor()
    assert.equal(state.signOutCalls, 0)
  })
  await scenario('existing Console member can create a separate organization', { ...empty, organizations: [organization], can_create_organization: true }, async page => {
    await heading(page, 'Tell us about your company')
    await page.goto(`${origin}/account`)
    await heading(page, 'Your Crewtraxa account')
    await page.getByRole('link', { name: 'Create an organization', exact: true }).click()
    await heading(page, 'Create your organization')
    await page.getByLabel('Organization name', { exact: true }).fill('Member Services')
    await page.getByRole('button', { name: 'Create organization', exact: true }).click()
    await heading(page, 'Tell us about your company')
    assert.equal(new URL(page.url()).pathname, '/setup')
    assert.equal(new URL(page.url()).search, '')
  })
  console.log(`${passed} browser scenarios passed. Screenshots: ${screenshots}`)
} finally {
  await browser?.close()
  server.kill()
}
