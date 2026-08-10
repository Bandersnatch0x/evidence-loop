// @vitest-environment node

/**
 * T18 硬事实学习计划 —— 契约测试。
 *
 * 守护的四条铁律（ADR-0001 / ADR-0006 / CONTEXT「candidateTasks 硬输入」）：
 *
 *   1. 不编造：没有硬输入就产出空计划 + `insufficient_evidence`，
 *      绝不用 LLM 填「本周先复习一下基础」这类假内容。
 *   2. 可追溯：每一个 task 都挂着非空 evidenceRefs，能回到 ReviewCard /
 *      MasterySnapshot（进而回到确定性 Runner 产出的 Evidence）。
 *   3. provenance 正确：LLM 只能写 presentationHint，且必须是 llm_inference；
 *      它一个字节都不能改 days/tasks。
 *   4. 不写分：整条生成路径（纯函数 + Service + HTTP）绝不写
 *      mastery_scores / review_cards / evaluations。
 */
import { createServer } from 'node:http'
import { readFileSync, readdirSync, statSync } from 'node:fs'
import type { AddressInfo } from 'node:net'
import { join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { InMemoryOrgReader } from '../server/adaptive'
import type { SessionUser } from '../server/auth/SessionProvider'
import { MASTERY_THRESHOLD } from '../server/config/mastery'
import { openMemoryDatabase } from '../server/db/memorySchema'
import { QuestionBankService } from '../server/questionbank/QuestionBankService'
import { QuestionStore } from '../server/questionbank/QuestionStore'
import type { QuestionDraft } from '../server/questionbank/questionValidation'
import { ReviewScheduler } from '../server/review/ReviewScheduler'
import {
  StudyPlanService,
  StudyPlanSnapshotStore,
  TeachingUnitMissingError,
  attachPresentationHint,
  buildStudyPlan,
  handleStudyPlanApi,
  type StudyPlanAssignPort
} from '../server/studyPlan'
import type {
  InterventionSuggestion,
  MasteryProfileMap,
  MasterySnapshot,
  Provenance,
  ReviewCard,
  TeachingUnit
} from '../shared/contracts'
import {
  STUDY_PLAN_ALGORITHM,
  STUDY_PLAN_HORIZON_DAYS,
  findUnbackedTasks,
  isAdvisoryHint,
  listStudyPlanTasks,
  listTodayTasks,
  type StudyPlan,
  type StudyPlanHardFacts
} from '../shared/studyPlan'

const SECRET = 't18-study-plan-hmac'
const TEACHER = 'teacher-t18'
const STUDENT = 'student-t18'
const NOW_ISO = '2026-07-24T08:00:00.000Z'
const FIXED_NOW = () => new Date(NOW_ISO)

// ---------------------------------------------------------------------------
// 夹具
// ---------------------------------------------------------------------------

function snapshot(
  score: number,
  overrides: Partial<MasterySnapshot> = {}
): MasterySnapshot {
  return {
    score,
    evidenceIds: ['ev-runner-1'],
    computedAt: '2026-07-24T00:00:00.000Z',
    algorithmVersion: 'simple.v1',
    ...overrides
  }
}

function profileOf(scores: Record<string, number>): MasteryProfileMap {
  const profile: MasteryProfileMap = {}
  for (const [kpId, score] of Object.entries(scores)) {
    profile[kpId] = snapshot(score)
  }
  return profile
}

function sampleUnit(overrides: Partial<TeachingUnit> = {}): TeachingUnit {
  return {
    id: 'tu-t18',
    teacherId: TEACHER,
    classId: 'class-t18',
    subjectId: 'subject-math',
    termId: 'term-2026-fall',
    taughtKpIds: ['kp-A', 'kp-B', 'kp-C'],
    ...overrides
  }
}

/** 空硬事实：所有三路输入都为空。 */
function emptyFacts(
  overrides: Partial<StudyPlanHardFacts> = {}
): StudyPlanHardFacts {
  return {
    studentId: STUDENT,
    teachingUnitId: 'tu-t18',
    termId: 'term-2026-fall',
    taughtKpIds: ['kp-A', 'kp-B', 'kp-C'],
    dueCards: [],
    masteryProfile: {},
    dependencyGaps: [],
    questionsByKp: {},
    now: NOW_ISO,
    ...overrides
  }
}

function dueCard(kpId: string, dueAt: string, id = `card-${kpId}`): ReviewCard {
  return {
    id,
    studentId: STUDENT,
    kpId,
    scheduling: {
      dueAt,
      stability: 1,
      difficulty: 5,
      state: 'review',
      reps: 1,
      lapses: 0,
      lastReviewAt: '2026-07-20T00:00:00.000Z'
    }
  }
}

const LLM_PROVENANCE: Provenance = {
  kind: 'llm_inference',
  sourceMessages: ['msg-1'],
  model: 'local-advisor',
  extractedAt: NOW_ISO
}

function choiceDraft(kpId: string, suffix: string): QuestionDraft {
  return {
    questionBankId: 'bank-t18',
    authorId: TEACHER,
    subject: 'math',
    questionType: 'choice',
    stem: `计划题 ${kpId} ${suffix}`,
    payload: { kind: 'choice', correctOptionIds: ['A'] },
    kpIds: [kpId],
    difficulty: 2
  }
}

// ---------------------------------------------------------------------------
// 1. 纯函数内核：不编造 / 可追溯 / 确定性 / D4
// ---------------------------------------------------------------------------

describe('buildStudyPlan：硬输入 → 计划（纯函数）', () => {
  it('无任何硬输入时产出空计划 + insufficient_evidence，绝不编造内容', () => {
    const plan = buildStudyPlan(emptyFacts())

    expect(plan.status).toBe('insufficient_evidence')
    expect(plan.days).toHaveLength(STUDY_PLAN_HORIZON_DAYS)
    expect(listStudyPlanTasks(plan)).toEqual([])
    expect(listTodayTasks(plan)).toEqual([])
    expect(plan.evidenceRefs).toEqual([])
    // 空计划仍然是结构完整的 7 天骨架（诚实地空着），不是 null / 报错。
    expect(plan.days.map((day) => day.dayIndex)).toEqual([0, 1, 2, 3, 4, 5, 6])
    expect(plan.days[0]?.date).toBe('2026-07-24')
    expect(plan.days[6]?.date).toBe('2026-07-30')
    // 没有 LLM 兜底文案。
    expect(plan.presentationHint).toBeUndefined()
    expect(plan.algorithm).toBe(STUDY_PLAN_ALGORITHM)
  })

  it('taughtKpIds 为空（还没上课）时同样是空计划，而不是全库刷题', () => {
    const plan = buildStudyPlan(
      emptyFacts({
        taughtKpIds: [],
        dueCards: [dueCard('kp-A', '2026-07-20T00:00:00.000Z')],
        masteryProfile: profileOf({ 'kp-A': 0.1 })
      })
    )
    expect(plan.status).toBe('insufficient_evidence')
    expect(listStudyPlanTasks(plan)).toEqual([])
  })

  it('MasteryProfile 里缺失的 KP 视为「没有证据」，绝不当成 score 0 的薄弱点', () => {
    // 与 T06 NextPracticeService 的关键差异：那边缺快照退化为 0 分薄弱，
    // T18 不做这个推断 —— 没证据就没任务。
    const plan = buildStudyPlan(
      emptyFacts({ taughtKpIds: ['kp-A', 'kp-B', 'kp-C'] })
    )
    expect(listStudyPlanTasks(plan)).toEqual([])
    expect(plan.status).toBe('insufficient_evidence')
  })

  it('每条计划项都能追溯到 evidence 引用（非空不变量）', () => {
    const plan = buildStudyPlan(
      emptyFacts({
        dueCards: [dueCard('kp-A', '2026-07-20T00:00:00.000Z', 'card-A')],
        masteryProfile: profileOf({ 'kp-B': 0.2, 'kp-C': 0.95 }),
        dependencyGaps: [{ weakKp: 'kp-B', targetKp: 'kp-C', chain: ['kp-C', 'kp-B'] }],
        questionsByKp: { 'kp-A': ['q-a1', 'q-a2', 'q-a3'], 'kp-B': ['q-b1'] }
      })
    )

    expect(plan.status).toBe('ok')
    const tasks = listStudyPlanTasks(plan)
    expect(tasks.length).toBeGreaterThan(0)
    // 不变量：没有任何一条无锚点的任务。
    expect(findUnbackedTasks(plan)).toEqual([])
    for (const task of tasks) {
      expect(task.evidenceRefs.length).toBeGreaterThan(0)
      for (const ref of task.evidenceRefs) {
        expect(['review_card', 'mastery_snapshot']).toContain(ref.kind)
        expect(ref.kpId).toBeTruthy()
        if (ref.kind === 'mastery_snapshot') {
          // 直指底层 Evidence 原子 + 算法版本，审计可回放。
          expect(Array.isArray(ref.evidenceIds)).toBe(true)
          expect(ref.algorithmVersion).toBe('simple.v1')
        } else {
          expect(ref.cardId).toBeTruthy()
          expect(ref.dueAt).toBeTruthy()
        }
      }
    }
    // 计划级并集 = 所有任务锚点之和，审计入口不漏。
    expect(plan.evidenceRefs.length).toBe(
      tasks.reduce((total, task) => total + task.evidenceRefs.length, 0)
    )
  })

  it('FSRS 到期任务的锚点指向真实 ReviewCard；掌握度任务锚点指向真实快照', () => {
    const plan = buildStudyPlan(
      emptyFacts({
        dueCards: [dueCard('kp-A', '2026-07-21T00:00:00.000Z', 'card-A')],
        masteryProfile: profileOf({ 'kp-B': 0.3 })
      })
    )
    const tasks = listStudyPlanTasks(plan)
    const fsrsTask = tasks.find((task) => task.reason === 'fsrs')
    const masteryTask = tasks.find((task) => task.reason === 'mastery')

    expect(fsrsTask?.kpId).toBe('kp-A')
    expect(fsrsTask?.evidenceRefs[0]).toEqual({
      kind: 'review_card',
      cardId: 'card-A',
      kpId: 'kp-A',
      dueAt: '2026-07-21T00:00:00.000Z'
    })
    expect(masteryTask?.kpId).toBe('kp-B')
    expect(masteryTask?.evidenceRefs[0]).toMatchObject({
      kind: 'mastery_snapshot',
      kpId: 'kp-B',
      score: 0.3
    })
  })

  it('未教 KP（D4）永不进计划，哪怕到期且掌握度极低', () => {
    const plan = buildStudyPlan(
      emptyFacts({
        taughtKpIds: ['kp-A'],
        dueCards: [
          dueCard('kp-A', '2026-07-20T00:00:00.000Z', 'card-A'),
          dueCard('kp-UNTAUGHT', '2026-07-19T00:00:00.000Z', 'card-U')
        ],
        masteryProfile: profileOf({ 'kp-A': 0.4, 'kp-UNTAUGHT': 0 }),
        dependencyGaps: [
          { weakKp: 'kp-A', targetKp: 'kp-UNTAUGHT', chain: ['kp-A', 'kp-UNTAUGHT'] }
        ]
      })
    )
    const kpIds = listStudyPlanTasks(plan).map((task) => task.kpId)
    expect(kpIds).toEqual(['kp-A'])
    expect(kpIds).not.toContain('kp-UNTAUGHT')
    expect(plan.taughtKpIds).toEqual(['kp-A'])
  })

  it('依赖链缺口的触发点必须有真实快照且低于阈值，否则该缺口不成立', () => {
    // weakKp 没有快照 ⇒ 诊断无硬事实基础 ⇒ 不产出 task。
    const noSnapshot = buildStudyPlan(
      emptyFacts({
        dependencyGaps: [{ weakKp: 'kp-C', targetKp: 'kp-A', chain: ['kp-C', 'kp-A'] }]
      })
    )
    expect(listStudyPlanTasks(noSnapshot)).toEqual([])

    // weakKp 已达标 ⇒ 同样不成立。
    const mastered = buildStudyPlan(
      emptyFacts({
        masteryProfile: profileOf({ 'kp-C': MASTERY_THRESHOLD + 0.1 }),
        dependencyGaps: [{ weakKp: 'kp-C', targetKp: 'kp-A', chain: ['kp-C', 'kp-A'] }]
      })
    )
    expect(listStudyPlanTasks(mastered)).toEqual([])

    // 触发点有快照且低于阈值 ⇒ 成立，锚点挂在触发点的快照上。
    const gap = buildStudyPlan(
      emptyFacts({
        masteryProfile: profileOf({ 'kp-C': 0.2 }),
        dependencyGaps: [{ weakKp: 'kp-C', targetKp: 'kp-A', chain: ['kp-C', 'kp-A'] }]
      })
    )
    const weakTask = listStudyPlanTasks(gap).find((task) => task.reason === 'weak')
    expect(weakTask?.kpId).toBe('kp-A')
    expect(weakTask?.evidenceRefs[0]).toMatchObject({
      kind: 'mastery_snapshot',
      kpId: 'kp-C'
    })
  })

  it('达标 KP 不进计划（阈值边界）', () => {
    const plan = buildStudyPlan(
      emptyFacts({
        masteryProfile: profileOf({
          'kp-A': MASTERY_THRESHOLD,
          'kp-B': MASTERY_THRESHOLD - 0.0001
        })
      })
    )
    expect(listStudyPlanTasks(plan).map((task) => task.kpId)).toEqual(['kp-B'])
  })

  it('确定性可重放：同一硬事实两次构建逐字节相同', () => {
    const facts = emptyFacts({
      dueCards: [
        dueCard('kp-B', '2026-07-22T00:00:00.000Z', 'card-B'),
        dueCard('kp-A', '2026-07-21T00:00:00.000Z', 'card-A')
      ],
      masteryProfile: profileOf({ 'kp-A': 0.4, 'kp-C': 0.1 }),
      questionsByKp: { 'kp-A': ['q1', 'q2'], 'kp-B': ['q3'], 'kp-C': ['q4'] }
    })

    const first = buildStudyPlan(facts)
    const second = buildStudyPlan(facts)
    expect(JSON.stringify(second)).toBe(JSON.stringify(first))
    // 计划 id 也确定（同学生 × 同单元 × 同自然日 ⇒ 同 id，重算幂等）。
    expect(first.id).toBe(`plan_${STUDENT}_tu-t18_2026-07-24`)
    // 到期早的排今天（轮转分配下 index 0 落 dayIndex 0）。
    expect(first.days[0]?.tasks[0]?.kpId).toBe('kp-A')
  })

  it('mode 恒为 practice，reason 只在 fsrs|weak|mastery 中；题量不超过题库供给', () => {
    const plan = buildStudyPlan(
      emptyFacts({
        dueCards: [dueCard('kp-A', '2026-07-20T00:00:00.000Z')],
        masteryProfile: profileOf({ 'kp-B': 0.1 }),
        questionsByKp: { 'kp-A': ['q1'], 'kp-B': [] }
      })
    )
    for (const task of listStudyPlanTasks(plan)) {
      // D1：计划永不自动升级为正式测评。
      expect(task.mode).toBe('practice')
      expect(['fsrs', 'weak', 'mastery']).toContain(task.reason)
      expect(task.targetCount).toBeGreaterThan(0)
      expect(task.questionIds.length).toBeLessThanOrEqual(task.targetCount)
    }
    // 题库暂无该 KP 的题 ⇒ 诚实地给空列表，不编题。
    const kpB = listStudyPlanTasks(plan).find((task) => task.kpId === 'kp-B')
    expect(kpB?.questionIds).toEqual([])
  })

  it('候选项铺满 7 天窗口，超出上限的候选被截断而非塞爆某一天', () => {
    const profile: Record<string, number> = {}
    const taughtKpIds: string[] = []
    for (let index = 0; index < 30; index += 1) {
      const kpId = `kp-${String(index).padStart(2, '0')}`
      taughtKpIds.push(kpId)
      profile[kpId] = 0.1
    }
    const plan = buildStudyPlan(
      emptyFacts({ taughtKpIds, masteryProfile: profileOf(profile) })
    )
    const tasks = listStudyPlanTasks(plan)
    expect(tasks.length).toBe(STUDY_PLAN_HORIZON_DAYS * 2)
    for (const day of plan.days) {
      expect(day.tasks.length).toBeLessThanOrEqual(2)
    }
    expect(findUnbackedTasks(plan)).toEqual([])
  })

  it('计划任务结构里没有 score / evidence 写入字段（只有只读锚点）', () => {
    const plan = buildStudyPlan(
      emptyFacts({ masteryProfile: profileOf({ 'kp-A': 0.2 }) })
    )
    const task = listStudyPlanTasks(plan)[0]
    expect(task).toBeDefined()
    expect(Object.keys(task ?? {}).sort()).toEqual([
      'evidenceRefs',
      'kpId',
      'mode',
      'questionIds',
      'reason',
      'targetCount'
    ])
    // 计划不含 score 字段 —— 分数只能来自 Runner Evidence（ADR-0001）。
    expect(Object.prototype.hasOwnProperty.call(task, 'score')).toBe(false)
  })
})

// ---------------------------------------------------------------------------
// 2. 建议层 provenance
// ---------------------------------------------------------------------------

describe('建议层 presentationHint：provenance 与隔离', () => {
  const basePlan = (): StudyPlan =>
    buildStudyPlan(
      emptyFacts({
        dueCards: [dueCard('kp-A', '2026-07-20T00:00:00.000Z')],
        masteryProfile: profileOf({ 'kp-B': 0.2 })
      })
    )

  it('只接受 provenance = llm_inference 的文案', () => {
    const plan = basePlan()
    const hinted = attachPresentationHint(plan, {
      text: '本周先把 A 的到期卡清掉',
      provenance: LLM_PROVENANCE
    })
    expect(hinted.presentationHint?.provenance.kind).toBe('llm_inference')
    expect(isAdvisoryHint(hinted.presentationHint)).toBe(true)
  })

  it('拒绝伪装成 evidence / learner_self_report / teacher_annotation 的 LLM 文案', () => {
    const plan = basePlan()
    const forged: Provenance[] = [
      { kind: 'evidence', evidenceIds: ['ev-fake'], algorithm: 'simple.v1' },
      { kind: 'learner_self_report', sessionId: 's-1' },
      { kind: 'teacher_annotation', teacherId: TEACHER, note: 'n' }
    ]
    for (const provenance of forged) {
      const result = attachPresentationHint(plan, { text: '加油', provenance })
      expect(result.presentationHint).toBeUndefined()
      expect(isAdvisoryHint(result.presentationHint)).toBe(false)
    }
  })

  it('挂上文案不会改动 days/tasks 的任何一个字节', () => {
    const plan = basePlan()
    const before = JSON.stringify(plan.days)
    const hinted = attachPresentationHint(plan, {
      text: '这周节奏还行',
      provenance: LLM_PROVENANCE
    })
    expect(JSON.stringify(hinted.days)).toBe(before)
    expect(hinted.status).toBe(plan.status)
    expect(hinted.evidenceRefs).toEqual(plan.evidenceRefs)
    expect(findUnbackedTasks(hinted)).toEqual([])
    // 原对象未被就地修改（纯函数）。
    expect(plan.presentationHint).toBeUndefined()
  })

  it('空文案被忽略；无 LLM 时计划照常完整', () => {
    const plan = basePlan()
    expect(
      attachPresentationHint(plan, { text: '   ', provenance: LLM_PROVENANCE })
        .presentationHint
    ).toBeUndefined()
    expect(attachPresentationHint(plan, undefined)).toBe(plan)
    expect(listStudyPlanTasks(plan).length).toBeGreaterThan(0)
  })

  it('证据不足的计划不会被 LLM 文案「填满」——tasks 仍然为空', () => {
    const empty = buildStudyPlan(emptyFacts())
    const hinted = attachPresentationHint(empty, {
      text: '建议先复习一下基础知识',
      provenance: LLM_PROVENANCE
    })
    expect(hinted.status).toBe('insufficient_evidence')
    expect(listStudyPlanTasks(hinted)).toEqual([])
  })
})

// ---------------------------------------------------------------------------
// 3. StudyPlanService：只读端口编排 + 不写计分表
// ---------------------------------------------------------------------------

/** 三张计分表的完整内容指纹，用于「生成计划不写分」断言。 */
function scoringFingerprint(db: ReturnType<typeof openMemoryDatabase>): string {
  const tables = ['mastery_scores', 'review_cards', 'evaluations']
  return JSON.stringify(
    tables.map((table) => [table, db.prepare(`SELECT * FROM ${table}`).all()])
  )
}

describe('StudyPlanService：只读收集硬事实', () => {
  let db: ReturnType<typeof openMemoryDatabase>
  let review: ReviewScheduler
  let questions: QuestionStore
  let org: InMemoryOrgReader

  beforeEach(() => {
    db = openMemoryDatabase(':memory:')
    review = new ReviewScheduler({ db, hmacSecret: SECRET })
    questions = new QuestionStore({ database: db })
    const bank = new QuestionBankService({ store: questions, now: FIXED_NOW })
    org = new InMemoryOrgReader()
    org.saveTeachingUnit(sampleUnit())
    for (const kpId of ['kp-A', 'kp-B', 'kp-C', 'kp-UNTAUGHT']) {
      bank.create(choiceDraft(kpId, 'one'))
      bank.create(choiceDraft(kpId, 'two'))
    }
  })

  afterEach(() => {
    questions.close()
    db.close()
  })

  function makeService(
    profile: MasteryProfileMap,
    extras: { interventions?: boolean; snapshots?: StudyPlanSnapshotStore } = {}
  ): StudyPlanService {
    return new StudyPlanService({
      review,
      mastery: { getProfile: () => profile },
      org,
      questions,
      ...(extras.interventions
        ? {
            interventions: {
              suggestNextIntervention: (
                studentId: string,
                weakKp: string
              ): Promise<InterventionSuggestion> =>
                Promise.resolve({
                  studentId,
                  weakKp,
                  // 依赖链：C ← B ← A，薄弱点回溯到 A。
                  targetKp: weakKp === 'kp-C' ? 'kp-A' : weakKp,
                  chain: ['kp-C', 'kp-B', 'kp-A']
                })
            }
          }
        : {}),
      ...(extras.snapshots ? { snapshots: extras.snapshots } : {}),
      now: FIXED_NOW
    })
  }

  it('生成计划的全过程不写 mastery_scores / review_cards / evaluations', async () => {
    review.applyReview(STUDENT, 'kp-B', 1, new Date('2026-07-01T00:00:00.000Z'))
    review.applyReview(STUDENT, 'kp-C', 1, new Date('2026-07-02T00:00:00.000Z'))
    const service = makeService(profileOf({ 'kp-A': 0.2, 'kp-B': 0.9, 'kp-C': 0.9 }), {
      interventions: true
    })

    const before = scoringFingerprint(db)
    const plan = await service.generate(STUDENT, 'tu-t18')
    const after = scoringFingerprint(db)

    expect(after).toBe(before)
    expect(listStudyPlanTasks(plan).length).toBeGreaterThan(0)
    expect(findUnbackedTasks(plan)).toEqual([])
    // 重复生成同样不写分（幂等只读）。
    await service.generate(STUDENT, 'tu-t18')
    expect(scoringFingerprint(db)).toBe(before)
  })

  it('真实 FSRS 到期卡进计划，并按 D4 已教进度过滤', async () => {
    review.applyReview(STUDENT, 'kp-B', 1, new Date('2026-07-01T00:00:00.000Z'))
    review.applyReview(
      STUDENT,
      'kp-UNTAUGHT',
      1,
      new Date('2026-06-30T00:00:00.000Z')
    )
    const service = makeService(profileOf({ 'kp-A': 0.9, 'kp-B': 0.9, 'kp-C': 0.9 }))

    const plan = await service.generate(STUDENT, 'tu-t18')
    const kpIds = listStudyPlanTasks(plan).map((task) => task.kpId)
    expect(kpIds).toContain('kp-B')
    expect(kpIds).not.toContain('kp-UNTAUGHT')
    expect(plan.termId).toBe('term-2026-fall')
    // 题目来自教师私有题库（T03），不是凭空生成的题干。
    const kpB = listStudyPlanTasks(plan).find((task) => task.kpId === 'kp-B')
    expect(kpB?.questionIds.length).toBeGreaterThan(0)
  })

  it('完全没有硬输入的新学生拿到证据不足的空计划', async () => {
    const service = makeService({})
    const plan = await service.generate(STUDENT, 'tu-t18')
    expect(plan.status).toBe('insufficient_evidence')
    expect(listStudyPlanTasks(plan)).toEqual([])
    expect(plan.days).toHaveLength(STUDY_PLAN_HORIZON_DAYS)
  })

  it('collectHardFacts 返回可完整重放的快照，纯函数复算得到同一计划', async () => {
    review.applyReview(STUDENT, 'kp-B', 1, new Date('2026-07-01T00:00:00.000Z'))
    const service = makeService(profileOf({ 'kp-A': 0.3, 'kp-B': 0.9, 'kp-C': 0.9 }))

    const facts = await service.collectHardFacts(STUDENT, 'tu-t18')
    const plan = await service.generate(STUDENT, 'tu-t18')
    expect(JSON.stringify(buildStudyPlan(facts))).toBe(JSON.stringify(plan))
  })

  it('教学单元不存在时抛 TeachingUnitMissingError', async () => {
    const service = makeService({})
    await expect(service.generate(STUDENT, 'missing-unit')).rejects.toBeInstanceOf(
      TeachingUnitMissingError
    )
  })

  it('快照存储只写自有表 study_plan_snapshots，且能原样读回', async () => {
    const snapshots = new StudyPlanSnapshotStore({ database: db })
    review.applyReview(STUDENT, 'kp-B', 1, new Date('2026-07-01T00:00:00.000Z'))
    const service = makeService(profileOf({ 'kp-B': 0.9 }), { snapshots })

    const before = scoringFingerprint(db)
    const plan = await service.generate(STUDENT, 'tu-t18')
    expect(scoringFingerprint(db)).toBe(before)

    const loaded = snapshots.load(STUDENT, 'tu-t18')
    expect(loaded?.id).toBe(plan.id)
    expect(JSON.stringify(loaded)).toBe(JSON.stringify(plan))
    // Upsert：同一 (student, unit) 只留一行。
    await service.generate(STUDENT, 'tu-t18')
    const rows = db.prepare('SELECT * FROM study_plan_snapshots').all()
    expect(rows).toHaveLength(1)
  })
})

// ---------------------------------------------------------------------------
// 4. HTTP 面
// ---------------------------------------------------------------------------

describe('study plan HTTP 路由', () => {
  let db: ReturnType<typeof openMemoryDatabase>
  let questions: QuestionStore
  let baseUrl: string
  let closeServer: () => Promise<void>
  let assignCalls: Array<Record<string, unknown>>
  let profile: MasteryProfileMap

  beforeEach(async () => {
    db = openMemoryDatabase(':memory:')
    const review = new ReviewScheduler({ db, hmacSecret: SECRET })
    questions = new QuestionStore({ database: db })
    const bank = new QuestionBankService({ store: questions, now: FIXED_NOW })
    const org = new InMemoryOrgReader()
    const unit = sampleUnit()
    org.saveTeachingUnit(unit)
    org.saveEnrollment({
      id: 'enr-t18',
      studentId: STUDENT,
      classId: unit.classId,
      termId: unit.termId
    })
    bank.create(choiceDraft('kp-A', 'route'))
    bank.create(choiceDraft('kp-B', 'route'))
    review.applyReview(STUDENT, 'kp-B', 1, new Date('2026-07-01T00:00:00.000Z'))

    profile = profileOf({ 'kp-A': 0.2, 'kp-B': 0.9, 'kp-C': 0.9 })
    const studyPlan = new StudyPlanService({
      review,
      mastery: { getProfile: () => profile },
      org,
      questions,
      now: FIXED_NOW
    })

    assignCalls = []
    const assign: StudyPlanAssignPort = {
      assign: (input) => {
        assignCalls.push({ ...input })
        return Promise.resolve({ attemptIds: ['att-1'], mode: input.mode })
      }
    }

    const teacher: SessionUser = {
      userId: TEACHER,
      role: 'teacher',
      displayName: 'Teacher T18'
    }
    const student: SessionUser = {
      userId: STUDENT,
      role: 'student',
      displayName: 'Student T18',
      studentId: STUDENT
    }
    const stranger: SessionUser = {
      userId: 'stranger',
      role: 'student',
      displayName: 'Stranger',
      studentId: 'other-student'
    }

    const server = createServer((request, response) => {
      void (async () => {
        const url = new URL(
          request.url ?? '/',
          `http://${request.headers.host ?? 'localhost'}`
        )
        const role = request.headers['x-demo-role']
        const user =
          role === 'student' ? student : role === 'stranger' ? stranger : teacher
        const handled = await handleStudyPlanApi(request, response, url, {
          db,
          studyPlan,
          user,
          org,
          assign
        })
        if (!handled) {
          response.writeHead(404)
          response.end('not study plan')
        }
      })()
    })

    await new Promise<void>((resolve) => {
      server.listen(0, '127.0.0.1', () => resolve())
    })
    const address = server.address() as AddressInfo
    baseUrl = `http://127.0.0.1:${String(address.port)}`
    closeServer = () =>
      new Promise((done, reject) => {
        server.close((error) => (error ? reject(error) : done()))
      })
  })

  afterEach(async () => {
    await closeServer()
    questions.close()
    db.close()
  })

  it('GET /api/student/study-plan 返回 7 日计划 + 今日任务', async () => {
    const response = await fetch(
      `${baseUrl}/api/student/study-plan?studentId=${STUDENT}&unitId=tu-t18`,
      { headers: { 'x-demo-role': 'student' } }
    )
    expect(response.status).toBe(200)
    const body = (await response.json()) as {
      plan: StudyPlan
      today: Array<{ kpId: string; evidenceRefs: unknown[] }>
      taskCount: number
    }
    expect(body.plan.days).toHaveLength(STUDY_PLAN_HORIZON_DAYS)
    expect(body.plan.algorithm).toBe(STUDY_PLAN_ALGORITHM)
    expect(body.taskCount).toBeGreaterThan(0)
    expect(findUnbackedTasks(body.plan)).toEqual([])
    for (const task of body.today) {
      expect(task.evidenceRefs.length).toBeGreaterThan(0)
    }
  })

  it('GET 只读端点不写任何计分表', async () => {
    const before = scoringFingerprint(db)
    await fetch(
      `${baseUrl}/api/student/study-plan?studentId=${STUDENT}&unitId=tu-t18`,
      { headers: { 'x-demo-role': 'student' } }
    )
    await fetch(`${baseUrl}/api/student/study-plan/regenerate`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-demo-role': 'student' },
      body: JSON.stringify({ studentId: STUDENT, unitId: 'tu-t18' })
    })
    expect(scoringFingerprint(db)).toBe(before)
  })

  it('别的学生看不到本学生的计划（403）', async () => {
    const response = await fetch(
      `${baseUrl}/api/student/study-plan?studentId=${STUDENT}&unitId=tu-t18`,
      { headers: { 'x-demo-role': 'stranger' } }
    )
    expect(response.status).toBe(403)
  })

  it('POST regenerate 幂等：同一硬输入重算得到同一计划 id 与同一任务集', async () => {
    const call = async (): Promise<StudyPlan> => {
      const response = await fetch(`${baseUrl}/api/student/study-plan/regenerate`, {
        method: 'POST',
        headers: { 'content-type': 'application/json', 'x-demo-role': 'student' },
        body: JSON.stringify({ studentId: STUDENT, unitId: 'tu-t18' })
      })
      expect(response.status).toBe(200)
      return ((await response.json()) as { plan: StudyPlan }).plan
    }
    const first = await call()
    const second = await call()
    expect(second.id).toBe(first.id)
    expect(JSON.stringify(second.days)).toBe(JSON.stringify(first.days))
  })

  it('教师只读端点：学生角色 403，教师 200', async () => {
    const denied = await fetch(
      `${baseUrl}/api/teacher/students/${STUDENT}/study-plan?unitId=tu-t18`,
      { headers: { 'x-demo-role': 'student' } }
    )
    expect(denied.status).toBe(403)

    const allowed = await fetch(
      `${baseUrl}/api/teacher/students/${STUDENT}/study-plan?unitId=tu-t18`,
      { headers: { 'x-demo-role': 'teacher' } }
    )
    expect(allowed.status).toBe(200)
    const body = (await allowed.json()) as { plan: StudyPlan }
    expect(body.plan.studentId).toBe(STUDENT)
  })

  it('一键布置只转交计划内的 KP，且恒为 practice 模式', async () => {
    const response = await fetch(`${baseUrl}/api/teacher/study-plan/assign`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-demo-role': 'teacher' },
      body: JSON.stringify({ studentId: STUDENT, unitId: 'tu-t18', dayIndex: 0 })
    })
    expect(response.status).toBe(201)
    const body = (await response.json()) as { kpIds: string[]; planId: string }
    expect(body.kpIds.length).toBeGreaterThan(0)
    expect(assignCalls).toHaveLength(1)
    const call = assignCalls[0]
    expect(call?.mode).toBe('practice')
    expect(call?.studentIds).toEqual([STUDENT])
    // 布置的 KP 必须是计划里已有的（不新增未教/无证据的知识点）。
    const planned = new Set(body.kpIds)
    for (const kpId of (call?.kpIds as string[] | undefined) ?? []) {
      expect(planned.has(kpId)).toBe(true)
      expect(sampleUnit().taughtKpIds).toContain(kpId)
    }
  })

  it('证据不足时拒绝布置（409），绝不编造练习内容', async () => {
    profile = {}
    db.prepare('DELETE FROM review_cards').run()
    const response = await fetch(`${baseUrl}/api/teacher/study-plan/assign`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-demo-role': 'teacher' },
      body: JSON.stringify({ studentId: STUDENT, unitId: 'tu-t18' })
    })
    expect(response.status).toBe(409)
    const body = (await response.json()) as { status: string }
    expect(body.status).toBe('insufficient_evidence')
    expect(assignCalls).toHaveLength(0)
  })

  it('学生角色不能调用布置端点（403）', async () => {
    const response = await fetch(`${baseUrl}/api/teacher/study-plan/assign`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-demo-role': 'student' },
      body: JSON.stringify({ studentId: STUDENT, unitId: 'tu-t18' })
    })
    expect(response.status).toBe(403)
    expect(assignCalls).toHaveLength(0)
  })

  it('不认识的路径原样放行给后续 handler', async () => {
    const response = await fetch(`${baseUrl}/api/unrelated`, {
      headers: { 'x-demo-role': 'teacher' }
    })
    expect(response.status).toBe(404)
  })
})

