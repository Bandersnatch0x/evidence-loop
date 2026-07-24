/**
 * Auth mode switch (T02 decision).
 * - AUTH_MODE=mock|real (primary)
 * - DEMO_AUTH=true forces mock (task-level demo backdoor switch)
 * - Default: real in production (NODE_ENV=production), mock otherwise.
 *   The mock provider honors the X-Demo-Role header — a demo backdoor that
 *   MUST NOT be reachable on a production server. Production callers must
 *   authenticate via /api/auth/login to obtain a real session.
 */
export type AuthMode = 'mock' | 'real'

export function resolveAuthMode(
  env: NodeJS.ProcessEnv = process.env
): AuthMode {
  const demoAuth = (env.DEMO_AUTH ?? '').trim().toLowerCase()
  if (demoAuth === 'true' || demoAuth === '1' || demoAuth === 'yes') {
    return 'mock'
  }

  const raw = (env.AUTH_MODE ?? '').trim().toLowerCase()
  if (raw === 'real') return 'real'
  if (raw === 'mock') return 'mock'

  // Default: real in production, mock for dev/test. This closes the
  // X-Demo-Role privilege-escalation backdoor on `--production` servers
  // unless DEMO_AUTH is explicitly set.
  const nodeEnv = (env.NODE_ENV ?? '').trim().toLowerCase()
  return nodeEnv === 'production' ? 'real' : 'mock'
}

export function isDemoAuthEnabled(
  env: NodeJS.ProcessEnv = process.env
): boolean {
  return resolveAuthMode(env) === 'mock'
}
