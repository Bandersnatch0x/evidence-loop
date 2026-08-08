import { type ReactNode } from 'react'

export interface QuestionCardProps {
  id: string
  title: string
  /** Knowledge-point tags (121-node DAG ids). */
  kpTags: string[]
  /** 1..5 difficulty band. */
  difficulty: number
  /** Optional header badges (subject / type / source / hasSolution). */
  badges?: ReactNode
  /** Student's last score 0..100. When present, renders a color block. */
  lastScore?: number
  /** Evidence provenance link label (shown only with onEvidence). */
  evidenceLabel?: string
  onEvidence?: () => void
  /** Primary action (开始练 / 查看). */
  onOpen?: () => void
  openLabel?: string
  /** Disable the primary action (e.g. while a start is in flight). */
  openDisabled?: boolean
  /** Footer actions (teacher edit / delete). */
  footer?: ReactNode
}

/**
 * P1-1 shared question card. Student "我的练习" grid and teacher
 * QuestionBankPanel reuse the same component via prop differentiation.
 *
 * 密度优先无插画：文字 / 标签 / 色块，不用装饰图。可 Tab 遍历（所有交互元素
 * 是原生 button）。证据出处链接把卡片锚定到证据来源（红线：证据先于表达）。
 */
function scoreTier(score: number): 'score-high' | 'score-mid' | 'score-low' {
  if (score >= 80) return 'score-high'
  if (score >= 60) return 'score-mid'
  return 'score-low'
}

export function QuestionCard({
  title,
  kpTags,
  difficulty,
  badges,
  lastScore,
  evidenceLabel,
  onEvidence,
  onOpen,
  openLabel = '查看',
  openDisabled = false,
  footer
}: QuestionCardProps) {
  return (
    <article className="question-card" aria-label={title}>
      <header className="question-card-head">
        <div className="question-card-badges">{badges}</div>
        <span className="question-card-difficulty">难度 {difficulty}</span>
      </header>

      <h4 className="question-card-title">{title}</h4>

      {kpTags.length > 0 ? (
        <ul className="question-card-tags" aria-label="知识点标签">
          {kpTags.map((kp) => (
            <li key={kp} className="subject-tag">{kp}</li>
          ))}
        </ul>
      ) : null}

      <div className="question-card-meta">
        {lastScore !== undefined ? (
          <span className={`score-chip ${scoreTier(lastScore)}`}>
            <span className="score-chip-label">上次得分</span>
            <strong>{lastScore}</strong>
          </span>
        ) : null}
        {evidenceLabel !== undefined && onEvidence !== undefined ? (
          <button type="button" className="evidence-link" onClick={onEvidence}>
            {evidenceLabel}
          </button>
        ) : null}
      </div>

      <div className="question-card-actions">
        {onOpen !== undefined ? (
          <button
            type="button"
            className="primary-button"
            onClick={onOpen}
            disabled={openDisabled}
          >
            {openLabel}
          </button>
        ) : null}
        {footer}
      </div>
    </article>
  )
}
