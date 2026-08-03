/**
 * T-G player pure-function tests — determinism, budget, interactions, lazy
 * loading, capability probe. These lock the §6 contract with the same pure
 * function paradigm as the existing *Projection.ts tests (ADR-0013).
 */
import { describe, it, expect } from 'vitest'
import { parseSceneDocument, type SceneDocument } from '../server/demonstration/sceneDocumentSchema'
import {
  applyEasing,
  sampleTrack,
  lerp,
  lerpVec3,
  seededRandom,
  particlePositions
} from '../src/components/player/determinism'
import { checkPlayerBudget, budgetCounts, PLAYER_BUDGET, chapterOverBudget } from '../src/components/player/budget'
import {
  initialState,
  nextStep,
  prevStep,
  nextView,
  togglePick,
  stepVisibilityNodes,
  orbitEnabled,
  interactionLabel
} from '../src/components/player/interactions'
import { requestChapter, requestEngine, requestVideo, chaptersFromTimeline, requiresEngine, emptyLoadState } from '../src/components/player/lazyLoad'
import { renderLevelLabel } from '../src/components/player/capabilityProbe'

function doc(overrides: Partial<SceneDocument>): SceneDocument {
  return parseSceneDocument({
    documentMeta: { sceneFormatVersion: '1.0' },
    runtimeVersion: { sceneFormatVersion: '1.0', capabilities: [] },
    ...overrides
  })
}

describe('T-G determinism', () => {
  it('easing curves are pure and bounded', () => {
    expect(applyEasing('linear', 0.5)).toBe(0.5)
    expect(applyEasing('ease-in', 0.5)).toBeCloseTo(0.25)
    expect(applyEasing('ease-out', 0.5)).toBeCloseTo(0.75)
    expect(applyEasing('ease-in-out', 0.5)).toBe(0.5)
    expect(applyEasing('step', 0.99)).toBe(0)
    expect(applyEasing('step', 1)).toBe(1)
    // Clamped, never outside [0,1].
    expect(applyEasing('linear', -5)).toBe(0)
    expect(applyEasing('linear', 5)).toBe(1)
  })

  it('lerp and lerpVec3 are exact linear interpolation', () => {
    expect(lerp(0, 10, 0.5)).toBe(5)
    expect(lerpVec3([0, 0, 0], [2, 4, 6], 0.5)).toEqual([1, 2, 3])
  })

  it('sampleTrack is deterministic and handles bool/step/vec3', () => {
    const track = [
      { time: 0, property: 'visible', value: false, easing: 'step' as const },
      { time: 2, property: 'visible', value: true, easing: 'step' as const }
    ]
    expect(sampleTrack(track, 1.9).value).toBe(false)
    expect(sampleTrack(track, 2).value).toBe(true)
    const vecTrack = [
      { time: 0, property: 'transform.position', value: [0, 0, 0] as [number, number, number], easing: 'linear' as const },
      { time: 2, property: 'transform.position', value: [10, 0, 0] as [number, number, number], easing: 'linear' as const }
    ]
    expect(sampleTrack(vecTrack, 1).value).toEqual([5, 0, 0])
    // Same input → same output (determinism).
    expect(sampleTrack(vecTrack, 1).value).toEqual(sampleTrack(vecTrack, 1).value)
  })

  it('seededRandom + particlePositions are deterministic', () => {
    const a = particlePositions('sphere', 10, 42)
    const b = particlePositions('sphere', 10, 42)
    expect(a).toEqual(b)
    const c = particlePositions('sphere', 10, 43)
    expect(a).not.toEqual(c)
    // All unit-ish length for sphere kind.
    for (const [x, y, z] of a) {
      const len = Math.hypot(x, y, z)
      expect(len).toBeCloseTo(1, 5)
    }
    expect(seededRandom(1)()).toBe(seededRandom(1)())
  })
})

describe('T-G budget', () => {
  it('budgetCounts counts nested nodes and estimates triangles', () => {
    const d = doc({
      objectTree: [
        {
          id: 'root',
          transform: { position: [0, 0, 0], rotation: [0, 0, 0], scale: [1, 1, 1] },
          visible: true,
          children: [
            {
              id: 'child',
              transform: { position: [0, 0, 0], rotation: [0, 0, 0], scale: [1, 1, 1] },
              visible: true,
              children: []
            }
          ]
        }
      ],
      geometry3D: [
        { id: 'b', kind: 'box', size: [1, 1, 1] },
        { id: 's', kind: 'sphere', radius: 1, segments: 24 }
      ]
    })
    const counts = budgetCounts(d)
    expect(counts.nodes).toBe(2)
    expect(counts.triangles).toBe(12 + 24 * 24 * 2)
  })

  it('rejects over-budget docs (never silently truncates)', () => {
    // Animation duration over budget (schema allows large durations).
    const d = doc({
      timeline: {
        tracks: [],
        chapters: [],
        duration: PLAYER_BUDGET.maxAnimationSeconds + 10
      }
    })
    const issues = checkPlayerBudget(d)
    expect(issues.some((i) => i.code === 'animation-over-budget')).toBe(true)
    // Media refs over budget: schema caps at 200 == budget cap, so simulate a
    // hostile/legacy snapshot row that slipped past an older schema gate — the
    // player's own second gate must still refuse it.
    const hostile = {
      documentMeta: { sceneFormatVersion: '1.0' },
      runtimeVersion: { sceneFormatVersion: '1.0', capabilities: [] },
      mediaRefs: Array.from({ length: PLAYER_BUDGET.maxMediaRefs + 3 }, (_, i) => ({
        id: `m${i}`,
        blobHash: `${String(i).padStart(64, '0')}`,
        purpose: 'texture'
      }))
    } as unknown as SceneDocument
    const mediaIssues = checkPlayerBudget(hostile)
    expect(mediaIssues.some((i) => i.code === 'media-over-budget')).toBe(true)
  })

  it('chapterOverBudget gates lazy chapter load', () => {
    expect(chapterOverBudget(PLAYER_BUDGET.maxChapterBytes + 1)).toBe(true)
    expect(chapterOverBudget(100)).toBe(false)
    expect(chapterOverBudget(null)).toBe(false)
    expect(chapterOverBudget(PLAYER_BUDGET.maxChapterBytes + 1, { maxChapterBytes: 999 })).toBe(true)
  })
})

