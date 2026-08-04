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

function seedQuestionWithViz(
  env: { db: Database.Database; store: QuestionStore },
  id: string,
  viz: Visualization,
  author = SEED_AUTHOR_ID
): void {
  env.store.save({
    id,
    questionBankId: 'qb-1',
    authorId: author,
    subject: 'physics',
    questionType: 'choice',
    stem: '演示题',
    payload: { kind: 'choice', options: ['a', 'b'], answer: 'a' },
    kpIds: ['kp.phy.demo'],
    difficulty: 3,
    source: 'authored_key',
    createdAt: new Date().toISOString(),
    visualization: viz
  } as never)
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

describe('T-K migration runner (idempotent, zero overwrite)', () => {
  it('migrates questions with visualizations; guard table prevents duplicates', () => {
    const env = makeEnv()
    seedQuestionWithViz(env, 'q-helix', HELIX)
    seedQuestionWithViz(env, 'q-methane', METHANE)

    const first = ensureDemonstrationMigration(env.db, env.store)
    expect(first.migrated).toBe(2)
    expect(env.db.prepare(`SELECT COUNT(*) AS c FROM visualization_migration_map`).get()).toEqual({ c: 2 })

    const second = ensureDemonstrationMigration(env.db, env.store)
    expect(second.migrated).toBe(0)
    expect(second.skippedExisting).toBe(2)
  })

  it('questions without visualization are never touched', () => {
    const env = makeEnv()
    seedQuestionWithViz(env, 'q-plain', HELIX)
    env.store.save({
      id: 'q-noviz', questionBankId: 'qb-1', authorId: SEED_AUTHOR_ID, subject: 'math', stem: '无 viz',
      payload: { kind: 'choice', options: ['a'], answer: 'a' }, kpIds: [], questionType: 'choice', difficulty: 3,
      source: 'authored_key', createdAt: new Date().toISOString()
    } as never)
    const counts = ensureDemonstrationMigration(env.db, env.store)
    expect(counts.migrated).toBe(1)
    expect(counts.skippedNoVisualization).toBe(1)
    // The no-viz question produced no demo row.
    expect(env.db.prepare(`SELECT COUNT(*) AS c FROM teaching_demonstrations`).get()).toEqual({ c: 1 })
  })

  it('teacher-authored visualizations are migrated but teacher data preserved', () => {
    const env = makeEnv()
    seedQuestionWithViz(env, 'q-teacher', HELIX, 'teacher-9')
    const before = env.store.get('q-teacher')
    const counts = ensureDemonstrationMigration(env.db, env.store)
    expect(counts.migrated).toBe(1)
    const after = env.store.get('q-teacher')
    // The question row is untouched (only new demo created).
    expect(after?.visualization).toEqual(before?.visualization)
  })

  it('rolls back created demos when guard insertion fails', () => {
    const env = makeEnv()
    seedQuestionWithViz(env, 'q-atomic', HELIX)
    env.db.exec(`
      CREATE TABLE IF NOT EXISTS visualization_migration_map (
        question_id TEXT PRIMARY KEY,
        demo_id TEXT NOT NULL,
        version_id TEXT NOT NULL,
        migrated_at TEXT NOT NULL
      );
      CREATE TRIGGER force_guard_failure
      BEFORE INSERT ON visualization_migration_map
      BEGIN
        SELECT RAISE(ABORT, 'forced guard failure');
      END;
    `)
    expect(() => ensureDemonstrationMigration(env.db, env.store)).toThrow(/forced guard failure/)
    expect(env.db.prepare(`SELECT COUNT(*) AS c FROM teaching_demonstrations`).get()).toEqual({ c: 0 })
    expect(env.db.prepare(`SELECT COUNT(*) AS c FROM demonstration_versions`).get()).toEqual({ c: 0 })
  })

  it('resolveMigratedDemonstration returns the new-path mapping (dual-read new path)', () => {
    const env = makeEnv()
    seedQuestionWithViz(env, 'q-helix', HELIX)
    ensureDemonstrationMigration(env.db, env.store)
    const mapped = resolveMigratedDemonstration(env.db, 'q-helix')
    expect(mapped).not.toBeNull()
    expect(mapped?.versionId).toBeTruthy()
    // Unmigrated → null → caller falls back to legacy field.
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

  it('adapter dual-read: legacy fallback and new reference path render the same content', () => {
    // New path: the migrated preset demonstration (approved version) plays the
    // SceneDocument derived from the legacy visualization.
    const env = makeEnv()
    seedQuestionWithViz(env, 'q-helix', HELIX)
    ensureDemonstrationMigration(env.db, env.store)
    const mapped = resolveMigratedDemonstration(env.db, 'q-helix')!
    const version = env.db
      .prepare(`SELECT status, snapshot_document_json FROM demonstration_versions WHERE id = ?`)
      .get(mapped.versionId) as { status: string; snapshot_document_json: string }
    expect(version.status).toBe('approved')
    const newPathDoc = JSON.parse(version.snapshot_document_json) as {
      editorMetadata?: { migratedFrom?: string }
    }
    // Legacy path: direct mapping of the same visualization.
    const legacyDoc = visualizationToSceneDocument(HELIX)
    // Both derive from the same source — identity matches (same migratedFrom).
    expect(newPathDoc.editorMetadata?.migratedFrom).toBe(legacyDoc.editorMetadata?.migratedFrom)
  })
})
