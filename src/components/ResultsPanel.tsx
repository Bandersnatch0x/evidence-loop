import type { CSSProperties } from 'react'
import {
  Activity,
  ArrowUpRight,
  CheckCircle2,
  CircleDashed,
  CircleX,
  FlaskConical,
  Lightbulb,
  LockKeyhole,
  RotateCw
} from 'lucide-react'
import type {
  EvaluationHistoryItem,
  EvaluationResult,
  ResultState,
  SessionMode
} from '../../shared/contracts'
import { evidenceKindLabel } from '../lib/labels'
import { AdvisoryPanel } from './AdvisoryPanel'
import { EvidenceShieldBadge } from './EvidenceShieldBadge'
import { TutoringPanel } from './tutoring'

interface ResultsPanelProps {
  evaluation?: EvaluationResult
  history: EvaluationHistoryItem[]
  onApplyRepair: () => void
  /**
   * D1 session mode for T05 tutoring gate. Defaults to practice so demo
   * submissions can open the three-layer panels without an Attempt wire-up.
   */
  sessionMode?: SessionMode
  /** Attempt id when the evaluate path has been migrated to AttemptStore. */
  attemptId?: string
}

function StateIcon({ state }: { state: ResultState }) {
  if (state === 'passed') return <CheckCircle2 size={16} />
  if (state === 'failed') return <CircleX size={16} />
  return <CircleDashed size={16} />
}

function EmptyResult() {
  return (
    <div className="result-empty">
      <div className="empty-icon"><FlaskConical size={24} /></div>
      <h3>等待首轮证据</h3>
      <p>运行提交后，这里将呈现测试事实、量规得分、薄弱概念和下一轮修复任务。</p>
      <div className="empty-pipeline" aria-label="评估流程">
        <span>受限运行</span><i />
        <span>量规评分</span><i />
        <span>知识诊断</span>
      </div>
    </div>
  )
}

export function ResultsPanel({
  evaluation,
  history,
  onApplyRepair,
  sessionMode = 'practice',
  attemptId
}: ResultsPanelProps) {
  return (
    <section className="results-panel" aria-labelledby="result-title">
      <header className="panel-header result-header">
        <div>
          <h2 id="result-title">循证评估</h2>
          <p className="panel-subtitle">验证输出 · 证据驱动</p>
        </div>
        <span className="policy-badge"><LockKeyhole size={13} /> 确定性评分</span>
      </header>

      {!evaluation ? (
        <EmptyResult />
      ) : (
        <div className="result-content" aria-live="polite">
          <div className="score-block">
            <div
              className={`score-ring score-${evaluation.status} ${
                evaluation.status === 'completed'
                  ? evaluation.score >= 80
                    ? 'score-high'
                    : evaluation.score >= 60
                      ? 'score-mid'
                      : 'score-low'
                  : ''
              }`}
              style={
                evaluation.status === 'completed'
                  ? ({
                      '--score-pct': `${Math.max(0, Math.min(100, evaluation.score))}%`
                    } as CSSProperties)
                  : undefined
              }
            >
              <div className="score-ring-core">
                <span>{evaluation.score}</span>
                <small>/ 100</small>
              </div>
            </div>
            <div className="score-summary">
              <div className="score-summary-head">
                <span>第 {evaluation.attempt} 次提交</span>
                {evaluation.provenance.kind === 'evidence' && (
                  <EvidenceShieldBadge
                    evidenceIds={evaluation.provenance.evidenceIds}
                    algorithm={evaluation.provenance.algorithm}
                  />
                )}
              </div>
              <p>{evaluation.summary}</p>
              {evaluation.scoreDelta !== undefined && (
                <b className={evaluation.scoreDelta >= 0 ? 'positive' : 'negative'}>
                  <ArrowUpRight size={14} />
                  {evaluation.scoreDelta >= 0 ? '+' : ''}{evaluation.scoreDelta} 分
                </b>
              )}
            </div>
          </div>

          {evaluation.status !== 'completed' && evaluation.rejectionReason && (
            <div className="rejection-notice">
              <CircleX size={17} />
              <div><strong>本次提交未执行</strong><p>{evaluation.rejectionReason}</p></div>
            </div>
          )}

          <div className="result-section">
            <div className="result-section-title">
              <h3>评分证据</h3>
              <span>{evaluation.evidence.filter((item) => item.state === 'passed').length}/{evaluation.evidence.length} 通过</span>
            </div>
            <div className="evidence-list">
              {evaluation.evidence.map((item) => (
                <article className={`evidence-row is-${item.state}`} key={item.id}>
                  <StateIcon state={item.state} />
                  <div>
                    <div className="evidence-heading">
                      <strong>{item.label}</strong>
                      <span>{evidenceKindLabel(item.kind)}</span>
                      {item.visibility === 'hidden' && <LockKeyhole size={12} aria-label="隐藏测试" />}
                    </div>
                    <p>{item.message}</p>
                    {item.state === 'failed' && (item.expected || item.actual) && (
                      <code>期望 {item.expected ?? '通过'} · 实际 {item.actual ?? '未通过'}</code>
                    )}
                  </div>
                  <b>{item.state === 'passed' ? `+${item.weight}` : '0'}</b>
                </article>
              ))}
            </div>
          </div>

          {evaluation.advisory && evaluation.advisory.length > 0 && (
            <AdvisoryPanel suggestions={evaluation.advisory} />
          )}

          <TutoringPanel
            attemptId={attemptId ?? evaluation.id}
            mode={sessionMode}
            evaluationCompleted={evaluation.status === 'completed'}
          />

          {evaluation.diagnoses.length > 0 && (
            <div className="result-section diagnosis-section">
              <div className="result-section-title">
                <h3>知识诊断</h3><span>基于失败证据</span>
              </div>
              {evaluation.diagnoses.map((diagnosis) => (
                <article className="diagnosis-item" key={diagnosis.conceptId}>
                  <div className="diagnosis-icon"><Lightbulb size={17} /></div>
                  <div><strong>{diagnosis.title}</strong><p>{diagnosis.explanation}</p></div>
                </article>
              ))}
            </div>
          )}

          {evaluation.intervention && (
            <div className="intervention-card">
              <span className="section-label">下一轮任务</span>
              <h3>{evaluation.intervention.title}</h3>
              <p>{evaluation.intervention.instruction}</p>
              <ul>
                {evaluation.intervention.successCriteria.map((criterion) => (
                  <li key={criterion}><CheckCircle2 size={14} /> {criterion}</li>
                ))}
              </ul>
              <button className="repair-button" type="button" onClick={onApplyRepair}>
                <RotateCw size={16} /> 应用修复示例
              </button>
            </div>
          )}

          <details className="trace-details">
            <summary><Activity size={15} /> Agent 执行轨迹</summary>
            <ol>
              {evaluation.trace.map((step) => (
                <li key={step.id}>
                  <CheckCircle2 size={14} />
                  <div><strong>{step.label}</strong><span>{step.tool} · {step.durationMs} ms</span></div>
                </li>
              ))}
            </ol>
          </details>

          {history.length > 1 && (
            <p className="history-note">已保存 {history.length} 轮评估，可用于对比修复前后的学习证据。</p>
          )}
        </div>
      )}
    </section>
  )
}
