/**
 * useHashRoute — zero-dependency hash router for demoRole + activeView +
 * current questionId/paperId.
 *
 * Restores state on refresh (#role=student&view=practice&questionId=...).
 * Architecture deepening P0: activeView was useState-only; refresh produced
 * "right role, wrong page". demoRole went to localStorage but view did not.
 */
import { useCallback, useEffect, useState } from 'react'
import type { AppView } from '../components/Sidebar'
import type { DemoRole } from '../../shared/contracts'

export interface HashRouteState {
  role: DemoRole | undefined
  view: AppView | undefined
  questionId: string | undefined
  paperId: string | undefined
}

const VALID_VIEWS: readonly AppView[] = [
  'workspace',
  'practice',
  'mastery',
  'review',
  'teaching',
  'cohort',
  'cohort-mastery',
  'transparency',
  'student-plan',
  'teacher-tools',
  'reviewer'
]

const VALID_ROLES: readonly DemoRole[] = ['student', 'teacher', 'admin']

function isAppView(value: string): value is AppView {
  return (VALID_VIEWS as readonly string[]).includes(value)
}

function isDemoRoleValue(value: string): value is DemoRole {
  return (VALID_ROLES as readonly string[]).includes(value)
}

/** Parse #role=x&view=y&questionId=z&paperId=w into a state object. */
export function parseHashRoute(): HashRouteState {
  const hash = window.location.hash.replace(/^#/, '')
  const params = new URLSearchParams(hash)
  const roleRaw = params.get('role') ?? undefined
  const viewRaw = params.get('view') ?? undefined
  return {
    role: roleRaw && isDemoRoleValue(roleRaw) ? roleRaw : undefined,
    view: viewRaw && isAppView(viewRaw) ? viewRaw : undefined,
    questionId: params.get('questionId') ?? undefined,
    paperId: params.get('paperId') ?? undefined
  }
}

/** Serialize state back into the hash. Omits undefined keys. */
export function writeHashRoute(state: Partial<HashRouteState>): void {
  const params = new URLSearchParams()
  if (state.role) params.set('role', state.role)
  if (state.view) params.set('view', state.view)
  if (state.questionId) params.set('questionId', state.questionId)
  if (state.paperId) params.set('paperId', state.paperId)
  const next = `#${params.toString()}`
  // Avoid clobbering if identical (prevents popstate loops).
  if (window.location.hash !== next) {
    window.location.hash = next
  }
}

/**
 * Hook: returns the current parsed hash state and re-reads on hashchange.
 * Used by App to seed initial state + stay in sync with back/forward.
 */
export function useHashRoute(): HashRouteState {
  const [state, setState] = useState<HashRouteState>(() => parseHashRoute())

  useEffect(() => {
    const onChange = () => setState(parseHashRoute())
    window.addEventListener('hashchange', onChange)
    return () => window.removeEventListener('hashchange', onChange)
  }, [])

  return state
}

/** Stable writer that merges partial state into the current hash. */
export function useHashWriter() {
  return useCallback((partial: Partial<HashRouteState>) => {
    const current = parseHashRoute()
    writeHashRoute({ ...current, ...partial })
  }, [])
}
