// @vitest-environment node

/**
 * T16 跨学科模拟考（组卷）。
 *
 * 断言的四件事（ADR-0001 / PRD 验收）：
 *   1. D2 闸门：只有「已入库且有权威答案」的正式题能进卷；未校对草稿题
 *      （llm_inference）在结构上进不来（不在题库表），source 校验是二道闸；
 *   2. 组卷是确定性纯函数（同输入同输出），薄弱 KP 优先、同 KP 去重、
 *      跨学科轮转，题量不足只出 warning 不断卷；
 *   3. save 对教师改过的题号列表重新跑一遍闸门 —— 前端不能替服务端放行；
 *   4. 组卷 / 报告路径不写任何 score / evidence / mastery。
 */
import { createServer } from 'node:http'
import type { AddressInfo } from 'node:net'
import { afterEach, describe, expect, it, vi } from 'vitest'
import Database from 'better-sqlite3'
import type { Attempt, CreateAssignmentResult, EvidenceSource, Question, TeachingUnit } from '../shared/contracts'
import {
  DEFAULT_MOCK_EXAM_QUESTION_COUNT,
  hasAnswerAuthority,
  MOCK_EXAM_GATE_NOTICE,
  type MockExamCandidate,
  type MockExamPlan
} from '../shared/mockExam'
import { assembleMockExam } from '../server/mockExam/assembleMockExam'
import { MockExamService } from '../server/mockExam/MockExamService'
import {
  handleMockExamApi,
  MockExamPlanStore,
  type MockExamRouteContext
} from '../server/mockExam'
import type { SessionUser } from '../server/auth/SessionProvider'

const TEACHER = 'teacher-mock-alpha'
const OTHER_TEACHER = 'teacher-mock-beta'
const STUDENT = 'student-mock-1'
const CLASS_ID = 'class-mock-1'
const TERM_ID = 'term-2026-fall'
const UNIT_A = 'tu-mock-math'
const UNIT_B = 'tu-mock-phys'
const FIXED_NOW = () => new Date('2026-08-07T09:00:00.000Z')

// ---------------------------------------------------------------------------
// fixtures
// ---------------------------------------------------------------------------

function sampleUnit(id: string, overrides: Partial<TeachingUnit> = {}): TeachingUnit {
  return {
    id,
    teacherId: TEACHER,
    classId: CLASS_ID,
    subjectId: id === UNIT_A ? 'subject-math' : 'subject-physics',
    termId: TERM_ID,
    taughtKpIds: id === UNIT_A ? ['kp-A1', 'kp-A2'] : ['kp-B1', 'kp-B2'],
    ...overrides
  }
}

/** 正式题库题：教师手写答案 = D2 权威等级。 */
function formalQuestion(
  id: string,
  overrides: Partial<Question> = {}
): Question {
  return {
    id,
    questionBankId: 'bank-mock',
    authorId: TEACHER,
    subject: id.startsWith('q-b') ? 'physics' : 'math',
    questionType: 'choice',
    stem: `正式题 ${id}`,
    payload: { kind: 'choice', correctOptionIds: ['A'] },
    kpIds: ['kp-A1'],
    difficulty: 2,
    source: 'authored_key',
    createdAt: '2026-08-01T00:00:00.000Z',
    ...overrides
  }
}

function candidate(id: string, overrides: Partial<MockExamCandidate> = {}): MockExamCandidate {
  return {
    questionId: id,
    subject: 'math',
    questionType: 'choice',
    kpIds: ['kp-A1'],
    difficulty: 2,
    source: 'authored_key',
    teachingUnitId: UNIT_A,
    createdAt: '2026-08-01T00:00:00.000Z',
    ...overrides
  }
}

