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
import type { Keyframe, SceneDocument } from '../../../server/demonstration/sceneDocumentSchema'
import { parseSceneDocument } from '../../../server/demonstration/sceneDocumentSchema'
import { seedScene, TEMPLATES } from './templates'

// StudentPlayer preview is lazy-loaded so the studio chunk never pulls the
// player render path into first paint; preview mounts it on demand (spec §8
// chunk isolation: student path loads only when previewing).
const StudentPlayer = lazy(() =>
  import('../player/StudentPlayer').then((m) => ({ default: m.StudentPlayer }))
)

const PlayCanvasStudioViewport = lazy(() =>
  import('./PlayCanvasStudioViewport').then((m) => ({ default: m.PlayCanvasStudioViewport }))
)

export type StudioStep = 'create' | 'objects' | 'animate' | 'preview' | 'submit'
type AnimationProperty = 'transform.position' | 'transform.rotation' | 'transform.scale' | 'visible'

const ANIMATION_PROPERTIES: Array<{ value: AnimationProperty; label: string }> = [
  { value: 'transform.position', label: '位置' },
  { value: 'transform.rotation', label: '旋转' },
  { value: 'transform.scale', label: '缩放' },
  { value: 'visible', label: '可见性' }
]

const STEPS: Array<{ id: StudioStep; label: string }> = [
  { id: 'create', label: '建场景' },
  { id: 'objects', label: '加对象' },
  { id: 'animate', label: '调动画' },
  { id: 'preview', label: '预览' },
  { id: 'submit', label: '提交' }
]

type StudioNode = NonNullable<SceneDocument['objectTree']>[number]

function animationValue(node: StudioNode, property: AnimationProperty): Keyframe['value'] {
  if (property === 'transform.position') return [...node.transform.position] as [number, number, number]
  if (property === 'transform.rotation') return [...node.transform.rotation] as [number, number, number]
  if (property === 'transform.scale') return [...node.transform.scale] as [number, number, number]
  return node.visible
}

function defaultEndValue(value: Keyframe['value'], property: AnimationProperty): Keyframe['value'] {
  if (property === 'visible') return typeof value === 'boolean' ? !value : false
  if (!Array.isArray(value)) return value
  if (property === 'transform.rotation') return [value[0], value[1], value[2] + 45]
  if (property === 'transform.scale') return [value[0] * 1.2, value[1] * 1.2, value[2] * 1.2]
  return [value[0] + 1, value[1], value[2]]
}

export interface StudioMediaAsset {
  id: string
  kind: 'model3d'
  blobHash: string
  status: 'ready'
  displayName: string
  byteSize: number
}

export interface TeacherStudioProps {
  /** Demonstration id to persist the draft against (empty = new). */
  demonstrationId?: string
  /** Injected save function (tests); defaults to the author API. */
  onSave?: (doc: SceneDocument) => Promise<boolean>
  /** Injected submit function (tests); defaults to the author API. */
  onSubmit?: (doc: SceneDocument) => Promise<{ versionId: string } | null>
  /** Owner-scoped ready model asset loader (tests); defaults to media API. */
  loadModelAssets?: () => Promise<StudioMediaAsset[]>
}

