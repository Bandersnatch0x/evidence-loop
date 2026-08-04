/**
 * T-M v1 acceptance tests — quality budget configuration (env ≠ constant),
 * governance audit completeness, scoring-chain invariants, and chunk
 * isolation assertions (spec §9).
 */
import { describe, it, expect, afterEach } from 'vitest'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { resolveResourceBudget } from '../server/demonstration/sceneSecurity'
import { parseSceneDocument } from '../server/demonstration/sceneDocumentSchema'
import { checkPlayerBudget, PLAYER_BUDGET } from '../src/components/player/budget'
import { ACTION_MAP } from '../server/demonstration/demoAuditSink'

afterEach(() => {
  for (const key of Object.keys(process.env)) {
    if (key.startsWith('DEMO_BUDGET_')) delete process.env[key]
  }
})

describe('T-M quality budget configuration (配置值 ≠ 代码常量)', () => {
  it('env overrides change the resource budget; defaults stay spec constants', () => {
    const defaults = resolveResourceBudget({})
    expect(defaults.maxNodes).toBe(2000)
    expect(defaults.maxTriangles).toBe(500_000)

    process.env.DEMO_BUDGET_MAX_NODES = '150'
    process.env.DEMO_BUDGET_MAX_TRIANGLES = '9999'
    const configured = resolveResourceBudget(process.env)
    expect(configured.maxNodes).toBe(150)
    expect(configured.maxTriangles).toBe(9999)
    // Unset caps keep defaults.
    expect(configured.maxAnimationSeconds).toBe(600)
  })

  it('invalid env values fall back to defaults (never zero/negative)', () => {
    process.env.DEMO_BUDGET_MAX_NODES = 'abc'
    process.env.DEMO_BUDGET_MAX_NODES = '-5'
    const budget = resolveResourceBudget(process.env)
    expect(budget.maxNodes).toBe(2000)
  })
})

describe('T-M player budget second gate', () => {
  it('player refuses over-budget snapshots with a visible issue (never silent)', () => {
    const hostile: unknown = {
      documentMeta: { sceneFormatVersion: '1.0' },
      runtimeVersion: { sceneFormatVersion: '1.0', capabilities: [] },
      mediaRefs: Array.from({ length: PLAYER_BUDGET.maxMediaRefs + 5 }, (_, i) => ({
        id: `m${i}`,
        blobHash: `${String(i).padStart(64, '0')}`,
        purpose: 'texture'
      }))
    }
    const issues = checkPlayerBudget(hostile as never)
    expect(issues.some((i) => i.code === 'media-over-budget')).toBe(true)
  })

  it('document passes schema and is within budget → no issues', () => {
    const doc = parseSceneDocument({
      documentMeta: { sceneFormatVersion: '1.0' },
      objectTree: [],
      geometry2D: [],
      timeline: { tracks: [], chapters: [], duration: 10 }
    })
    expect(checkPlayerBudget(doc)).toEqual([])
  })
})

describe('T-M governance audit completeness (spec §5.7)', () => {
  it('demoAuditSink maps every mandatory governance action to the audit enum', () => {
    for (const action of [
      'demo.submit',
      'demo.withdraw',
      'demo.approve',
      'demo.reject',
      'demo.takedown',
      'demo.takedown.forced',
      'demo.report.create',
      'demo.report.resolve',
      'demo.appeal.create',
      'demo.appeal.resolve',
      'demo.upgrade_reference'
    ]) {
      expect(ACTION_MAP[action], `missing audit mapping for ${action}`).toBeTruthy()
    }
  })
})

describe('T-M scoring-chain invariants (evidence-first 铁律)', () => {
  it('player module has no scoring/evidence import and no submission prop', () => {
    const playerSource = readFileSync(
      resolve(__dirname, '../src/components/player/StudentPlayer.tsx'),
      'utf8'
    )
    expect(playerSource).not.toMatch(/from '.*\/(mastery|review|runner|domain\/EvaluationAgent)/)
    // No submission prop or evidence-prop in the component props interface.
    expect(playerSource).not.toMatch(/^\s*(submission|evidence)\s*[?:]/m)
  })
})
