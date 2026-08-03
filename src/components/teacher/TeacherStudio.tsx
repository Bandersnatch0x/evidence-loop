/**
 * TeacherStudio — teacher authoring workbench front-end (spec §8, ticket T-H).
 *
 * Three-pane layout (left: object tree + resources; center: 2D/3D viewport;
 * right: properties + timeline + AI drawer) + a five-step wizard
 * (建场景 → 加对象 → 调动画 → 预览 → 提交). Edits persist to a SceneDocument
 * draft via the author API (T-D service, T-H authorRoutes). Professional
 * panes (object tree / properties / full timeline) default collapsed and
 * expand on demand. AI drawer is a placeholder until T-I ("能力未接" notice —
 * never silent).
 *
 * Chunk isolation (spec §8 / 票15): TeacherStudio is lazy-loaded in App.tsx
 * as its own async chunk; it never imports the student player path.
 */
import { useCallback, useMemo, useState, lazy, Suspense } from 'react'
import type { SceneDocument } from '../../../server/demonstration/sceneDocumentSchema'
import { parseSceneDocument } from '../../../server/demonstration/sceneDocumentSchema'
import { seedScene, TEMPLATES } from './templates'

// StudentPlayer preview is lazy-loaded so the studio chunk never pulls the
// player render path into first paint; preview mounts it on demand (spec §8
// chunk isolation: student path loads only when previewing).
const StudentPlayer = lazy(() =>
  import('../player/StudentPlayer').then((m) => ({ default: m.StudentPlayer }))
)

export type StudioStep = 'create' | 'objects' | 'animate' | 'preview' | 'submit'

const STEPS: Array<{ id: StudioStep; label: string }> = [
  { id: 'create', label: '建场景' },
  { id: 'objects', label: '加对象' },
  { id: 'animate', label: '调动画' },
  { id: 'preview', label: '预览' },
  { id: 'submit', label: '提交' }
]

export interface TeacherStudioProps {
  /** Demonstration id to persist the draft against (empty = new). */
  demonstrationId?: string
  /** Injected save function (tests); defaults to the author API. */
  onSave?: (doc: SceneDocument) => Promise<boolean>
  /** Injected submit function (tests); defaults to the author API. */
  onSubmit?: (doc: SceneDocument) => Promise<{ versionId: string } | null>
}

