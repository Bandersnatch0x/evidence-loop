// @vitest-environment node

/**
 * T19 学情周报。
 *
 * 断言的四件事（ADR-0001 / ADR-0006 / PRD 验收）：
 *   1. 报告里**每一个数字**都必须挂非空 evidenceRefs —— 没有硬输入就不产出
 *      数字（findUnbackedMetrics / findUnbackedItems 是两条可执行断言）；
 *   2. 无数据的章节是诚实的 `insufficient_evidence` 空态，绝不编数、绝不
 *      用 LLM 兜底；
 *   3. 练习（practice）不入正式得分（D1），只进「练习活动量」章节；
 *   4. narrative 只能外挂文案、逐字节不动数字；非 llm_inference 一律拒绝。
 */
import { createServer } from 'node:http'
import type { AddressInfo } from 'node:net'
import { afterEach, describe, expect, it } from 'vitest'
import Database from 'better-sqlite3'
import type {
  Attempt,
  MasteryProfileMap,
  MistakeBookView,
  TeacherTip,
  TeachingUnit
} from '../shared/contracts'
import type { StudyPlan } from '../shared/studyPlan'
import {
  findUnbackedItems,
  findUnbackedMetrics,
  findWeeklyReportMetric,
  findWeeklyReportSection,
  WEEKLY_REPORT_SECTION_ORDER,
  type WeeklyReport,
  type WeeklyReportAttemptFact,
  type WeeklyReportHardFacts,
  type WeeklyReportMasteryFact,
  type WeeklyReportSectionId,
  type WeeklyReportWindow
} from '../shared/weeklyReport'
import {
  attachReportNarrative,
  buildWeeklyReport,
  WeeklyReportService,
  type WeeklyReportNarrator,
  type WeeklyReportRouteContext,
  WeeklyReportUnitMissingError,
  WeeklyReportWindowError,
  handleWeeklyReportApi
} from '../server/reports'
import type { SessionUser } from '../server/auth/SessionProvider'

const TEACHER = 'teacher-weekly-alpha'
const STUDENT = 'student-weekly-1'
const UNIT = 'tu-weekly'
const TERM = 'term-2026-fall'
const CLASS = 'class-weekly'
const NOW_ISO = '2026-08-07T09:00:00.000Z'
const WINDOW: WeeklyReportWindow = {
  from: '2026-07-31T00:00:00.000Z',
  to: '2026-08-07T00:00:00.000Z'
}

// ---------------------------------------------------------------------------
// fixtures
// ---------------------------------------------------------------------------

function sampleUnit(overrides: Partial<TeachingUnit> = {}): TeachingUnit {
  return {
    id: UNIT,
    teacherId: TEACHER,
    classId: CLASS,
    subjectId: 'subject-math',
    termId: TERM,
    taughtKpIds: ['kp-A', 'kp-B'],
    ...overrides
  }
}

