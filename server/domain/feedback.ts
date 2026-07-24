import { z } from 'zod'
import type {
  Diagnosis,
  EvidenceItem,
  Intervention
} from '../../shared/contracts'
import type { ExecutableAssignment } from '../data/assignments'
import {
  callOpenAICompatible,
  resolveLlmProvider
} from '../tutoring/callOpenAICompatible'

export interface FeedbackContext {
  assignment: ExecutableAssignment
  score: number
  previousScore?: number
  evidence: EvidenceItem[]
  diagnoses: Diagnosis[]
  intervention?: Intervention
}

export interface FeedbackOutput {
  summary: string
  source: 'local-policy' | 'llm'
}

export interface FeedbackGenerator {
  generate(context: FeedbackContext): Promise<FeedbackOutput>
}

export class LocalFeedbackGenerator implements FeedbackGenerator {
  public generate(context: FeedbackContext): Promise<FeedbackOutput> {
    const failedCount = context.evidence.filter(
      (item) => item.state !== 'passed'
    ).length
    const delta =
      context.previousScore === undefined
        ? ''
        : context.score > context.previousScore
          ? `，比上一轮提高 ${String(context.score - context.previousScore)} 分`
          : context.score === context.previousScore
            ? '，与上一轮持平'
            : `，比上一轮下降 ${String(context.previousScore - context.score)} 分`

    if (failedCount === 0) {
      return Promise.resolve({
        summary: `全部可验证证据通过，当前得分 ${String(context.score)} 分${delta}。本轮已完成任务闭环，可进入下一项能力训练。`,
        source: 'local-policy'
      })
    }

    const focus = context.diagnoses[0]?.title ?? '尚未通过的证据'
    return Promise.resolve({
      summary: `当前得分 ${String(context.score)} 分${delta}，${String(failedCount)} 项证据未通过。优先处理“${focus}”，完成后重新提交验证。`,
      source: 'local-policy'
    })
  }
}

const llmResponseSchema = z.object({
  summary: z.string().min(12).max(240)
})

interface OpenAICompatibleOptions {
  apiKey: string
  baseUrl: string
  model: string
  fallback: FeedbackGenerator
}

export class OpenAICompatibleFeedbackGenerator implements FeedbackGenerator {
  public constructor(private readonly options: OpenAICompatibleOptions) {}

  public async generate(context: FeedbackContext): Promise<FeedbackOutput> {
    try {
      const parsed = await callOpenAICompatible(
        [
          {
            role: 'system',
            content:
              '你是循证编程教练。只能根据提供的测试与静态证据总结，不得修改分数、捏造错误或给出完整答案。只输出 JSON：{"summary":"..."}。'
          },
          {
            role: 'user',
            content: JSON.stringify({
              assignment: context.assignment.title,
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
              diagnoses: context.diagnoses,
              intervention: context.intervention
            })
          }
        ],
        llmResponseSchema,
        {
          apiKey: this.options.apiKey,
          baseUrl: this.options.baseUrl,
          model: this.options.model,
          temperature: 0.2
        }
      )
      return { summary: parsed.summary, source: 'llm' }
    } catch {
      return this.options.fallback.generate(context)
    }
  }
}

export function createFeedbackGenerator(): FeedbackGenerator {
  const fallback = new LocalFeedbackGenerator()
  const config = resolveLlmProvider()
  if (!config) return fallback

  return new OpenAICompatibleFeedbackGenerator({
    apiKey: config.apiKey,
    baseUrl: config.baseUrl,
    model: config.model,
    fallback
  })
}
