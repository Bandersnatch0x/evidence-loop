import { defineConfig } from '@playwright/test'

export default defineConfig({
  testDir: './e2e',
  timeout: 30_000,
  retries: 0,
  workers: 1,
  use: {
    baseURL: process.env.BASE_URL ?? 'http://localhost:4173',
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
    // Probe an EvidenceRing-specific endpoint so Playwright never reuses an
    // unrelated Vite app that happens to occupy port 4173.
    url: 'http://localhost:4173/api/health',
    reuseExistingServer: true,
    timeout: 120_000
  }
})
