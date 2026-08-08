import { useState } from 'react'
import { QuestionCard, type QuestionCardProps } from './QuestionCard'

export interface QuestionCardGridProps {
  cards: QuestionCardProps[]
  emptyHint?: string
}

/**
 * P1-1 card grid with knowledge-point + difficulty filters.
 *
 * Filter chips are native buttons (Tab-traversable, aria-pressed).
 * "全部" resets both filters. Empty state is explicit (not an error).
 */
export function QuestionCardGrid({
  cards,
  emptyHint = '该筛选下暂无题目'
}: QuestionCardGridProps) {
  const [activeKp, setActiveKp] = useState<string | null>(null)
  const [activeDifficulty, setActiveDifficulty] = useState<number | null>(null)

  const allKps = Array.from(new Set(cards.flatMap((card) => card.kpTags)))
  const allDifficulties = Array.from(new Set(cards.map((card) => card.difficulty))).sort(
    (a, b) => a - b
  )

  const filtered = cards.filter((card) => {
    if (activeKp !== null && !card.kpTags.includes(activeKp)) return false
    if (activeDifficulty !== null && card.difficulty !== activeDifficulty) return false
    return true
  })

  const allActive = activeKp === null && activeDifficulty === null
  const reset = () => {
    setActiveKp(null)
    setActiveDifficulty(null)
  }

  return (
    <div className="question-card-grid-wrap">
      <div className="filter-chips" role="group" aria-label="知识点与难度筛选">
        <button
          type="button"
          className={`filter-chip${allActive ? ' is-active' : ''}`}
          aria-pressed={allActive}
          onClick={reset}
        >
          全部
        </button>
        {allKps.map((kp) => (
          <button
            key={kp}
            type="button"
            className={`filter-chip${activeKp === kp ? ' is-active' : ''}`}
            aria-pressed={activeKp === kp}
            onClick={() => setActiveKp((current) => (current === kp ? null : kp))}
          >
            {kp}
          </button>
        ))}
        {allDifficulties.map((d) => (
          <button
            key={d}
            type="button"
            className={`filter-chip${activeDifficulty === d ? ' is-active' : ''}`}
            aria-pressed={activeDifficulty === d}
            onClick={() =>
              setActiveDifficulty((current) => (current === d ? null : d))
            }
          >
            难度 {d}
          </button>
        ))}
      </div>

      {filtered.length > 0 ? (
        <ul className="question-card-grid" aria-label="题目卡片">
          {filtered.map((card) => (
            <li key={card.id} className="question-card-cell">
              <QuestionCard {...card} />
            </li>
          ))}
        </ul>
      ) : (
        <p className="muted question-card-empty">{emptyHint}</p>
      )}
    </div>
  )
}
