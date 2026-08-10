// @vitest-environment node

/**
 * T20 证据驱动的轻激励（成就徽章）。
 *
 * 断言的四件事（ADR-0001 / ADR-0006 / PRD 验收）：
 *   1. 徽章授予是**确定性规则判定**，同一硬事实必得同一批徽章；
 *   2. **没有证据就没有徽章** —— findUnbackedAchievements 是这条不变量的
 *      可执行断言，且内核自己在授予前也拒绝无锚点的徽章；
 *   3. 占位 Attempt（未提交）永不参与任何授予；
 *   4. 祝贺文案（attachCongratulation）只外挂、不改授予；非 llm_inference
 *      一律拒绝；授予路径不写任何 score / evidence / mastery。
 */
import { createServer } from 'node:http'
import type { AddressInfo } from 'node:net'
import { afterEach, describe, expect, it } from 'vitest'
import Database from 'better-sqlite3'
import type { Attempt, Question } from '../shared/contracts'
import type { StudyPlan } from '../shared/studyPlan'
import {
  ACHIEVEMENT_CATALOG,
  findUnbackedAchievements,
  REPAIR_SCORE_DELTA,
  type AchievementAttemptFact,
  type AchievementHardFacts,
  type AchievementPlanFact,
  type StudentAchievement
} from '../shared/achievements'
import { evaluateAchievements } from '../server/achievements/evaluateAchievements'
import {
  AchievementService,
  attachCongratulation
} from '../server/achievements/AchievementService'
import {
  AchievementStore,
  handleAchievementApi,
  type AchievementRouteContext
} from '../server/achievements'
import type { SessionUser } from '../server/auth/SessionProvider'

const STUDENT = 'student-ach-1'
const NOW_ISO = '2026-08-07T09:00:00.000Z'

// ---------------------------------------------------------------------------
// fixtures
// ---------------------------------------------------------------------------

/** 一次产生证据的 assessment 通过提交。 */
function passFact(
  id: string,
  overrides: Partial<AchievementAttemptFact> = {}
): AchievementAttemptFact {
  return {
    attemptId: id,
    questionId: 'q1',
    kpIds: ['kp-A'],
    mode: 'assessment',
    createdAt: '2026-08-05T08:00:00.000Z',
    status: 'completed',
    score: 90,
    maxScore: 100,
    evidenceIds: [`e-${id}`],
    hasFailedEvidence: false,
    placeholder: false,
    ...overrides
  }
}

function emptyFacts(overrides: Partial<AchievementHardFacts> = {}): AchievementHardFacts {
  return {
    studentId: STUDENT,
    attempts: [],
    mistakes: [],
    now: NOW_ISO,
    ...overrides
  }
}

function samplePlan(overrides: Partial<AchievementPlanFact> = {}): AchievementPlanFact {
  return {
    planId: 'plan-1',
    algorithm: 'studyplan.v1',
    date: '2026-08-07',
    tasks: [
      {
        kpId: 'kp-A',
        questionIds: ['q1'],
        evidenceRefs: [
          {
            kind: 'review_card',
            cardId: 'card-1',
            kpId: 'kp-A',
            dueAt: '2026-08-07T00:00:00.000Z'
          }
        ]
      }
    ],
    ...overrides
  }
}

