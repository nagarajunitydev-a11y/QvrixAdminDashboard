import { defineConfig } from '@playwright/test'
import local from './playwright.config'

export default defineConfig(local, {
  testDir: './tests/live',
  // Live sessions must never be written into trace archives.
  use: { trace: 'off', screenshot: 'off', video: 'off' },
  reporter: 'list',
})
