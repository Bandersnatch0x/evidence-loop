import { defineConfig } from '@playwright/test'

// Corporate/system proxies must never intercept the local E2E server probe.
const noProxy = [process.env.NO_PROXY, 'localhost', '127.0.0.1'].filter(Boolean).join(',')
process.env.NO_PROXY = noProxy
process.env.no_proxy = noProxy

export default defineConfig({
  testDir: './e2e',
  timeout: 30_000,
  retries: 0,
  workers: 1,
  use: {
    baseURL: process.env.BASE_URL ?? 'http://localhost:4180',
    headless: true,
    viewport: { width: 1280, height: 800 }
  },
  projects: [
    {
      name: 'chromium',
      use: { browserName: 'chromium' }
    },
    {
      name: 'firefox',
      use: { browserName: 'firefox' }
    },
    {
      name: 'webkit',
      use: { browserName: 'webkit' }
    }
  ],
  webServer: {
    command: 'npm run dev',
    // Probe an EvidenceRing-specific endpoint on its dedicated port. Reuse is
    // safe only when this exact health route is available.
    url: 'http://localhost:4180/api/health',
    reuseExistingServer: true,
    timeout: 120_000
  }
})
