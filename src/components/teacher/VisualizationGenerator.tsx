/**
 * VisualizationGenerator — teacher AI-generate / manual JSON → preview → adopt
 * flow for a 3D visualization (ADR-0015: ball_stick / curve / primitives).
 *
 * Mounted inside QuestionEditor (edit mode only — a questionId is required).
 * Paths: (1) natural-language LLM draft, (2) manual JSON paste without LLM.
 * Confirms persist onto the Question; the student-side Visualizer then renders.
 *
 * PRODUCT.md boundary: the LLM only drafts presentation content — it never
 * scores. The "已确认" / "待确认" badge makes the authority grade visible.
 */
import { Suspense, lazy, useState, type ReactNode } from 'react'
import { AlertTriangle, Sparkles, FileJson } from 'lucide-react'
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
const PrimitivesScene = lazy(() =>
  import('../visualizer/scenes/PrimitivesScene').then((m) => ({
    default: m.PrimitivesScene
  }))
)

function VisualizationPreview({ visualization }: { visualization: Visualization }): ReactNode {
  if (visualization.kind === 'curve') {
    return <CurveScene visualization={visualization} />
  }
  if (visualization.kind === 'primitives') {
    return <PrimitivesScene visualization={visualization} />
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
  const [manualJson, setManualJson] = useState('')
  const [preview, setPreview] = useState<Visualization>()
  const [warnings, setWarnings] = useState<string[]>([])
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
      setWarnings(result.warnings ?? [])
    } catch (generateError) {
      setError(
        generateError instanceof Error
          ? generateError.message
          : '生成失败（可能未配置 LLM）'
      )
      setPreview(undefined)
      setWarnings([])
    } finally {
      setBusy(false)
    }
  }

  /** Parse manual JSON client-side shape check; server re-validates on adopt. */
  const handleManualPreview = () => {
    setError(undefined)
    setWarnings([])
    try {
      const raw: unknown = JSON.parse(manualJson)
      if (typeof raw !== 'object' || raw === null || !('kind' in raw)) {
        setError('JSON 需包含 kind（ball_stick | curve | primitives）')
        return
      }
      const record = raw as Record<string, unknown>
      if (typeof record.kind !== 'string') {
        setError('JSON 需包含 kind（ball_stick | curve | primitives）')
        return
      }
      // Trust boundary is still server-side parse on adopt; client only drafts.
      setPreview(raw as Visualization)
      setWarnings(['手动 JSON 预览：确认保存时仍由服务端 schema 校验'])
    } catch {
      setError('JSON 解析失败，请检查格式')
      setPreview(undefined)
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
      setWarnings([])
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
        描述分子/晶体（球棍）、螺旋/轨迹（曲线）或电路/节点图（图元），AI 生成 3D 几何供预览；也可粘贴 JSON 手动录入（无 LLM）。
        确认后学生打开此题即可见。仅展示，不参与评分。
      </p>

      <label>
        结构描述（AI）
        <textarea
          rows={2}
          value={description}
          onChange={(e) => setDescription(e.target.value)}
          placeholder="如：氨气 NH3；磁场螺旋轨迹；串联电路 电源-电阻-开关"
          disabled={busy}
        />
      </label>
      <button
        type="button"
        className="secondary-button"
        disabled={busy}
        onClick={() => void handleGenerate()}
      >
        <Sparkles size={14} /> AI 生成预览
      </button>

      <label>
        手动几何 JSON（无 LLM）
        <textarea
          className="viz-json-input"
          rows={5}
          value={manualJson}
          onChange={(e) => setManualJson(e.target.value)}
          placeholder='{"kind":"curve","points":[[0,0,0],[1,0,1]],"label":"示例"}'
          disabled={busy}
        />
      </label>
      <button
        type="button"
        className="secondary-button"
        disabled={busy}
        onClick={handleManualPreview}
      >
        <FileJson size={14} /> 预览 JSON
      </button>

      {error !== undefined ? (
        <div className="error-banner" role="alert">
          <AlertTriangle size={18} /> {error}
        </div>
      ) : null}

      {warnings.length > 0 ? (
        <div className="viz-warnings">
          几何提示：{warnings.join('；')}
        </div>
      ) : null}

      {preview ? (
        <div className="viz-preview">
          <Suspense fallback={<div className="muted">正在加载 3D 预览…</div>}>
            <VisualizationPreview visualization={preview} />
          </Suspense>
          <div className="viz-actions">
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
              onClick={() => {
                setPreview(undefined)
                setWarnings([])
              }}
            >
              丢弃
            </button>
          </div>
        </div>
      ) : null}

      {confirmed ? (
        <div className="viz-confirmed">
          <div className="viz-scene-caption">
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
          >
            清除演示
          </button>
        </div>
      ) : null}
    </fieldset>
  )
}