export function TeacherStudio({ demonstrationId, onSave, onSubmit, loadModelAssets }: TeacherStudioProps) {
  const [step, setStep] = useState<StudioStep>('create')
  const [viewportMode, setViewportMode] = useState<'2d' | '3d'>('2d')
  const [document, setDocument] = useState<SceneDocument>(seedScene())
  const [saveState, setSaveState] = useState<'idle' | 'saving' | 'saved' | 'error'>('idle')
  const [submitState, setSubmitState] = useState<'idle' | 'submitting' | 'submitted' | 'error'>('idle')
  const [professionalOpen, setProfessionalOpen] = useState(false)
  const [selectedNodeId, setSelectedNodeId] = useState<string | null>(null)
  const [animationProperty, setAnimationProperty] = useState<AnimationProperty>('transform.position')
  const [aiDrawerOpen, setAiDrawerOpen] = useState(false)
  const [aiDescription, setAiDescription] = useState('')
  const [aiCandidate, setAiCandidate] = useState<SceneDocument | null>(null)
  const [aiStatus, setAiStatus] = useState<'idle' | 'generating' | 'error' | 'no-llm' | 'quota'>('idle')
  const [aiMessage, setAiMessage] = useState('')
  const [checkpoints, setCheckpoints] = useState<Array<{ id: string; savedAt: string }>>([])
  const [lastVersionId, setLastVersionId] = useState<string | null>(null)
  const [modelAssets, setModelAssets] = useState<StudioMediaAsset[]>([])
  const [selectedAssetId, setSelectedAssetId] = useState('')
  const [modelAssetState, setModelAssetState] = useState<'idle' | 'loading' | 'error'>('idle')
  const [modelAssetMessage, setModelAssetMessage] = useState('')

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

  const generateAi = useCallback(async () => {
    setAiStatus('generating')
    setAiMessage('')
    try {
      const res = await fetch(`/api/demonstrations/${demonstrationId ?? 'new'}/ai-draft`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ description: aiDescription })
      })
      const data = (await res.json()) as {
        ok: boolean
        document?: unknown
        reason?: string
        message?: string
      }
      if (!res.ok || !data.ok) {
        setAiStatus(data.reason === 'no-llm' ? 'no-llm' : data.reason === 'quota' ? 'quota' : 'error')
        setAiMessage(data.message ?? '生成失败')
        return
      }
      const candidate = parseSceneDocument(data.document)
      setAiCandidate(candidate)
      setAiStatus('idle')
    } catch (error) {
      setAiStatus('error')
      setAiMessage(error instanceof Error ? error.message : '生成失败')
    }
  }, [aiDescription, demonstrationId])

  const loadCheckpoints = useCallback(async () => {
    try {
      const res = await fetch(`/api/demonstrations/${demonstrationId ?? 'new'}/ai-checkpoints`)
      if (res.ok) {
        const data = (await res.json()) as { checkpoints: Array<{ id: string; savedAt: string }> }
        setCheckpoints(data.checkpoints)
      }
    } catch {
      // Non-fatal: rollback list stays empty.
    }
  }, [demonstrationId])

  const confirmAiCandidate = useCallback(async () => {
    if (!aiCandidate) return
    // Teacher confirmation: save checkpoint + apply as draft (explicit action).
    try {
      await fetch(`/api/demonstrations/${demonstrationId ?? 'new'}/ai-checkpoint`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ document: aiCandidate })
      })
      setDocument(aiCandidate)
      setAiCandidate(null)
      setAiMessage('已确认：AI 生成内容已保存为草稿（标注 ai_disclosure）')
      await loadCheckpoints()
    } catch (error) {
      setAiMessage(error instanceof Error ? error.message : '保存失败')
    }
  }, [aiCandidate, demonstrationId, loadCheckpoints])

  const rejectAiCandidate = useCallback(() => {
    setAiCandidate(null)
    setAiMessage('已拒绝该生成结果')
  }, [])

  const rollback = useCallback(async (checkpointId: string) => {
    try {
      const res = await fetch(`/api/demonstrations/${demonstrationId ?? 'new'}/ai-rollback`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ checkpointId })
      })
      if (res.ok) {
        const draft = await fetch(`/api/demonstrations/${demonstrationId ?? 'new'}/draft`)
        if (draft.ok) {
          const data = (await draft.json()) as { document: unknown }
          setDocument(parseSceneDocument(data.document))
        }
        setAiMessage('已回滚到检查点')
      }
    } catch (error) {
      setAiMessage(error instanceof Error ? error.message : '回滚失败')
    }
  }, [demonstrationId])

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

  const loadReadyModelAssets = useCallback(async () => {
    setModelAssetState('loading')
    setModelAssetMessage('')
    try {
      const assets = loadModelAssets
        ? await loadModelAssets()
        : await fetch('/api/media/assets?kind=model3d').then(async (response) => {
            if (!response.ok) throw new Error('3D 资产列表加载失败')
            const data = (await response.json()) as { assets?: StudioMediaAsset[] }
            return data.assets ?? []
          })
      const safeAssets = assets.filter(
        (asset) => asset.kind === 'model3d' && asset.status === 'ready' && /^[0-9a-f]{64}$/.test(asset.blobHash)
      )
      setModelAssets(safeAssets)
      setSelectedAssetId(safeAssets[0]?.id ?? '')
      setModelAssetMessage(safeAssets.length === 0 ? '暂无可导入的 ready GLB 资产' : '')
      setModelAssetState('idle')
    } catch (error) {
      setModelAssetState('error')
      setModelAssetMessage(error instanceof Error ? error.message : '3D 资产列表加载失败')
    }
  }, [loadModelAssets])

  const importSelectedModel = (): void => {
    const asset = modelAssets.find((candidate) => candidate.id === selectedAssetId)
    if (!asset || asset.kind !== 'model3d' || asset.status !== 'ready' || !/^[0-9a-f]{64}$/.test(asset.blobHash)) {
      setModelAssetMessage('请选择可信的 ready GLB 资产')
      return
    }
    const safeId = asset.id.slice(0, 90)
    const geometryId = `gltf-${safeId}`
    const nodeId = `model-${safeId}`
    const mediaRefId = `media-${safeId}`
    setDocument((doc) => {
      if ((doc.geometry3D ?? []).some((geometry) => geometry.kind === 'gltf' && geometry.assetHash === asset.blobHash)) {
        return doc
      }
      return parseSceneDocument({
        ...doc,
        runtimeVersion: {
          ...(doc.runtimeVersion ?? { sceneFormatVersion: '1.0', capabilities: [] }),
          capabilities: Array.from(new Set([...(doc.runtimeVersion?.capabilities ?? []), 'webgl2']))
        },
        objectTree: [
          ...(doc.objectTree ?? []),
          {
            id: nodeId,
            name: asset.displayName,
            transform: { position: [0, 0, 0], rotation: [0, 0, 0], scale: [1, 1, 1] },
            visible: true,
            meshRef: geometryId,
            children: []
          }
        ],
        geometry3D: [...(doc.geometry3D ?? []), { id: geometryId, kind: 'gltf', assetHash: asset.blobHash }],
        mediaRefs: [
          ...(doc.mediaRefs ?? []),
          { id: mediaRefId, assetId: asset.id, blobHash: asset.blobHash, purpose: 'glb', label: asset.displayName }
        ]
      })
    })
    setSelectedNodeId(nodeId)
    setViewportMode('3d')
    setModelAssetMessage(`已导入 ${asset.displayName}`)
    setStep('objects')
  }

  const stepIndex = STEPS.findIndex((s) => s.id === step)

  const applyTemplate = (templateId: string): void => {
    const tpl = TEMPLATES.find((t) => t.id === templateId)
    if (tpl) {
      const nextDocument = tpl.make()
      setDocument(nextDocument)
      setViewportMode(has2D3D(nextDocument))
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
    setViewportMode(shape === 'rect' || shape === 'circle' ? '2d' : '3d')
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

  const addAnimationTrack = (): void => {
    if (!selectedNode) return
    setDocument((doc) => {
      const timeline = doc.timeline ?? { tracks: [], chapters: [], duration: 10 }
      const exists = timeline.tracks.some(
        (track) => track.nodeId === selectedNode.id && track.keyframes[0]?.property === animationProperty
      )
      if (exists) return doc
      const duration = Math.max(timeline.duration ?? 10, 1)
      const startValue = animationValue(selectedNode, animationProperty)
      const track = {
        nodeId: selectedNode.id,
        keyframes: [
          { time: 0, property: animationProperty, value: startValue, easing: 'linear' as const },
          {
            time: duration,
            property: animationProperty,
            value: defaultEndValue(startValue, animationProperty),
            easing: 'linear' as const
          }
        ]
      }
      return parseSceneDocument({
        ...doc,
        timeline: { ...timeline, duration, tracks: [...timeline.tracks, track] }
      })
    })
  }

  const updateKeyframe = (trackIndex: number, keyframeIndex: number, patch: Partial<Keyframe>): void => {
    setDocument((doc) => {
      const timeline = doc.timeline ?? { tracks: [], chapters: [], duration: 10 }
      const tracks = timeline.tracks.map((track, index) => {
        if (index !== trackIndex) return track
        const keyframes = track.keyframes
          .map((keyframe, frameIndex) => frameIndex === keyframeIndex ? { ...keyframe, ...patch } : keyframe)
          .sort((a, b) => a.time - b.time)
        return { ...track, keyframes }
      })
      const maxTime = Math.max(0, ...tracks.flatMap((track) => track.keyframes.map((keyframe) => keyframe.time)))
      return parseSceneDocument({
        ...doc,
        timeline: { ...timeline, duration: Math.max(timeline.duration ?? 0, maxTime), tracks }
      })
    })
  }

  const addKeyframe = (trackIndex: number): void => {
    setDocument((doc) => {
      const timeline = doc.timeline ?? { tracks: [], chapters: [], duration: 10 }
      const tracks = timeline.tracks.map((track, index) => {
        if (index !== trackIndex || track.keyframes.length >= 500) return track
        const last = track.keyframes[track.keyframes.length - 1]
        if (!last) return track
        const nextTime = last.time + 1
        return {
          ...track,
          keyframes: [...track.keyframes, { ...last, time: nextTime, value: Array.isArray(last.value) ? [...last.value] : last.value }]
        }
      })
      const maxTime = Math.max(0, ...tracks.flatMap((track) => track.keyframes.map((keyframe) => keyframe.time)))
      return parseSceneDocument({
        ...doc,
        timeline: { ...timeline, duration: Math.max(timeline.duration ?? 0, maxTime), tracks }
      })
    })
  }

  const removeKeyframe = (trackIndex: number, keyframeIndex: number): void => {
    setDocument((doc) => {
      const timeline = doc.timeline ?? { tracks: [], chapters: [], duration: 10 }
      const tracks = timeline.tracks.map((track, index) => {
        if (index !== trackIndex || track.keyframes.length <= 1) return track
        return { ...track, keyframes: track.keyframes.filter((_, frameIndex) => frameIndex !== keyframeIndex) }
      })
      return parseSceneDocument({ ...doc, timeline: { ...timeline, tracks } })
    })
  }

  const removeTrack = (trackIndex: number): void => {
    setDocument((doc) => {
      const timeline = doc.timeline ?? { tracks: [], chapters: [], duration: 10 }
      return parseSceneDocument({
        ...doc,
        timeline: { ...timeline, tracks: timeline.tracks.filter((_, index) => index !== trackIndex) }
      })
    })
  }

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
            <span>媒体资产库（T-B owner-scoped ready 资产）</span>
            <button
              type="button"
              className="studio-btn"
              onClick={() => void loadReadyModelAssets()}
              disabled={modelAssetState === 'loading'}
            >
              {modelAssetState === 'loading' ? '加载中…' : '刷新 3D 资产'}
            </button>
            {modelAssets.length > 0 ? (
              <>
                <label>
                  glTF 资产
                  <select
                    aria-label="glTF 资产"
                    value={selectedAssetId}
                    onChange={(event) => setSelectedAssetId(event.target.value)}
                  >
                    {modelAssets.map((asset) => (
                      <option key={asset.id} value={asset.id}>
                        {asset.displayName} · {(asset.byteSize / 1024).toFixed(1)} KiB
                      </option>
                    ))}
                  </select>
                </label>
                <button type="button" className="studio-btn" onClick={importSelectedModel}>
                  导入 glTF
                </button>
              </>
            ) : null}
            {modelAssetMessage ? (
              <span role={modelAssetState === 'error' ? 'alert' : 'status'}>{modelAssetMessage}</span>
            ) : null}
          </div>
        </aside>

        <main className="studio-center">
          {step !== 'preview' ? (
            <div role="group" aria-label="视口模式" className="studio-toolbar">
              <button
                type="button"
                className="studio-btn"
                aria-pressed={viewportMode === '2d'}
                onClick={() => setViewportMode('2d')}
              >
                2D
              </button>
              <button
                type="button"
                className="studio-btn"
                aria-pressed={viewportMode === '3d'}
                onClick={() => setViewportMode('3d')}
              >
                3D
              </button>
            </div>
          ) : null}
          <div className="studio-viewport" data-2d3d={viewportMode}>
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
            ) : viewportMode === '3d' ? (
              <Suspense fallback={<div className="studio-viewport-note">正在加载 PlayCanvas 视口…</div>}>
                <PlayCanvasStudioViewport document={document} selectedNodeId={selectedNodeId} />
              </Suspense>
            ) : (
              <div className="studio-canvas-placeholder" data-2d3d="2d">
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

          {step === 'animate' && (
            <div className="studio-animation-editor" role="region" aria-label="关键帧编辑器">
              <div className="studio-pane-title">关键帧</div>
              {!selectedNode ? (
                <div className="studio-empty">先从对象树选择要动画的对象</div>
              ) : (
                <>
                  <label>
                    动画属性
                    <select
                      aria-label="动画属性"
                      value={animationProperty}
                      onChange={(event) => setAnimationProperty(event.target.value as AnimationProperty)}
                    >
                      {ANIMATION_PROPERTIES.map((property) => (
                        <option key={property.value} value={property.value}>{property.label}</option>
                      ))}
                    </select>
                  </label>
                  <button type="button" className="studio-btn" onClick={addAnimationTrack}>
                    添加动画轨道
                  </button>
                  {(document.timeline?.tracks ?? []).map((track, trackIndex) => {
                    if (track.nodeId !== selectedNode.id) return null
                    const property = track.keyframes[0]?.property ?? 'unknown'
                    return (
                      <div
                        key={`${track.nodeId}-${property}`}
                        className="studio-animation-track"
                        role="group"
                        aria-label={`${selectedNode.name ?? selectedNode.id} ${property} 动画轨道`}
                      >
                        <div className="studio-track">
                          <strong>{property}</strong>
                          <span>{track.keyframes.length} 关键帧</span>
                          <button type="button" onClick={() => removeTrack(trackIndex)}>删除轨道</button>
                        </div>
                        {track.keyframes.map((keyframe, keyframeIndex) => (
                          <fieldset key={`${keyframe.time}-${keyframeIndex}`} className="studio-keyframe">
                            <legend>关键帧 {keyframeIndex + 1}</legend>
                            <label>
                              时间
                              <input
                                aria-label={`关键帧 ${keyframeIndex + 1} 时间`}
                                type="number"
                                min={0}
                                step={0.1}
                                value={keyframe.time}
                                onChange={(event) => updateKeyframe(trackIndex, keyframeIndex, {
                                  time: Math.max(0, Number(event.target.value))
                                })}
                              />
                            </label>
                            <label>
                              缓动
                              <select
                                aria-label={`关键帧 ${keyframeIndex + 1} 缓动`}
                                value={keyframe.easing}
                                onChange={(event) => updateKeyframe(trackIndex, keyframeIndex, {
                                  easing: event.target.value as Keyframe['easing']
                                })}
                              >
                                {['linear', 'ease-in', 'ease-out', 'ease-in-out', 'step'].map((easing) => (
                                  <option key={easing} value={easing}>{easing}</option>
                                ))}
                              </select>
                            </label>
                            {Array.isArray(keyframe.value) ? (
                              <VectorKeyframeInputs
                                value={keyframe.value}
                                keyframeNumber={keyframeIndex + 1}
                                onChange={(value) => updateKeyframe(trackIndex, keyframeIndex, { value })}
                              />
                            ) : typeof keyframe.value === 'boolean' ? (
                              <label>
                                可见
                                <input
                                  aria-label={`关键帧 ${keyframeIndex + 1} 可见`}
                                  type="checkbox"
                                  checked={keyframe.value}
                                  onChange={(event) => updateKeyframe(trackIndex, keyframeIndex, {
                                    value: event.target.checked
                                  })}
                                />
                              </label>
                            ) : (
                              <label>
                                值
                                <input
                                  aria-label={`关键帧 ${keyframeIndex + 1} 值`}
                                  type="number"
                                  step={0.1}
                                  value={keyframe.value}
                                  onChange={(event) => updateKeyframe(trackIndex, keyframeIndex, {
                                    value: Number(event.target.value)
                                  })}
                                />
                              </label>
                            )}
                            <button
                              type="button"
                              onClick={() => removeKeyframe(trackIndex, keyframeIndex)}
                              disabled={track.keyframes.length <= 1}
                            >
                              删除关键帧
                            </button>
                          </fieldset>
                        ))}
                        <button
                          type="button"
                          className="studio-btn"
                          onClick={() => addKeyframe(trackIndex)}
                          disabled={track.keyframes.length >= 500}
                        >
                          新增关键帧
                        </button>
                      </div>
                    )
                  })}
                </>
              )}
            </div>
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
              <label className="studio-ai-label">
                描述场景
                <textarea
                  value={aiDescription}
                  onChange={(e) => setAiDescription(e.target.value)}
                  rows={4}
                  placeholder="例如：画一个 DNA 双螺旋，带碱基对横档，可旋转查看"
                />
              </label>
              <button
                type="button"
                className="studio-btn studio-btn-primary"
                onClick={() => void generateAi()}
                disabled={aiStatus === 'generating' || aiDescription.trim() === ''}
              >
                {aiStatus === 'generating' ? '生成中…' : '生成场景'}
              </button>
              {aiStatus === 'no-llm' && (
                <p className="studio-ai-notice" role="status">
                  AI 起稿不可用（未配置 LLM）。可改用手动创建。
                </p>
              )}
              {aiStatus === 'quota' && (
                <p className="studio-ai-notice" role="status">{aiMessage}</p>
              )}
              {aiStatus === 'error' && (
                <p className="studio-ai-error" role="alert">{aiMessage}</p>
              )}
              {aiCandidate && (
                <div className="studio-ai-candidate" role="region" aria-label="生成结果">
                  <p>AI 生成候选（{aiCandidate.objectTree?.length ?? 0} 个对象）— 需教师确认</p>
                  <div className="studio-ai-actions">
                    <button type="button" className="studio-btn" onClick={() => void confirmAiCandidate()}>
                      确认并保存
                    </button>
                    <button type="button" className="studio-btn" onClick={rejectAiCandidate}>
                      拒绝
                    </button>
                  </div>
                </div>
              )}
              {aiMessage && <p className="studio-ai-note" role="status">{aiMessage}</p>}
              <button type="button" className="studio-ai-checks" onClick={() => void loadCheckpoints()}>
                加载检查点（{checkpoints.length}）
              </button>
              <ul className="studio-checkpoint-list">
                {checkpoints.map((cp) => (
                  <li key={cp.id}>
                    <span>{new Date(cp.savedAt).toLocaleTimeString()}</span>
                    <button type="button" onClick={() => void rollback(cp.id)}>
                      回滚
                    </button>
                  </li>
                ))}
              </ul>
            </div>
          )}
        </aside>
      </div>
    </div>
  )
}

function VectorKeyframeInputs({
  value,
  keyframeNumber,
  onChange
}: {
  value: [number, number, number]
  keyframeNumber: number
  onChange: (value: [number, number, number]) => void
}) {
  return (
    <div className="studio-keyframe-vector">
      {(['X', 'Y', 'Z'] as const).map((axis, componentIndex) => (
        <label key={axis}>
          {axis}
          <input
            aria-label={`关键帧 ${keyframeNumber} ${axis}`}
            type="number"
            step={0.1}
            value={value[componentIndex]}
            onChange={(event) => {
              const next: [number, number, number] = [...value]
              next[componentIndex] = Number(event.target.value)
              onChange(next)
            }}
          />
        </label>
      ))}
    </div>
  )
}

function has2D3D(doc: SceneDocument): '2d' | '3d' {
  return (doc.geometry3D ?? []).length > 0 ? '3d' : '2d'
}

/** Center 2D viewport — renders SVG subset deterministically (spec §8). */
function StudioViewport({ document }: { document: SceneDocument }) {
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
