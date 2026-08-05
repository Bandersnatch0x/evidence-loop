/**
 * T-H TeacherStudio tests — three-pane layout, five-step wizard, object tree
 * editing → SceneDocument persistence, draft save / submit via injected
 * handlers, AI drawer placeholder (explicit "能力未接"), and preview step
 * mounting the student player lazily.
 */
import { describe, it, expect, vi } from 'vitest'
import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import { TeacherStudio } from '../src/components/teacher/TeacherStudio'
import { TEMPLATES } from '../src/components/teacher/templates'
import { TeacherWorkbench } from '../src/components/teacher/TeacherWorkbench'
import { getRenderable3DNodes } from '../src/components/teacher/viewportModel'
import type { SceneDocument } from '../server/demonstration/sceneDocumentSchema'

describe('T-H TeacherStudio', () => {
  it('renders the three-pane layout with a five-step wizard', () => {
    render(<TeacherStudio />)
    expect(screen.getByText('教学演示创作台')).not.toBeNull()
    const stepNames: Record<string, RegExp> = {
      '建场景': /1\. 建场景/,
      '加对象': /2\. 加对象/,
      '调动画': /3\. 调动画/,
      '预览': /4\. 预览/,
      '提交': /5\. 提交/
    }
    for (const step of ['建场景', '加对象', '调动画', '预览', '提交']) {
      expect(screen.getByText(stepNames[step]!)).not.toBeNull()
    }
    expect(screen.getByLabelText('对象树')).not.toBeNull()
    expect(document.querySelector('.studio-layout')).not.toBeNull()
  })

  it('maps nested SceneDocument objects to trusted 3D viewport nodes', () => {
    const hash = 'b'.repeat(64)
    const doc = TEMPLATES.find((template) => template.id === 'demo-dna')!.make()
    const withModel = {
      ...doc,
      geometry3D: [{ id: 'model-geometry', kind: 'gltf' as const, assetHash: hash }],
      objectTree: [
        {
          id: 'root',
          name: '根节点',
          transform: { position: [0, 0, 0] as [number, number, number], rotation: [0, 0, 0] as [number, number, number], scale: [1, 1, 1] as [number, number, number] },
          visible: true,
          children: [
            {
              id: 'nested-model',
              name: '嵌套模型',
              transform: { position: [1, 2, 3] as [number, number, number], rotation: [0, 0, 0] as [number, number, number], scale: [1, 1, 1] as [number, number, number] },
              visible: true,
              meshRef: 'model-geometry',
              children: []
            }
          ]
        }
      ]
    } as SceneDocument

    const nodes = getRenderable3DNodes(withModel)
    expect(nodes).toHaveLength(1)
    expect(nodes[0]?.id).toBe('nested-model')
    expect(nodes[0]?.geometry).toMatchObject({ kind: 'gltf', assetHash: hash })
    expect(nodes[0]?.assetUrl).toBe(`/api/media/blobs/${hash}`)
  })

  it('mounts the lazy PlayCanvas viewport in 3D mode', async () => {
    render(<TeacherStudio />)
    fireEvent.click(screen.getByRole('button', { name: 'DNA 双螺旋模板' }))
    fireEvent.click(screen.getByRole('button', { name: '3D' }))
    expect(await screen.findByLabelText('PlayCanvas 3D 创作视口')).not.toBeNull()
  })

  it('step 1 shows templates; applying one advances to objects', () => {
    render(<TeacherStudio />)
    expect(TEMPLATES.length).toBeGreaterThanOrEqual(2)
    fireEvent.click(screen.getByRole('button', { name: 'DNA 双螺旋模板' }))
    expect(document.querySelector('.studio-tree-node')).not.toBeNull()
    expect(screen.getByText('DNA 链')).not.toBeNull()
  })

  it('adding primitives updates the SceneDocument object tree', () => {
    render(<TeacherStudio />)
    fireEvent.click(screen.getByRole('button', { name: 'DNA 双螺旋模板' }))
    fireEvent.click(screen.getByRole('button', { name: '矩形' }))
    // Original template node + added rect.
    const nodes = document.querySelectorAll('.studio-tree-node')
    expect(nodes.length).toBeGreaterThanOrEqual(2)
  })

  it('selecting a node shows editable properties that persist into the doc', () => {
    render(<TeacherStudio />)
    fireEvent.click(screen.getByRole('button', { name: 'DNA 双螺旋模板' }))
    fireEvent.click(screen.getByText('DNA 链'))
    const nameInput = screen.getByLabelText<HTMLInputElement>('名称')
    fireEvent.change(nameInput, { target: { value: '主链' } })
    expect(nameInput.value).toBe('主链')
    // Object tree reflects the rename.
    expect(screen.getByText('主链')).not.toBeNull()
  })

  it('imports a ready owner-scoped GLB asset into the SceneDocument', async () => {
    const hash = 'a'.repeat(64)
    const onSave = vi.fn<(doc: SceneDocument) => Promise<boolean>>(() => Promise.resolve(true))
    const loadModelAssets = vi.fn(() => Promise.resolve([
      {
        id: 'asset-1',
        kind: 'model3d' as const,
        blobHash: hash,
        status: 'ready' as const,
        displayName: '细胞模型.glb',
        byteSize: 1024
      }
    ]))
    render(<TeacherStudio onSave={onSave} loadModelAssets={loadModelAssets} />)

    fireEvent.click(screen.getByRole('button', { name: '刷新 3D 资产' }))
    await waitFor(() => expect(screen.getByLabelText('glTF 资产')).not.toBeNull())
    fireEvent.click(screen.getByRole('button', { name: '导入 glTF' }))
    expect(screen.getByText('细胞模型.glb')).not.toBeNull()
    fireEvent.click(screen.getByRole('button', { name: '保存草稿' }))

    await waitFor(() => expect(onSave).toHaveBeenCalledTimes(1))
    const doc = onSave.mock.calls[0]![0]
    expect(doc.geometry3D?.[0]).toMatchObject({ kind: 'gltf', assetHash: hash })
    expect(doc.mediaRefs?.[0]).toMatchObject({ assetId: 'asset-1', blobHash: hash, purpose: 'glb' })
    expect(doc.objectTree?.[0]?.meshRef).toBe(doc.geometry3D?.[0]?.id)
  })

  it('creates and edits a deterministic keyframe track in the animate step', async () => {
    const onSave = vi.fn<(doc: SceneDocument) => Promise<boolean>>(() => Promise.resolve(true))
    render(<TeacherStudio onSave={onSave} />)
    fireEvent.click(screen.getByRole('button', { name: 'DNA 双螺旋模板' }))
    fireEvent.click(screen.getByText('DNA 链'))
    fireEvent.click(screen.getByText(/3\. 调动画/))

    expect(screen.getByLabelText('动画属性')).not.toBeNull()
    fireEvent.click(screen.getByRole('button', { name: '添加动画轨道' }))
    expect(screen.getByText('2 关键帧')).not.toBeNull()

    fireEvent.change(screen.getByLabelText('关键帧 2 时间'), { target: { value: '4' } })
    fireEvent.change(screen.getByLabelText('关键帧 2 X'), { target: { value: '2' } })
    fireEvent.change(screen.getByLabelText('关键帧 2 缓动'), { target: { value: 'ease-in-out' } })
    fireEvent.click(screen.getByRole('button', { name: '保存草稿' }))

    await waitFor(() => expect(onSave).toHaveBeenCalledTimes(1))
    const doc = onSave.mock.calls[0]![0]
    const track = doc.timeline?.tracks[0]
    expect(track?.nodeId).toBe('strand')
    expect(track?.keyframes).toHaveLength(2)
    expect(track?.keyframes[1]).toMatchObject({
      time: 4,
      property: 'transform.position',
      value: [2, 0, 0],
      easing: 'ease-in-out'
    })
  })

  it('save draft calls the injected handler with the current document', async () => {
    const onSave = vi.fn<(doc: SceneDocument) => Promise<boolean>>(() => Promise.resolve(true))
    render(<TeacherStudio onSave={onSave} />)
    fireEvent.click(screen.getByRole('button', { name: '保存草稿' }))
    await waitFor(() => expect(onSave).toHaveBeenCalledTimes(1))
    const doc = onSave.mock.calls[0]![0]
    expect(doc.documentMeta.sceneFormatVersion).toBe('1.0')
  })

  it('submit calls the injected handler and shows the version id', async () => {
    const onSubmit = vi.fn(() => Promise.resolve({ versionId: 'v-123' }))
    render(<TeacherStudio onSubmit={onSubmit} />)
    fireEvent.click(screen.getByRole('button', { name: '提交审核' }))
    await waitFor(() => expect(onSubmit).toHaveBeenCalled())
    await waitFor(() => expect(screen.getByText(/v-123/)).not.toBeNull())
  })

  it('AI drawer (T-I) exposes description input + generate + confirm/reject', () => {
    render(<TeacherStudio />)
    fireEvent.click(screen.getByRole('button', { name: 'AI 起稿' }))
    expect(screen.getByRole('dialog', { name: 'AI 起稿' })).not.toBeNull()
    expect(screen.getByLabelText('描述场景')).not.toBeNull()
    // Generate disabled when description empty (explicit, not silent).
    expect(screen.getByRole('button', { name: '生成场景' })).toBeDisabled()
  })

  it('preview step mounts the student player', async () => {
    render(<TeacherStudio />)
    fireEvent.click(screen.getByText(/4\. 预览/))
    await waitFor(() => expect(document.querySelector('.student-player')).not.toBeNull())
  })

  it('professional panes default collapsed, expand on demand', () => {
    render(<TeacherStudio />)
    const toggle = screen.getByRole('button', { name: /专业能力/ })
    expect(toggle.getAttribute('aria-expanded')).toBe('false')
    fireEvent.click(toggle)
    expect(toggle.getAttribute('aria-expanded')).toBe('true')
    expect(screen.getByLabelText('动画时间线')).not.toBeNull()
  })
})

describe('T-H TeacherWorkbench studio tab', () => {
  it('exposes the studio tab that lazily mounts TeacherStudio', () => {
    render(<TeacherWorkbench />)
    fireEvent.click(screen.getByRole('tab', { name: /教学演示创作台/ }))
    expect(screen.getByText('教学演示创作台')).not.toBeNull()
  })
})
