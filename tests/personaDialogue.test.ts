// @vitest-environment node

/**
 * T21 人物对话探究 —— 契约 + HTTP 集成 + 架构守卫。
 *
 * 守护的铁律（ADR-0001 / ADR-0006 / D1 / PRD 验收）：
 *   1. 只开放 practice 模式：assessment 一律拒绝，且不产生任何会话/轮次；
 *   2. 每次角色回复都带 llm_inference provenance（含模板降级），
 *      且绝不写 score / evidence —— 类型层无字段 + 存储层无列 + 服务无写句柄；
 *   3. 对话记录可审计：能追溯「哪次练习（studentId/sessionId）、哪个角色
 *      （personaId）、哪一轮（turn_index）」；
 *   4. 角色目录是**固定静态集**（PERSONA_CATALOG），目录外的 personaId 直接 404；
 *   5. 无 LLM → 模板角色回复可演示（降级路径明确）；
 *   6. 轮次上限到达后拒绝继续，引导转论述题（suggestedNext: 'essay'）；
 *   7. 连续低努力索取标准答案 → 拒绝剧透（对齐 T05 苏格拉底）；
 *   8. 关闭对话不产生 Attempt；server/dialogue 的 import 图不指向评分/Attempt 存储。
 */
import { createServer } from 'node:http'
import type { Server } from 'node:http'
import { readFileSync, readdirSync } from 'node:fs'
import type { AddressInfo } from 'node:net'
import { join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import Database from 'better-sqlite3'
import type { SessionUser } from '../server/auth/SessionProvider'
import { applyProductMigrations } from '../server/db/migrate'
import {
  DIALOGUE_MAX_ROUNDS,
  PERSONA_CATALOG,
  type DialogueTurn,
  type DialogueTurnResult,
  type PersonaDialogueMessage
} from '../shared/personaDialogue'
import {
  DialogueRoundLimitError,
  DialogueStore,
  handleDialogueApi,
  LlmPersonaDialogueGenerator,
  PERSONA_TEMPLATE_MODEL,
  PersonaDialogueService,
  type PersonaDialogueDraft,
  type PersonaDialogueGenerator,
  type PersonaDialogueInput
} from '../server/dialogue'

const projectRoot = resolve(fileURLToPath(new URL('..', import.meta.url)))
const STUDENT = 'student-t21'
const NOW = '2026-08-07T09:00:00.000Z'
const FIXED_NOW = () => new Date(NOW)

// ---------------------------------------------------------------------------
// 夹具
// ---------------------------------------------------------------------------

/** 模拟实时 LLM 的生成器（source: 'llm'）。 */
class FakeLlmGenerator implements PersonaDialogueGenerator {
  public readonly model = 'fake-llm.v1'

  public reply(input: PersonaDialogueInput): Promise<PersonaDialogueDraft> {
    return Promise.resolve({
      content: `（${input.persona.name}）据史料，你的问题是：${input.message.slice(0, 30)}`,
      source: 'llm',
      model: this.model,
      sourceMessages: ['fake-llm-source']
    })
  }
}

function makeService(overrides: {
  generator?: PersonaDialogueGenerator
  now?: () => Date
} = {}) {
  const db = new Database(':memory:')
  applyProductMigrations(db)
  const store = new DialogueStore({ database: db })
  const service = new PersonaDialogueService({
    store,
    generator: overrides.generator ?? new LlmPersonaDialogueGenerator(null),
    now: overrides.now ?? FIXED_NOW
  })
  return { db, store, service }
}

const DEMO_USER: SessionUser = {
  userId: STUDENT,
  role: 'student',
  displayName: 'Student T21',
  studentId: STUDENT
}

// ---------------------------------------------------------------------------
// 1. 静态角色目录（固定集）
// ---------------------------------------------------------------------------

describe('PERSONA_CATALOG is a fixed static set', () => {
  it('has 3–5 preset demo personas, each with source excerpts', () => {
    expect(PERSONA_CATALOG.length).toBeGreaterThanOrEqual(3)
    expect(PERSONA_CATALOG.length).toBeLessThanOrEqual(5)
    const ids = PERSONA_CATALOG.map((entry) => entry.id)
    expect(new Set(ids).size).toBe(ids.length)
    for (const entry of PERSONA_CATALOG) {
      expect(entry.sourceExcerpts.length).toBeGreaterThan(0)
      expect(entry.openingLine.length).toBeGreaterThan(0)
      expect(entry.disclaimer).toContain('不计入测评')
    }
  })

  it('rejects persona ids outside the fixed set (no LLM-invented personas)', () => {
    const { service } = makeService()
    expect(() =>
      service.open({
        personaId: 'some-llm-invented-persona',
        mode: 'practice',
        studentId: STUDENT
      })
    ).toThrow(/Persona not found/)
  })
})

// ---------------------------------------------------------------------------
// 2. practice-only（D1：assessment 关闭辅导）
// ---------------------------------------------------------------------------

describe('practice-only gate (D1)', () => {
  it('assessment mode is rejected and creates no session', () => {
    const { service, db } = makeService()
    expect(() =>
      service.open({ personaId: 'quyuan', mode: 'assessment', studentId: STUDENT })
    ).toThrow(/practice mode/)
    const count = db
      .prepare('SELECT COUNT(*) AS c FROM dialogue_sessions')
      .get() as { c: number }
    expect(count.c).toBe(0)
  })
})

// ---------------------------------------------------------------------------
// 3. provenance 恒 llm_inference + 不改分（类型/存储双闸）
// ---------------------------------------------------------------------------

describe('every reply is llm_inference and never touches score', () => {
  it('stamps provenance and exposes no score/evidence on replies', async () => {
    const { service } = makeService({ generator: new FakeLlmGenerator() })
    const opened = service.open({
      personaId: 'wanganshi',
      mode: 'practice',
      studentId: STUDENT,
      kpId: 'kp.history.song'
    })
    const result = await service.turn({
      sessionId: opened.session.id,
      studentId: STUDENT,
      message: '王安石变法包括哪些内容？'
    })

    const message: PersonaDialogueMessage = result.message
    expect(message.role).toBe('assistant')
    expect(message.provenance.kind).toBe('llm_inference')
    expect(message.provenance.model).toBe('fake-llm.v1')
    expect(message.source).toBe('llm')
    // 类型层：回复与轮次都没有 score / evidence / weight 字段。
    expect(message).not.toHaveProperty('score')
    expect(message).not.toHaveProperty('evidence')
    expect(message).not.toHaveProperty('weight')
    type ForbiddenTurnKeys = Extract<keyof DialogueTurn, 'score' | 'evidence' | 'weight'>
    const noScoreChannel: ForbiddenTurnKeys extends never ? true : false = true
    expect(noScoreChannel).toBe(true)
  })

  it('storage schema has no score/evidence/weight columns on dialogue_turns', () => {
    const { db } = makeService()
    const columns = db.prepare('PRAGMA table_info(dialogue_turns)').all() as Array<{
      name: string
    }>
    const names = columns.map((column) => column.name)
    expect(names).not.toContain('score')
    expect(names).not.toContain('evidence')
    expect(names).not.toContain('weight')
    // mode 列在存储层就禁止 assessment。
    const sessionColumns = db.prepare('PRAGMA table_info(dialogue_sessions)').all() as Array<{
      name: string
      dflt_value: string | null
    }>
    const modeCol = sessionColumns.find((column) => column.name === 'mode')
    expect(modeCol?.dflt_value).toContain('practice')
  })
})

// ---------------------------------------------------------------------------
// 4. 可审计：哪次练习 / 哪个角色 / 哪轮提问
// ---------------------------------------------------------------------------

describe('dialogue transcript is auditable', () => {
  it('persists session + per-turn rows with persona, turn index and provenance', async () => {
    const { service, db } = makeService()
    const opened = service.open({
      personaId: 'zhangqian',
      mode: 'practice',
      studentId: STUDENT,
      questionId: 'q-7'
    })
    await service.turn({ sessionId: opened.session.id, studentId: STUDENT, message: '丝绸之路通向哪里？' })

    const sessionRow = db
      .prepare('SELECT * FROM dialogue_sessions WHERE id = ?')
      .get(opened.session.id) as Record<string, unknown>
    expect(sessionRow.persona_id).toBe('zhangqian')
    expect(sessionRow.student_id).toBe(STUDENT)
    expect(sessionRow.question_id).toBe('q-7')
    expect(sessionRow.mode).toBe('practice')

    const turns = db
      .prepare('SELECT * FROM dialogue_turns WHERE session_id = ? ORDER BY turn_index ASC')
      .all(opened.session.id) as Array<Record<string, unknown>>
    expect(turns.length).toBe(3) // 开场白 + 用户轮 + 角色轮
    expect(turns[0]).toMatchObject({ turn_index: 0, role: 'assistant' })
    expect(turns[1]).toMatchObject({ role: 'user', content: '丝绸之路通向哪里？' })
    expect(turns[2]).toMatchObject({ role: 'assistant', source: 'local-policy' })
    const provenance = JSON.parse(turns[2]!.provenance_json as string) as { kind: string }
    expect(provenance.kind).toBe('llm_inference')
  })
})

// ---------------------------------------------------------------------------
// 5. 无 LLM 降级路径
// ---------------------------------------------------------------------------

describe('no-LLM degradation', () => {
  it('falls back to template persona replies with local-policy provenance', async () => {
    const { service } = makeService() // default = LlmPersonaDialogueGenerator(null)
    const opened = service.open({ personaId: 'xuxiake', mode: 'practice', studentId: STUDENT })
    const result = await service.turn({
      sessionId: opened.session.id,
      studentId: STUDENT,
      message: '喀斯特地貌是什么？'
    })
    expect(result.message.source).toBe('local-policy')
    expect(result.message.model).toBe(PERSONA_TEMPLATE_MODEL)
    expect(result.message.provenance.kind).toBe('llm_inference')
    expect(result.message.content.length).toBeGreaterThan(5)
    expect(result.message.content).toContain('徐霞客')
  })

  it('opening line is a static catalog line (local-policy), still provenance-tagged', () => {
    const { service } = makeService()
    const opened = service.open({ personaId: 'kongzi', mode: 'practice', studentId: STUDENT })
    expect(opened.session.turns[0]).toMatchObject({
      role: 'assistant',
      source: 'local-policy',
      turnIndex: 0
    })
    expect(opened.session.turns[0]?.provenance?.kind).toBe('llm_inference')
  })
})

// ---------------------------------------------------------------------------
// 6. 轮次上限 → 拒绝继续，引导转论述题
// ---------------------------------------------------------------------------

describe('round limit', () => {
  it('rejects further turns after DIALOGUE_MAX_ROUNDS and suggests the essay', async () => {
    const { service } = makeService()
    const opened = service.open({ personaId: 'kongzi', mode: 'practice', studentId: STUDENT })
    let result: DialogueTurnResult | undefined
    for (let round = 1; round <= DIALOGUE_MAX_ROUNDS; round += 1) {
      result = await service.turn({
        sessionId: opened.session.id,
        studentId: STUDENT,
        message: `第${String(round)}个问题`
      })
    }
    expect(result?.roundLimitReached).toBe(true)
    await expect(
      service.turn({ sessionId: opened.session.id, studentId: STUDENT, message: '还能问吗' })
    ).rejects.toThrow(DialogueRoundLimitError)
  })
})

// ---------------------------------------------------------------------------
// 7. 防套话（对齐 T05 苏格拉底）
// ---------------------------------------------------------------------------

describe('anti-spoiler', () => {
  it('refuses to spoil standard answers after consecutive low-effort requests', async () => {
    const { service } = makeService()
    const opened = service.open({ personaId: 'quyuan', mode: 'practice', studentId: STUDENT })
    let result: DialogueTurnResult | undefined
    for (const lowEffort of ['答案', '提示', '不会']) {
      result = await service.turn({
        sessionId: opened.session.id,
        studentId: STUDENT,
        message: lowEffort
      })
    }
    expect(result?.message.content).toMatch(/不能直接给你标准答案/)
    expect(result?.message.source).toBe('local-policy')
  })
})

// ---------------------------------------------------------------------------
// 8. 关闭 + 越权 + 未找到
// ---------------------------------------------------------------------------

describe('close and ownership', () => {
  it('closes a session without creating any Attempt and rejects further turns', async () => {
    const { service, db } = makeService()
    const attemptsBefore = (
      db.prepare('SELECT COUNT(*) AS c FROM attempts').get() as { c: number }
    ).c
    const evaluationsBefore = (
      db.prepare('SELECT COUNT(*) AS c FROM evaluations').get() as { c: number }
    ).c

    const opened = service.open({ personaId: 'zhangqian', mode: 'practice', studentId: STUDENT })
    await service.turn({ sessionId: opened.session.id, studentId: STUDENT, message: '丝绸之路通向哪里？' })
    const closed = service.close({ sessionId: opened.session.id, studentId: STUDENT })
    expect(closed.status).toBe('closed')

    // 关闭对话不产生 Attempt / Evaluation（除非用户另开测评题）。
    const attemptsAfter = (
      db.prepare('SELECT COUNT(*) AS c FROM attempts').get() as { c: number }
    ).c
    const evaluationsAfter = (
      db.prepare('SELECT COUNT(*) AS c FROM evaluations').get() as { c: number }
    ).c
    expect(attemptsAfter).toBe(attemptsBefore)
    expect(evaluationsAfter).toBe(evaluationsBefore)

    await expect(
      service.turn({ sessionId: opened.session.id, studentId: STUDENT, message: '还开着吗' })
    ).rejects.toThrow(/closed/)
  })

  it('forbids another student from reading or writing the session', async () => {
    const { service } = makeService()
    const opened = service.open({ personaId: 'wanganshi', mode: 'practice', studentId: STUDENT })
    await expect(
      service.turn({ sessionId: opened.session.id, studentId: 'student-other', message: 'hi' })
    ).rejects.toThrow(/Forbidden/)
    expect(() =>
      service.close({ sessionId: opened.session.id, studentId: 'student-other' })
    ).toThrow(/Forbidden/)
  })

  it('returns 404 for unknown sessions', async () => {
    const { service } = makeService()
    await expect(
      service.turn({ sessionId: 'missing', studentId: STUDENT, message: 'hi' })
    ).rejects.toThrow(/not found/)
  })
})

// ---------------------------------------------------------------------------
// 9. HTTP 集成（与 tutoring.test.ts 同款挂载方式）
// ---------------------------------------------------------------------------

describe('HTTP /api/personas + /api/practice/dialogue', () => {
  let service: PersonaDialogueService
  let server: Server
  let baseUrl: string
  let closeServer: () => Promise<void>

  beforeEach(async () => {
    const built = makeService({ generator: new FakeLlmGenerator() })
    service = built.service

    server = createServer((request, response) => {
      void (async () => {
        const url = new URL(
          request.url ?? '/',
          `http://${request.headers.host ?? 'localhost'}`
        )
        const handled = await handleDialogueApi(request, response, url, {
          dialogue: service,
          user: DEMO_USER
        })
        if (!handled) {
          response.writeHead(404)
          response.end('not dialogue')
        }
      })()
    })
    await new Promise<void>((resolvePromise) => {
      server.listen(0, '127.0.0.1', () => resolvePromise())
    })
    const address = server.address() as AddressInfo
    baseUrl = `http://127.0.0.1:${String(address.port)}`
    closeServer = () =>
      new Promise((resolvePromise, reject) => {
        server.close((error) => (error ? reject(error) : resolvePromise()))
      })
  })

  afterEach(async () => {
    await closeServer()
  })

  it('GET /api/personas returns the fixed catalog with practice notice', async () => {
    const response = await fetch(`${baseUrl}/api/personas`)
    expect(response.status).toBe(200)
    const body = (await response.json()) as { personas: Array<{ id: string }>; notice: string }
    expect(body.personas.length).toBeGreaterThanOrEqual(3)
    expect(body.notice).toBe('练习探究 · 不计入测评')
  })

  it('POST /api/practice/dialogue rejects assessment mode with 403 and creates nothing', async () => {
    const response = await fetch(`${baseUrl}/api/practice/dialogue`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ personaId: 'quyuan', mode: 'assessment' })
    })
    expect(response.status).toBe(403)
    const body = (await response.json()) as { error: string }
    expect(body.error).toMatch(/practice mode/)
    const count = service.listPersonas().length // sanity: service still healthy
    expect(count).toBeGreaterThan(0)
  })

  it('open → turn → close full flow returns provenance and essay guidance', async () => {
    const open = await fetch(`${baseUrl}/api/practice/dialogue`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ personaId: 'xuxiake', mode: 'practice', kpId: 'kp.geo' })
    })
    expect(open.status).toBe(201)
    const opened = (await open.json()) as {
      session: { id: string; turns: unknown[] }
      persona: { name: string }
      notice: string
    }
    expect(opened.session.turns.length).toBe(1)
    expect(opened.notice).toBe('练习探究 · 不计入测评')

    const turn = await fetch(`${baseUrl}/api/practice/dialogue/${opened.session.id}/turn`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ message: '游记最出名的是哪部分？' })
    })
    expect(turn.status).toBe(200)
    const turned = (await turn.json()) as {
      message: { provenance: { kind: string }; content: string }
    }
    expect(turned.message.provenance.kind).toBe('llm_inference')
    expect(turned.message.content.length).toBeGreaterThan(5)

    const close = await fetch(`${baseUrl}/api/practice/dialogue/${opened.session.id}/close`, {
      method: 'POST'
    })
    expect(close.status).toBe(200)
    const closed = (await close.json()) as { session: { status: string }; suggestedNext: string }
    expect(closed.session.status).toBe('closed')
    expect(closed.suggestedNext).toBe('essay')
  })

  it('returns 404 for a missing session on turn', async () => {
    const response = await fetch(`${baseUrl}/api/practice/dialogue/missing/turn`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ message: 'hello' })
    })
    expect(response.status).toBe(404)
  })
})

