/**
 * AchievementStore — 徽章持久化（T20，迁移 0016）。
 *
 * 实现 `AchievementAwardWriter` 端口。整个文件只 touch `student_achievements`
 * 一张自有表：没有一条 SQL 提到 mastery_scores / review_cards / evaluations /
 * attempts，所以「授予徽章」这条路径在物理上不可能写计分数据（ADR-0001）。
 * tests/achievements.test.ts 用正则扫描本文件源码守护这一点。
 *
 * 语义要点：
 *   * `save` 是**首次授予即定格**（ON CONFLICT DO NOTHING）。重复 sync 不会
 *     改写 earnedAt，也不会重复刷 toast；
 *   * 无证据的徽章直接抛 `UnbackedAchievementError`，不静默写库 ——
 *     「没有证据就没有徽章」在这里响亮地失败；
 *   * 表本身是可重放缓存：丢了重算即可（判定确定性 + earnedAt 取自 Attempt）。
 */
import type Database from 'better-sqlite3'
import {
  ACHIEVEMENT_CATALOG,
  type AchievementEvidenceRef,
  type AchievementId,
  type AchievementPresentationHint,
  type StudentAchievement
} from '../../shared/achievements'
import { UnbackedAchievementError, type AchievementAwardWriter } from './ports'

interface AchievementRow {
  student_id: string
  achievement_id: string
  earned_at: string
  algorithm: string
  evidence_refs: string
  presentation_hint: string | null
}

export interface AchievementStoreOptions {
  database: Database.Database
}

/** 目录白名单：数据库里的脏 id 不会被读成徽章。 */
const KNOWN_IDS = new Set<string>(ACHIEVEMENT_CATALOG.map((entry) => entry.id))

export class AchievementStore implements AchievementAwardWriter {
  private readonly db: Database.Database

  public constructor(options: AchievementStoreOptions) {
    this.db = options.database
  }

  /**
   * 授予一枚徽章。已存在则**原样保留**（不覆盖 earnedAt / evidenceRefs），
   * 因此重算幂等。
   */
  public save(achievement: StudentAchievement): void {
    if (achievement.evidenceRefs.length === 0) {
      throw new UnbackedAchievementError(achievement.achievementId)
    }
    this.db
      .prepare(
        `
        INSERT INTO student_achievements (
          student_id, achievement_id, earned_at, algorithm,
          evidence_refs, presentation_hint
        ) VALUES (
          @student_id, @achievement_id, @earned_at, @algorithm,
          @evidence_refs, @presentation_hint
        )
        ON CONFLICT(student_id, achievement_id) DO NOTHING
        `
      )
      .run({
        student_id: achievement.studentId,
        achievement_id: achievement.achievementId,
        earned_at: achievement.earnedAt,
        algorithm: achievement.algorithm,
        evidence_refs: JSON.stringify(achievement.evidenceRefs),
        presentation_hint: achievement.presentationHint
          ? JSON.stringify(achievement.presentationHint)
          : null
      })
  }

  /** 读回学生已授予的徽章（按获得时间升序，与判定输出同序）。 */
  public list(studentId: string): StudentAchievement[] {
    const rows = this.db
      .prepare(
        `
        SELECT * FROM student_achievements
        WHERE student_id = @studentId
        ORDER BY earned_at ASC, achievement_id ASC
        `
      )
      .all({ studentId }) as AchievementRow[]
    return rows
      .map((row) => toAchievement(row))
      .filter((item): item is StudentAchievement => item !== undefined)
  }

  /**
   * 班级聚合计数。**只返回每枚徽章有多少人拿到**，不返回是谁、不排名 ——
   * SQL 里根本没有 student_id 出现在 SELECT 列表中（PRD 反社交 PK 边界）。
   */
  public countByStudents(
    studentIds: readonly string[]
  ): Array<{ achievementId: AchievementId; earnedCount: number }> {
    if (studentIds.length === 0) return []
    const placeholders = studentIds.map(() => '?').join(', ')
    const rows = this.db
      .prepare(
        `
        SELECT achievement_id, COUNT(*) AS earned_count
        FROM student_achievements
        WHERE student_id IN (${placeholders})
        GROUP BY achievement_id
        ORDER BY achievement_id ASC
        `
      )
      .all(...studentIds) as Array<{
      achievement_id: string
      earned_count: number
    }>
    return rows
      .filter((row) => KNOWN_IDS.has(row.achievement_id))
      .map((row) => ({
        achievementId: row.achievement_id as AchievementId,
        earnedCount: row.earned_count
      }))
  }
}

/**
 * 行 → 领域对象。任何一步不合法（未知 id / 证据链解析失败 / 空证据）都返回
 * undefined 并被上游过滤掉 —— 宁可少显示一枚徽章，也不显示一枚证据断链的。
 */
function toAchievement(row: AchievementRow): StudentAchievement | undefined {
  if (!KNOWN_IDS.has(row.achievement_id)) return undefined
  const evidenceRefs = parseJson<AchievementEvidenceRef[]>(row.evidence_refs)
  if (!Array.isArray(evidenceRefs) || evidenceRefs.length === 0) return undefined

  const hint = row.presentation_hint
    ? parseJson<AchievementPresentationHint>(row.presentation_hint)
    : undefined
  // 建议层校验放在读侧：provenance 不是 llm_inference 的一律当作没有文案。
  const usableHint =
    hint && hint.provenance.kind === 'llm_inference' ? hint : undefined

  return {
    studentId: row.student_id,
    achievementId: row.achievement_id as AchievementId,
    earnedAt: row.earned_at,
    evidenceRefs,
    algorithm: row.algorithm,
    ...(usableHint ? { presentationHint: usableHint } : {})
  }
}

function parseJson<T>(raw: string): T | undefined {
  try {
    return JSON.parse(raw) as T
  } catch {
    return undefined
  }
}