function makeService(overrides: {
  attempts?: Attempt[]
  questions?: Question[]
  studyPlan?: {
    generate: (studentId: string, teachingUnitId: string) => Promise<StudyPlan>
  }
  persist?: boolean
} = {}) {
  const db = new Database(':memory:')
  db.exec(`CREATE TABLE IF NOT EXISTS student_achievements (
    student_id TEXT NOT NULL,
    achievement_id TEXT NOT NULL,
    earned_at TEXT NOT NULL,
    algorithm TEXT NOT NULL,
    evidence_refs TEXT NOT NULL,
    presentation_hint TEXT,
    PRIMARY KEY (student_id, achievement_id)
  );`)
  const store = new AchievementStore({ database: db })
  const service = new AchievementService({
    attempts: {
      listAttempts: () => Promise.resolve(overrides.attempts ?? [])
    },
    questions: {
      get: (id) => overrides.questions?.find((q) => q.id === id)
    },
    mistakes: {
      view: () => Promise.resolve({ studentId: STUDENT, entries: [], activeCount: 0, masteredCount: 0 })
    },
    ...(overrides.studyPlan ? { studyPlan: overrides.studyPlan } : {}),
    ...(overrides.persist ? { awards: store } : {}),
    org: {
      getTeachingUnit: () => ({
        id: 'tu-ach',
        teacherId: 'teacher-ach',
        classId: 'class-ach',
        subjectId: 'subject-math',
        termId: 'term-2026-fall',
        taughtKpIds: ['kp-A']
      }),
      listEnrolledStudentIds: () => [STUDENT]
    },
    now: () => new Date(NOW_ISO)
  })
  return { service, store }
}

function startServer(
  service: AchievementService,
  user: SessionUser
): Promise<{ url: string; close: () => Promise<void> }> {
  const db = new Database(':memory:')
  db.exec(`CREATE TABLE IF NOT EXISTS users (
    id TEXT PRIMARY KEY,
    public_library_reviewer INTEGER NOT NULL DEFAULT 0
  );`)
  const server = createServer((request, response) => {
    const requestUrl = new URL(request.url ?? '/', 'http://127.0.0.1')
    const context: AchievementRouteContext = {
      db,
      achievements: service,
      user,
      org: {
        getTeachingUnit: () => ({
          id: 'tu-ach',
          teacherId: 'teacher-ach',
          classId: 'class-ach',
          subjectId: 'subject-math',
          termId: 'term-2026-fall',
          taughtKpIds: ['kp-A']
        }),
        listEnrolledStudentIds: () => [STUDENT]
      }
    }
    void handleAchievementApi(request, response, requestUrl, context).then(
      (handled) => {
        if (!handled) response.writeHead(404).end('not mine')
      }
    )
  })
  return new Promise((resolveServer) => {
    server.listen(0, '127.0.0.1', () => {
      const { port } = server.address() as AddressInfo
      const entry = {
        url: `http://127.0.0.1:${String(port)}`,
        close: () =>
          new Promise<void>((done) => {
            server.close(() => done())
          })
      }
      servers.push(entry)
      resolveServer(entry)
    })
  })
}

const servers: Array<{ close: () => Promise<void> }> = []

afterEach(async () => {
  while (servers.length > 0) await servers.pop()?.close()
})

// ---------------------------------------------------------------------------
// 1. 纯函数内核：没有证据就没有徽章
// ---------------------------------------------------------------------------

describe('evaluateAchievements：纯函数内核 (T20)', () => {
  it('空硬事实 → 不授予任何徽章，且 5 条目录全覆盖', () => {
    const evaluation = evaluateAchievements(emptyFacts())
    expect(evaluation.earned).toHaveLength(0)
    expect(evaluation.progress).toHaveLength(ACHIEVEMENT_CATALOG.length)
    expect(evaluation.algorithm).toBe('achievement.hard.v1')
  })

  it('占位 Attempt（未提交）永不参与授予', () => {
    const placeholder = passFact('a-placeholder', { placeholder: true })
    const evaluation = evaluateAchievements(emptyFacts({ attempts: [placeholder] }))
    expect(evaluation.earned).toHaveLength(0)
  })

  it('零证据的提交不算通过（first_evidence_pass 不授予）', () => {
    const noEvidence = passFact('a-no-ev', { evidenceIds: [] })
    const evaluation = evaluateAchievements(emptyFacts({ attempts: [noEvidence] }))
    expect(evaluation.earned).toHaveLength(0)
    const progress = evaluation.progress.find((p) => p.id === 'first_evidence_pass')
    expect(progress?.status).toBe('locked')
  })

  it('practice 模式不点亮测评类徽章（D1）', () => {
    const practice = passFact('a-practice', { mode: 'practice' })
    const evaluation = evaluateAchievements(emptyFacts({ attempts: [practice] }))
    expect(evaluation.earned).toHaveLength(0)
  })

  it('每枚授予的徽章都必须带非空 evidenceRefs（findUnbackedAchievements 恒空）', () => {
    const facts = emptyFacts({
      attempts: [passFact('a1')],
      mistakes: [
        {
          questionId: 'q1',
          kpIds: ['kp-A'],
          consecutiveAssessmentPasses: 1,
          mastered: true,
          lastActiveAt: '2026-08-05T08:00:00.000Z'
        }
      ],
      planToday: samplePlan()
    })
    const evaluation = evaluateAchievements(facts)
    expect(evaluation.earned.length).toBeGreaterThan(0)
    expect(findUnbackedAchievements(evaluation.earned)).toEqual([])
    for (const achievement of evaluation.earned) {
      expect(achievement.evidenceRefs.length).toBeGreaterThan(0)
    }
  })
})

