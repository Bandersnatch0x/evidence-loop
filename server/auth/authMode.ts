/**
 * Auth mode switch (T02 decision).
 * - AUTH_MODE=mock|real (primary)
 * - DEMO_AUTH=true forces mock (task-level demo backdoor switch)
 * - Default mock so existing demos and tests keep working until wired.
 */
export type AuthMode = 'mock' | 'real'

export function resolveAuthMode(
  env: NodeJS.ProcessEnv = process.env
): AuthMode {
  const demoAuth = (env.DEMO_AUTH ?? '').trim().toLowerCase()
  if (demoAuth === 'true' || demoAuth === '1' || demoAuth === 'yes') {
    return 'mock'
  }

  const raw = (env.AUTH_MODE ?? 'mock').trim().toLowerCase()
  if (raw === 'real') return 'real'
  if (raw === 'mock') return 'mock'
  return 'mock'
}

export function isDemoAuthEnabled(
  env: NodeJS.ProcessEnv = process.env
): boolean {
  return resolveAuthMode(env) === 'mock'
}