function makeService(overrides: {
  questions?: Question[]
  units?: TeachingUnit[]
  attempts?: Attempt[]
  studentIds?: string[]
  excludeRecentDays?: number
} = {}) {
  const questions = overrides.questions ?? []
  const units = overrides.units ?? [sampleUnit(UNIT_A), sampleUnit(UNIT_B)]
  const studentIds = overrides.studentIds ?? [STUDENT]
  const attempts = overrides.attempts ?? []
  const db = new Database(':memory:')
  db.exec(`
    CREATE TABLE IF NOT EXISTS mock_exam_plans (
      id TEXT PRIMARY KEY,
      creator_id TEXT NOT NULL,
      class_id TEXT NOT NULL,
      teaching_unit_ids TEXT NOT NULL,
      title TEXT NOT NULL,
      duration_minutes INTEGER NOT NULL,
      question_ids TEXT NOT NULL,
      kp_coverage TEXT NOT NULL,
      status TEXT NOT NULL,
      algorithm TEXT NOT NULL,
      created_at TEXT NOT NULL,
      paper_id TEXT,
      assigned_at TEXT
    );
  `)
  const plans = new MockExamPlanStore({ database: db })
  const assignedInputs: Array<{
    teachingUnitId: string
    paperId?: string
    questionTeachingUnitIds?: Record<string, string>
  }> = []

  const service = new MockExamService({
    org: {
      getTeachingUnit: (id) => units.find((unit) => unit.id === id),
      listEnrolledStudentIds: (classId, termId) =>
        classId === CLASS_ID && termId === TERM_ID ? studentIds : [],
      listTeachingUnitsByTeacher: () => units
    },
    questions: {
      list: ({ authorId, kpIds }) =>
        questions.filter(
          (q) =>
            (authorId === undefined || q.authorId === authorId) &&
            (kpIds === undefined || q.kpIds.some((kp) => kpIds.includes(kp)))
        ),
      get: (id) => questions.find((q) => q.id === id)
    },
    mastery: {
      getProfile: () => ({})
    },
    plans,
    attempts: {
      listAttempts: () => Promise.resolve(attempts)
    },
    assign: {
      create: (input): Promise<CreateAssignmentResult> => {
        const extended = input as typeof input & {
          paperId?: string
          questionTeachingUnitIds?: Record<string, string>
        }
        assignedInputs.push(extended)
        return Promise.resolve({
          teachingUnitId: input.teachingUnitId,
          kind: input.kind,
          paperId: extended.paperId ?? 'paper-mock-1',
          attemptIds: input.studentIds?.map((s) => `attempt-${s}`) ?? [],
          studentIds: input.studentIds ?? [],
          questionIds: input.questionIds ?? [],
          mode: input.mode,
          createdAt: FIXED_NOW().toISOString(),
          ...(input.dueAt !== undefined ? { dueAt: input.dueAt } : {})
        })
      }
    },
    now: FIXED_NOW,
    newId: () => 'mock-plan-1',
    excludeRecentDays: overrides.excludeRecentDays
  })
  return { service, plans, questions, assignedInputs }
}

