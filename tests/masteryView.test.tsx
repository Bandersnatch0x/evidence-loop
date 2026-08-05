/**
 * MasteryView — KP-bound demonstration section (知识点页 touchpoint).
 * Verifies that selecting a knowledge point fetches /api/demonstrations/by-kp
 * and lazy-mounts StudentDemonstration (expanded); shows graceful empty.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, waitFor } from '@testing-library/react'
import type { KnowledgePoint } from '../shared/contracts'

const points: KnowledgePoint[] = [
  { id: 'kp.bio.photo', name: '光合作用', weight: 1 },
  { id: 'kp.empty', name: '空知识点', weight: 1 }
]

function mockMasteryApi(): void {
  vi.doMock('../src/lib/api', () => ({
    getMasteryProfile: vi.fn(() => Promise.resolve({ 'kp.bio.photo': { masteryLevel: 3, evidenceIds: [] } })),
    getMasteryTimeline: vi.fn(() => Promise.resolve([]))
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
