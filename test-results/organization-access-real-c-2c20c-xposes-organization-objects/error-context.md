# Instructions

- Following Playwright test failed.
- Explain why, be concise, respect Playwright best practices.
- Provide a snippet of code with the fix, if possible.

# Test info

- Name: organization-access.spec.ts >> real configured Data API exposes organization objects
- Location: tests\live\organization-access.spec.ts:26:1

# Error details

```
Error: organizations?select=id&limit=0

expect(received).toContain(expected) // indexOf

Expected value: 404
Received array: [401, 403]
```

```
Error: organizations?select=id&limit=0

expect(received).toBe(expected) // Object.is equality

Expected: "42501"
Received: "PGRST205"
```

```
Error: organization_memberships?select=*&user_id=eq.00000000-0000-0000-0000-000000000000

expect(received).toContain(expected) // indexOf

Expected value: 404
Received array: [401, 403]
```

```
Error: organization_memberships?select=*&user_id=eq.00000000-0000-0000-0000-000000000000

expect(received).toBe(expected) // Object.is equality

Expected: "42501"
Received: "PGRST205"
```

```
Error: rpc/is_platform_admin

expect(received).toContain(expected) // indexOf

Expected value: 404
Received array: [401, 403]
```

```
Error: rpc/is_platform_admin

expect(received).toBe(expected) // Object.is equality

Expected: "42501"
Received: "PGRST202"
```

```
Error: rpc/validate_organization_selection

expect(received).toContain(expected) // indexOf

Expected value: 404
Received array: [401, 403]
```

```
Error: rpc/validate_organization_selection

expect(received).toBe(expected) // Object.is equality

Expected: "42501"
Received: "PGRST202"
```

# Page snapshot

```yaml
- generic [ref=e3]:
  - complementary [ref=e4]:
    - generic [ref=e15]:
      - paragraph [ref=e16]: Crewtraxa Console
      - paragraph [ref=e17]: Every Team. Every Site. In Sync.
    - generic [ref=e18]:
      - generic [ref=e19]: WORKFORCE MANAGEMENT, REFINED
      - heading "Your people. Your operations. Perfectly in sync." [level=1] [ref=e21]: Your people.Your operations.Perfectly in sync.
      - paragraph [ref=e22]: One clear view of your workforce. Bring your teams, locations, and everyday operations together.
      - generic [ref=e23]:
        - generic [ref=e24]: Location visibility
        - generic [ref=e28]: Connected teams
        - generic [ref=e34]: Daily insights
    - paragraph [ref=e37]: Crewtraxa Console / Every Team. Every Site. In Sync.
  - main [ref=e38]:
    - generic [ref=e39]:
      - paragraph [ref=e40]: WELCOME TO TRACKORA CONSOLE
      - heading "Good to see you again." [level=2] [ref=e41]
      - paragraph [ref=e42]: Sign in to keep your workforce moving in sync.
      - generic [ref=e43]:
        - generic [ref=e44]:
          - text: Work email
          - textbox "Work email" [ref=e46]:
            - /placeholder: you@company.com
        - generic [ref=e47]:
          - text: Password
          - generic [ref=e48]:
            - textbox "Password" [ref=e49]:
              - /placeholder: Enter your password
            - button "Show password" [ref=e50] [cursor=pointer]
        - generic [ref=e54] [cursor=pointer]:
          - checkbox "Remember my email" [ref=e55]
          - generic [ref=e56]: Remember my email
        - button "Sign in to your workspace" [ref=e57] [cursor=pointer]
      - generic [ref=e59]: Secure access for organization members
```

# Test source

