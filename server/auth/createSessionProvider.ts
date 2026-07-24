/**
 * Factory that selects MockSessionProvider vs RealSessionProvider from env.
 * Coordinator wires this at bootstrap; auth module stays self-contained.
 */
import type Database from 'better-sqlite3'
import { resolveAuthMode, type AuthMode } from './authMode'
import type { AuthStore } from './AuthStore'
import { MockSessionProvider } from './MockSessionProvider'
import { RealSessionProvider } from './RealSessionProvider'
import type { SessionProvider } from './SessionProvider'

export interface CreateSessionProviderOptions {
  env?: NodeJS.ProcessEnv
  /** Required when mode resolves to `real` and `store` is omitted. */
  db?: Database.Database
  store?: AuthStore
  /** Force a mode regardless of env (tests). */
  mode?: AuthMode
}

export function createSessionProvider(
  options: CreateSessionProviderOptions = {}
): SessionProvider {
  const mode = options.mode ?? resolveAuthMode(options.env ?? process.env)
  if (mode === 'mock') {
    return new MockSessionProvider()
  }

  if (options.store !== undefined) {
    return new RealSessionProvider({ store: options.store })
  }

  if (options.db === undefined) {
    throw new Error(
      'createSessionProvider(mode=real) requires db or store'
    )
  }
  return new RealSessionProvider({ db: options.db })
}
