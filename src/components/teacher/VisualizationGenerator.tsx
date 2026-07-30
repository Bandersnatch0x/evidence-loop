/**
 * VisualizationGenerator — teacher AI-generate → preview → adopt flow for a
 * 3D visualization (ADR-0015 + Phase 4 curve).
 *
 * Mounted inside QuestionEditor (edit mode only — a questionId is required).
 * The teacher types a natural-language description, the server's LLM proposes
 * ball_stick or curve geometry, this component previews it live in 3D, and
 * the teacher confirms (adopt) or discards. Confirms persist onto the
 * Question; the student-side Visualizer then renders it.
 *
 * PRODUCT.md boundary: the LLM only drafts presentation content — it never
 * scores. The "已确认" / "待确认" badge makes the authority grade visible.
 */
import { Suspense, lazy, useState, type ReactNode } from 'react'
import { AlertTriangle, Sparkles } from 'lucide-react'
import type { Question, Visualization } from '../../../shared/contracts'
import {
  adoptVisualization,
  previewVisualization
} from '../../lib/api'

// Lazy-load so three/fiber/drei stay out of the teacher-form main chunk
// (ADR-0013 lazy-loading discipline). Only downloads when a preview renders.
const BallStickScene = lazy(() =>
  import('../visualizer/scenes/BallStickScene').then((m) => ({
    default: m.BallStickScene
  }))
)
const CurveScene = lazy(() =>
  import('../visualizer/scenes/CurveScene').then((m) => ({
    default: m.CurveScene
  }))
)

function VisualizationPreview({ visualization }: { visualization: Visualization }): ReactNode {
  if (visualization.kind === 'curve') {
    return <CurveScene visualization={visualization} />
  }
  return <BallStickScene visualization={visualization} />
}

export interface VisualizationGeneratorProps {
  questionId: string
  /** Current confirmed visualization (if any) — shown as the live state. */
  initial?: Visualization
  /** Called after a successful adopt/clear so the parent can refresh. */
  onAdopted?: (question: Question) => void
}

export function VisualizationGenerator({
  questionId,
  initial,
  onAdopted
}: VisualizationGeneratorProps) {
  const [description, setDescription] = useState('')
  const [preview, setPreview] = useState<Visualization>()
  const [confirmed, setConfirmed] = useState<Visualization | undefined>(initial)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string>()

  const handleGenerate = async () => {
    if (description.trim() === '') {
      setError('请先描述要生成的 3D 结构')
      return
    }
    setBusy(true)
    setError(undefined)
    try {
      const result = await previewVisualization(questionId, description.trim())
      setPreview(result.visualization)
    } catch (generateError) {
      setError(
        generateError instanceof Error
          ? generateError.message
          : '生成失败（可能未配置 LLM）'
      )
      setPreview(undefined)
    } finally {
      setBusy(false)
    }
  }

  const handleAdopt = async () => {
    if (!preview) return
    setBusy(true)
    setError(undefined)
    try {
      const result = await adoptVisualization(questionId, preview)
      setConfirmed(result.question.visualization)
      setPreview(undefined)
      onAdopted?.(result.question)
    } catch (adoptError) {
      setError(adoptError instanceof Error ? adoptError.message : '确认失败')
    } finally {
      setBusy(false)
    }
  }

  const handleClear = async () => {
    setBusy(true)
    setError(undefined)
    try {
      const result = await adoptVisualization(questionId, null)
      setConfirmed(undefined)
      onAdopted?.(result.question)
    } catch (clearError) {
      setError(clearError instanceof Error ? clearError.message : '清除失败')
    } finally {
      setBusy(false)
    }
  }

  return (
    <fieldset className="visualization-panel">
      <legend>
        <Sparkles size={16} style={{ verticalAlign: 'middle' }} /> 3D 演示生成
      </legend>
      <p className="muted">
        描述分子/晶体（球棍）或螺旋/轨迹（曲线），AI 生成 3D 几何供预览；确认后学生打开此题即可见。
        仅展示，不参与评分。
      </p>

      <label>
        结构描述
        <textarea
          rows={2}
          value={description}
          onChange={(e) => setDescription(e.target.value)}
          placeholder="如：氨气 NH3 三角锥；或：带电粒子在磁场中的螺旋轨迹"
          disabled={busy}
        />
      </label>
      <button
        type="button"
        className="secondary-button"
        disabled={busy}
        onClick={() => void handleGenerate()}
      >
        <Sparkles size={14} /> 生成预览
      </button>

      {error !== undefined ? (
        <div className="error-banner">
          <AlertTriangle size={18} /> {error}
        </div>
      ) : null}

      {preview ? (
        <div className="viz-preview">
          <Suspense fallback={<div className="muted">正在加载 3D 预览…</div>}>
            <VisualizationPreview visualization={preview} />
          </Suspense>
          <div style={{ marginTop: 8, display: 'flex', gap: 8 }}>
            <button
              type="button"
              className="primary-button"
              disabled={busy}
              onClick={() => void handleAdopt()}
            >
              确认并保存
            </button>
            <button
              type="button"
              className="secondary-button"
              disabled={busy}
              onClick={() => setPreview(undefined)}
            >
              丢弃
            </button>
          </div>
        </div>
      ) : null}

      {confirmed ? (
        <div className="viz-confirmed" style={{ marginTop: 12 }}>
          <div style={{ fontSize: 13, color: '#374151', marginBottom: 4 }}>
            当前演示（AI 生成 · 教师已确认）
          </div>
          <Suspense fallback={<div className="muted">正在加载 3D 预览…</div>}>
            <VisualizationPreview visualization={confirmed} />
          </Suspense>
          <button
            type="button"
            className="secondary-button"
            disabled={busy}
            onClick={() => void handleClear()}
            style={{ marginTop: 8 }}
          >
            清除演示
          </button>
        </div>
      ) : null}
    </fieldset>
  )
}
