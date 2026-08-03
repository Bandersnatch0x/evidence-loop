/**
 * T-G StudentPlayer component tests — rendering paths, degradation ladder,
 * keyboard-reachable controls, interaction buttons, and the zero-submission
 * contract. jsdom environment (vitest.config). The player is pure presentation:
 * no scoring, no evidence, no submission props.
 */
import { describe, it, expect } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import { StudentPlayer } from '../src/components/player/StudentPlayer'
import type { PlayerPayload } from '../server/demonstration/playerRoutes'
import { parseSceneDocument } from '../server/demonstration/sceneDocumentSchema'

const BASE_DOC = parseSceneDocument({
  documentMeta: { sceneFormatVersion: '1.0' },
  runtimeVersion: { sceneFormatVersion: '1.0', capabilities: [] },
  viewerConfig: { camera: { position: [3, 2, 5], target: [0, 0, 0], fov: 50 } },
  objectTree: [
    {
      id: 'leaf',
      name: 'leaf',
      transform: { position: [0, 0, 0], rotation: [0, 0, 0], scale: [1, 1, 1] },
      visible: true,
      meshRef: 'leaf-rect',
      children: []
    }
  ],
  geometry2D: [
    { id: 'leaf-rect', shape: 'rect', x: -1, y: -1, width: 2, height: 2, rx: 0, ry: 0 }
  ],
  materials: [{ kind: 'fill2d', fill: '#228b22', fillOpacity: 1 }],
  interactions: [
    { type: 'orbit', nodeId: 'leaf', enabled: true },
    {
      type: 'step-visibility',
      nodeId: 'leaf',
      steps: [
        { label: '一', show: ['leaf'] },
        { label: '二', show: ['leaf'] }
      ]
    },
    { type: 'view-switch', nodeId: 'leaf', viewpoints: [{ label: '前', position: [0, 0, 5], target: [0, 0, 0] }] }
  ],
  timeline: { tracks: [], chapters: [], duration: 30 },
  editorMetadata: {}
})

function payload(overrides: Partial<PlayerPayload> = {}): PlayerPayload {
  return {
    demonstrationId: 'd1',
    versionId: 'v1',
    status: 'approved',
    document: BASE_DOC,
    renderLevel: 'full',
    reasons: [],
    mediaManifest: [],
    coverRef: null,
    subtitleRef: null,
    budget: { ok: true, issues: [], nodes: 1, triangles: 0, durationSeconds: 30, mediaRefs: 0 },
    externalVideos: [],
    ...overrides
  }
}