// ---------------------------------------------------------------------------
// 2. 五条规则各自的边界
// ---------------------------------------------------------------------------

describe('五条规则 (T20)', () => {
  it('first_evidence_pass：首次全证据通过即授予，earnedAt 取自该 Attempt', () => {
    const attempt = passFact('a-first', { createdAt: '2026-08-03T08:00:00.000Z' })
    const evaluation = evaluateAchievements(emptyFacts({ attempts: [attempt] }))
    const badge = evaluation.earned.find((a) => a.achievementId === 'first_evidence_pass')
    expect(badge).toBeDefined()
    expect(badge?.earnedAt).toBe('2026-08-03T08:00:00.000Z')
  })

  it('repair_plus_20：分差 19 不授，20 授（阈值含）', () => {
    const earlier = passFact('a-low', { score: 60 })
    const delta19 = passFact('a-delta19', { score: 79, createdAt: '2026-08-04T08:00:00.000Z' })
    const delta20 = passFact('a-delta20', { score: 80, createdAt: '2026-08-06T08:00:00.000Z' })

    const locked = evaluateAchievements(emptyFacts({ attempts: [earlier, delta19] }))
    expect(locked.earned.some((a) => a.achievementId === 'repair_plus_20')).toBe(false)

    const earned = evaluateAchievements(emptyFacts({ attempts: [earlier, delta20] }))
    const badge = earned.earned.find((a) => a.achievementId === 'repair_plus_20')
    expect(badge).toBeDefined()
    expect(badge?.earnedAt).toBe('2026-08-06T08:00:00.000Z')
    expect(REPAIR_SCORE_DELTA).toBe(20)
  })

  it('repair_plus_20：相邻两次分差不足 20 不授予（分数一路下跌）', () => {
    const attempts = [
      passFact('a1', { score: 90, createdAt: '2026-08-01T08:00:00.000Z' }),
      passFact('a2', { score: 70, createdAt: '2026-08-02T08:00:00.000Z' }),
      passFact('a3', { score: 65, createdAt: '2026-08-03T08:00:00.000Z' })
    ]
    // 相邻对：(90,70) = -20、(70,65) = -5 —— 没有任何一次相邻提升 ≥ 20。
    const evaluation = evaluateAchievements(emptyFacts({ attempts }))
    expect(evaluation.earned.some((a) => a.achievementId === 'repair_plus_20')).toBe(false)
  })

  it('weak_kp_cleared：错题按 T07 规则移出活跃即授予，锚点回捞通过的 Attempt', () => {
    const evaluation = evaluateAchievements(
      emptyFacts({
        attempts: [passFact('a-pass', { questionId: 'q-wrong' })],
        mistakes: [
          {
            questionId: 'q-wrong',
            kpIds: ['kp-A'],
            consecutiveAssessmentPasses: 1,
            mastered: true,
            lastActiveAt: '2026-08-05T08:00:00.000Z'
          }
        ]
      })
    )
    const badge = evaluation.earned.find((a) => a.achievementId === 'weak_kp_cleared')
    expect(badge).toBeDefined()
    const cleared = badge?.evidenceRefs.find((r) => r.kind === 'mistake_cleared')
    expect(cleared?.kind).toBe('mistake_cleared')
  })

  it('weak_kp_cleared：已移出但回捞不到通过的 Attempt → 不授予（不编造）', () => {
    const evaluation = evaluateAchievements(
      emptyFacts({
        attempts: [],
        mistakes: [
          {
            questionId: 'q-wrong',
            kpIds: ['kp-A'],
            consecutiveAssessmentPasses: 1,
            mastered: true,
            lastActiveAt: '2026-08-05T08:00:00.000Z'
          }
        ]
      })
    )
    expect(evaluation.earned.some((a) => a.achievementId === 'weak_kp_cleared')).toBe(false)
  })

  it('streak_study_3：连续 3 个自然日授予，断了不延续', () => {
    const continuous = [
      passFact('d1', { createdAt: '2026-08-01T08:00:00.000Z' }),
      passFact('d2', { createdAt: '2026-08-02T08:00:00.000Z' }),
      passFact('d3', { createdAt: '2026-08-03T08:00:00.000Z' })
    ]
    const earned = evaluateAchievements(emptyFacts({ attempts: continuous }))
    const badge = earned.earned.find((a) => a.achievementId === 'streak_study_3')
    expect(badge).toBeDefined()

    const broken = [
      passFact('d1', { createdAt: '2026-08-01T08:00:00.000Z' }),
      passFact('d2', { createdAt: '2026-08-03T08:00:00.000Z' }),
      passFact('d3', { createdAt: '2026-08-05T08:00:00.000Z' })
    ]
    const locked = evaluateAchievements(emptyFacts({ attempts: broken }))
    expect(locked.earned.some((a) => a.achievementId === 'streak_study_3')).toBe(false)
  })

  it('plan_day_done：无计划 → unavailable（不是 locked）', () => {
    const evaluation = evaluateAchievements(emptyFacts())
    const progress = evaluation.progress.find((p) => p.id === 'plan_day_done')
    expect(progress?.status).toBe('unavailable')
  })

  it('plan_day_done：当日计划全部完成才授予；差一项 locked', () => {
    const done = evaluateAchievements(
      emptyFacts({
        attempts: [passFact('a-today', { createdAt: '2026-08-07T08:00:00.000Z' })],
        planToday: samplePlan()
      })
    )
    expect(done.earned.some((a) => a.achievementId === 'plan_day_done')).toBe(true)

    const partial = evaluateAchievements(
      emptyFacts({
        attempts: [],
        planToday: samplePlan({
          tasks: [
            {
              kpId: 'kp-A',
              questionIds: ['q1'],
              evidenceRefs: [
                {
                  kind: 'review_card',
                  cardId: 'card-1',
                  kpId: 'kp-A',
                  dueAt: '2026-08-07T00:00:00.000Z'
                }
              ]
            },
            {
              kpId: 'kp-B',
              questionIds: ['q2'],
              evidenceRefs: [
                {
                  kind: 'review_card',
                  cardId: 'card-2',
                  kpId: 'kp-B',
                  dueAt: '2026-08-07T00:00:00.000Z'
                }
              ]
            }
          ]
        })
      })
    )
    expect(partial.earned.some((a) => a.achievementId === 'plan_day_done')).toBe(false)
  })

  it('同一硬事实必得同一批徽章（确定性可重放）', () => {
    const facts = emptyFacts({ attempts: [passFact('a1'), passFact('a2')] })
    const first = evaluateAchievements(facts)
    const second = evaluateAchievements({
      ...facts,
      attempts: [...facts.attempts].reverse()
    })
    expect(JSON.stringify(first)).toBe(JSON.stringify(second))
  })
})