```ts
  1   | import { test, expect, type Page, type APIRequestContext } from '@playwright/test'
  2   | import { randomUUID } from 'node:crypto'
  3   | import { loadEnv } from 'vite'
  4   | import { writeFile } from 'node:fs/promises'
  5   | 
  6   | const env = loadEnv('test', process.cwd(), 'VITE_')
  7   | const backend = env.VITE_SUPABASE_URL.replace(/\/$/, '')
  8   | const key = env.VITE_SUPABASE_ANON_KEY
  9   | 
  10  | async function openAuthenticatedConsole(page: Page, request: APIRequestContext, token: string) {
  11  |   const identity = await request.get(`${backend}/auth/v1/user`, { headers: { apikey: key, Authorization: `Bearer ${token}` } })
  12  |   expect(identity.ok(), 'Test JWT must be accepted by the configured project').toBe(true)
  13  |   const user = await identity.json()
  14  |   const claims = JSON.parse(Buffer.from(token.split('.')[1], 'base64url').toString())
  15  |   expect(claims.role).toBe('authenticated')
  16  |   expect(claims.exp).toBeGreaterThan(Date.now() / 1000 + 180)
  17  |   await page.addInitScript(({ project, token, user, exp }) => {
  18  |     localStorage.setItem(`sb-${project}-auth-token`, JSON.stringify({
  19  |       access_token: token, refresh_token: '', token_type: 'bearer',
  20  |       expires_at: exp, expires_in: exp - Math.floor(Date.now() / 1000), user,
  21  |     }))
  22  |   }, { project: new URL(backend).hostname.split('.')[0], token, user, exp: claims.exp })
  23  |   return user
  24  | }
  25  | 
  26  | test('real configured Data API exposes organization objects', async ({ page }, info) => {
  27  |   const consoleErrors: string[] = []
  28  |   page.on('console', message => {
  29  |     if (message.type() === 'error') consoleErrors.push(message.text())
  30  |   })
  31  |   page.on('pageerror', error => consoleErrors.push(error.message))
  32  |   await page.goto('/employees')
  33  |   await expect(page).toHaveURL(/\/login/)
  34  |   // Real network requests from the Console origin; no route interception or fake JWT.
  35  |   // The nil UUID is only a filter and does not impersonate an authenticated user.
  36  |   const results = await page.evaluate(async ({ backend, key }) => {
  37  |     const paths = [
  38  |       'organizations?select=id&limit=0',
  39  |       'organization_memberships?select=*&user_id=eq.00000000-0000-0000-0000-000000000000',
  40  |       'rpc/is_platform_admin',
  41  |       'rpc/validate_organization_selection',
  42  |     ]
  43  |     return Promise.all(paths.map(async path => {
  44  |       const rpc = path.startsWith('rpc/')
  45  |       const response = await fetch(`${backend}/rest/v1/${path}`, {
  46  |         method: rpc ? 'POST' : 'GET',
  47  |         headers: { apikey: key, ...(key.startsWith('eyJ') ? { Authorization: `Bearer ${key}` } : {}), 'Content-Type': 'application/json' },
  48  |         ...(rpc ? { body: JSON.stringify(path.endsWith('validate_organization_selection')
  49  |           ? { org: '00000000-0000-0000-0000-000000000000' } : {}) } : {}),
  50  |       })
  51  |       return { path, status: response.status, body: await response.json() }
  52  |     }))
  53  |   }, { backend, key })
  54  |   const evidence = info.outputPath('real-data-api-responses.json')
  55  |   await writeFile(evidence, JSON.stringify({ project: new URL(backend).hostname, results, consoleErrors }, null, 2))
  56  |   await info.attach('real-data-api-responses', { path: evidence, contentType: 'application/json' })
  57  |   console.log(JSON.stringify({ project: new URL(backend).hostname, results, consoleErrors }, null, 2))
  58  |   for (const result of results) {
  59  |     // The checked-in migration revokes anon access to all four objects.
  60  |     // PostgREST maps 42501 to 401 for anon or 403 for authenticated requests.
  61  |     // Require the SQL error code too: an invalid-key/JWT 401 is not readiness.
  62  |     expect.soft([401, 403], result.path).toContain(result.status)
> 63  |     expect.soft(result.body.code, result.path).toBe('42501')
      |                                                ^ Error: rpc/validate_organization_selection
  64  |   }
  65  | })
  66  | 
  67  | test('real authenticated member opens Console and cannot select another organization', async ({ page, request }) => {
  68  |   const token = process.env.CREWTRAXA_TEST_A_ADMIN_TOKEN
  69  |   const allowed = process.env.CREWTRAXA_TEST_ORG_A
  70  |   const denied = process.env.CREWTRAXA_TEST_ORG_B
  71  |   test.skip(!token || !allowed || !denied, 'Requires authenticated A admin JWT and dedicated organization A/B IDs; no session is fabricated.')
  72  |   const headers = { apikey: key, Authorization: `Bearer ${token}` }
  73  |   const identity = await request.get(`${backend}/auth/v1/user`, { headers })
  74  |   expect(identity.ok(), 'Test JWT must be accepted by the configured project').toBe(true)
  75  |   const user = await identity.json()
  76  |   const claims = JSON.parse(Buffer.from(token!.split('.')[1], 'base64url').toString())
  77  |   expect(claims.role).toBe('authenticated')
  78  |   expect(claims.exp).toBeGreaterThan(Date.now() / 1000 + 120)
  79  |   const membership = await request.get(`${backend}/rest/v1/organization_memberships?select=*&user_id=eq.${user.id}`, { headers })
  80  |   expect(membership.status()).toBe(200)
  81  |   const memberships = await membership.json()
  82  |   expect(memberships.some((m: { organization_id: string; status: string }) => m.organization_id === allowed && m.status === 'active')).toBe(true)
  83  |   expect(memberships.some((m: { organization_id: string }) => m.organization_id === denied)).toBe(false)
  84  |   const rejection = await request.post(`${backend}/rest/v1/rpc/validate_organization_selection`, { headers, data: { org: denied } })
  85  |   expect(rejection.status()).toBe(403)
  86  |   const hiddenOrganization = await request.get(`${backend}/rest/v1/organizations?select=id&id=eq.${denied}`, { headers })
  87  |   expect(hiddenOrganization.status()).toBe(200)
  88  |   expect(await hiddenOrganization.json()).toEqual([])
  89  |   const errors: string[] = []
  90  |   const failedRequests: string[] = []
  91  |   page.on('pageerror', error => errors.push(error.message))
  92  |   page.on('console', message => { if (message.type() === 'error') errors.push(message.text()) })
  93  |   page.on('response', response => {
  94  |     if (response.url().startsWith(`${backend}/rest/v1/`) && response.status() >= 400)
  95  |       failedRequests.push(`${response.status()} ${new URL(response.url()).pathname}`)
  96  |   })
  97  |   await page.addInitScript(({ project, token, user, exp, allowed }) => {
  98  |     localStorage.setItem(`sb-${project}-auth-token`, JSON.stringify({
  99  |       access_token: token, refresh_token: '', token_type: 'bearer',
  100 |       expires_at: exp, expires_in: exp - Math.floor(Date.now() / 1000), user,
  101 |     }))
  102 |     localStorage.setItem(`crewtraxa-organization:${user.id}`, allowed)
  103 |   }, { project: new URL(backend).hostname.split('.')[0], token: token!, user, exp: claims.exp, allowed: allowed! })
  104 |   await page.goto('/employees')
  105 |   await expect(page.getByRole('heading', { name: 'Employees', exact: true })).toBeVisible()
  106 |   await expect(page.getByLabel('Switch organization').locator(`option[value="${denied}"]`)).toHaveCount(0)
  107 |   expect(failedRequests).toEqual([])
  108 |   expect(errors).toEqual([])
  109 | })
  110 | 
  111 | test('real platform admin creates, edits, assigns members and changes organization lifecycle', async ({ page, request }) => {
  112 |   test.setTimeout(90000)
  113 |   const token = process.env.CREWTRAXA_TEST_PLATFORM_ADMIN_TOKEN
  114 |   const member = process.env.CREWTRAXA_TEST_MEMBER_UUID
  115 |   test.skip(!token || !member, 'Requires a real platform admin JWT and separate verified test member UUID. Creates a dedicated test organization, then suspends it for cleanup.')
  116 |   const user = await openAuthenticatedConsole(page, request, token!)
  117 |   expect(member).not.toBe(user.id)
  118 |   const headers = { apikey: key, Authorization: `Bearer ${token}` }
  119 |   const platform = await request.post(`${backend}/rest/v1/rpc/is_platform_admin`, { headers, data: {} })
  120 |   expect(platform.status()).toBe(200)
  121 |   expect(await platform.json()).toBe(true)
  122 |   const name = `Crewtraxa isolation test UI ${randomUUID()}`
  123 |   const browserErrors: string[] = []
  124 |   page.on('console', message => { if (message.type() === 'error') browserErrors.push(message.text()) })
  125 |   page.on('pageerror', error => browserErrors.push(error.message))
  126 |   let organizationId: string | undefined
  127 |   try {
  128 |     await page.goto('/organizations')
  129 |     await page.getByRole('button', { name: 'Create organization', exact: true }).click()
  130 |     const dialog = page.getByRole('dialog')
  131 |     await dialog.getByLabel('Name', { exact: true }).fill(name)
  132 |     await dialog.getByLabel('Time zone', { exact: true }).fill('UTC')
  133 |     const saved = page.waitForResponse(response => response.url().endsWith('/rpc/save_organization') && response.request().method() === 'POST')
  134 |     await dialog.getByRole('button', { name: 'Save organization' }).click()
  135 |     const response = await saved
  136 |     expect(response.status()).toBe(200)
  137 |     organizationId = (await response.json()).id
  138 |     expect(organizationId).toBeTruthy()
  139 |     // Search keeps the dedicated fixture visible when the platform has >10 orgs.
  140 |     await page.getByLabel('Search table records').fill(name)
  141 |     const row = page.getByRole('row').filter({ hasText: name })
  142 |     await expect(row).toBeVisible()
  143 |     await row.getByRole('button', { name: 'Edit', exact: true }).click()
  144 |     await dialog.getByLabel('Name', { exact: true }).fill(`${name} renamed`)
  145 |     await dialog.getByRole('button', { name: 'Save organization' }).click()
  146 |     await expect(row).toContainText('renamed')
  147 |     await row.getByRole('button', { name: 'Open workspace' }).click()
  148 |     await expect(page).toHaveURL(/\/$/)
  149 |     await page.goto('/users')
  150 |     await page.getByLabel('Existing account UUID').fill(member!)
  151 |     await page.getByLabel('Assigned member role').selectOption('organization_admin')
  152 |     await page.getByRole('button', { name: 'Assign member', exact: true }).click()
  153 |     await expect(page.getByRole('status')).toContainText('Changes saved.')
  154 |     await page.reload()
  155 |     const membership = await request.get(`${backend}/rest/v1/organization_memberships?organization_id=eq.${organizationId}&user_id=eq.${member}&select=role,status`, { headers })
  156 |     expect(membership.status()).toBe(200)
  157 |     expect(await membership.json()).toEqual([{ role: 'organization_admin', status: 'active' }])
  158 |     await page.goto('/organizations')
  159 |     await page.getByLabel('Search table records').fill(name)
  160 |     await row.getByRole('button', { name: 'Edit', exact: true }).click()
  161 |     await dialog.getByLabel('Status', { exact: true }).selectOption('suspended')
  162 |     await dialog.getByRole('button', { name: 'Save organization' }).click()
  163 |     await page.getByRole('button', { name: 'Confirm', exact: true }).click()
```