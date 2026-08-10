/**
 * MockExamPlanStore — 模拟考卷面的持久化（T16，迁移 0014）。
 *
 * 边界：只 touch `mock_exam_plans` 一张自有表。整个文件里没有任何
 * attempts / evaluations / mastery_scores 的读写 —— 组卷路径永不回写计分
 * 数据（ADR-0001）。布置结果（Paper / Attempt）由 T08 既有服务写，本表
 * 只回填 paper_id 做反查。
 */
import type Database from 'better-sqlite3'
import type {
  MockExamKpCoverage,
  MockExamPlan,
  MockExamStatus
} from '../../shared/mockExam'

interface PlanRow {
  id: string
  creator_id: string
  class_id: string
  teaching_unit_ids: string
  title: string
  duration_minutes: number
  question_ids: string
  kp_coverage: string
  status: string
  algorithm: string
  created_at: string
  paper_id: string | null
  assigned_at: string | null
}

export interface MockExamPlanStoreOptions {
  database: Database.Database
}

export class MockExamPlanStore {
  private readonly db: Database.Database

  public constructor(options: MockExamPlanStoreOptions) {
    this.db = options.database
  }

  /** Upsert 一份卷面。 */
  public save(plan: MockExamPlan): void {
    this.db
      .prepare(
        `
        INSERT INTO mock_exam_plans (
          id, creator_id, class_id, teaching_unit_ids, title, duration_minutes,
          question_ids, kp_coverage, status, algorithm, created_at, paper_id,
          assigned_at
        ) VALUES (
          @id, @creator_id, @class_id, @teaching_unit_ids, @title,
          @duration_minutes, @question_ids, @kp_coverage, @status, @algorithm,
          @created_at, @paper_id, @assigned_at
        )
        ON CONFLICT(id) DO UPDATE SET
          creator_id = excluded.creator_id,
          class_id = excluded.class_id,
          teaching_unit_ids = excluded.teaching_unit_ids,
          title = excluded.title,
          duration_minutes = excluded.duration_minutes,
          question_ids = excluded.question_ids,
          kp_coverage = excluded.kp_coverage,
          status = excluded.status,
          algorithm = excluded.algorithm,
          paper_id = excluded.paper_id,
          assigned_at = excluded.assigned_at
        `
      )
      .run({
        id: plan.id,
        creator_id: plan.creatorId,
        class_id: plan.classId,
        teaching_unit_ids: JSON.stringify(plan.teachingUnitIds),
        title: plan.title,
        duration_minutes: plan.durationMinutes,
        question_ids: JSON.stringify(plan.questionIds),
        kp_coverage: JSON.stringify(plan.kpCoverage),
        status: plan.status,
        algorithm: plan.algorithm,
        created_at: plan.createdAt,
        paper_id: plan.paperId ?? null,
        assigned_at: plan.assignedAt ?? null
      })
  }

  public get(id: string): MockExamPlan | undefined {
    const row = this.db
      .prepare(`SELECT * FROM mock_exam_plans WHERE id = ?`)
      .get(id) as PlanRow | undefined
    return row ? rowToPlan(row) : undefined
  }

  /** 学生报告端点用 paperId 反查卷面标题 / planId。 */
  public findByPaperId(paperId: string): MockExamPlan | undefined {
    const row = this.db
      .prepare(
        `SELECT * FROM mock_exam_plans WHERE paper_id = ?
         ORDER BY created_at DESC LIMIT 1`
      )
      .get(paperId) as PlanRow | undefined
    return row ? rowToPlan(row) : undefined
  }

  public listByCreator(creatorId: string, limit = 50): MockExamPlan[] {
    const rows = this.db
      .prepare(
        `SELECT * FROM mock_exam_plans WHERE creator_id = @creatorId
         ORDER BY created_at DESC LIMIT @limit`
      )
      .all({ creatorId, limit }) as PlanRow[]
    return rows.map(rowToPlan)
  }

  public listAssigned(): MockExamPlan[] {
    const rows = this.db
      .prepare(
        `SELECT * FROM mock_exam_plans
         WHERE status = 'assigned' AND paper_id IS NOT NULL
         ORDER BY assigned_at DESC, created_at DESC`
      )
      .all() as PlanRow[]
    return rows.map(rowToPlan)
  }
}

function rowToPlan(row: PlanRow): MockExamPlan {
  const plan: MockExamPlan = {
    id: row.id,
    creatorId: row.creator_id,
    classId: row.class_id,
    teachingUnitIds: parseStringArray(row.teaching_unit_ids),
    title: row.title,
    durationMinutes: row.duration_minutes,
    questionIds: parseStringArray(row.question_ids),
    kpCoverage: parseCoverage(row.kp_coverage),
    status: parseStatus(row.status),
    createdAt: row.created_at,
    algorithm: row.algorithm
  }
  if (row.paper_id !== null) plan.paperId = row.paper_id
  if (row.assigned_at !== null) plan.assignedAt = row.assigned_at
  return plan
}

function parseStatus(raw: string): MockExamStatus {
  return raw === 'assigned' || raw === 'archived' ? raw : 'draft'
}

function parseStringArray(raw: string): string[] {
  try {
    const parsed: unknown = JSON.parse(raw)
    if (!Array.isArray(parsed)) return []
    return parsed.filter((item): item is string => typeof item === 'string')
  } catch {
    return []
  }
}

function parseCoverage(raw: string): MockExamKpCoverage[] {
  try {
    const parsed: unknown = JSON.parse(raw)
    if (!Array.isArray(parsed)) return []
    return parsed.filter(isCoverageEntry)
  } catch {
    return []
  }
}

function isCoverageEntry(value: unknown): value is MockExamKpCoverage {
  if (typeof value !== 'object' || value === null) return false
  const record = value as Partial<MockExamKpCoverage>
  return (
    typeof record.kpId === 'string' &&
    typeof record.subject === 'string' &&
    typeof record.questionCount === 'number' &&
    typeof record.teachingUnitId === 'string'
  )
}