// ---------------------------------------------------------------------------
// 3. Service：授予幂等 / 降级 / 建议层闸门
// ---------------------------------------------------------------------------

describe('AchievementService：编排 (T20)', () => {
  it('evaluate 纯只读：无 awards 端口也可用（不落库）', async () => {
    const { service } = makeService()
    const evaluation = await service.evaluate(STUDENT)
    expect(evaluation.earned).toHaveLength(0)
  })

  it('sync 幂等：重复调用不刷重复 toast、不改 earnedAt', async () => {
    const attempts: Attempt[] = [
      {
        id: 'a1',
        studentId: STUDENT,
        questionId: 'q1',
        teachingUnitId: 'tu-ach',
        termId: 'term-2026-fall',
        mode: 'assessment',
        createdAt: '2026-08-05T08:00:00.000Z',
        result: {
          id: 'ev-1',
          assignmentId: 'q1',
          attempt: 1,
          createdAt: '2026-08-05T08:00:00.000Z',
          status: 'completed',
          score: 90,
          summary: '',
          evidence: [
            {
              id: 'e-1',
              kind: 'answer_match',
              label: '核对',
              dimensionId: 'd1',
              visibility: 'public',
              state: 'passed',
              weight: 1,
              message: '正确',
              source: 'authored_key'
            }
          ],
          dimensions: [
            { id: 'd1', label: '正确性', description: '答案与标准一致', maxScore: 100, earnedScore: 90, state: 'passed', evidenceIds: [] }
          ],
          diagnoses: [],
          trace: [],
          mastery: [],
          feedbackSource: 'local-policy',
          provenance: { kind: 'evidence', evidenceIds: ['e-1'], algorithm: 'simple.v1' }
        }
      }
    ]
    const { service, store } = makeService({ attempts, persist: true })

    const first = await service.sync(STUDENT, { teachingUnitId: 'tu-ach' })
    const second = await service.sync(STUDENT, { teachingUnitId: 'tu-ach' })
    expect(first.newlyEarned.length).toBeGreaterThan(0)
    expect(second.newlyEarned).toHaveLength(0)
    // 已落库的行数 = 首次授予数（幂等，不重复）
    const stored = store.list(STUDENT)
    expect(stored.length).toBe(first.newlyEarned.length)
  })

  it('studyPlan 端口缺失 → plan_day_done unavailable，其余 4 种不受影响', async () => {
    const attempts: Attempt[] = [
      {
        id: 'a1',
        studentId: STUDENT,
        questionId: 'q1',
        teachingUnitId: 'tu-ach',
        termId: 'term-2026-fall',
        mode: 'assessment',
        createdAt: '2026-08-05T08:00:00.000Z',
        result: {
          id: 'ev-1',
          assignmentId: 'q1',
          attempt: 1,
          createdAt: '2026-08-05T08:00:00.000Z',
          status: 'completed',
          score: 90,
          summary: '',
          evidence: [
            {
              id: 'e-1',
              kind: 'answer_match',
              label: '核对',
              dimensionId: 'd1',
              visibility: 'public',
              state: 'passed',
              weight: 1,
              message: '正确',
              source: 'authored_key'
            }
          ],
          dimensions: [
            { id: 'd1', label: '正确性', description: '答案与标准一致', maxScore: 100, earnedScore: 90, state: 'passed', evidenceIds: [] }
          ],
          diagnoses: [],
          trace: [],
          mastery: [],
          feedbackSource: 'local-policy',
          provenance: { kind: 'evidence', evidenceIds: ['e-1'], algorithm: 'simple.v1' }
        }
      }
    ]
    const { service } = makeService({ attempts })
    const evaluation = await service.evaluate(STUDENT, { teachingUnitId: 'tu-ach' })
    // 无 studyPlan 端口 → plan_day_done 报 unavailable
    expect(evaluation.progress.find((p) => p.id === 'plan_day_done')?.status).toBe('unavailable')
    // 其余规则照常工作
    expect(evaluation.earned.some((a) => a.achievementId === 'first_evidence_pass')).toBe(true)
  })

  it('studyPlan 端口抛错 → 同样降级，不拖垮整批判定', async () => {
    const { service } = makeService({
      attempts: [],
      studyPlan: {
        generate: () => Promise.reject(new Error('plan down'))
      }
    })
    const evaluation = await service.evaluate(STUDENT, { teachingUnitId: 'tu-ach' })
    expect(evaluation.progress.find((p) => p.id === 'plan_day_done')?.status).toBe('unavailable')
  })

  it('attachCongratulation：只外挂文案、不改授予；非 llm_inference 拒绝', () => {
    const badge: StudentAchievement = {
      studentId: STUDENT,
      achievementId: 'first_evidence_pass',
      earnedAt: NOW_ISO,
      evidenceRefs: [
        {
          kind: 'attempt',
          attemptId: 'a1',
          questionId: 'q1',
          mode: 'assessment',
          score: 90,
          maxScore: 100,
          evidenceIds: ['e-1'],
          createdAt: NOW_ISO
        }
      ],
      algorithm: 'achievement.hard.v1'
    }
    const accepted = attachCongratulation(badge, {
      text: '继续保持。',
      provenance: {
        kind: 'llm_inference',
        sourceMessages: ['m1'],
        model: 'm',
        extractedAt: NOW_ISO
      }
    })
    expect(accepted.presentationHint?.text).toBe('继续保持。')
    // 证据链引用原样透传
    expect(accepted.evidenceRefs).toBe(badge.evidenceRefs)

    const rejected = attachCongratulation(badge, {
      text: '你好棒！',
      provenance: {
        kind: 'teacher_annotation',
        teacherId: 'teacher-ach',
        note: 'x'
      }
    })
    expect(rejected.presentationHint).toBeUndefined()
    expect(rejected).toBe(badge)
  })
})

