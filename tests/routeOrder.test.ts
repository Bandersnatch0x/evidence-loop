// @vitest-environment node

/**
 * 路由委托顺序守护（Effort 2 接线回归锁）。
 *
 * server/index.ts 的 handleApi 里，既有 `handleStudentApi` / `handleTeacherApi`
 * 会对 `/api/student/*`、`/api/teacher/*` **前缀全量消费**（未知子路径也返回
 * 404 + true，吞掉请求）。T15–T23 的多个端点恰恰挂在 `/api/student/*` 和
 * `/api/teacher/*` 下（study-plan / achievements / reports/weekly /
 * material-import / mock-exams / flashcard-drafts / portfolio/export…），
 * 因此 Effort 2 委托块**必须**位于 handleStudentApi / handleTeacherApi 之前，
 * 否则新路由永远轮不到（返回 "Student/Teacher route not found"）。
 *
 * 本测试以源码行号为锚，防止未来重构把块移回去。这是可执行断言，
 * 比一次性冒烟更有长期价值。
 */
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'

const indexSource = readFileSync(
  resolve(__dirname, '../server/index.ts'),
  'utf8'
)

/** 找到 `xxx(` 出现在顶层委托位置的第一个行号（1 基）。 */
function firstCallLine(token: string): number {
  const lines = indexSource.split('\n')
  const index = lines.findIndex((line) =>
    line.includes(`await ${token}(`) || line.includes(`${token}(request`)
  )
  if (index === -1) {
    throw new Error(`委托调用 ${token}( 未在 server/index.ts 中找到`)
  }
  return index + 1
}

describe('architecture guard: Effort 2 routes precede student/teacher prefix consumers', () => {
  const effort2Tokens = [
    'tryHandleMaterialImportRoute', // T15 /api/teacher/material-import
    'handleMockExamApi', // T16 /api/teacher/mock-exams, /api/student/papers
    'handleStudyPlanApi', // T18 /api/student/study-plan, /api/teacher/...
    'handleWeeklyReportApi', // T19 /api/student/reports, /api/teacher/reports
    'handleAchievementApi', // T20 /api/student/achievements, /api/teacher/...
    'handleDialogueApi', // T21 /api/personas, /api/practice/dialogue
    'tryHandleFlashcardDraftRoute', // T22 /api/teacher/flashcard-drafts
    'handlePortfolioApi' // T23 /api/student/portfolio, /api/teacher/portfolio
  ]

  const prefixConsumers = ['handleStudentApi', 'handleTeacherApi']

  it('每个 Effort 2 委托块都位于 handleStudentApi / handleTeacherApi 之前', () => {
    const consumers = prefixConsumers.map((token) => ({
      token,
      line: firstCallLine(token)
    }))
    const violations: string[] = []
    for (const token of effort2Tokens) {
      const line = firstCallLine(token)
      for (const consumer of consumers) {
        if (line > consumer.line) {
          violations.push(
            `${token}（第 ${line} 行）晚于 ${consumer.token}（第 ${consumer.line} 行）——` +
              '会被前缀路由吞掉，永远轮不到。'
          )
        }
      }
    }
    expect(
      violations,
      violations.length === 0
        ? ''
        : ['路由委托顺序违规：', ...violations].join('\n')
    ).toEqual([])
  })

  it('handleTransparencyApi 也先于前缀消费者（/api/transparency 不冲突但保持一致）', () => {
    const transparencyLine = firstCallLine('handleTransparencyApi')
    for (const token of prefixConsumers) {
      expect(
        transparencyLine,
        `handleTransparencyApi 应早于 ${token}`
      ).toBeLessThan(firstCallLine(token))
    }
  })

  it('Effort 2 委托块整体位于既有委托段（T02-T08）之前', () => {
    const questionBankLine = firstCallLine('handleQuestionBankApi')
    for (const token of effort2Tokens) {
      expect(
        firstCallLine(token),
        `${token} 应早于 handleQuestionBankApi`
      ).toBeLessThan(questionBankLine)
    }
  })
})