export function TeacherStudio({ demonstrationId, onSave, onSubmit }: TeacherStudioProps) {
  const [step, setStep] = useState<StudioStep>('create')
  const [document, setDocument] = useState<SceneDocument>(seedScene())
  const [saveState, setSaveState] = useState<'idle' | 'saving' | 'saved' | 'error'>('idle')
  const [submitState, setSubmitState] = useState<'idle' | 'submitting' | 'submitted' | 'error'>('idle')
  const [professionalOpen, setProfessionalOpen] = useState(false)
  const [selectedNodeId, setSelectedNodeId] = useState<string | null>(null)
  const [aiDrawerOpen, setAiDrawerOpen] = useState(false)
  const [lastVersionId, setLastVersionId] = useState<string | null>(null)

  const saveDraft = useCallback(async () => {
    setSaveState('saving')
    try {
      if (onSave) {
        const ok = await onSave(document)
        setSaveState(ok ? 'saved' : 'error')
        return ok
      }
      const res = await fetch(`/api/demonstrations/${demonstrationId ?? 'new'}/draft`, {
        method: 'PUT',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(document)
      })
      setSaveState(res.ok ? 'saved' : 'error')
      return res.ok
    } catch {
      setSaveState('error')
      return false
    }
  }, [document, demonstrationId, onSave])

  const submitDraft = useCallback(async () => {
    setSubmitState('submitting')
    try {
      if (onSubmit) {
        const result = await onSubmit(document)
        if (!result) {
          setSubmitState('error')
          return
        }
        setLastVersionId(result.versionId)
        setSubmitState('submitted')
        return
      }
      const res = await fetch(`/api/demonstrations/${demonstrationId ?? 'new'}/submit`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          classification: 'scene',
          license: 'CC-BY-4.0',
          aiDisclosure: 'none'
        })
      })
      if (!res.ok) {
        setSubmitState('error')
        return
      }
      const data = (await res.json()) as { versionId: string }
      setLastVersionId(data.versionId)
      setSubmitState('submitted')
    } catch {
      setSubmitState('error')
    }
  }, [document, demonstrationId, onSubmit])

  const stepIndex = STEPS.findIndex((s) => s.id === step)

  const applyTemplate = (templateId: string): void => {
    const tpl = TEMPLATES.find((t) => t.id === templateId)
    if (tpl) {
      setDocument(tpl.make())
      setStep('objects')
    }
  }

  const addPrimitive = (shape: 'rect' | 'circle' | 'box' | 'sphere'): void => {
    setDocument((doc) => {
      const id = `${shape}-${Date.now()}`
      const node = {
        id,
        name: shape,
        transform: { position: [0, 0, 0], rotation: [0, 0, 0], scale: [1, 1, 1] },
        visible: true,
        meshRef: id,
        children: []
      }
      const is2D = shape === 'rect' || shape === 'circle'
      const geo = is2D
        ? shape === 'rect'
          ? { id, shape: 'rect' as const, x: -0.5, y: -0.5, width: 1, height: 1 }
          : { id, shape: 'circle' as const, cx: 0, cy: 0, r: 0.5 }
        : shape === 'box'
          ? { id, kind: 'box' as const, size: [1, 1, 1] as [number, number, number] }
          : { id, kind: 'sphere' as const, radius: 0.5, segments: 24 }
      return parseSceneDocument({
        ...doc,
        objectTree: [...(doc.objectTree ?? []), node],
        geometry2D: is2D ? [...(doc.geometry2D ?? []), geo] : doc.geometry2D,
        geometry3D: is2D ? doc.geometry3D : [...(doc.geometry3D ?? []), geo]
      })
    })
    setSelectedNodeId(null)
  }

  const updateNode = (nodeId: string, patch: Partial<NonNullable<SceneDocument['objectTree']>[number]>): void => {
    setDocument((doc) =>
      parseSceneDocument({
        ...doc,
        objectTree: (doc.objectTree ?? []).map((n) => (n.id === nodeId ? { ...n, ...patch } : n))
      })
    )
  }

  const selectedNode = useMemo(
    () => (document.objectTree ?? []).find((n) => n.id === selectedNodeId),
    [document, selectedNodeId]
  )

  const nodeCount = document.objectTree?.length ?? 0

  return (
    <div className="teacher-studio" data-step={step}>
      <header className="studio-topbar">
        <div className="studio-brand">教学演示创作台</div>
        <nav className="studio-steps" aria-label="创作步骤">
          {STEPS.map((s, i) => (
            <button
              key={s.id}
              type="button"
              className={`studio-step ${s.id === step ? 'active' : ''} ${i < stepIndex ? 'done' : ''}`}
              onClick={() => setStep(s.id)}
              aria-current={s.id === step ? 'step' : undefined}
            >
              {i + 1}. {s.label}
            </button>
          ))}
        </nav>
        <div className="studio-actions">
          <button type="button" className="studio-btn" onClick={() => setAiDrawerOpen(true)}>
            AI 起稿
          </button>
          <button
            type="button"
            className="studio-btn"
            onClick={() => void saveDraft()}
            disabled={saveState === 'saving'}
          >
            {saveState === 'saved' ? '已保存 ✓' : saveState === 'error' ? '保存失败' : '保存草稿'}
          </button>
          <button
            type="button"
            className="studio-btn studio-btn-primary"
            onClick={() => void submitDraft()}
            disabled={submitState === 'submitting'}
          >
            {submitState === 'submitted' ? `已提交 ${lastVersionId ?? ''}` : '提交审核'}
          </button>
        </div>
      </header>

      <div className="studio-layout">
        <aside className="studio-left">
          <div className="studio-pane-title">对象</div>
          {step === 'objects' && (
            <div className="studio-add-row" role="group" aria-label="添加对象">
              <button type="button" onClick={() => addPrimitive('rect')}>矩形</button>
              <button type="button" onClick={() => addPrimitive('circle')}>圆形</button>
              <button type="button" onClick={() => addPrimitive('box')}>立方体</button>
              <button type="button" onClick={() => addPrimitive('sphere')}>球体</button>
            </div>
          )}
          <ul className="studio-object-tree" aria-label="对象树">
            {(document.objectTree ?? []).map((n) => (
              <li key={n.id}>
                <button
                  type="button"
                  className={`studio-tree-node ${n.id === selectedNodeId ? 'selected' : ''}`}
                  onClick={() => setSelectedNodeId(n.id)}
                >
                  <span className="studio-node-name">{n.name ?? n.id}</span>
                  <span className="studio-node-vis">{n.visible ? '👁' : '🚫'}</span>
                </button>
              </li>
            ))}
            {nodeCount === 0 && <li className="studio-empty">空场景 — 添加对象或选模板</li>}
          </ul>
          <div className="studio-pane-title">资源</div>
          <div className="studio-resources">
            <span>媒体资产库（T-B 上传接入）</span>
            <span>glTF 导入件（T-C 白名单）</span>
          </div>
        </aside>

        <main className="studio-center">
          <div className="studio-viewport" data-2d3d={has2D3D(document)}>
            {step === 'create' ? (
              <div className="studio-template-picker">
                <h3>选择模板</h3>
                <div className="studio-templates">
                  {TEMPLATES.map((t) => (
                    <button key={t.id} type="button" onClick={() => applyTemplate(t.id)}>
                      {t.label}
                    </button>
                  ))}
                </div>
              </div>
            ) : step === 'preview' ? (
              <Suspense fallback={<div className="studio-viewport-note">正在加载播放器预览…</div>}>
                <StudentPlayer
                  payload={{
                    demonstrationId: demonstrationId ?? 'draft',
                    versionId: 'draft',
                    status: 'approved',
                    document,
                    renderLevel: 'full',
                    reasons: [],
                    mediaManifest: [],
                    coverRef: null,
                    subtitleRef: null,
                    budget: { ok: true, issues: [], nodes: nodeCount, triangles: 0, durationSeconds: 10, mediaRefs: 0 },
                    externalVideos: []
                  }}
                />
              </Suspense>
            ) : (
              <div className="studio-canvas-placeholder" data-2d3d={has2D3D(document)}>
                <StudioViewport document={document} />
              </div>
            )}
          </div>
        </main>

        <aside className="studio-right">
          <div className="studio-pane-title">属性</div>
          {selectedNode ? (
            <div className="studio-properties">
              <label>
                名称
                <input
                  value={selectedNode.name ?? selectedNode.id}
                  onChange={(e) => updateNode(selectedNode.id, { name: e.target.value })}
                />
              </label>
              <label>
                可见
                <input
                  type="checkbox"
                  checked={selectedNode.visible}
                  onChange={(e) => updateNode(selectedNode.id, { visible: e.target.checked })}
                />
              </label>
              <label>
                X
                <input
                  type="number"
                  step={0.1}
                  value={selectedNode.transform.position[0]}
                  onChange={(e) =>
                    updateNode(selectedNode.id, {
                      transform: {
                        ...selectedNode.transform,
                        position: [Number(e.target.value), selectedNode.transform.position[1], selectedNode.transform.position[2]]
                      }
                    })
                  }
                />
              </label>
              <label>
                Y
                <input
                  type="number"
                  step={0.1}
                  value={selectedNode.transform.position[1]}
                  onChange={(e) =>
                    updateNode(selectedNode.id, {
                      transform: {
                        ...selectedNode.transform,
                        position: [selectedNode.transform.position[0], Number(e.target.value), selectedNode.transform.position[2]]
                      }
                    })
                  }
                />
              </label>
            </div>
          ) : (
            <div className="studio-properties-empty">选择对象查看属性</div>
          )}

          <div className="studio-pane-title">
            <button
              type="button"
              className="studio-pane-toggle"
              onClick={() => setProfessionalOpen((v) => !v)}
              aria-expanded={professionalOpen}
            >
              专业能力 {professionalOpen ? '▾' : '▸'}
            </button>
          </div>
          {professionalOpen && (
            <div className="studio-timeline" role="region" aria-label="动画时间线">
              <div className="studio-timeline-tracks">
                {(document.timeline?.tracks ?? []).length === 0 && (
                  <div className="studio-empty">时间线为空 — 在「调动画」步添加补间</div>
                )}
                {(document.timeline?.tracks ?? []).map((t, i) => (
                  <div key={i} className="studio-track">
                    <span>{t.nodeId}</span>
                    <span>{t.keyframes.length} 关键帧</span>
                  </div>
                ))}
              </div>
            </div>
          )}

          {aiDrawerOpen && (
            <div className="studio-ai-drawer" role="dialog" aria-label="AI 起稿">
              <div className="studio-ai-header">
                <span>AI 起稿</span>
                <button type="button" onClick={() => setAiDrawerOpen(false)}>✕</button>
              </div>
              <p className="studio-ai-notice">
                AI 创作助手将在 T-I 接入。当前版本仅支持手动创作（显式占位，不静默）。
              </p>
            </div>
          )}
        </aside>
      </div>
    </div>
  )
}

function has2D3D(doc: SceneDocument): '2d' | '3d' {
  return (doc.geometry3D ?? []).length > 0 ? '3d' : '2d'
}

/** Center viewport — renders the scene graph deterministically (spec §8). */
function StudioViewport({ document }: { document: SceneDocument }) {
  const geoms3D = document.geometry3D ?? []
  if (geoms3D.length > 0) {
    return (
      <div className="studio-viewport-3d">
        {geoms3D.map((g, i) => (
          <div key={i} className="studio-3d-node">
            {g.kind} 图元
          </div>
        ))}
        <p className="studio-viewport-note">PlayCanvas 3D 视口（T-H chunk 接入点）</p>
      </div>
    )
  }
  const geoms2D = document.geometry2D ?? []
  return (
    <svg className="studio-viewport-svg" viewBox="-5 -5 10 10" role="img" aria-label="2D 画布">
      {geoms2D.map((g, i) => {
        if (g.shape === 'rect') {
          return <rect key={i} x={g.x} y={g.y} width={g.width} height={g.height} fill="currentColor" />
        }
        if (g.shape === 'circle') {
          return <circle key={i} cx={g.cx} cy={g.cy} r={g.r} fill="currentColor" />
        }
        return null
      })}
    </svg>
  )
}
