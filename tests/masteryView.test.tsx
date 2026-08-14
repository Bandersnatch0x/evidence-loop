/**
 * MasteryView — KP-bound demonstration section (知识点页 touchpoint).
 * Verifies that selecting a knowledge point fetches /api/demonstrations/by-kp
 * and lazy-mounts StudentDemonstration (expanded); shows graceful empty.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import type { KnowledgePoint } from '../shared/contracts'
import { MasteryHeatmap } from '../src/components/MasteryHeatmap'

const points: KnowledgePoint[] = [
  { id: 'kp.bio.photo', name: '光合作用', weight: 1 },
  { id: 'kp.empty', name: '空知识点', weight: 1 }
]

describe('MasteryHeatmap evidence controls', () => {
  it('keeps mastery selection and evidence disclosure as sibling buttons', () => {
    const onSelectKp = vi.fn()
    render(
      <MasteryHeatmap
        points={[points[0]!]}
        profile={{
          'kp.bio.photo': {
            score: 0.8,
            evidenceIds: ['evidence-1'],
            computedAt: '2026-08-14T00:00:00.000Z',
            algorithmVersion: 'mastery-v1'
          }
        }}
        onSelectKp={onSelectKp}
      />
    )

    const cell = screen.getByRole('listitem')
    const cellButtons = within(cell).getAllByRole('button')
    expect(cellButtons).toHaveLength(2)
    expect(cell.querySelector('button button')).toBeNull()

    fireEvent.click(screen.getByRole('button', { name: '基于 1 条证据' }))
    expect(onSelectKp).not.toHaveBeenCalled()
    expect(screen.getByRole('dialog')).not.toBeNull()
  })
})

function mockMasteryApi(): void {
  vi.doMock('../src/lib/api', () => ({
    getMasteryProfile: vi.fn(() => Promise.resolve({ 'kp.bio.photo': { masteryLevel: 3, evidenceIds: [] } })),
    getMasteryTimeline: vi.fn(() => Promise.resolve([])),
    getNextIntervention: vi.fn(() => Promise.reject(new Error('no intervention in test')))
  }))
}

describe('MasteryView KP demonstration section', () => {
  let originalFetch: typeof globalThis.fetch

  beforeEach(() => {
    originalFetch = globalThis.fetch
    vi.doUnmock('../src/lib/api')
  })

  afterEach(() => {
    globalThis.fetch = originalFetch
    vi.restoreAllMocks()
    vi.doUnmock('../src/lib/api')
  })

  it('mounts KP demonstrations for the selected knowledge point', async () => {
    mockMasteryApi()
    globalThis.fetch = vi.fn(() =>
      Promise.resolve(
        new Response(
          JSON.stringify({
            demonstrations: [
              {
                id: 'ref-1',
                role: 'primary',
                title: '光合作用演示',
                authorName: '平台',
                license: 'CC-BY-4.0',
                versionSeq: 1,
                source: 'public',
                demoId: 'demo-1',
                versionId: 'v-1',
                health: 'healthy'
              }
            ]
          }),
          { status: 200, headers: { 'content-type': 'application/json' } }
        )
      )
    )

    const { MasteryView } = await import('../src/components/MasteryView')
    render(<MasteryView studentId="s1" points={points} />)

    // First tracked KP is auto-selected; demonstration section mounts.
    await waitFor(() =>
      expect(screen.getByRole('region', { name: '知识点教学演示' })).not.toBeNull()
    )
    expect(screen.getByText(/光合作用 · 教学演示/)).not.toBeNull()
    expect(globalThis.fetch).toHaveBeenCalledWith(
      '/api/demonstrations/by-kp/kp.bio.photo'
    )
  })

  it('shows a graceful empty message when the KP has no demonstrations', async () => {
    mockMasteryApi()
    globalThis.fetch = vi.fn(() =>
      Promise.resolve(
        new Response(JSON.stringify({ demonstrations: [] }), {
          status: 200,
          headers: { 'content-type': 'application/json' }
        })
      )
    )

    const { MasteryView } = await import('../src/components/MasteryView')
    render(<MasteryView studentId="s1" points={points} />)

    await waitFor(() =>
      expect(screen.getByText('该知识点暂无教学演示')).not.toBeNull()
    )
  })
})
