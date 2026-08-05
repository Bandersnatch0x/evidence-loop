/**
 * TodayReviewList — KP-bound demonstration toggle (解析页 touchpoint).
 * Verifies the "查看教学演示" toggle fetches /api/demonstrations/by-kp/:kpId
 * and lazy-mounts StudentDemonstration; falls back gracefully when none.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import { TodayReviewList } from '../src/components/TodayReviewList'
import type { ReviewCard } from '../shared/contracts'

const card = (kpId: string): ReviewCard => ({
  id: 'card-1',
  studentId: 's1',
  kpId,
  scheduling: {
    state: 'review',
    dueAt: '2026-01-01T00:00:00.000Z',
    reps: 3,
    lapses: 1,
    stability: 2.5,
    difficulty: 5
  }
})

describe('TodayReviewList KP demonstration toggle', () => {
  let originalFetch: typeof globalThis.fetch

  beforeEach(() => {
    originalFetch = globalThis.fetch
  })

  afterEach(() => {
    globalThis.fetch = originalFetch
    vi.restoreAllMocks()
  })

  it('fetches KP demonstrations and mounts the player on toggle', async () => {
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

    render(
      <TodayReviewList
        cards={[card('kp.bio.photo')]}
        kpNames={new Map([['kp.bio.photo', '光合作用']])}
        onComplete={vi.fn()}
      />
    )

    expect(screen.getByText('光合作用')).not.toBeNull()
    const toggle = screen.getByRole('button', { name: /查看教学演示/ })
    fireEvent.click(toggle)

    // KP demonstration region mounts; lazy player may still be resolving.
    await waitFor(() =>
      expect(screen.getByRole('region', { name: '知识点教学演示' })).not.toBeNull()
    )
    expect(globalThis.fetch).toHaveBeenCalledWith(
      '/api/demonstrations/by-kp/kp.bio.photo'
    )
  })

  it('shows a graceful empty message when the KP has no demonstrations', async () => {
    globalThis.fetch = vi.fn(() =>
      Promise.resolve(
        new Response(JSON.stringify({ demonstrations: [] }), {
          status: 200,
          headers: { 'content-type': 'application/json' }
        })
      )
    )

    render(
      <TodayReviewList
        cards={[card('kp.empty')]}
        kpNames={new Map([['kp.empty', '空知识点']])}
        onComplete={vi.fn()}
      />
    )

    fireEvent.click(screen.getByRole('button', { name: /查看教学演示/ }))
    await waitFor(() =>
      expect(screen.getByText('该知识点暂无教学演示')).not.toBeNull()
    )
  })
})
