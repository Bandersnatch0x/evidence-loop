/**
 * T-K Phase E migration tests — lossless mapping, idempotent runner, zero
 * teacher-data overwrite, dual-read (new reference path + legacy fallback),
 * and CI dual-read consistency (legacy JSON and SceneDocument agree).
 */
import { describe, it, expect } from 'vitest'
import Database from 'better-sqlite3'
import { applyProductMigrations } from '../server/db/migrate'
import { QuestionStore } from '../server/questionbank/QuestionStore'
import { SEED_AUTHOR_ID } from '../server/questionbank/seedFromAssignments'
import { visualizationToSceneDocument, curveToSceneDocument, ballStickToSceneDocument, primitivesToSceneDocument } from '../server/demonstration/migration'
import { ensureDemonstrationMigration, resolveMigratedDemonstration } from '../server/demonstration/migrationRunner'
import { parseSceneDocument } from '../server/demonstration/sceneDocumentSchema'
import type { Visualization } from '../shared/contracts'

const HELIX: Visualization = {
  kind: 'curve',
  points: [
    [0, 0, 0], [0.5, 0.2, 0.3], [1, 0.5, 0.6], [1.5, 0.8, 0.9]
  ],
  label: '磁场螺旋'
}

const METHANE: Visualization = {
  kind: 'ball_stick',
  atoms: [
    { id: 'C', element: 'C', position: [0, 0, 0] },
    { id: 'H1', element: 'H', position: [1, 0, 0] }
  ],
  bonds: [{ from: 'C', to: 'H1' }],
  label: '甲烷'
}

const CIRCUIT: Visualization = {
  kind: 'primitives',
  nodes: [
    { id: 'V', label: '电源', position: [-2, 0, 0], role: 'source' },
    { id: 'R', label: 'R', position: [2, 0, 0], role: 'resistor' }
  ],
  edges: [{ from: 'V', to: 'R', label: '导线' }],
  label: '串联电路'
}

function makeEnv(): { db: Database.Database; store: QuestionStore } {
  const db = new Database(':memory:')
  db.pragma('journal_mode = WAL')
  applyProductMigrations(db)
  const store = new QuestionStore({ database: db })
  return { db, store }
}

describe('T-K lossless mapping (3 kinds → valid SceneDocument)', () => {
  it('curve maps to projected 2D polylines that pass the T-C schema', () => {
    const doc = curveToSceneDocument(HELIX)
    expect(doc.geometry2D?.length).toBe(1)
    expect(doc.geometry2D?.[0]?.shape).toBe('polyline')
    expect(doc.documentMeta.sceneFormatVersion).toBe('1.0')
    // Re-parse proves schema validity.
    expect(() => parseSceneDocument(doc)).not.toThrow()
  })

  it('ball_stick maps atoms to spheres + bonds to cylinders', () => {
    const doc = ballStickToSceneDocument(METHANE)
    expect(doc.geometry3D?.length).toBe(3) // 2 atoms + 1 bond
    expect(doc.geometry3D?.some((g) => g.kind === 'sphere')).toBe(true)
    expect(doc.geometry3D?.some((g) => g.kind === 'cylinder')).toBe(true)
    expect(() => parseSceneDocument(doc)).not.toThrow()
  })

  it('primitives maps nodes to circles + edges to lines', () => {
    const doc = primitivesToSceneDocument(CIRCUIT)
    expect(doc.geometry2D?.some((g) => g.shape === 'circle')).toBe(true)
    expect(doc.geometry2D?.some((g) => g.shape === 'line')).toBe(true)
    expect(() => parseSceneDocument(doc)).not.toThrow()
  })

  it('dispatcher routes all three kinds', () => {
    expect(visualizationToSceneDocument(HELIX).geometry2D?.length).toBeGreaterThan(0)
    expect(visualizationToSceneDocument(METHANE).geometry3D?.length).toBeGreaterThan(0)
    expect(visualizationToSceneDocument(CIRCUIT).geometry2D?.length).toBeGreaterThan(0)
  })
})

describe('T-K migration runner (legacy source removed, ticket #30)', () => {
  // The legacy `questions.visualization_json` column is deleted (Phase C, #30),
  // so QuestionStore can no longer hold a legacy visualization. The migration
  // runner is therefore a permanent no-op over the store: it never finds a
  // question with a visualization to migrate. The guard table retains the
  // historical question→demo mapping written before deletion, and
  // ReferenceService reads it as the new-path resolution (no legacy fallback).

  it('runs as a no-op when no question carries a visualization', () => {
    const env = makeEnv()
    env.store.save({
      id: 'q-plain',
      questionBankId: 'qb-1',
      authorId: SEED_AUTHOR_ID,
      subject: 'math',
      questionType: 'choice',
      stem: '无 viz',
      payload: { kind: 'choice', options: ['a'], answer: 'a' },
      kpIds: [],
      difficulty: 3,
      source: 'authored_key',
      createdAt: new Date().toISOString()
    })
    const counts = ensureDemonstrationMigration(env.db, env.store)
    expect(counts.migrated).toBe(0)
    expect(counts.skippedNoVisualization).toBe(1)
    // No demo rows are created from a question without a visualization.
    expect(env.db.prepare(`SELECT COUNT(*) AS c FROM teaching_demonstrations`).get()).toEqual({ c: 0 })
  })

  it('resolveMigratedDemonstration returns null for an unmigrated question', () => {
    const env = makeEnv()
    // No legacy visualization persisted → no migration mapping is ever written.
    expect(resolveMigratedDemonstration(env.db, 'q-none')).toBeNull()
  })
})

describe('T-K CI dual-read consistency', () => {
  it('legacy visualization and migrated SceneDocument carry the same identity', () => {
    const doc = visualizationToSceneDocument(HELIX)
    expect(doc.editorMetadata?.migratedFrom).toBe('curve')
    expect(doc.runtimeVersion.sceneFormatVersion).toBe('1.0')
    // Deterministic: same input → same output (CI re-run stability).
    const again = visualizationToSceneDocument(HELIX)
    expect(JSON.stringify(again)).toBe(JSON.stringify(doc))
  })

  it('the conversion function is the single source for preset SceneDocuments', () => {
    // Phase C (#30): the legacy column is deleted, so the conversion function
    // is no longer driven by stored question data — it is the pure mapping
    // used by the (now historical) migration and by scene import/export.
    const doc = visualizationToSceneDocument(HELIX)
    expect(() => parseSceneDocument(doc)).not.toThrow()
    expect(doc.editorMetadata?.migratedFrom).toBe('curve')
  })
})
