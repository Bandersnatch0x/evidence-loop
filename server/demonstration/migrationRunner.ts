/**
 * migrationRunner — Phase E demonstration migration (ticket T-K, spec §7.3).
 *
 * ensureDemonstrationMigration is idempotent (只补缺不覆盖):
 *   - questions whose visualization was already migrated (guard table) are
 *     skipped
 *   - questions with no visualization are never touched
 *   - teacher data is never overwritten
 *   - the demo/version created carries SEED_AUTHOR_ID ownership and is
 *     auto-approved as a preset (publication governance applies to later
 *     human submissions)
 */
import type DatabaseConstructor from 'better-sqlite3'
import type { Visualization } from '../../shared/contracts'
import { visualizationToSceneDocument } from './migration'
import { DemonstrationService, type AuditWriter } from './DemonstrationService'
import type { QuestionStore } from '../questionbank/QuestionStore'

type Db = DatabaseConstructor.Database

export const SEED_DEMO_AUTHOR_ID = 'seed'

export interface MigrationCounts {
  migrated: number
  skippedExisting: number
  skippedNoVisualization: number
}

interface GuardRow {
  question_id: string
  demo_id: string
  version_id: string
}

/**
 * Ensure every question with a legacy visualization has a corresponding
 * preset demonstration. Returns counts for CI assertion. Never throws on
 * guard-table already-present rows; skips them.
 */
export function ensureDemonstrationMigration(
  db: Db,
  questionStore: QuestionStore
): MigrationCounts {
  db.exec(`
    CREATE TABLE IF NOT EXISTS visualization_migration_map (
      question_id TEXT PRIMARY KEY,
      demo_id TEXT NOT NULL,
      version_id TEXT NOT NULL,
      migrated_at TEXT NOT NULL
    )
  `)
  const audit = (() => {}) as unknown as AuditWriter
  const demo = new DemonstrationService({ db, audit })
  // Presets bypass the human review queue: reviewer approval is for
  // teacher-submitted works. Seed presets are auto-published (spec §7.3:
  // 7 built-in scenes migrate as preset demonstrations, E2E plays them).
  const approveSql = db.prepare(`UPDATE demonstration_versions SET status = 'approved' WHERE id = ?`)

  const counts: MigrationCounts = { migrated: 0, skippedExisting: 0, skippedNoVisualization: 0 }

  const questions = questionStore.list({ limit: 2000 })
  for (const question of questions) {
    if (!question.visualization) {
      counts.skippedNoVisualization += 1
      continue
    }
    const already = db
      .prepare(`SELECT question_id, demo_id, version_id FROM visualization_migration_map WHERE question_id = ?`)
      .get(question.id) as GuardRow | undefined
    if (already) {
      counts.skippedExisting += 1
      continue
    }

    const document = visualizationToSceneDocument(question.visualization)
    const demoId = demo.createDemonstration(SEED_DEMO_AUTHOR_ID, {
      title: question.stem?.slice(0, 80) ?? `演示 ${question.id}`,
      description: `由旧可视化迁移（${question.visualization.kind}）`,
      subject: question.subject ?? '',
      grade: 'grade9',
      kpIds: question.kpIds,
      format: 'scene',
      space: question.visualization.kind === 'ball_stick' ? '3d' : '2d',
      behavior: 'interactive',
      source: 'migration'
    })
    demo.saveDraft(demoId, SEED_DEMO_AUTHOR_ID, document)
    const versionId = demo.submit(demoId, SEED_DEMO_AUTHOR_ID, {
      classification: question.subject ?? 'general',
      license: 'CC-BY-4.0',
      aiDisclosure: 'none'
    })
    approveSql.run(versionId)

    db.prepare(
      `INSERT INTO visualization_migration_map (question_id, demo_id, version_id, migrated_at)
       VALUES (?, ?, ?, ?)`
    ).run(question.id, demoId, versionId, new Date().toISOString())
    counts.migrated += 1
  }
  return counts
}

/**
 * Resolve a demonstration version for a question via the migration guard
 * (new reference path). Returns null when the question was never migrated —
 * callers fall back to the legacy visualization field (Phase E dual-read).
 */
export function resolveMigratedDemonstration(
  db: Db,
  questionId: string
): { demoId: string; versionId: string } | null {
  const row = db
    .prepare(`SELECT demo_id, version_id FROM visualization_migration_map WHERE question_id = ?`)
    .get(questionId) as { demo_id: string; version_id: string } | undefined
  if (!row) return null
  return { demoId: row.demo_id, versionId: row.version_id }
}

export type { Visualization }