describe('T-G StudentPlayer component', () => {
  it('renders the SVG 2D path for a 2D document', () => {
    render(<StudentPlayer payload={payload()} device={{ webgl: 'webgl2', tier: 'high', prefersReducedMotion: false, maxTextureSize: 4096 }} />)
    expect(document.querySelector('.student-player-svg')).not.toBeNull()
    expect(screen.getByRole('toolbar', { name: '播放控制' })).not.toBeNull()
  })

  it('negotiates static-alternative for reduced-motion devices', () => {
    render(
      <StudentPlayer
        payload={payload()}
        device={{ webgl: 'webgl2', tier: 'high', prefersReducedMotion: true, maxTextureSize: 4096 }}
      />
    )
    expect(document.querySelector('.player-static-alt')).not.toBeNull()
  })

  it('refuses when the document is null (refuse path shows warning)', () => {
    render(
      <StudentPlayer
        payload={payload({ document: null })}
        device={{ webgl: 'webgl2', tier: 'high', prefersReducedMotion: false, maxTextureSize: 4096 }}
      />
    )
    expect(screen.getByRole('alert')).not.toBeNull()
  })

  it('shows budget warning when over budget', () => {
    const over = payload()
    over.budget = { ok: false, issues: ['nodes 9999 > 2000'], nodes: 9999, triangles: 0, durationSeconds: 30, mediaRefs: 0 }
    render(
      <StudentPlayer
        payload={over}
        device={{ webgl: 'webgl2', tier: 'high', prefersReducedMotion: false, maxTextureSize: 4096 }}
      />
    )
    expect(screen.getByRole('alert').textContent).toContain('资源超预算')
  })

  it('renders interaction buttons (step + view-switch + orbit) and steps advance', () => {
    render(
      <StudentPlayer
        payload={payload()}
        device={{ webgl: 'webgl2', tier: 'high', prefersReducedMotion: false, maxTextureSize: 4096 }}
      />
    )
    const stepButton = screen.getByRole('button', { name: '下一步骤' })
    expect(stepButton.textContent).toContain('1/2')
    fireEvent.click(stepButton)
    expect(screen.getByRole('button', { name: '下一步骤' }).textContent).toContain('2/2')
    expect(screen.getByRole('button', { name: '切换视角' })).not.toBeNull()
    expect(screen.getByRole('button', { name: '旋转/缩放' })).not.toBeNull()
  })

  it('pick-highlight interaction drives node highlight in the SVG render', () => {
    const pickDoc = parseSceneDocument({
      documentMeta: { sceneFormatVersion: '1.0' },
      runtimeVersion: { sceneFormatVersion: '1.0', capabilities: [] },
      objectTree: [],
      geometry2D: [{ id: 'leaf', shape: 'circle', cx: 0, cy: 0, r: 1 }],
      interactions: [{ type: 'pick-highlight', nodeId: 'leaf', highlightColor: '#ffff00', label: '叶片' }]
    })
    render(
      <StudentPlayer
        payload={payload({ document: pickDoc })}
        device={{ webgl: 'webgl2', tier: 'high', prefersReducedMotion: false, maxTextureSize: 4096 }}
      />
    )
    const svg = document.querySelector('.student-player-svg')!
    expect(svg.querySelector('[data-highlighted="true"]')).toBeNull()
    fireEvent.click(screen.getByRole('button', { name: '叶片' }))
    const highlighted = document.querySelector('[data-highlighted="true"]')
    expect(highlighted).not.toBeNull()
  })

  it('keyboard-reachable controls (play button toggles aria-label)', () => {
    render(
      <StudentPlayer
        payload={payload()}
        device={{ webgl: 'webgl2', tier: 'high', prefersReducedMotion: false, maxTextureSize: 4096 }}
      />
    )
    const play = screen.getByRole('button', { name: '播放' })
    fireEvent.click(play)
    expect(screen.getByRole('button', { name: '暂停' })).not.toBeNull()
  })

  it('text view toggle shows the accessibility text alternative', () => {
    render(
      <StudentPlayer
        payload={payload()}
        device={{ webgl: 'webgl2', tier: 'high', prefersReducedMotion: false, maxTextureSize: 4096 }}
      />
    )
    fireEvent.click(screen.getByRole('button', { name: '文字替代视图' }))
    expect(screen.getByRole('region', { name: '文字替代视图' })).not.toBeNull()
  })

  it('video chapters render the click-to-load launch button only', () => {
    const videoDoc = parseSceneDocument({
      documentMeta: { sceneFormatVersion: '1.0' },
      runtimeVersion: { sceneFormatVersion: '1.0', capabilities: ['video'] },
      objectTree: [],
      geometry2D: [],
      mediaRefs: [{ id: 'evr-1', blobHash: '0'.repeat(64), purpose: 'video' }],
      timeline: {
        tracks: [],
        chapters: [{ title: '视频段', mediaRefId: 'evr-1', startTime: 0, endTime: 30 }],
        duration: 30
      }
    })
    const videoPayload = payload({ document: videoDoc })
    videoPayload.externalVideos = [
      { id: 'evr-1', provider: 'youtube', providerVideoId: 'abc123', canonicalUrl: 'https://www.youtube.com/watch?v=abc123', health: 'healthy' }
    ]
    render(
      <StudentPlayer
        payload={videoPayload}
        device={{ webgl: 'webgl2', tier: 'high', prefersReducedMotion: false, maxTextureSize: 4096 }}
      />
    )
    const launch = screen.getByRole('button', { name: /播放视频/ })
    expect(launch).not.toBeNull()
    // iframe not loaded until click (spec §6.6 click-gated)
    expect(document.querySelector('iframe')).toBeNull()
    fireEvent.click(launch)
    expect(document.querySelector('iframe')).not.toBeNull()
  })
})
