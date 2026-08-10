/**
 * T-J reference UI tests — teacher drawer closed loop (search → preview →
 * bind → reorder → remove, primary-replace confirm, supplementary ≤8) and the
 * student-side presentation (primary + collapsible supplementary + source
 * badge). Injected API keeps tests hermetic.
 */
import { describe, it, expect, vi } from 'vitest'
import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import { ReferenceDrawer, type LibraryCard, type ReferenceEntry } from '../src/components/demonstration/ReferenceDrawer'
import { StudentDemonstration, type StudentRef } from '../src/components/demonstration/StudentDemonstration'

const CARDS: LibraryCard[] = [
  {
    id: 'd1', title: 'DNA 双螺旋', description: '双链结构', authorName: '张三', license: 'CC-BY-4.0',
    subject: 'bio', grade: 'grade9', format: 'scene', space: '3d', behavior: 'interactive',
    versionSeq: 2, latestVersionId: 'v2', health: 'healthy', citationCount: 3, sourceBadge: null
  },
  {
    id: 'd2', title: '电磁感应', description: '线圈', authorName: '李四', license: 'CC-BY-4.0',
    subject: 'phy', grade: 'grade9', format: 'scene', space: '3d', behavior: 'interactive',
    versionSeq: 1, latestVersionId: 'v1', health: 'healthy', citationCount: 1, sourceBadge: null
  }
]

type TestApi = NonNullable<Parameters<typeof ReferenceDrawer>[0]['api']> & {
  setReferences: ReturnType<typeof vi.fn>
  removeReference: ReturnType<typeof vi.fn>
  upgradeReference: ReturnType<typeof vi.fn>
  list: ReturnType<typeof vi.fn>
  getReferences: ReturnType<typeof vi.fn>
  loadPlayer: ReturnType<typeof vi.fn>
}

function makeApi(overrides: Partial<NonNullable<Parameters<typeof ReferenceDrawer>[0]['api']>> = {}): TestApi {
  const refs: ReferenceEntry[] = []
  const base = {
    list: vi.fn(() => Promise.resolve(CARDS)),
    getReferences: vi.fn(() => Promise.resolve([...refs])),
    setReferences: vi.fn((entries: Array<{ demoVersionId: string; role: 'primary' | 'supplementary' }>) => {
      refs.length = 0
      entries.forEach((e, i) => refs.push({
        id: `ref-${i}`,
        demoVersionId: e.demoVersionId,
        demoId: CARDS.find((card) => card.latestVersionId === e.demoVersionId)?.id ?? 'unknown',
        role: e.role,
        ord: i
      }))
      return Promise.resolve()
    }),
    removeReference: vi.fn((id: string) => {
      const i = refs.findIndex((r) => r.id === id)
      if (i >= 0) refs.splice(i, 1)
      return Promise.resolve()
    }),
    upgradeReference: vi.fn((id: string, newVersionId: string) => {
      const r = refs.find((x) => x.id === id)
      if (r) r.demoVersionId = newVersionId
      return Promise.resolve()
    }),
    loadPlayer: vi.fn(() => Promise.resolve({ document: null, mediaManifest: [] }))
  }
  return { ...base, ...overrides } as TestApi
}

