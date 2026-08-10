/**
 * PortfolioExportStore — 作品集导出台账（T23，迁移 0019）。
 *
 * 只 touch `portfolio_exports` 一张自有表。整个文件里没有任何
 * mastery_scores / review_cards / evaluations / attempts 的读写 ——
 * 导出路径永不回写计分数据（ADR-0001）。
 *
 * 只落**标识与元数据**：包 id、学生、单元、操作者、条目数、算法与量规版本。
 * 包正文、题干、批注原文、evidence.actual 一律不入表
 * （ADR-0003：不做 PII 二次落库）。
 */
import type Database from 'better-sqlite3'
import type {
  PortfolioExportEntry,
  PortfolioExportRecorder
} from './ports'

interface ExportRow {
  id: string
  package_id: string
  student_id: string
  teaching_unit_id: string
  actor_id: string
  actor_role: string
  attempt_count: number
  algorithm: string
  rubric_version: string
  exported_at: string
}

export interface PortfolioExportStoreOptions {
  database: Database.Database
}

export class PortfolioExportStore implements PortfolioExportRecorder {
  private readonly db: Database.Database

  public constructor(options: PortfolioExportStoreOptions) {
    this.db = options.database
  }

  /** 每次导出 = 一条独立审计事件（id 唯一，绝不覆写历史）。 */
  public record(entry: PortfolioExportEntry): void {
    this.db
      .prepare(
        `
        INSERT INTO portfolio_exports (
          id, package_id, student_id, teaching_unit_id, actor_id, actor_role,
          attempt_count, algorithm, rubric_version, exported_at
        ) VALUES (
          @id, @package_id, @student_id, @teaching_unit_id, @actor_id, @actor_role,
          @attempt_count, @algorithm, @rubric_version, @exported_at
        )
        `
      )
      .run({
        id: entry.id,
        package_id: entry.packageId,
        student_id: entry.studentId,
        teaching_unit_id: entry.teachingUnitId,
        actor_id: entry.actorId,
        actor_role: entry.actorRole,
        attempt_count: entry.attemptCount,
        algorithm: entry.algorithm,
        rubric_version: entry.rubricVersion,
        exported_at: entry.exportedAt
      })
  }

  public list(query: {
    studentId?: string
    teachingUnitId?: string
    limit?: number
  }): PortfolioExportEntry[] {
    const limit = Math.min(Math.max(query.limit ?? 50, 1), 500)
    const rows = this.db
      .prepare(
        `
        SELECT * FROM portfolio_exports
        WHERE (@studentId IS NULL OR student_id = @studentId)
          AND (@teachingUnitId IS NULL OR teaching_unit_id = @teachingUnitId)
        ORDER BY exported_at DESC, id ASC
        LIMIT @limit
        `
      )
      .all({
        studentId: query.studentId ?? null,
        teachingUnitId: query.teachingUnitId ?? null,
        limit
      }) as ExportRow[]
    return rows.map(toEntry)
  }
}

function toEntry(row: ExportRow): PortfolioExportEntry {
  return {
    id: row.id,
    packageId: row.package_id,
    studentId: row.student_id,
    teachingUnitId: row.teaching_unit_id,
    actorId: row.actor_id,
    actorRole: row.actor_role,
    attemptCount: row.attempt_count,
    algorithm: row.algorithm,
    rubricVersion: row.rubric_version,
    exportedAt: row.exported_at
  }
}
