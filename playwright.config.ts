import { defineConfig } from '@playwright/test'
export default defineConfig({
  testDir: './tests/ui',
  timeout: 30000,
  fullyParallel: false,
  use: {
    baseURL: 'http://127.0.0.1:4175',
    channel: process.env.CREWTRAXA_BROWSER_CHANNEL,
    viewport: { width: 1440, height: 960 },
    trace: 'retain-on-failure',
  },
  webServer: {
    command: 'npm run dev -- --host 127.0.0.1 --port 4175 --strictPort',
    url: 'http://127.0.0.1:4175',
    reuseExistingServer: false,
    timeout: 30000,
  },
})