function attempt(
  id: string,
  overrides: Partial<Attempt> = {}
): Attempt {
  return {
    id,
    studentId: STUDENT,
    questionId: 'q1',
    teachingUnitId: UNIT,
    termId: TERM,
    mode: 'assessment',
    createdAt: '2026-08-03T08:00:00.000Z',
    result: {
      id: `ev-${id}`,
      assignmentId: 'paper-1',
      attempt: 1,
      createdAt: '2026-08-03T08:00:00.000Z',
      status: 'completed',
      score: 80,
      summary: '',
      evidence: [
        {
          id: `e-${id}`,
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
      trace: [
        { id: 't1', label: '判题', tool: 'runner', status: 'completed', summary: '', durationMs: 1_500 }
      ],
      mastery: [],
      feedbackSource: 'local-policy',
      provenance: {
        kind: 'evidence',
        evidenceIds: [`e-${id}`],
        algorithm: 'simple.v1'
      }
    },
    ...overrides
  }
}

/** 纯函数内核的扁平提交事实（区别于 Service 层的 Attempt 聚合根）。 */
function fact(
  id: string,
  overrides: Partial<WeeklyReportAttemptFact> = {}
): WeeklyReportAttemptFact {
  return {
    attemptId: id,
    evaluationId: `ev-${id}`,
    questionId: 'q1',
    mode: 'assessment',
    createdAt: '2026-08-03T08:00:00.000Z',
    score: 80,
    status: 'completed',
    durationMs: 1_500,
    ...overrides
  }
}

function emptyFacts(overrides: Partial<WeeklyReportHardFacts> = {}): WeeklyReportHardFacts {
  return {
    studentId: STUDENT,
    displayName: STUDENT,
    teachingUnitId: UNIT,
    termId: TERM,
    window: WINDOW,
    attempts: [],
    mastery: [],
    taughtKpIds: ['kp-A', 'kp-B'],
    mistakes: [],
    tips: [],
    masteryThreshold: 0.6,
    now: NOW_ISO,
    ...overrides
  }
}

function makeService(overrides: {
  attempts?: Attempt[]
  mastery?: WeeklyReportMasteryFact[]
  mistakes?: MistakeBookView
  tips?: TeacherTip[]
  plan?: {
    generate: (studentId: string, teachingUnitId: string) => Promise<StudyPlan>
  }
  aliases?: { getDisplayName: (studentId: string) => string | undefined }
  unit?: TeachingUnit
} = {}) {
  const service = new WeeklyReportService({
    attempts: {
      listAttempts: () => Promise.resolve(overrides.attempts ?? [])
    },
    mastery: {
      getProfile: () => {
        const profile: MasteryProfileMap = {}
        for (const fact of overrides.mastery ?? []) {
          profile[fact.kpId] = {
            score: fact.score,
            evidenceIds: [...fact.evidenceIds],
            computedAt: fact.computedAt,
            algorithmVersion: fact.algorithmVersion
          }
        }
        return profile
      }
    },
    mistakes: {
      view: () =>
        Promise.resolve(
          overrides.mistakes ?? { studentId: STUDENT, entries: [], activeCount: 0, masteredCount: 0 }
        )
    },
    tips: {
      listForStudent: () => overrides.tips ?? []
    },
    org: {
      getTeachingUnit: (id) => (overrides.unit ?? sampleUnit()).id === id ? overrides.unit ?? sampleUnit() : undefined,
      listEnrolledStudentIds: () => [STUDENT]
    },
    ...(overrides.plan ? { plan: overrides.plan } : {}),
    ...(overrides.aliases ? { aliases: overrides.aliases } : {}),
    now: () => new Date(NOW_ISO)
  })
  return { service }
}

function startServer(
  service: WeeklyReportService,
  user: SessionUser,
  options: {
    narrator?: WeeklyReportNarrator
  } = {}
): Promise<{ url: string; close: () => Promise<void> }> {
  const db = new Database(':memory:')
  db.exec(`CREATE TABLE IF NOT EXISTS users (
    id TEXT PRIMARY KEY,
    public_library_reviewer INTEGER NOT NULL DEFAULT 0
  );`)
  const server = createServer((request, response) => {
    const requestUrl = new URL(request.url ?? '/', 'http://127.0.0.1')
    const context: WeeklyReportRouteContext = {
      db,
      weeklyReport: service,
      org: {
        getTeachingUnit: (id: string) => (id === UNIT ? sampleUnit() : undefined),
        listEnrolledStudentIds: () => [STUDENT]
      },
      user,
      now: () => new Date(NOW_ISO),
      ...(options.narrator ? { narrator: options.narrator } : {})
    }
    void handleWeeklyReportApi(request, response, requestUrl, context).then(
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
// 1. 纯函数内核：数字可追溯 / 诚实空态 / 确定性
// ---------------------------------------------------------------------------

describe('buildWeeklyReport：硬事实 → 周报（纯函数）', () => {
  it('全空输入 → 全章节 insufficient_evidence，不产出任何数字', () => {
    const report = buildWeeklyReport(emptyFacts())
    expect(report.status).toBe('insufficient_evidence')
    expect(report.sections).toHaveLength(WEEKLY_REPORT_SECTION_ORDER.length)
    for (const section of report.sections) {
      expect(section.status).toBe('insufficient_evidence')
      expect(section.metrics).toHaveLength(0)
      expect(section.items).toHaveLength(0)
      expect(section.emptyStateText?.length ?? 0).toBeGreaterThan(0)
    }
    expect(report.evidenceRefs).toHaveLength(0)
    expect(findUnbackedMetrics(report)).toEqual([])
    expect(findUnbackedItems(report)).toEqual([])
  })

  it('每个数字都挂锚点：findUnbackedMetrics 恒为空', () => {
    const report = buildWeeklyReport(
      emptyFacts({ attempts: [fact('a1')] })
    )
    expect(findUnbackedMetrics(report)).toEqual([])
    const count = findWeeklyReportMetric(report, 'completion.attempts')
    expect(count?.value).toBe(1)
    expect(count?.evidenceRefs.length).toBeGreaterThan(0)
  })

  it('同一输入必得同一输出（确定性，可重放审计）', () => {
    const mastery: WeeklyReportMasteryFact[] = [
      {
        kpId: 'kp-A',
        score: 0.4,
        evidenceIds: ['e1'],
        computedAt: '2026-08-05T00:00:00.000Z',
        algorithmVersion: 'simple.v1'
      }
    ]
    const first = buildWeeklyReport(emptyFacts({ attempts: [fact('a2'), fact('a1')], mastery }))
    const second = buildWeeklyReport(emptyFacts({ attempts: [fact('a1'), fact('a2')], mastery }))
    expect(JSON.stringify(first)).toBe(JSON.stringify(second))
  })

  it('章节顺序固定等于 WEEKLY_REPORT_SECTION_ORDER', () => {
    const report = buildWeeklyReport(emptyFacts())
    expect(report.sections.map((s) => s.id)).toEqual([
      ...WEEKLY_REPORT_SECTION_ORDER
    ])
  })

  it('练习（practice）不进正式得分趋势，只进练习活动量章节（D1）', () => {
    const practice = fact('a-p1', { mode: 'practice' })
    const report = buildWeeklyReport(emptyFacts({ attempts: [practice] }))
    const trend = findWeeklyReportSection(report, 'assessment_trend')
    expect(trend?.status).toBe('insufficient_evidence')
    const activity = findWeeklyReportSection(report, 'practice_activity')
    expect(activity?.status).toBe('ok')
    expect(activity?.metrics[0]?.value).toBe(1)
  })

  it('缺掌握度快照 ≠ 0 分薄弱点：无快照时薄弱章节诚实空态', () => {
    const report = buildWeeklyReport(emptyFacts())
    const weak = findWeeklyReportSection(report, 'weak_kps')
    expect(weak?.status).toBe('insufficient_evidence')
    // 不产出「0 分」数字 —— 没有快照就不是薄弱，只是不知道。
    expect(findWeeklyReportMetric(report, 'weak.count')).toBeUndefined()
  })

  it('薄弱知识点章节只统计已教 KP（D4）且只列低于阈值者', () => {
    const mastery: WeeklyReportMasteryFact[] = [
      {
        kpId: 'kp-A',
        score: 0.3,
        evidenceIds: ['e1'],
        computedAt: '2026-08-05T00:00:00.000Z',
        algorithmVersion: 'simple.v1'
      },
      {
        kpId: 'kp-B',
        score: 0.9,
        evidenceIds: ['e2'],
        computedAt: '2026-08-05T00:00:00.000Z',
        algorithmVersion: 'simple.v1'
      },
      {
        kpId: 'kp-UNTAUGHT',
        score: 0.1,
        evidenceIds: ['e3'],
        computedAt: '2026-08-05T00:00:00.000Z',
        algorithmVersion: 'simple.v1'
      }
    ]
    const report = buildWeeklyReport(emptyFacts({ mastery }))
    const weak = findWeeklyReportSection(report, 'weak_kps')
    expect(weak?.status).toBe('ok')
    expect(weak?.items.map((item) => item.id)).toEqual(['weak.kp-A'])
    expect(weak?.items[0]?.layer).toBe('evidence')
    expect(weak?.items[0]?.evidenceRefs.length).toBeGreaterThan(0)
  })

  it('evidence 层列表项必须挂锚点；teacher_annotation 层必须自证 provenance', () => {
    const report = buildWeeklyReport(
      emptyFacts({
        mistakes: [
          {
            questionId: 'q-x',
            teachingUnitId: UNIT,
            attemptId: 'a1',
            kpIds: ['kp-A'],
            lastScore: 0.3,
            lastActiveAt: '2026-08-04T00:00:00.000Z',
            mastered: false
          }
        ],
        tips: [
          {
            tipId: 'tip-1',
            teachingUnitId: UNIT,
            teacherId: TEACHER,
            body: '多看一遍例题',
            createdAt: '2026-08-02T00:00:00.000Z',
            kpIds: ['kp-A']
          }
        ]
      })
    )
    expect(findUnbackedItems(report)).toEqual([])
    const tips = findWeeklyReportSection(report, 'teacher_tips')
    expect(tips?.items[0]?.layer).toBe('teacher_annotation')
    expect(tips?.items[0]?.provenance?.kind).toBe('teacher_annotation')
    const mistakes = findWeeklyReportSection(report, 'mistake_top')
    expect(mistakes?.items[0]?.layer).toBe('evidence')
  })

  it('报告不包含真实姓名 / 手机号 / 邮箱等 PII 字段', () => {
    const report = buildWeeklyReport(emptyFacts({ displayName: STUDENT }))
    const serialized = JSON.stringify(report)
    expect(serialized).not.toContain('13800138000')
    expect(serialized).not.toContain('real-name')
  })
})

// ---------------------------------------------------------------------------
// 2. 建议层闸门：narrative 只外挂、不改数字
// ---------------------------------------------------------------------------

describe('attachReportNarrative：AI 文案安全闸门 (T19)', () => {
  it('合格的 llm_inference 文案只外挂到章节，metrics 引用原样透传', () => {
    const base = buildWeeklyReport(emptyFacts({ attempts: [fact('a1')] }))
    const sectionBefore = findWeeklyReportSection(base, 'completion')
    const withNarrative = attachReportNarrative(base, 'completion', {
      text: '本周提交正常。',
      provenance: {
        kind: 'llm_inference',
        sourceMessages: ['m1'],
        model: 'local-advisor',
        extractedAt: NOW_ISO
      }
    })
    const sectionAfter = findWeeklyReportSection(withNarrative, 'completion')
    // 挂上了文案，但 metrics / items 是同一引用 —— 数字物理上不可被改写。
    expect(sectionAfter?.narrative?.text).toBe('本周提交正常。')
    expect(sectionAfter?.metrics).toBe(sectionBefore?.metrics)
    expect(sectionAfter?.items).toBe(sectionBefore?.items)
    expect(sectionAfter?.status).toBe(sectionBefore?.status)
  })

  it('非 llm_inference provenance 一律拒绝（原样返回）', () => {
    const base = buildWeeklyReport(emptyFacts())
    const rejected = attachReportNarrative(base, 'completion', {
      text: '假装是 AI 写的。',
      provenance: {
        kind: 'teacher_annotation',
        teacherId: TEACHER,
        note: 'x'
      }
    })
    expect(rejected).toBe(base)
  })

  it('空正文拒绝', () => {
    const base = buildWeeklyReport(emptyFacts())
    const rejected = attachReportNarrative(base, 'completion', {
      text: '   ',
      provenance: {
        kind: 'llm_inference',
        sourceMessages: ['m1'],
        model: 'm',
        extractedAt: NOW_ISO
      }
    })
    expect(rejected).toBe(base)
  })
})

// ---------------------------------------------------------------------------
// 3. Service：窗口 / 隐私 / 降级
// ---------------------------------------------------------------------------

describe('WeeklyReportService：编排 (T19)', () => {
  it('教学单元不存在 → 明确报错而非空报告', async () => {
    const { service } = makeService({ unit: sampleUnit({ id: 'other-unit' }) })
    await expect(service.generate(STUDENT, 'missing-unit')).rejects.toThrow(
      WeeklyReportUnitMissingError
    )
  })

  it('窗口非法（from >= to）→ WeeklyReportWindowError', async () => {
    const { service } = makeService()
    await expect(
      service.generate(STUDENT, UNIT, {
        from: '2026-08-07T00:00:00.000Z',
        to: '2026-08-01T00:00:00.000Z'
      })
    ).rejects.toThrow(WeeklyReportWindowError)
  })

  it('窗口超过 31 天被拒绝（周报就是周报）', async () => {
    const { service } = makeService()
    await expect(
      service.generate(STUDENT, UNIT, {
        from: '2026-01-01T00:00:00.000Z',
        to: '2026-08-07T00:00:00.000Z'
      })
    ).rejects.toThrow(/must not exceed/)
  })

  it('PII 别名退回 studentId（隐私安全展示名）', async () => {
    const { service } = makeService({
      aliases: { getDisplayName: () => '张三 13800138000' }
    })
    const report = await service.generate(STUDENT, UNIT)
    expect(report.displayName).toBe(STUDENT)
  })

  it('plan 端口缺失 → 下周建议章节降级，整份报告照常生成', async () => {
    const { service } = makeService({ attempts: [attempt('a1')] })
    const report = await service.generate(STUDENT, UNIT)
    expect(report.status).toBe('ok')
    const nextWeek = findWeeklyReportSection(report, 'next_week')
    expect(nextWeek?.status).toBe('insufficient_evidence')
    expect(findWeeklyReportMetric(report, 'completion.attempts')?.value).toBe(1)
  })

  it('plan 端口抛错 → 同样降级不 500', async () => {
    const { service } = makeService({
      plan: {
        generate: () => Promise.reject(new Error('plan unavailable'))
      }
    })
    const report = await service.generate(STUDENT, UNIT)
    expect(findWeeklyReportSection(report, 'next_week')?.status).toBe(
      'insufficient_evidence'
    )
  })
})

// ---------------------------------------------------------------------------
// 4. HTTP 端点
// ---------------------------------------------------------------------------

describe('周报 HTTP 端点 (T19)', () => {
  it('学生拉自己的周报 → 200 + 契约形状（sectionOrder / evidenceCount）', async () => {
    const { service } = makeService({ attempts: [attempt('a1')] })
    const server = await startServer(service, {
      userId: STUDENT,
      role: 'student',
      displayName: 'S',
      studentId: STUDENT
    })
    const response = await fetch(`${server.url}/api/student/reports/weekly?unitId=${UNIT}`)
    expect(response.status).toBe(200)
    const body = (await response.json()) as {
      report: WeeklyReport
      sectionOrder: WeeklyReportSectionId[]
      evidenceCount: number
    }
    expect(body.report.studentId).toBe(STUDENT)
    expect(body.sectionOrder).toEqual([...WEEKLY_REPORT_SECTION_ORDER])
    expect(body.evidenceCount).toBeGreaterThan(0)
  })

  it('教师拉学生周报（JSON）→ 200；HTML 端点返回 text/html', async () => {
    const { service } = makeService({ attempts: [attempt('a1')] })
    const server = await startServer(service, {
      userId: TEACHER,
      role: 'teacher',
      displayName: 'T'
    })
    const json = await fetch(
      `${server.url}/api/teacher/reports/weekly?studentId=${STUDENT}&unitId=${UNIT}`
    )
    expect(json.status).toBe(200)
    const html = await fetch(
      `${server.url}/api/teacher/reports/weekly.html?studentId=${STUDENT}&unitId=${UNIT}`
    )
    expect(html.status).toBe(200)
    expect(html.headers.get('content-type')).toContain('text/html')
  })

  it('学生不能拉别人的周报 → 403', async () => {
    const { service } = makeService()
    const server = await startServer(service, {
      userId: STUDENT,
      role: 'student',
      displayName: 'S',
      studentId: STUDENT
    })
    const response = await fetch(
      `${server.url}/api/student/reports/weekly?studentId=someone-else&unitId=${UNIT}`
    )
    expect(response.status).toBe(403)
  })
})
