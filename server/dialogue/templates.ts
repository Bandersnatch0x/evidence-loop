/**
 * templates — T21 人物对话的确定性模板回复（无 LLM / LLM 失败时的降级路径）。
 *
 * 降级不阻塞练习：没有 LLM 时角色仍然「据史料摘录」作答。模板是纯函数，
 * 同一输入必得同一回复，绝不编造摘录之外的史实，也绝不改分。
 */
import {
  PERSONA_HELP_ABUSE_THRESHOLD,
  type PersonaCatalogEntry
} from '../../shared/personaDialogue'

export interface PersonaTemplateInput {
  persona: PersonaCatalogEntry
  message: string
  /** 连续低努力索取标准答案的轮数（对齐 T05 苏格拉底防套话）。 */
  lowEffortStreak: number
}

/** 摘录太长时截断的字符数。 */
const EXCERPT_SNIPPET = 120

/**
 * 防套话：连续低努力索取标准答案 → 拒绝剧透，转而要求从史料出发思考。
 */
export function buildAntiSpoilerReply(persona: PersonaCatalogEntry): string {
  return `（${persona.name}）我不能直接给你标准答案。先说说你从史料摘录里读到了什么？我们据此讨论。`
}

/**
 * 角色模板回复：引用第一条史料摘录作答，附练习态免责声明。
 */
export function buildPersonaTemplateReply(input: PersonaTemplateInput): string {
  const { persona, message } = input
  const question = message.trim()

  if (input.lowEffortStreak >= PERSONA_HELP_ABUSE_THRESHOLD) {
    return buildAntiSpoilerReply(persona)
  }

  const excerpt = persona.sourceExcerpts[0] ?? ''
  const snippet =
    excerpt.length > EXCERPT_SNIPPET
      ? `${excerpt.slice(0, EXCERPT_SNIPPET)}…`
      : excerpt
  return `关于「${question.slice(0, 40)}」：${snippet}（以上仅依据挂载史料摘录回答；练习探究，不计入测评。）`
}
