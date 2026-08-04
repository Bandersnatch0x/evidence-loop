import { defineConfig } from 'vitest/config'

export default defineConfig({
  test: {
    environment: 'jsdom',
    setupFiles: ['./src/test/setup.ts'],
    css: true,
    include: ['tests/**/*.test.{ts,tsx}'],
    // Run test files serially. Several suites spin up real HTTP servers
    // (server.listen(0)) and open sqlite handles; running them in parallel
    // under a loaded machine caused intermittent startup/timeout flakes
    // (observed 5 red .tsx files that passed on re-run). Serial execution
    // trades total runtime for deterministic results — worth it for CI.
    fileParallelism: false
  }
})