function startServer(service: MockExamService, user: SessionUser): Promise<{ url: string; close: () => Promise<void> }> {
  const db = new Database(':memory:')
  // authorizeAccess 会查 users 表的 public_library_reviewer 旗标（fail-closed）。
  // 空表 = 任何测试用户都不是 reviewer，权限判定回到 role 本身。
  db.exec(`CREATE TABLE IF NOT EXISTS users (
    id TEXT PRIMARY KEY,
    public_library_reviewer INTEGER NOT NULL DEFAULT 0
  );`)
  const units = [sampleUnit(UNIT_A), sampleUnit(UNIT_B)]
  const server = createServer((request, response) => {
    const requestUrl = new URL(request.url ?? '/', 'http://127.0.0.1')
    const context: MockExamRouteContext = {
      db,
      mockExam: service,
      user,
      org: {
        getTeachingUnit: (id) => units.find((unit) => unit.id === id),
        listEnrolledStudentIds: (classId, termId) =>
          classId === CLASS_ID && termId === TERM_ID ? [STUDENT] : []
      }
    }
    void handleMockExamApi(request, response, requestUrl, context).then(
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

function teacherUser(userId = TEACHER): SessionUser {
  return { userId, role: 'teacher', displayName: 'T' }
}

// ---------------------------------------------------------------------------
// 1. D2 闸门：可计分题判定
// ---------------------------------------------------------------------------

describe('hasAnswerAuthority：D2 答案权威闸门 (T16)', () => {
  it('authored_key + 完整选择题答案 → 可计分', () => {
    expect(
      hasAnswerAuthority({
        questionType: 'choice',
        payload: { kind: 'choice', correctOptionIds: ['A'] },
        source: 'authored_key',
        kpIds: ['kp-A1']
      })
    ).toBe(true)
  })

  it('llm_inference 来源（未校对草稿题）→ 拒绝入卷', () => {
    // 用 as unknown 模拟 SQLite 强转出来的脏数据：正常类型系统里 Question.source
    // 只有 test_case / authored_key，但运行时数据可能带别的字符串。
    const dirtySource = 'llm_inference' as unknown as EvidenceSource
    expect(
      hasAnswerAuthority({
        questionType: 'choice',
        payload: { kind: 'choice', correctOptionIds: ['A'] },
        source: dirtySource,
        kpIds: ['kp-A1']
      })
    ).toBe(false)
  })

  it('essay 主观题永远不可计分（只能走教师终裁）', () => {
    expect(
      hasAnswerAuthority({
        questionType: 'essay',
        payload: { kind: 'essay', maxWords: 300 },
        source: 'authored_key',
        kpIds: ['kp-A1']
      })
    ).toBe(false)
  })

  it('无知识点标签 → 拒绝（D4 溯源断裂）', () => {
    expect(
      hasAnswerAuthority({
        questionType: 'choice',
        payload: { kind: 'choice', correctOptionIds: ['A'] },
        source: 'authored_key',
        kpIds: []
      })
    ).toBe(false)
  })

  it('code 题必须有非空 testCases；geometry 必须有 sectionVertexIds', () => {
    expect(
      hasAnswerAuthority({
        questionType: 'code',
        payload: { kind: 'code', testCases: [] },
        source: 'authored_key',
        kpIds: ['kp-A1']
      })
    ).toBe(false)
    expect(
      hasAnswerAuthority({
        questionType: 'code',
        payload: { kind: 'code', testCases: [{ input: '1', expected: '1' }] },
        source: 'authored_key',
        kpIds: ['kp-A1']
      })
    ).toBe(true)
    expect(
      hasAnswerAuthority({
        questionType: 'geometry',
        payload: { kind: 'geometry', sectionVertexIds: [] },
        source: 'authored_key',
        kpIds: ['kp-A1']
      })
    ).toBe(false)
    expect(
      hasAnswerAuthority({
        questionType: 'geometry',
        payload: { kind: 'geometry', sectionVertexIds: ['v1'] },
        source: 'authored_key',
        kpIds: ['kp-A1']
      })
    ).toBe(true)
  })
})

// ---------------------------------------------------------------------------
// 2. 纯函数内核：确定性 / 排序 / 去重 / 轮转
// ---------------------------------------------------------------------------

describe('assembleMockExam：组卷纯函数内核 (T16)', () => {
  const baseInput = {
    id: 'plan-1',
    createdAt: '2026-08-07T09:00:00.000Z',
    creatorId: TEACHER,
    classId: CLASS_ID,
    title: '期中模拟',
    durationMinutes: 60,
    questionCount: 4,
    teachingUnitIds: [UNIT_A, UNIT_B],
    allowedKpIds: ['kp-A1', 'kp-A2', 'kp-B1', 'kp-B2'],
    weakKpIds: ['kp-B1'],
    excludeQuestionIds: []
  }

  it('同一输入必得同一输出（逐字节确定，可重放）', () => {
    const candidates = [
      candidate('q1', { kpIds: ['kp-A1'] }),
      candidate('q2', { kpIds: ['kp-B1'], subject: 'physics' }),
      candidate('q3', { kpIds: ['kp-A2'] }),
      candidate('q4', { kpIds: ['kp-B2'], subject: 'physics' })
    ]
    const first = assembleMockExam({ ...baseInput, candidates })
    const second = assembleMockExam({ ...baseInput, candidates: [...candidates].reverse() })
    expect(JSON.stringify(first)).toBe(JSON.stringify(second))
    expect(first.warnings).toHaveLength(0)
  })

  it('薄弱 KP 优先：同科候选内，weakKpIds 排前的题先被选入', () => {
    const candidates = [
      // 同属 math 学科：q-weak 命中薄弱 KP，应排在同 pool 的 q-normal 前面。
      candidate('q-weak', { kpIds: ['kp-A1'] }),
      candidate('q-normal', { kpIds: ['kp-A2'] })
    ]
    const { plan } = assembleMockExam({
      ...baseInput,
      questionCount: 1,
      weakKpIds: ['kp-A1'],
      candidates
    })
    expect(plan.questionIds).toEqual(['q-weak'])
  })

  it('同 KP 去重：一个知识点在一份卷里最多出一题', () => {
    const candidates = [
      candidate('q1', { kpIds: ['kp-A1'] }),
      candidate('q2', { kpIds: ['kp-A1', 'kp-A2'] }),
      candidate('q3', { kpIds: ['kp-A2'] })
    ]
    const { plan, warnings } = assembleMockExam({
      ...baseInput,
      questionCount: 10,
      candidates
    })
    // 三个候选中，q1 先占 kp-A1，q2 带来新 kp-A2 被选，q3 无新 KP 被跳过。
    expect(plan.questionIds).toEqual(['q1', 'q2'])
    expect(warnings.some((w) => w.code === 'short_paper')).toBe(true)
  })

  it('跨学科轮转：目标题量内两个学科都有题', () => {
    const candidates = [
      candidate('q-m1', { kpIds: ['kp-A1'] }),
      candidate('q-m2', { kpIds: ['kp-A2'] }),
      candidate('q-p1', { kpIds: ['kp-B1'], subject: 'physics' }),
      candidate('q-p2', { kpIds: ['kp-B2'], subject: 'physics' })
    ]
    const { plan } = assembleMockExam({ ...baseInput, questionCount: 4, candidates })
    const subjects = new Set(
      plan.kpCoverage.map((entry) => entry.subject)
    )
    expect(subjects.has('math')).toBe(true)
    expect(subjects.has('physics')).toBe(true)
    expect(plan.questionIds).toHaveLength(4)
  })

  it('无任何候选题 → 空卷 + no_scorable_question，不报错', () => {
    const { plan, warnings } = assembleMockExam({
      ...baseInput,
      candidates: []
    })
    expect(plan.questionIds).toEqual([])
    expect(warnings.some((w) => w.code === 'no_scorable_question')).toBe(true)
  })

  it('无薄弱信号 → no_weak_kp warning，退化为按已教顺序覆盖', () => {
    const candidates = [candidate('q1', { kpIds: ['kp-A1'] })]
    const { plan, warnings } = assembleMockExam({
      ...baseInput,
      weakKpIds: [],
      questionCount: 1,
      candidates
    })
    expect(plan.questionIds).toEqual(['q1'])
    expect(warnings.some((w) => w.code === 'no_weak_kp')).toBe(true)
  })

  it('题量 clamp 到 [1, 60]，非法值回退到最小值', () => {
    const candidates = [
      candidate('q1', { kpIds: ['kp-A1'] }),
      candidate('q2', { kpIds: ['kp-A2'] })
    ]
    const huge = assembleMockExam({ ...baseInput, questionCount: 500, candidates })
    const tiny = assembleMockExam({ ...baseInput, questionCount: -5, candidates })
    expect(huge.plan.questionIds.length).toBeLessThanOrEqual(60)
    expect(tiny.plan.questionIds.length).toBeGreaterThanOrEqual(1)
  })

  it('输出不含任何 score / evidence 字段（组卷不判分）', () => {
    const candidates = [candidate('q1', { kpIds: ['kp-A1'] })]
    const { plan } = assembleMockExam({ ...baseInput, questionCount: 1, candidates })
    const serialized = JSON.stringify(plan)
    expect(serialized).not.toContain('"score"')
    expect(serialized).not.toContain('"evidence"')
    expect(plan.algorithm).toBe('mockexam.assemble.v1')
  })
})

// ---------------------------------------------------------------------------
// 3. Service：D4 / 权限 / save 重校验 / 发布转交
// ---------------------------------------------------------------------------

describe('MockExamService：编排与闸门 (T16)', () => {
  it('未教知识点（D4）的题被排除出候选题', async () => {
    const questions = [formalQuestion('q1', { kpIds: ['kp-NOT-TAUGHT'] })]
    const { service } = makeService({ questions })
    const suggestion = await service.suggest({
      teacherId: TEACHER,
      teachingUnitIds: [UNIT_A]
    })
    expect(suggestion.plan.questionIds).toEqual([])
    expect(suggestion.warnings.some((w) => w.code === 'no_scorable_question')).toBe(true)
  })

  it('其他教师题库的题被移除（归属校验）', async () => {
    const questions = [
      formalQuestion('q-mine', { authorId: TEACHER }),
      formalQuestion('q-other', { authorId: OTHER_TEACHER })
    ]
    const { service } = makeService({ questions })
    const suggestion = await service.suggest({
      teacherId: TEACHER,
      teachingUnitIds: [UNIT_A]
    })
    expect(suggestion.plan.questionIds).not.toContain('q-other')
  })

  it('suggest 返回结构完整：gateNotice / sections / warnings', async () => {
    const questions = [
      formalQuestion('q1', { kpIds: ['kp-A1'] }),
      formalQuestion('q2', { kpIds: ['kp-A2'] })
    ]
    const { service } = makeService({ questions })
    const suggestion = await service.suggest({
      teacherId: TEACHER,
      teachingUnitIds: [UNIT_A],
      questionCount: 2
    })
    expect(suggestion.gateNotice).toBe(MOCK_EXAM_GATE_NOTICE)
    expect(suggestion.sections.length).toBeGreaterThanOrEqual(1)
    expect(suggestion.plan.questionIds).toHaveLength(2)
  })

  it('save 对教师改过的题号列表重新跑闸门：无答案权威的题被剔除', async () => {
    const questions = [
      formalQuestion('q-good', { kpIds: ['kp-A1'] }),
      // 模拟脏数据：source 不是权威等级（例如草稿误入库）
      formalQuestion('q-bad', {
        kpIds: ['kp-A2'],
        source: 'llm_inference' as unknown as EvidenceSource
      })
    ]
    const { service } = makeService({ questions })
    const result = await service.save({
      teacherId: TEACHER,
      teachingUnitIds: [UNIT_A],
      questionIds: ['q-good', 'q-bad', 'q-missing']
    })
    expect(result.plan.questionIds).toEqual(['q-good'])
    expect(result.warnings.some((w) => w.code === 'no_scorable_question')).toBe(true)
  })

  it('save 空卷抛输入错误（前端不能绕过闸门存一张空卷）', async () => {
    const { service } = makeService({ questions: [] })
    await expect(
      service.save({
        teacherId: TEACHER,
        teachingUnitIds: [UNIT_A],
        questionIds: ['q-nope']
      })
    ).rejects.toThrow(/卷面为空/)
  })

  it('发布（publish）把布置动作整体转交 assign 端口，不自造 Attempt', async () => {
    const questions = [formalQuestion('q1', { kpIds: ['kp-A1'] })]
    const { service } = makeService({ questions })
    const result = await service.save({
      teacherId: TEACHER,
      teachingUnitIds: [UNIT_A],
      questionIds: ['q1'],
      studentIds: [STUDENT],
      publish: true
    })
    expect(result.plan.status).toBe('assigned')
    expect(result.assignment?.paperId).toBe(result.plan.paperId)
    expect(result.assignment?.mode).toBe('assessment')
    expect(result.assignment?.studentIds).toContain(STUDENT)
  })

  it('跨学科发布把每道题映射到其教学单元', async () => {
    const questions = [
      formalQuestion('q-math', { kpIds: ['kp-A1'], subject: 'math' }),
      formalQuestion('q-physics', { kpIds: ['kp-B1'], subject: 'physics' })
    ]
    const { service, assignedInputs } = makeService({ questions })

    await service.save({
      teacherId: TEACHER,
      teachingUnitIds: [UNIT_A, UNIT_B],
      questionIds: ['q-math', 'q-physics'],
      studentIds: [STUDENT],
      publish: true
    })

    expect(assignedInputs[0]?.questionTeachingUnitIds).toEqual({
      'q-math': UNIT_A,
      'q-physics': UNIT_B
    })
  })

  it('发布前先持久化带稳定 paperId 的发布意图', async () => {
    const questions = [formalQuestion('q1', { kpIds: ['kp-A1'] })]
    const { service, plans } = makeService({ questions })
    const save = vi.spyOn(plans, 'save')

    const result = await service.save({
      teacherId: TEACHER,
      teachingUnitIds: [UNIT_A],
      questionIds: ['q1'],
      studentIds: [STUDENT],
      publish: true
    })

    expect(save.mock.calls[0]?.[0]).toMatchObject({
      status: 'draft',
      paperId: result.assignment?.paperId
    })
    expect(save.mock.calls.at(-1)?.[0]).toMatchObject({
      status: 'assigned',
      paperId: result.assignment?.paperId
    })
  })

  it('重复发布复用 paperId，且不会把已发布计划降回草稿', async () => {
    const questions = [formalQuestion('q1', { kpIds: ['kp-A1'] })]
    const { service, plans } = makeService({ questions })
    const input = {
      teacherId: TEACHER,
      teachingUnitIds: [UNIT_A],
      questionIds: ['q1'],
      planId: 'mock-retry-plan',
      studentIds: [STUDENT],
      publish: true
    }
    const first = await service.save(input)
    const save = vi.spyOn(plans, 'save')

    const second = await service.save(input)

    expect(second.assignment?.paperId).toBe(first.assignment?.paperId)
    expect(save.mock.calls.every(([plan]) => plan.status === 'assigned')).toBe(true)
  })

  it('report 是对已存在 Attempt 的只读投影，不重新判分', async () => {
    const attempts: Attempt[] = [
      {
        id: 'attempt-1',
        studentId: STUDENT,
        questionId: 'q1',
        teachingUnitId: UNIT_A,
        termId: TERM_ID,
        mode: 'assessment',
        createdAt: '2026-08-05T08:00:00.000Z',
        paperId: 'paper-mock-1',
        result: {
          id: 'ev-1',
          assignmentId: 'paper-mock-1',
          attempt: 1,
          createdAt: '2026-08-05T08:00:00.000Z',
          status: 'completed',
          score: 80,
          summary: '',
          evidence: [
            {
              id: 'e-1',
              kind: 'answer_match',
              label: '答案核对',
              dimensionId: 'd1',
              visibility: 'public',
              state: 'passed',
              weight: 1,
              message: '正确',
              source: 'authored_key'
            }
          ],
          dimensions: [
            { id: 'd1', label: '正确性', description: '答案与标准一致', maxScore: 100, earnedScore: 80, state: 'passed', evidenceIds: [] }
          ],
          diagnoses: [],
          trace: [],
          mastery: [],
          feedbackSource: 'local-policy',
          provenance: { kind: 'evidence', evidenceIds: ['e-1'], algorithm: 'simple.v1' }
        }
      }
    ]
    const questions = [formalQuestion('q1', { kpIds: ['kp-A1'] })]
    const { service } = makeService({ questions, attempts })
    const report = await service.report('paper-mock-1', STUDENT)
    expect(report.mode).toBe('assessment')
    expect(report.questionCount).toBe(1)
    expect(report.answeredCount).toBe(1)
    expect(report.algorithm).toBe('mockexam.report.v1')
  })
})

// ---------------------------------------------------------------------------
// 4. HTTP 端点
// ---------------------------------------------------------------------------

describe('模拟考 HTTP 端点 (T16)', () => {
  it('学生可读取自己已布置的真实模拟考列表', async () => {
    const questions = [formalQuestion('q1', { kpIds: ['kp-A1'] })]
    const { service } = makeService({ questions })
    await service.save({
      teacherId: TEACHER,
      teachingUnitIds: [UNIT_A],
      questionIds: ['q1'],
      studentIds: [STUDENT],
      publish: true
    })
    const server = await startServer(service, {
      userId: STUDENT,
      role: 'student',
      displayName: 'S',
      studentId: STUDENT
    })

    const response = await fetch(`${server.url}/api/student/mock-exams`)
    const body = (await response.json()) as { plans: MockExamPlan[] }

    expect(response.status).toBe(200)
    expect(body.plans).toHaveLength(1)
    expect(body.plans[0]?.paperId).toBeDefined()
  })

  it('POST suggest 返回 200 + 契约形状', async () => {
    const questions = [
      formalQuestion('q1', { kpIds: ['kp-A1'] }),
      formalQuestion('q2', { kpIds: ['kp-A2'] })
    ]
    const { service } = makeService({ questions })
    const server = await startServer(service, teacherUser())

    const response = await fetch(`${server.url}/api/teacher/mock-exams/suggest`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ teachingUnitIds: [UNIT_A], count: 2 })
    })
    const body = (await response.json()) as {
      plan: MockExamPlan
      gateNotice: string
      sections: unknown[]
      warnings: unknown[]
    }
    expect(response.status).toBe(200)
    expect(body.plan.questionIds).toHaveLength(2)
    expect(body.gateNotice).toContain('草稿题')
    expect(Array.isArray(body.sections)).toBe(true)
  })

  it('POST suggest 无教学单元 → 400', async () => {
    const { service } = makeService()
    const server = await startServer(service, teacherUser())
    const response = await fetch(`${server.url}/api/teacher/mock-exams/suggest`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ teachingUnitIds: [] })
    })
    expect(response.status).toBe(400)
  })

  it('学生身份访问教师端点 → 403', async () => {
    const { service } = makeService()
    const server = await startServer(service, {
      userId: STUDENT,
      role: 'student',
      displayName: 'S',
      studentId: STUDENT
    })
    const response = await fetch(`${server.url}/api/teacher/mock-exams/suggest`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ teachingUnitIds: [UNIT_A] })
    })
    expect(response.status).toBe(403)
  })

  it('GET 学生报告：学生只能看自己的（他人 → 403）', async () => {
    const attempts: Attempt[] = [
      {
        id: 'attempt-1',
        studentId: STUDENT,
        questionId: 'q1',
        teachingUnitId: UNIT_A,
        termId: TERM_ID,
        mode: 'assessment',
        createdAt: '2026-08-05T08:00:00.000Z',
        paperId: 'paper-mock-1',
        result: {
          id: 'ev-1',
          assignmentId: 'paper-mock-1',
          attempt: 1,
          createdAt: '2026-08-05T08:00:00.000Z',
          status: 'completed',
          score: 100,
          summary: '',
          evidence: [
            {
              id: 'e-1',
              kind: 'answer_match',
              label: '答案核对',
              dimensionId: 'd1',
              visibility: 'public',
              state: 'passed',
              weight: 1,
              message: '正确',
              source: 'authored_key'
            }
          ],
          dimensions: [
            { id: 'd1', label: '正确性', description: '答案与标准一致', maxScore: 100, earnedScore: 100, state: 'passed', evidenceIds: [] }
          ],
          diagnoses: [],
          trace: [],
          mastery: [],
          feedbackSource: 'local-policy',
          provenance: { kind: 'evidence', evidenceIds: ['e-1'], algorithm: 'simple.v1' }
        }
      }
    ]
    const questions = [formalQuestion('q1', { kpIds: ['kp-A1'] })]
    const { service } = makeService({ questions, attempts })
    const studentUser: SessionUser = {
      userId: STUDENT,
      role: 'student',
      displayName: 'S',
      studentId: STUDENT
    }
    const server = await startServer(service, studentUser)

    const own = await fetch(`${server.url}/api/student/papers/paper-mock-1/report`)
    expect(own.status).toBe(200)
    const ownBody = (await own.json()) as { report: { studentId: string } }
    expect(ownBody.report.studentId).toBe(STUDENT)

    const other = await fetch(
      `${server.url}/api/student/papers/paper-mock-1/report?studentId=someone-else`
    )
    expect(other.status).toBe(403)
  })

  it('默认题量与时长符合契约常量', () => {
    expect(DEFAULT_MOCK_EXAM_QUESTION_COUNT).toBe(10)
  })
})
