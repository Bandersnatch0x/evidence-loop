import { defineConfig } from '@playwright/test'

// Corporate/system proxies must never intercept the local E2E server probe.
const noProxy = [process.env.NO_PROXY, 'localhost', '127.0.0.1'].filter(Boolean).join(',')
process.env.NO_PROXY = noProxy
process.env.no_proxy = noProxy
const e2ePort = Number(process.env.E2E_PORT ?? 4240)
const e2eBaseUrl = process.env.BASE_URL ?? `http://localhost:${String(e2ePort)}`
process.env.BASE_URL = e2eBaseUrl

export default defineConfig({
  testDir: './e2e',
  timeout: 30_000,
  retries: 0,
  workers: 1,
  use: {
    baseURL: e2eBaseUrl,
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
    // Non-watch mode: `tsx watch` spawns a child watcher that may not bind the
    // port when spawned by Playwright on Windows, so the probe times out even
    // though `npm run dev` works interactively. E2E does not need reloads — use
    // a plain `tsx server/index.ts` for a reliable, single-process server.
    command: 'npm run dev:no-watch',
    // Probe an EvidenceRing-specific endpoint on its dedicated port. Reuse is
    // safe only when this exact health route is available.
    url: `${e2eBaseUrl}/api/health`,
    env: {
      PORT: String(e2ePort)
    },
    reuseExistingServer: true,
    timeout: 120_000
  }
})
