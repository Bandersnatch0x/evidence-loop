import { z } from 'zod'
import { buildTutoringContext } from '../questionbank/solution'
import {
  callOpenAICompatible,
  type LlmProviderConfig
} from './callOpenAICompatible'
import { buildDialogueTemplate, explainDisclaimer } from './templates'
import { trimHistory } from './SocraticGenerator'
import type {
  TutoringGenerator,
  TutoringGeneratorResult,
  TutoringInput
} from './types'

const dialogueSchema = z.object({
  content: z.string().min(12).max(600)
})

/** Rolling window size for dialogue turns (TR2 §2.1: 4–6). */
export const DIALOGUE_WINDOW = 6

/**
 * Layer B — multi-turn Q&A (T05 / TR2).
 *
 * Context assembly is structured, not raw chat dump:
 *   stable question card prefix (title / evidence / optional solution)
 *   + last 4–6 turns
 *   + optional priorSummary for older turns
 */
export class DialogueGenerator implements TutoringGenerator {
  public readonly layer = 'dialogue' as const

  public constructor(private readonly llm: LlmProviderConfig | null = null) {}

  public async generate(input: TutoringInput): Promise<TutoringGeneratorResult> {
    const message = input.message?.trim() ?? ''
    const history = trimHistory(input.history ?? [], DIALOGUE_WINDOW)
    const tutoring = buildTutoringContext(input.solution)
    const disclaimer = explainDisclaimer(tutoring)
    const modelLabel = this.llm
      ? `${this.llm.provider}:${this.llm.model}`
      : 'tutoring-template.v1'

    if (!this.llm) {
      return {
        content: buildDialogueTemplate(input.context, message, input.solution),
        source: 'local-policy',
        model: modelLabel,
        disclaimer
      }
    }

    try {
      const parsed = await callOpenAICompatible(
        [
          { role: 'system', content: DIALOGUE_SYSTEM },
          {
            role: 'user',
            content: JSON.stringify({
              questionCard: {
                title: input.context.assignment.title,
                objective: input.context.assignment.objective,
                questionType: input.context.assignment.questionType,
                score: input.context.score,
                evidence: input.context.evidence.map(
                  ({ label, state, message: msg }) => ({
                    label,
                    state,
                    message: msg
                  })
                ),
                diagnoses: input.context.diagnoses.map(
                  ({ title, explanation }) => ({ title, explanation })
                ),
                standardSolution: input.solution
                  ? {
                      content: input.solution.content,
                      keyPoints: input.solution.keyPoints
                    }
                  : null
              },
              priorSummary: input.priorSummary ?? null,
              recentTurns: history,
              studentMessage: message
            })
          }
        ],
        dialogueSchema,
        {
          apiKey: this.llm.apiKey,
          baseUrl: this.llm.baseUrl,
          model: this.llm.model,
          temperature: 0.25,
          maxTokens: 400
        }
      )
      return {
        content: parsed.content,
        source: 'llm',
        model: modelLabel,
        sourceMessages: [parsed.content],
        disclaimer
      }
    } catch {
      return {
        content: buildDialogueTemplate(input.context, message, input.solution),
        source: 'local-policy',
        model: 'tutoring-template.v1',
        disclaimer
      }
    }
  }
}

const DIALOGUE_SYSTEM = [
  '你是循证学习对话辅导。',
  '可以解释概念与步骤，练习态可放宽到讲清思路，但不得声称改分或捏造证据外事实。',
  '有标准解析时优先复述/展开已验证正确的解；无标准解析时基于证据做保守解释。',
  '保持简洁中文，一次回答聚焦学生当前问题。',
  '只输出 JSON：{"content":"..."}。'
].join('')
