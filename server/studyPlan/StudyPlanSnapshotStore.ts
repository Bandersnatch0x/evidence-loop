/**
 * StudyPlanSnapshotStore — 最近一次 7 日计划的快照缓存（T18，迁移 0013）。
 *
 * 纯缓存语义：计划可由 `algorithm` + 硬事实完整重放，这张表丢了也不影响
 * 正确性。存在的唯一理由是让 UI 秒开，不必等一次全量重算。
 *
 * 边界：只 touch `study_plan_snapshots` 一张自有表。整个文件里没有任何
 * mastery_scores / review_cards / evaluations 的读写 —— 计划路径永不回写
 * 计分数据（ADR-0001）。
 */
import type Database from 'better-sqlite3'
import type { StudyPlan } from '../../shared/studyPlan'

interface SnapshotRow {
  student_id: string
  teaching_unit_id: string
  algorithm: string
  generated_at: string
  payload: string
}

export interface StudyPlanSnapshotStoreOptions {
  database: Database.Database
}

export class StudyPlanSnapshotStore {
  private readonly db: Database.Database

  public constructor(options: StudyPlanSnapshotStoreOptions) {
    this.db = options.database
  }

  /** Upsert 该学生 × 教学单元的最新计划。 */
  public save(plan: StudyPlan): void {
    this.db
      .prepare(
        `
        INSERT INTO study_plan_snapshots (
          student_id, teaching_unit_id, algorithm, generated_at, payload
        ) VALUES (
          @student_id, @teaching_unit_id, @algorithm, @generated_at, @payload
        )
        ON CONFLICT(student_id, teaching_unit_id) DO UPDATE SET
          algorithm = excluded.algorithm,
          generated_at = excluded.generated_at,
          payload = excluded.payload
        `
      )
      .run({
        student_id: plan.studentId,
        teaching_unit_id: plan.teachingUnitId,
        algorithm: plan.algorithm,
        generated_at: plan.generatedAt,
        payload: JSON.stringify(plan)
      })
  }

  /** 读回最近一次快照；解析失败视为无快照（下游会重算）。 */
  public load(studentId: string, teachingUnitId: string): StudyPlan | undefined {
    const row = this.db
      .prepare(
        `
        SELECT * FROM study_plan_snapshots
        WHERE student_id = @studentId AND teaching_unit_id = @teachingUnitId
        `
      )
      .get({ studentId, teachingUnitId }) as SnapshotRow | undefined
    if (!row) return undefined
    try {
      return JSON.parse(row.payload) as StudyPlan
    } catch {
      return undefined
    }
  }
}