// ---------------------------------------------------------------------------
// 5. 架构守护：计划模块与评分/辅导路径物理隔离
// ---------------------------------------------------------------------------

const projectRoot = resolve(fileURLToPath(new URL('..', import.meta.url)))

function collectSourceFiles(dir: string): string[] {
  const absoluteDir = resolve(projectRoot, dir)
  const files: string[] = []
  for (const entry of readdirSync(absoluteDir)) {
    const fullPath = join(absoluteDir, entry)
    if (statSync(fullPath).isDirectory()) {
      files.push(...collectSourceFiles(join(dir, entry)))
      continue
    }
    if (/\.tsx?$/.test(entry)) files.push(fullPath)
  }
  return files
}

function extractImportSpecifiers(source: string): string[] {
  const specifiers: string[] = []
  const patterns = [
    /import\s+[^'"]*from\s+['"]([^'"]+)['"]/g,
    /import\s+['"]([^'"]+)['"]/g,
    /export\s+[^'"]*from\s+['"]([^'"]+)['"]/g,
    /import\s*\(\s*['"]([^'"]+)['"]\s*\)/g
  ]
  for (const pattern of patterns) {
    let match: RegExpExecArray | null
    while ((match = pattern.exec(source)) !== null) {
      if (match[1]) specifiers.push(match[1])
    }
  }
  return specifiers
}