// ---------------------------------------------------------------------------
// 10. 架构守卫：server/dialogue 与评分/Attempt 存储物理隔离
// ---------------------------------------------------------------------------

describe('architecture guard: server/dialogue is isolated from the scoring loop', () => {
  const DIALOGUE_DIR = resolve(projectRoot, 'server/dialogue')
  const FORBIDDEN = [
    /(^|\/)domain\/EvaluationAgent/,
    /(^|\/)mastery(\/|$)/,
    /(^|\/)review(\/|$)/,
    /(^|\/)runner(\/|$)/,
    /AttemptStore/
  ]

  function extractImportSpecifiers(source: string): string[] {
    const specifiers: string[] = []
    const patterns = [
      /import\s+[^'"]*from\s+['"]([^'"]+)['"]/g,
      /import\s+['"]([^'"]+)['"]/g,
      /export\s+[^'"]*from\s+['"]([^'"]+)['"]/g
    ]
    for (const pattern of patterns) {
      let match: RegExpExecArray | null
      while ((match = pattern.exec(source)) !== null) {
        if (match[1]) specifiers.push(match[1])
      }
    }
    return specifiers
  }

  it('never imports AttemptStore / mastery / review / runner paths', () => {
    const violations: string[] = []
    for (const entry of readdirSync(DIALOGUE_DIR)) {
      if (!/\.ts$/.test(entry)) continue
      const source = readFileSync(join(DIALOGUE_DIR, entry), 'utf8')
      for (const specifier of extractImportSpecifiers(source)) {
        if (FORBIDDEN.some((pattern) => pattern.test(specifier))) {
          violations.push(`${entry} -> import '${specifier}'`)
        }
      }
    }
    expect(
      violations,
      violations.length === 0
        ? ''
        : [
            'T21 违规：server/dialogue 必须与打分路径物理隔离，',
            '不得 import AttemptStore / mastery / review / runner / EvaluationAgent。',
            '对话只读静态目录 + 写自有表，永不回写 score/evidence（ADR-0001）。违规：',
            violations.join('\n')
          ].join('\n')
    ).toEqual([])
  })

  it('DialogueTurn interface has no score/evidence/weight field declarations', () => {
    const source = readFileSync(
      resolve(projectRoot, 'shared/personaDialogue.ts'),
      'utf8'
    )
    const start = source.indexOf('export interface DialogueTurn')
    const end = source.indexOf('export interface DialogueSessionView', start)
    const block = source.slice(start, end === -1 ? start + 900 : end)
    expect(block).toMatch(/llm_inference/)
    expect(block).not.toMatch(/^\s*(readonly\s+)?score\s*[?:]/m)
    expect(block).not.toMatch(/^\s*(readonly\s+)?evidence\s*[?:]/m)
    expect(block).not.toMatch(/^\s*(readonly\s+)?weight\s*[?:]/m)
  })

  it('migration 0017 forbids assessment sessions at the schema level', () => {
    const source = readFileSync(
      resolve(projectRoot, 'server/db/migrations/0017_persona_dialogue.sql'),
      'utf8'
    )
    expect(source).toMatch(/CHECK\s*\(mode = 'practice'\)/)
  })
})
