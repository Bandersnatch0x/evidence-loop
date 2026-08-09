import { fireEvent, render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import { PlayerControls } from '../src/components/player/controls'

function renderControls(overrides: Record<string, unknown> = {}) {
  const props = {
    playing: false,
    onTogglePlay: vi.fn(),
    currentTime: 0,
    duration: 60,
    onSeek: vi.fn(),
    chapters: [{ title: 'ch1' }, { title: 'ch2' }, { title: 'ch3' }],
    currentChapter: 1,
    onChapter: vi.fn(),
    onReplay: vi.fn(),
    showTextView: false,
    onToggleTextView: vi.fn(),
    containerRef: { current: null },
    ...overrides
  }
  return render(<PlayerControls {...props} />)
}

describe('PlayerControls 重播与分段步进 (P2-1)', () => {
  it('fires onReplay when the replay button is clicked', () => {
    const onReplay = vi.fn()
    renderControls({ onReplay })
    fireEvent.click(screen.getByRole('button', { name: '重播' }))
    expect(onReplay).toHaveBeenCalledTimes(1)
  })

  it('steps to the previous chapter via 上一段', () => {
    const onChapter = vi.fn()
    renderControls({ onChapter, currentChapter: 2 })
    fireEvent.click(screen.getByRole('button', { name: '上一段' }))
    expect(onChapter).toHaveBeenCalledWith(1)
  })

  it('steps to the next chapter via 下一段', () => {
    const onChapter = vi.fn()
    renderControls({ onChapter, currentChapter: 0 })
    fireEvent.click(screen.getByRole('button', { name: '下一段' }))
    expect(onChapter).toHaveBeenCalledWith(1)
  })

  it('disables 上一段 at the first chapter', () => {
    renderControls({ currentChapter: 0 })
    expect(screen.getByRole('button', { name: '上一段' })).toBeDisabled()
  })

  it('disables 下一段 at the last chapter', () => {
    renderControls({ currentChapter: 2 })
    expect(screen.getByRole('button', { name: '下一段' })).toBeDisabled()
  })
})
