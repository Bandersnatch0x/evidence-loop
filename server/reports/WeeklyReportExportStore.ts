/**
 * WeeklyReportExportStore — 周报导出台账（T19，迁移 0015）。
 *
 * 只 touch `weekly_report_exports` 一张自有表。整个文件里没有任何
 * mastery_scores / review_cards / evaluations 的读写 —— 周报路径永不回写
 * 计分数据（ADR-0001）。
 *
 * 只落**标识与元数据**：报告 id、时间窗、格式、算法版本、状态。
 * 报告正文、教师提示原文、学生姓名一律不入表（ADR-0003：不做 PII 二次落库）。
 */
import type Database from 'better-sqlite3'
import type {
  WeeklyReportExportEntry,
  WeeklyReportExportRecorder
} from './ports'

interface ExportRow {
  id: string
  report_id: string
  student_id: string
  teaching_unit_id: string
  actor_id: string
  actor_role: string
  format: string
  window_from: string
  window_to: string
  algorithm: string
  status: string
  exported_at: string
}

export interface WeeklyReportExportStoreOptions {
  database: Database.Database
}

export class WeeklyReportExportStore implements WeeklyReportExportRecorder {
  private readonly db: Database.Database

  public constructor(options: WeeklyReportExportStoreOptions) {
    this.db = options.database
  }

  /** 幂等写入：同一 id 重复导出只更新时间戳（避免刷新页面刷爆台账）。 */
  public record(entry: WeeklyReportExportEntry): void {
    this.db
      .prepare(
        `
        INSERT INTO weekly_report_exports (
          id, report_id, student_id, teaching_unit_id, actor_id, actor_role,
          format, window_from, window_to, algorithm, status, exported_at
        ) VALUES (
          @id, @report_id, @student_id, @teaching_unit_id, @actor_id, @actor_role,
          @format, @window_from, @window_to, @algorithm, @status, @exported_at
        )
        ON CONFLICT(id) DO UPDATE SET
          exported_at = excluded.exported_at,
          status = excluded.status
        `
      )
      .run({
        id: entry.id,
        report_id: entry.reportId,
        student_id: entry.studentId,
        teaching_unit_id: entry.teachingUnitId,
        actor_id: entry.actorId,
        actor_role: entry.actorRole,
        format: entry.format,
        window_from: entry.windowFrom,
        window_to: entry.windowTo,
        algorithm: entry.algorithm,
        status: entry.status,
        exported_at: entry.exportedAt
      })
  }

  public list(query: {
    studentId?: string
    teachingUnitId?: string
    limit?: number
  }): WeeklyReportExportEntry[] {
    const limit = Math.min(Math.max(query.limit ?? 50, 1), 500)
    const rows = this.db
      .prepare(
        `
        SELECT * FROM weekly_report_exports
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

function toEntry(row: ExportRow): WeeklyReportExportEntry {
  return {
    id: row.id,
    reportId: row.report_id,
    studentId: row.student_id,
    teachingUnitId: row.teaching_unit_id,
    actorId: row.actor_id,
    actorRole: row.actor_role,
    format: row.format === 'html' ? 'html' : 'json',
    windowFrom: row.window_from,
    windowTo: row.window_to,
    algorithm: row.algorithm,
    status: row.status,
    exportedAt: row.exported_at
  }
}
