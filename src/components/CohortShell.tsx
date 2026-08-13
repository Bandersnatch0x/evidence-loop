/**
 * CohortShell — P1 merged cohort entry: overview + mastery matrix tabs.
 *
 * Navigation-layer merge (architecture deepening P1). CohortView and
 * CohortMasteryView keep their own data-fetch paths; this shell only
 * swaps the active tab. Sidebar drops cohort-mastery as a top-level item.
 */
import { useState, type ReactNode } from 'react'
import type { CohortSnapshot } from '../../shared/contracts'
import { CohortView } from './CohortView'

export interface CohortShellProps {
  cohort?: CohortSnapshot
  initialTab?: 'overview' | 'mastery'
  /** Mastery matrix rendered lazily (keeps its own data fetch). */
  renderMastery: () => ReactNode
}

export function CohortShell({
  cohort,
  initialTab = 'overview',
  renderMastery
}: CohortShellProps) {
  const [tab, setTab] = useState<'overview' | 'mastery'>(initialTab)

  return (
    <div className="cohort-shell">
      <div className="cohort-tabs" role="tablist" aria-label="班级学情视图">
        <button
          type="button"
          role="tab"
          aria-selected={tab === 'overview'}
          className={tab === 'overview' ? 'cohort-tab active' : 'cohort-tab'}
          onClick={() => setTab('overview')}
        >
          学情概览
        </button>
        <button
          type="button"
          role="tab"
          aria-selected={tab === 'mastery'}
          className={tab === 'mastery' ? 'cohort-tab active' : 'cohort-tab'}
          onClick={() => setTab('mastery')}
        >
          掌握度矩阵
        </button>
      </div>
      <div role="tabpanel">
        {tab === 'overview' ? (
          <CohortView cohort={cohort} isLoading={false} />
        ) : (
          renderMastery()
        )}
      </div>
    </div>
  )
}
