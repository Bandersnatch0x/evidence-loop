/**
 * Student-side 3D draft preview (ADR-0015). LLM generate only — never saves.
 * Mounted in the workspace for student role so learners can explore structures
 * without touching teacher authority or the score path.
 */
import { Suspense, lazy, useState, type ReactNode } from 'react'
import { AlertTriangle, Sparkles } from 'lucide-react'
import type { Visualization } from '../../../shared/contracts'
import { studentPreviewVisualization } from '../../lib/api'

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

function Preview({ visualization }: { visualization: Visualization }): ReactNode {
  if (visualization.kind === 'curve') {
    return <CurveScene visualization={visualization} />
  }
  if (visualization.kind === 'primitives') {
    return <PrimitivesScene visualization={visualization} />
  }
  return <BallStickScene visualization={visualization} />
}

export function StudentVizPreview() {
  const [description, setDescription] = useState('')
  const [preview, setPreview] = useState<Visualization>()
  const [warnings, setWarnings] = useState<string[]>([])
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string>()

  const handleGenerate = async () => {
    if (description.trim() === '') {
      setError('请先描述要预览的 3D 结构')
      return
    }
    setBusy(true)
    setError(undefined)
    try {
      const result = await studentPreviewVisualization(description.trim())
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

  return (
    <fieldset className="visualization-panel student-viz-preview">
      <legend>
        <Sparkles size={16} style={{ verticalAlign: 'middle' }} /> 试生成 3D 演示
      </legend>
      <p className="muted">
        学生可草稿预览分子/螺旋/电路示意图。仅本地预览，
        <strong>不会保存</strong>到题库，也不参与评分。
      </p>
      <label>
        结构描述
        <textarea
          rows={2}
          value={description}
          onChange={(e) => setDescription(e.target.value)}
          placeholder="如：水分子；磁场螺旋；串联电路"
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
      {warnings.length > 0 ? (
        <div className="viz-warnings">
          几何提示：{warnings.join('；')}
        </div>
      ) : null}
      {preview ? (
        <div className="viz-preview">
          <Suspense fallback={<div className="muted">正在加载 3D 预览…</div>}>
            <Preview visualization={preview} />
          </Suspense>
          <button
            type="button"
            className="secondary-button"
            disabled={busy}
            onClick={() => {
              setPreview(undefined)
              setWarnings([])
            }}
          >
            关闭预览
          </button>
        </div>
      ) : null}
    </fieldset>
  )
}