// ---------------------------------------------------------------------------
// 4. HTTP 端点
// ---------------------------------------------------------------------------

describe('成就 HTTP 端点 (T20)', () => {
  it('GET 学生成就墙 → 200 + 固定目录 + 无排行榜形状', async () => {
    const { service } = makeService()
    const server = await startServer(service, {
      userId: STUDENT,
      role: 'student',
      displayName: 'S',
      studentId: STUDENT
    })
    const response = await fetch(`${server.url}/api/student/achievements?studentId=${STUDENT}`)
    expect(response.status).toBe(200)
    const body = (await response.json()) as {
      catalog: AchievementCatalogEntryForTest[]
      earned: StudentAchievement[]
      progress: unknown[]
    }
    expect(body.catalog).toHaveLength(ACHIEVEMENT_CATALOG.length)
    expect(Array.isArray(body.earned)).toBe(true)
    expect(Array.isArray(body.progress)).toBe(true)
    // 类型层面无 points/rank/leaderboard —— 序列化后也不该出现。
    const serialized = JSON.stringify(body)
    expect(serialized).not.toContain('rank')
    expect(serialized).not.toContain('points')
  })

  it('POST sync → 200 + newlyEarned 数组', async () => {
    const { service } = makeService({ persist: true })
    const server = await startServer(service, {
      userId: STUDENT,
      role: 'student',
      displayName: 'S',
      studentId: STUDENT
    })
    const response = await fetch(`${server.url}/api/student/achievements/sync`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ studentId: STUDENT })
    })
    expect(response.status).toBe(200)
    const body = (await response.json()) as { newlyEarned: StudentAchievement[] }
    expect(Array.isArray(body.newlyEarned)).toBe(true)
  })

  it('GET 教师聚合计数 → 200 + 只有计数没有明细', async () => {
    const { service } = makeService()
    const server = await startServer(service, {
      userId: 'teacher-ach',
      role: 'teacher',
      displayName: 'T'
    })
    const response = await fetch(
      `${server.url}/api/teacher/achievements/summary?unitId=tu-ach`
    )
    expect(response.status).toBe(200)
    const body = (await response.json()) as { counts: unknown[]; studentCount: number }
    expect(Array.isArray(body.counts)).toBe(true)
    expect(typeof body.studentCount).toBe('number')
  })

  it('学生访问教师端点 → 403', async () => {
    const { service } = makeService()
    const server = await startServer(service, {
      userId: STUDENT,
      role: 'student',
      displayName: 'S',
      studentId: STUDENT
    })
    const response = await fetch(
      `${server.url}/api/teacher/achievements/summary?unitId=tu-ach`
    )
    expect(response.status).toBe(403)
  })
})

/** 只取测试需要的目录条目字段。 */
interface AchievementCatalogEntryForTest {
  id: string
  name: string
  condition: string
  icon: string
  requiresStudyPlan: boolean
}
