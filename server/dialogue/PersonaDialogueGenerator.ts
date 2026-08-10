/**
 * PersonaDialogueGenerator — T21 角色回复生成器（LLM / 模板降级）。
 *
 * 复用 T05 的 LLM 调用层（`callOpenAICompatible` / `resolveLlmProvider`）与
 * 防套话计数（`countLowEffortStreak`，对齐 T05 苏格拉底）。角色被系统 prompt
 * 约束为**只据挂载的史料/教材摘录回答，不知则说不知**，绝不编造。
 *
 * 产出是纯文本 draft，不含任何分数/证据字段；provenance 由 Service 统一盖戳
 * （ADR-0006）。无 LLM / LLM 抛错时降级到确定性模板，练习不阻塞。
 */
import { z } from 'zod'
import {
  PERSONA_HELP_ABUSE_THRESHOLD,
  type PersonaCatalogEntry
} from '../../shared/personaDialogue'
import {
  callOpenAICompatible,
  type LlmProviderConfig
} from '../tutoring/callOpenAICompatible'
import { countLowEffortStreak } from '../tutoring/SocraticGenerator'
import { buildPersonaTemplateReply } from './templates'

const personaReplySchema = z.object({
  content: z.string().min(4).max(600)
})

/** 生成器输入：角色 + 当前提问 + 历史轮次 + 低努力计数。 */
export interface PersonaDialogueInput {
  persona: PersonaCatalogEntry
  message: string
  history: Array<{ role: 'user' | 'assistant'; content: string }>
  lowEffortStreak: number
}

/** 生成器输出 draft：Service 负责盖 llm_inference provenance。 */
export interface PersonaDialogueDraft {
  content: string
  source: 'local-policy' | 'llm'
  model: string
  sourceMessages?: string[]
  confidence?: number
  disclaimer?: string
}

export interface PersonaDialogueGenerator {
  /** 稳定模型标签（记入 provenance.model）。 */
  readonly model: string
  reply(input: PersonaDialogueInput): Promise<PersonaDialogueDraft>
}

/** 模板降级时的模型标签。 */
export const PERSONA_TEMPLATE_MODEL = 'persona-template.v1'

/**
 * 模板生成器：确定性回复（同输入必得同输出），无 LLM 时的降级路径。
 */
export class TemplatePersonaDialogueGenerator implements PersonaDialogueGenerator {
  public readonly model = PERSONA_TEMPLATE_MODEL

  public reply(input: PersonaDialogueInput): Promise<PersonaDialogueDraft> {
    return Promise.resolve({
      content: buildPersonaTemplateReply({
        persona: input.persona,
        message: input.message,
        lowEffortStreak: input.lowEffortStreak
      }),
      source: 'local-policy',
      model: this.model,
      disclaimer: input.persona.disclaimer
    })
  }
}

/**
 * 默认生成器：LLM 可用时实时作答，任何失败都回退到模板。
 */
export class LlmPersonaDialogueGenerator implements PersonaDialogueGenerator {
  public readonly model: string

  public constructor(private readonly llm: LlmProviderConfig | null) {
    this.model = llm ? `${llm.provider}:${llm.model}` : PERSONA_TEMPLATE_MODEL
  }

  public async reply(input: PersonaDialogueInput): Promise<PersonaDialogueDraft> {
    const fallback = (): Promise<PersonaDialogueDraft> =>
      new TemplatePersonaDialogueGenerator().reply(input)

    if (!this.llm) {
      return fallback()
    }
    // 防套话：连续低努力索取标准答案 → 直接走模板拒绝（对齐 T05）。
    if (input.lowEffortStreak >= PERSONA_HELP_ABUSE_THRESHOLD) {
      return fallback()
    }

    try {
      const parsed = await callOpenAICompatible(
        [
          { role: 'system', content: buildPersonaSystemPrompt(input.persona) },
          {
            role: 'user',
            content: JSON.stringify({
              recentTurns: input.history,
              studentMessage: input.message
            })
          }
        ],
        personaReplySchema,
        {
          apiKey: this.llm.apiKey,
          baseUrl: this.llm.baseUrl,
          model: this.llm.model,
          temperature: 0.2,
          maxTokens: 320
        }
      )
      return {
        content: parsed.content,
        source: 'llm',
        model: this.model,
        sourceMessages: [parsed.content],
        disclaimer: input.persona.disclaimer
      }
    } catch {
      return fallback()
    }
  }
}

/**
 * 计算连续低努力索取答案的轮数（对齐 T05 苏格拉底的判定函数）。
 */
export function computeLowEffortStreak(
  history: Array<{ role: 'user' | 'assistant'; content: string }>,
  currentMessage: string
): number {
  return countLowEffortStreak(history, currentMessage)
}

/**
 * 角色系统 prompt：只据史料/教材摘录回答，不知则说不知，不评分数，
 * 连续索取答案则拒绝剧透。把「内容克制」写进 prompt，而不只是注释。
 */
function buildPersonaSystemPrompt(persona: PersonaCatalogEntry): string {
  const excerpts = persona.sourceExcerpts.map((item, index) => `${index + 1}. ${item}`).join('\n')
  return [
    `你正在扮演「${persona.name}」（${persona.eraOrContext}），一个练习态探究对话角色。`,
    `铁律：`,
    `1. 只依据下面挂载的「史料/教材摘录」回答；摘录里没有的内容，诚实说「史料里没有提到，我不确定」，绝不编造史实。`,
    `2. 不评价分数、不涉及任何评分/成绩话题——本次是练习探究，不计入测评，永远不要提及得分。`,
    `3. 若学生连续索取标准答案/直接答案（低努力），拒绝剧透，转而引导他先说出自己从史料里读到了什么。`,
    `4. 保持角色的时代口吻，但使用现代中文；一次回答聚焦学生当前问题，不超过 3 句。`,
    `史料/教材摘录：`,
    excerpts,
    `只输出 JSON：{"content":"..."}。`
  ].join('\n')
}
