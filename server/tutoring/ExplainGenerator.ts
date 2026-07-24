import { z } from 'zod'
import { buildTutoringContext } from '../questionbank/solution'
import {
  callOpenAICompatible,
  type LlmProviderConfig
} from './callOpenAICompatible'
import {
  buildExplainTemplate,
  explainDisclaimer
} from './templates'
import type {
  TutoringGenerator,
  TutoringGeneratorResult,
  TutoringInput
} from './types'

const explainSchema = z.object({
  content: z.string().min(20).max(800)
})

/**
 * Layer A — one-shot explain (T05 / TR2).
 *
 * RAG-first: when a T09 standard solution is present, the model only restates /
 * expands the verified solution and evidence. It never recomputes a new answer.
 * Template fallback when LLM is offline.
 */
export class ExplainGenerator implements TutoringGenerator {
  public readonly layer = 'explain' as const

  public constructor(private readonly llm: LlmProviderConfig | null = null) {}

  public async generate(input: TutoringInput): Promise<TutoringGeneratorResult> {
    const tutoring = buildTutoringContext(input.solution)
    const disclaimer = explainDisclaimer(tutoring)
    const modelLabel = this.llm
      ? `${this.llm.provider}:${this.llm.model}`
      : 'tutoring-template.v1'

    if (!this.llm) {
      return {
        content: buildExplainTemplate(input.context, input.solution),
        source: 'local-policy',
        model: modelLabel,
        disclaimer
      }
    }

    try {
      const parsed = await callOpenAICompatible(
        [
          { role: 'system', content: EXPLAIN_SYSTEM },
          {
            role: 'user',
            content: JSON.stringify(buildExplainPayload(input, tutoring.mode))
          }
        ],
        explainSchema,
        {
          apiKey: this.llm.apiKey,
          baseUrl: this.llm.baseUrl,
          model: this.llm.model,
          temperature: 0.2,
          maxTokens: 500
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
        content: buildExplainTemplate(input.context, input.solution),
        source: 'local-policy',
        model: 'tutoring-template.v1',
        disclaimer
      }
    }
  }
}

const EXPLAIN_SYSTEM = [
  '你是循证学习讲解助手。',
  '只能根据提供的证据与（若有）教师标准解析讲解思路，不得修改分数、不得捏造证据中未出现的数值或结论。',
  '有标准解析时：只解释已验证正确的解，禁止自行重算新解。',
  '无标准解析时：基于失败证据做思路提示，不要给出可直接抄写的完整最终答案。',
  '语气简洁、中文。只输出 JSON：{"content":"..."}。'
].join('')

function buildExplainPayload(
  input: TutoringInput,
  tutoringMode: 'rag_restate' | 'llm_generate'
): Record<string, unknown> {
  const { context, solution } = input
  return {
    tutoringMode,
    assignment: {
      title: context.assignment.title,
      objective: context.assignment.objective,
      questionType: context.assignment.questionType
    },
    score: context.score,
    previousScore: context.previousScore,
    evidence: context.evidence.map(
      ({ label, state, expected, actual, message }) => ({
        label,
        state,
        expected,
        actual,
        message
      })
    ),
    diagnoses: context.diagnoses.map(({ title, explanation, severity }) => ({
      title,
      explanation,
      severity
    })),
    standardSolution: solution
      ? {
          content: solution.content,
          latex: solution.latex,
          keyPoints: solution.keyPoints,
          source: solution.source
        }
      : null
  }
}