describe('T-G interactions', () => {
  const stepInteraction = {
    type: 'step-visibility' as const,
    nodeId: 'n1',
    steps: [
      { label: '一', show: ['a'] },
      { label: '二', show: ['b'], hide: ['a'] }
    ]
  }
  const viewInteraction = {
    type: 'view-switch' as const,
    nodeId: 'n1',
    viewpoints: [
      { label: '前', position: [0, 0, 5] as [number, number, number], target: [0, 0, 0] as [number, number, number] },
      { label: '侧', position: [5, 0, 0] as [number, number, number], target: [0, 0, 0] as [number, number, number] }
    ]
  }

  it('step-visibility cycles deterministically and exposes show/hide', () => {
    const state = initialState(stepInteraction)
    expect(state.type).toBe('step-visibility')
    const s1 = nextStep(state)
    if (s1.type !== 'step-visibility') throw new Error('expected step-visibility')
    expect(s1.stepIndex).toBe(1)
    const s2 = nextStep(s1)
    if (s2.type !== 'step-visibility') throw new Error('expected step-visibility')
    expect(s2.stepIndex).toBe(0) // wraps
    expect(stepVisibilityNodes(stepInteraction, 0)).toEqual(new Set(['a']))
    expect(stepVisibilityNodes(stepInteraction, 1)).toEqual(new Set(['b']))
    // prev wraps the other way
    const prev = prevStep(state)
    if (prev.type !== 'step-visibility') throw new Error('expected step-visibility')
    expect(prev.stepIndex).toBe(1)
  })

  it('view-switch cycles viewpoints; pick toggles', () => {
    const s0 = initialState(viewInteraction)
    if (s0.type !== 'view-switch') throw new Error('expected view-switch')
    expect(s0.index).toBe(0)
    const s1 = nextView(s0)
    if (s1.type !== 'view-switch') throw new Error('expected view-switch')
    expect(s1.index).toBe(1)
    const s2 = nextView(s1)
    if (s2.type !== 'view-switch') throw new Error('expected view-switch')
    expect(s2.index).toBe(0)
    const pick = initialState({ type: 'pick-highlight', nodeId: 'n1', highlightColor: '#ffff00' })
    const toggled = togglePick(pick)
    if (toggled.type !== 'pick-highlight') throw new Error('expected pick-highlight')
    expect(toggled.picked).toBe(true)
  })

  it('orbit enabled flag + labels', () => {
    expect(orbitEnabled({ type: 'orbit', nodeId: 'n1', enabled: true })).toBe(true)
    expect(orbitEnabled({ type: 'orbit', nodeId: 'n1', enabled: false })).toBe(false)
    expect(interactionLabel({ type: 'orbit', nodeId: 'n1', enabled: true })).toBe('旋转/缩放')
    expect(interactionLabel(stepInteraction)).toBe('步骤显隐')
  })
})

describe('T-G lazy loading', () => {
  it('chaptersFromTimeline maps scene/video chapters declaratively', () => {
    const timeline = {
      tracks: [],
      chapters: [
        { title: '开场', startTime: 0 },
        { title: '视频段', mediaRefId: 'evr-1', startTime: 10, endTime: 20 }
      ],
      duration: 30
    }
    const chapters = chaptersFromTimeline(timeline)
    expect(chapters).toHaveLength(2)
    expect(chapters[0]?.kind).toBe('scene')
    expect(chapters[1]?.kind).toBe('video')
    expect(chapters[1]?.mediaRefId).toBe('evr-1')
  })

  it('load state is monotonic and idempotent', () => {
    let state = emptyLoadState()
    state = requestChapter(state, 0)
    state = requestChapter(state, 0) // idempotent
    expect(state.loadedChapters).toEqual([0])
    state = requestEngine(state)
    state = requestEngine(state)
    expect(state.engineRequested).toBe(true)
    state = requestVideo(state, 'evr-1')
    state = requestVideo(state, 'evr-1')
    expect(state.videoRequested).toEqual(['evr-1'])
  })

  it('requiresEngine only when 3D content exists', () => {
    expect(requiresEngine(doc({ geometry3D: [{ id: 'b', kind: 'box', size: [1, 1, 1] }] }))).toBe(true)
    expect(requiresEngine(doc({ geometry2D: [{ id: 'r', shape: 'rect', x: 0, y: 0, width: 1, height: 1 }] }))).toBe(false)
  })

  it('renderLevelLabel maps all levels (merged static/text path)', () => {
    expect(renderLevelLabel('full')).toBe('完整渲染')
    expect(renderLevelLabel('simplified')).toBe('简化渲染')
    expect(renderLevelLabel('static-alternative')).toBe('静态替代')
    expect(renderLevelLabel('refuse')).toBe('无法安全渲染')
  })
})
