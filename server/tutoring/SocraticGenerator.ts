import { z } from 'zod'
import { buildTutoringContext } from '../questionbank/solution'
import {
  callOpenAICompatible,
  type LlmProviderConfig
} from './callOpenAICompatible'
import { buildSocraticTemplate, explainDisclaimer } from './templates'
import type {
  TutoringGenerator,
  TutoringGeneratorResult,
  TutoringInput
} from './types'
import type { TutoringTurn } from '../../shared/contracts'

const socraticSchema = z.object({
  content: z.string().min(12).max(500)
})

/** Consecutive low-effort solicitations before refusing more hints (Khanmigo). */
export const HELP_ABUSE_THRESHOLD = 3

/**
 * Layer C — Socratic hints (T05 / TR2 / Khanmigo Lite).
 *
 * Hard rules baked into prompt + local counters:
 *   1. Never give the answer on the original problem.
 *   2. One question / one step per turn.
 *   3. After ≥3 consecutive low-effort hint requests → refuse and re-ask effort.
 *   4. Teach method via isomorphic examples only.
 * Standard solution (if present) stays in system context for self-check only.
 */
export class SocraticGenerator implements TutoringGenerator {
  public readonly layer = 'socratic' as const

  public constructor(private readonly llm: LlmProviderConfig | null = null) {}

  public async generate(input: TutoringInput): Promise<TutoringGeneratorResult> {
    const message = input.message?.trim() ?? ''
    const history = trimHistory(input.history ?? [], 6)
    const streak = Math.max(
      input.lowEffortStreak ?? 0,
      countLowEffortStreak(history, message)
    )
    const tutoring = buildTutoringContext(input.solution)
    const disclaimer = explainDisclaimer(tutoring)
    const modelLabel = this.llm
      ? `${this.llm.provider}:${this.llm.model}`
      : 'tutoring-template.v1'

    if (!this.llm || streak >= HELP_ABUSE_THRESHOLD) {
      return {
        content: buildSocraticTemplate(
          input.context,
          message,
          streak,
          input.solution
        ),
        source: 'local-policy',
        model: streak >= HELP_ABUSE_THRESHOLD ? 'tutoring-template.v1' : modelLabel,
        disclaimer
      }
    }

    try {
      const messages = [
        { role: 'system' as const, content: SOCRATIC_SYSTEM },
        {
          role: 'user' as const,
          content: JSON.stringify({
            questionCard: buildQuestionCard(input),
            lowEffortStreak: streak,
            history,
            studentMessage: message
          })
        }
      ]
      const parsed = await callOpenAICompatible(messages, socraticSchema, {
        apiKey: this.llm.apiKey,
        baseUrl: this.llm.baseUrl,
        model: this.llm.model,
        temperature: 0.3,
        maxTokens: 350
      })
      return {
        content: parsed.content,
        source: 'llm',
        model: modelLabel,
        sourceMessages: [parsed.content],
        disclaimer
      }
    } catch {
      return {
        content: buildSocraticTemplate(
          input.context,
          message,
          streak,
          input.solution
        ),
        source: 'local-policy',
        model: 'tutoring-template.v1',
        disclaimer
      }
    }
  }
}

const SOCRATIC_SYSTEM = [
  '你是苏格拉底式辅导老师（Khanmigo 风格）。',
  '铁律：永远不给学生原题的最终答案；每次只问一个问题或给一级提示。',
  '先定位学生卡在哪一步，再引导下一步。',
  '防套答案：若学生连续 3 次以上低努力索取提示（只说“提示/答案/不会”且无实质尝试），停止放提示，坚决要求学生先说明卡点与已尝试内容。',
  '教方法时只用同构例题演示，绝不在学生原题上写出完整解法。',
  '声明式事实卡住时，可给选项列表让学生选择，仍不直接揭示原题答案。',
  '不得修改分数、不得捏造证据外事实。标准解析仅供你自检，不要整段输出给学生。',
  '中文、极简。只输出 JSON：{"content":"..."}。'
].join('')

function buildQuestionCard(input: TutoringInput): Record<string, unknown> {
  const { context, solution } = input
  return {
    title: context.assignment.title,
    objective: context.assignment.objective,
    questionType: context.assignment.questionType,
    score: context.score,
    evidence: context.evidence.map(({ label, state, message }) => ({
      label,
      state,
      message
    })),
    diagnoses: context.diagnoses.map(({ title, explanation }) => ({
      title,
      explanation
    })),
    // Solution for self-check only — prompt forbids dumping it.
    standardSolutionKeyPoints: solution?.keyPoints ?? null,
    hasAuthoredSolution: solution !== undefined
  }
}

/** Keep the last N turns (4–6 window). */
export function trimHistory(
  history: TutoringTurn[],
  window = 6
): TutoringTurn[] {
  if (history.length <= window) return history
  return history.slice(history.length - window)
}

/**
 * Count trailing low-effort user turns (incl. the current message).
 * Low effort ≈ short "hint/answer/idk" without substantive content.
 */
export function countLowEffortStreak(
  history: TutoringTurn[],
  currentMessage: string
): number {
  let streak = 0
  if (isLowEffort(currentMessage)) streak += 1
  else return 0

  for (let i = history.length - 1; i >= 0; i -= 1) {
    const turn = history[i]
    if (!turn || turn.role !== 'user') continue
    if (isLowEffort(turn.content)) streak += 1
    else break
  }
  return streak
}

function isLowEffort(text: string): boolean {
  const t = text.trim().toLowerCase()
  if (t.length === 0) return true
  if (t.length > 40) return false
  const exact = new Set([
    '提示',
    'hint',
    '答案',
    '不会',
    '不知道',
    '帮我',
    '下一步',
    '下一个',
    'no',
    'idk'
  ])
  if (exact.has(t)) return true
  return (
    t.startsWith('再提示') ||
    t.startsWith('告诉我') ||
    t.startsWith('直接给') ||
    t.startsWith('答案')
  )
}