describe('architecture guard: T18 计划模块隔离', () => {
  const PLAN_DIRS = ['server/studyPlan', 'src/components/studyPlan']
  // 注意排除 server/config/mastery（纯阈值常量），只禁真正的评分/辅导实现目录。
  const FORBIDDEN = [
    /(^|\/)mastery\//,
    /(^|\/)review\//,
    /(^|\/)runner\//,
    /(^|\/)tutoring\//,
    /(^|\/)domain\/EvaluationAgent/,
    /computeMastery/,
    /(^|\/)memory\//,
    /\bmem0ai\b/,
    /@xenova\/transformers/,
    /(^|\/)ollama($|\/)/
  ]

  it('计划模块 import 图不指向 mastery/review/runner/tutoring/LLM 运行时', () => {
    const violations: string[] = []
    for (const dir of PLAN_DIRS) {
      for (const filePath of collectSourceFiles(dir)) {
        const source = readFileSync(filePath, 'utf8')
        for (const specifier of extractImportSpecifiers(source)) {
          if (FORBIDDEN.some((pattern) => pattern.test(specifier))) {
            violations.push(
              `${filePath.slice(projectRoot.length + 1).replace(/\\/g, '/')} → '${specifier}'`
            )
          }
        }
      }
    }
    expect(
      violations,
      violations.length === 0
        ? ''
        : [
            'T18 违规：学习计划模块必须通过只读端口消费硬事实，',
            '不得 import server/mastery/*、server/review/*、server/runner/*、',
            'server/tutoring/* 或任何 LLM/embedding 运行时。违规导入：',
            violations.join('\n')
          ].join('\n')
    ).toEqual([])
  })

  it('计划模块源码里没有任何计分表写语句', () => {
    const writePattern =
      /(INSERT\s+INTO|UPDATE|DELETE\s+FROM)\s+(mastery_scores|review_cards|evaluations|attempts)/i
    const violations: string[] = []
    for (const filePath of collectSourceFiles('server/studyPlan')) {
      const source = readFileSync(filePath, 'utf8')
      if (writePattern.test(source)) {
        violations.push(filePath.slice(projectRoot.length + 1).replace(/\\/g, '/'))
      }
    }
    expect(
      violations,
      violations.length === 0
        ? ''
        : `T18 违规：计划模块不得写计分表。违规文件：${violations.join(', ')}`
    ).toEqual([])
  })

  it('buildStudyPlan 保持 (StudyPlanHardFacts) => StudyPlan 的纯函数签名', () => {
    // 编译期守护：一旦有人给纯函数塞进 db / store 句柄，这行赋值就通不过 tsc。
    const typedReference: (facts: StudyPlanHardFacts) => StudyPlan = buildStudyPlan
    expect(typeof typedReference).toBe('function')
    const source = readFileSync(
      resolve(projectRoot, 'server/studyPlan/buildStudyPlan.ts'),
      'utf8'
    )
    // 纯函数内核里不出现任何持久化/服务句柄（只看 import 图 + 写 API）。
    expect(source).not.toMatch(/\bprepare\s*\(/)
    for (const specifier of extractImportSpecifiers(source)) {
      expect(specifier).not.toMatch(/better-sqlite3/)
      expect(specifier).not.toMatch(/Service|Store|Scheduler/)
    }
  })

  it('计划快照迁移 0013 只建自有表，不碰计分表', () => {
    const sql = readFileSync(
      resolve(projectRoot, 'server/db/migrations/0013_study_plan_snapshots.sql'),
      'utf8'
    )
    expect(sql).toMatch(/CREATE TABLE IF NOT EXISTS study_plan_snapshots/)
    expect(sql).not.toMatch(/ALTER\s+TABLE\s+(mastery_scores|review_cards|evaluations)/i)
    expect(sql).not.toMatch(/REFERENCES\s+(mastery_scores|review_cards|evaluations)/i)
  })
})