describe('T-J ReferenceDrawer', () => {
  it('search returns library cards and bind sets primary', async () => {
    const api = makeApi()
    render(<ReferenceDrawer questionId="q1" api={api} />)
    fireEvent.change(screen.getByLabelText('检索'), { target: { value: 'DNA' } })
    fireEvent.click(screen.getByRole('button', { name: '检索' }))
    await waitFor(() => expect(screen.getByText('DNA 双螺旋')).not.toBeNull())
    fireEvent.click(screen.getAllByRole('button', { name: '设为主演示' })[0]!)
    await waitFor(() => expect(api.setReferences).toHaveBeenCalled())
    expect(api.setReferences.mock.calls[0]?.[0]).toContainEqual({ demoVersionId: 'v2', role: 'primary' })
  })

  it('replacing primary requires confirmation', async () => {
    const api = makeApi()
    render(<ReferenceDrawer questionId="q1" api={api} />)
    fireEvent.change(screen.getByLabelText('检索'), { target: { value: 'DNA' } })
    fireEvent.click(screen.getByRole('button', { name: '检索' }))
    await waitFor(() => expect(screen.getByText('DNA 双螺旋')).not.toBeNull())
    // First bind d1.
    fireEvent.click(screen.getAllByRole('button', { name: '设为主演示' })[0]!)
    await waitFor(() => expect(api.setReferences).toHaveBeenCalledTimes(1))
    // Bind d2 → replace confirm appears.
    fireEvent.click(screen.getAllByRole('button', { name: '设为主演示' })[1]!)
    await waitFor(() => expect(screen.getByText('替换当前主演示？')).not.toBeNull())
    fireEvent.click(screen.getByRole('button', { name: '确认替换' }))
    await waitFor(() => expect(api.setReferences).toHaveBeenCalledTimes(2))
    expect(api.setReferences.mock.calls[1]?.[0]).toContainEqual({ demoVersionId: 'v1', role: 'primary' })
  })

  it('supplementary add is capped at 8 via UI disable', async () => {
    const fullApi = makeApi()
    fullApi.getReferences.mockResolvedValue(
      Array.from({ length: 8 }, (_, i) => ({ id: `s${i}`, demoVersionId: `v${i}`, demoId: `d${i}`, role: 'supplementary' as const, ord: i }))
    )
    render(<ReferenceDrawer questionId="q1" api={fullApi} />)
    await waitFor(() => expect(fullApi.getReferences).toHaveBeenCalled())
    // Search to surface result cards.
    fireEvent.change(screen.getByLabelText('检索'), { target: { value: 'DNA' } })
    fireEvent.click(screen.getByRole('button', { name: '检索' }))
    await waitFor(() => expect(screen.getAllByText('DNA 双螺旋').length).toBeGreaterThan(0))
    await waitFor(() => expect(screen.getAllByRole('button', { name: '加入补充' })[0]!).toBeDisabled())
  })

  it('upgrade resolves by demo id and requires explicit confirmation', async () => {
    const api = makeApi()
    api.getReferences.mockResolvedValue([
      { id: 'r1', demoVersionId: 'v1-old', demoId: 'd1', role: 'primary', ord: 0 }
    ])
    render(<ReferenceDrawer questionId="q1" api={api} />)
    await waitFor(() => expect(screen.getByRole('button', { name: '升级到 v2' })).not.toBeNull())
    fireEvent.click(screen.getByRole('button', { name: '升级到 v2' }))
    expect(api.upgradeReference).not.toHaveBeenCalled()
    fireEvent.click(screen.getByRole('button', { name: '确认升级到 v2' }))
    await waitFor(() => expect(api.upgradeReference).toHaveBeenCalledWith('r1', 'v2'))
  })

  it('remove shows confirm then unbinds', async () => {
    const api = makeApi()
    api.getReferences.mockResolvedValue([{ id: 'r1', demoVersionId: 'v2', demoId: 'd1', role: 'primary', ord: 0 }])
    render(<ReferenceDrawer questionId="q1" api={api} />)
    await waitFor(() => expect(screen.getByRole('button', { name: '移除' })).not.toBeNull())
    fireEvent.click(screen.getByRole('button', { name: '移除' }))
    await waitFor(() => expect(screen.getByRole('button', { name: '确认移除' })).not.toBeNull())
    fireEvent.click(screen.getByRole('button', { name: '确认移除' }))
    await waitFor(() => expect(api.removeReference).toHaveBeenCalledWith('r1'))
  })
})

describe('T-J StudentDemonstration', () => {
  const REFS: StudentRef[] = [
    { id: 'p1', role: 'primary', title: 'DNA', authorName: '张三', license: 'CC-BY-4.0', versionSeq: 2, source: 'public', demoId: 'd1', versionId: 'v2', health: 'healthy' },
    { id: 's1', role: 'supplementary', title: '感应', authorName: '李四', license: 'CC-BY-4.0', versionSeq: 1, source: 'mine', demoId: 'd2', versionId: 'v1', health: 'healthy' }
  ]

  it('renders primary with source badge and lazy player', async () => {
    const loadPlayer = vi.fn(() => Promise.resolve({ document: null, mediaManifest: [] }))
    render(<StudentDemonstration refs={REFS} expanded={false} loadPlayer={loadPlayer} />)
    await waitFor(() => expect(loadPlayer).toHaveBeenCalledWith('d1', 'v2'))
    expect(screen.getByText('公共库')).not.toBeNull()
    expect(screen.getByText('v2')).not.toBeNull()
  })

  it('shows collapsible supplementary list only when expanded', async () => {
    const loadPlayer = vi.fn(() => Promise.resolve({ document: null, mediaManifest: [] }))
    const { rerender } = render(<StudentDemonstration refs={REFS} expanded={false} loadPlayer={loadPlayer} />)
    await waitFor(() => expect(loadPlayer).toHaveBeenCalled())
    expect(screen.queryByText(/补充演示/)).toBeNull()
    rerender(<StudentDemonstration refs={REFS} expanded={true} loadPlayer={loadPlayer} />)
    expect(screen.getByText(/补充演示（1）/)).not.toBeNull()
    expect(screen.getByText('我的演示')).not.toBeNull()
  })

  it('marks unavailable sources with a badge but keeps playing', async () => {
    const refs: StudentRef[] = [{ ...REFS[0]!, health: 'unavailable' }]
    render(<StudentDemonstration refs={refs} expanded={false} loadPlayer={vi.fn(() => Promise.resolve({ document: null, mediaManifest: [] }))} />)
    await waitFor(() => expect(screen.getByText(/源不可用/)).not.toBeNull())
  })

  it('degrades to an error placeholder when the payload load rejects', async () => {
    const loadPlayer = vi.fn(() => Promise.reject(new Error('network down')))
    render(<StudentDemonstration refs={[REFS[0]!]} expanded={false} loadPlayer={loadPlayer} />)
    await waitFor(() => expect(screen.getByRole('alert')).not.toBeNull())
    expect(screen.getByText(/演示加载失败/)).not.toBeNull()
  })
})