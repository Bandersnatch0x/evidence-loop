/**
 * ParentChildBindingStore — 家长-子女绑定（决赛加码 · 家长端）。
 *
 * 只 touch `parent_children` 一张自有表（迁移 0021）。替换此前写死在
 * weeklyReportRoutes 的 PARENT_CHILD_BINDING 常量：绑定关系落库、幂等增删、
 * 可审计。本模块不碰 attempts / evaluations / 周报 —— 家长端读取仍走既有
 * 只读端点。
 */
import type Database from 'better-sqlite3'
import { randomUUID } from 'node:crypto'

export interface ParentChildBindingReader {
  /** 家长绑定的子女 id 列表（稳定顺序：绑定时间升序）。 */
  listChildren(parentId: string): string[]
  /** 家长是否绑定了该子女。 */
  isBound(parentId: string, childStudentId: string): boolean
}

export interface ParentChildBindingStoreOptions {
  database: Database.Database
  now?: () => Date
}

interface BindingRow {
  child_student_id: string
}

export class ParentChildBindingStore implements ParentChildBindingReader {
  private readonly db: Database.Database
  private readonly now: () => Date

  public constructor(options: ParentChildBindingStoreOptions) {
    this.db = options.database
    this.now = options.now ?? (() => new Date())
  }

  /** 幂等绑定（已存在则不动，避免重复行）。 */
  public bind(parentId: string, childStudentId: string): void {
    this.db
      .prepare(
        `
        INSERT OR IGNORE INTO parent_children (parent_id, child_student_id, created_at)
        VALUES (@parent_id, @child_student_id, @created_at)
        `
      )
      .run({
        parent_id: parentId,
        child_student_id: childStudentId,
        created_at: this.now().toISOString()
      })
  }

  /** 解绑；返回是否真的删除了一行。 */
  public unbind(parentId: string, childStudentId: string): boolean {
    const result = this.db
      .prepare(
        `
        DELETE FROM parent_children
        WHERE parent_id = @parent_id AND child_student_id = @child_student_id
        `
      )
      .run({ parent_id: parentId, child_student_id: childStudentId })
    return result.changes > 0
  }

  /** 家长绑定的子女列表（绑定时间升序，稳定）。 */
  public listChildren(parentId: string): string[] {
    const rows = this.db
      .prepare(
        `
        SELECT child_student_id FROM parent_children
        WHERE parent_id = @parent_id
        ORDER BY created_at ASC, child_student_id ASC
        `
      )
      .all({ parent_id: parentId }) as BindingRow[]
    return rows.map((row) => row.child_student_id)
  }

  /** 该子女被哪些家长绑定（审计 / 其他视图用）。 */
  public listParents(childStudentId: string): string[] {
    const rows = this.db
      .prepare(
        `
        SELECT parent_id FROM parent_children
        WHERE child_student_id = @child_student_id
        ORDER BY created_at ASC
        `
      )
      .all({ child_student_id: childStudentId }) as Array<{
      parent_id: string
    }>
    return rows.map((row) => row.parent_id)
  }

  public isBound(parentId: string, childStudentId: string): boolean {
    const row = this.db
      .prepare(
        `
        SELECT 1 FROM parent_children
        WHERE parent_id = @parent_id AND child_student_id = @child_student_id
        LIMIT 1
        `
      )
      .get({ parent_id: parentId, child_student_id: childStudentId })
    return row !== undefined
  }
}

/**
 * Demo 种子：演示家长 parent-demo 绑定演示学员 learner-demo。
 * 幂等：已存在则不重复写。假多租户的诚实演示 —— 绑定是真实的数据行，
 * 但绑定的主体仍是演示身份。
 */
export function seedDemoParentBinding(
  store: ParentChildBindingStore,
  parentId = 'parent-demo',
  childStudentId = 'learner-demo'
): boolean {
  if (store.isBound(parentId, childStudentId)) return false
  store.bind(parentId, childStudentId)
  return true
}

/** 保证测试可用固定 id 构造绑定行（审计引用无需真实家长存在）。 */
export function newBindingId(): string {
  return `pb_${randomUUID()}`
}
