/**
 * visualizationSchema — zod validation + LLM generation for teacher-authored
 * ball-stick visualizations (ADR-0015).
 *
 * Validation is the trust boundary: the LLM proposes geometry, but nothing
 * reaches the DB or the renderer until `visualizationSchema.parse` accepts it.
 * Bonds referencing unknown atoms, empty atom sets, or non-finite positions are
 * rejected here — the teacher's 3D preview is a second, human check on top.
 *
 * Generation reuses `callOpenAICompatible` (the same OpenAI-compatible client
 * the feedback + tutoring layers use). No LLM config → returns an error the
 * UI surfaces, never throws to the caller.
 */
import { z } from 'zod'
import type { Visualization } from '../../shared/contracts'
import {
  callOpenAICompatible,
  resolveLlmProvider
} from '../tutoring/callOpenAICompatible'

const positionSchema = z.tuple([z.number().finite(), z.number().finite(), z.number().finite()])

const atomSchema = z.object({
  id: z.string().min(1),
  element: z.string().min(1).max(2),
  position: positionSchema
})

const bondSchema = z.object({
  from: z.string().min(1),
  to: z.string().min(1)
})

export const visualizationSchema: z.ZodType<Visualization> = z
  .object({
    kind: z.literal('ball_stick'),
    atoms: z.array(atomSchema).min(1).max(200),
    bonds: z.array(bondSchema),
    label: z.string().max(80).optional()
  })
  .superRefine((data, ctx) => {
    // Atom ids must be unique.
    const ids = new Set<string>()
    for (const atom of data.atoms) {
      if (ids.has(atom.id)) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: `重复的原子 id: ${atom.id}`
        })
      }
      ids.add(atom.id)
    }
    // Every bond endpoint must reference an existing atom.
    for (const bond of data.bonds) {
      if (!ids.has(bond.from)) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: `键引用了不存在的原子: ${bond.from}`
        })
      }
      if (!ids.has(bond.to)) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: `键引用了不存在的原子: ${bond.to}`
        })
      }
    }
  })

/** Parse + validate unknown input as a Visualization. Throws z.error on bad input. */
export function parseVisualization(raw: unknown): Visualization {
  return visualizationSchema.parse(raw)
}

export interface GenerateVisualizationResult {
  ok: true
  visualization: Visualization
}
export interface GenerateVisualizationError {
  ok: false
  reason: 'no-llm' | 'llm-failed' | 'invalid'
  message: string
}

const SYSTEM_PROMPT = `你是化学/生物 3D 结构建模助手。根据用户的自然语言描述，输出一个球棍模型（ball-and-stick）的 JSON。
规则：
- 只输出 JSON，不要解释文字。JSON 格式：{"kind":"ball_stick","atoms":[{"id":"A1","element":"C","position":[0,0,0]}],"bonds":[{"from":"A1","to":"A2"}],"label":"简短中文标题"}
- element 是元素符号（1-2 字母，如 C H O N Na Cl）。
- position 是合理的三维坐标 [x,y,z]，键长归一化到 1 附近，体现真实空间构型（如甲烷四面体、水 V 形、氨三角锥）。
- bonds 连接真实化学键对应的原子 id。
- atoms 1-50 个，id 唯一。`

/**
 * Generate a ball-stick visualization from a natural-language description.
 * Returns ok=false (never throws) so the route layer can surface a clean error.
 */
export async function generateVisualization(
  description: string
): Promise<GenerateVisualizationResult | GenerateVisualizationError> {
  const trimmed = description.trim()
  if (trimmed === '') {
    return { ok: false, reason: 'invalid', message: '描述不能为空' }
  }

  const config = resolveLlmProvider()
  if (!config) {
    return {
      ok: false,
      reason: 'no-llm',
      message: '未配置 LLM（LLM_API_KEY/LLM_BASE_URL/LLM_MODEL），无法生成。教师可改用手动几何录入。'
    }
  }

  try {
    const raw = await callOpenAICompatible(
      [
        { role: 'system', content: SYSTEM_PROMPT },
        { role: 'user', content: trimmed }
      ],
      // Validate the LLM payload against the same schema used for adopt.
      z.object({ kind: z.literal('ball_stick') }).passthrough(),
      {
        apiKey: config.apiKey,
        baseUrl: config.baseUrl,
        model: config.model,
        temperature: 0.3,
        maxTokens: 2000
      }
    )
    const visualization = visualizationSchema.parse(raw)
    return { ok: true, visualization }
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    return { ok: false, reason: 'llm-failed', message: `生成失败：${message}` }
  }
}
