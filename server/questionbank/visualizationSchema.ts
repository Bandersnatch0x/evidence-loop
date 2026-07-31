/**
 * visualizationSchema — zod validation + LLM generation for teacher-authored
 * visualizations (ADR-0015: ball_stick / curve / primitives).
 *
 * Validation is the trust boundary: the LLM proposes geometry, but nothing
 * reaches the DB or the renderer until `visualizationSchema.parse` accepts it.
 * Bonds/edges referencing unknown endpoints, empty sets, non-finite positions,
 * or invalid polylines are rejected here — the teacher's 3D preview is a
 * second, human check on top.
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
import {
  hardGeometryIssues,
  softGeometryWarnings
} from './geometrySanity'

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

const ballStickSchema = z
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
    for (const message of hardGeometryIssues(data)) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, message })
    }
  })

/** Pre-sampled curve polyline: 2–2000 finite [x,y,z] points. */
const pointsSchema = z.array(positionSchema).min(2).max(2000)

const crossBarSchema = z.tuple([positionSchema, positionSchema])

const curveSchema = z
  .object({
    kind: z.literal('curve'),
    points: pointsSchema,
    secondaryPoints: pointsSchema.optional(),
    crossBars: z.array(crossBarSchema).max(500).optional(),
    label: z.string().max(80).optional()
  })
  .superRefine((data, ctx) => {
    for (const message of hardGeometryIssues(data)) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, message })
    }
  })

const nodeSchema = z.object({
  id: z.string().min(1),
  label: z.string().max(40).optional(),
  position: positionSchema,
  role: z.string().max(32).optional()
})

const edgeSchema = z.object({
  from: z.string().min(1),
  to: z.string().min(1),
  label: z.string().max(40).optional()
})

const primitivesSchema = z
  .object({
    kind: z.literal('primitives'),
    nodes: z.array(nodeSchema).min(1).max(100),
    edges: z.array(edgeSchema).max(200),
    label: z.string().max(80).optional()
  })
  .superRefine((data, ctx) => {
    const ids = new Set<string>()
    for (const node of data.nodes) {
      if (ids.has(node.id)) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: `重复的节点 id: ${node.id}`
        })
      }
      ids.add(node.id)
    }
    for (const edge of data.edges) {
      if (!ids.has(edge.from)) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: `边引用了不存在的节点: ${edge.from}`
        })
      }
      if (!ids.has(edge.to)) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: `边引用了不存在的节点: ${edge.to}`
        })
      }
    }
    for (const message of hardGeometryIssues(data)) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, message })
    }
  })

// z.union (not discriminatedUnion): ballStick/primitives use superRefine
// (ZodEffects) — discriminatedUnion only accepts plain ZodObject options.
export const visualizationSchema: z.ZodType<Visualization> = z.union([
  ballStickSchema,
  curveSchema,
  primitivesSchema
])

/** Parse + validate unknown input as a Visualization. Throws z.error on bad input. */
export function parseVisualization(raw: unknown): Visualization {
  return visualizationSchema.parse(raw)
}

export interface GenerateVisualizationResult {
  ok: true
  visualization: Visualization
  /** Soft geometry advisories (never blocks save). */
  warnings: string[]
}
export interface GenerateVisualizationError {
  ok: false
  reason: 'no-llm' | 'llm-failed' | 'invalid'
  message: string
}

const SYSTEM_PROMPT = `你是科学 3D 可视化建模助手。根据用户的自然语言描述，输出一种几何 JSON：球棍、曲线或图元图。
规则：
- 只输出 JSON，不要解释文字。
- 分子/晶体/原子结构 → kind "ball_stick"：
  {"kind":"ball_stick","atoms":[{"id":"A1","element":"C","position":[0,0,0]}],"bonds":[{"from":"A1","to":"A2"}],"label":"简短中文标题"}
  - element 是元素符号（1-2 字母，如 C H O N Na Cl）。
  - position 是合理的三维坐标 [x,y,z]，键长归一化到 1 附近，体现真实空间构型（如甲烷四面体、水 V 形、氨三角锥）。
  - bonds 连接真实化学键对应的原子 id；atoms 1-50 个，id 唯一。
- 螺旋/轨迹/曲线（磁场螺旋、带电粒子轨迹、DNA 双螺旋等）→ kind "curve"：
  {"kind":"curve","points":[[x,y,z],...],"secondaryPoints":[[x,y,z],...],"crossBars":[[[x,y,z],[x,y,z]],...],"label":"简短中文标题"}
  - points 是预采样 3D 折线点，采样 50–200 个点，体现真实几何（如磁场螺旋：半径恒定、轴向均匀推进）。
  - secondaryPoints 可选：DNA 等双链用第二条螺旋；单条螺旋不要带 secondaryPoints。
  - crossBars 可选：DNA 碱基对横档，每项为两端点 [[x,y,z],[x,y,z]]，建议每隔数个采样点连一条。
  - 坐标量级控制在约 -5..5，便于 3D 预览。
- 电路/节点图/简单结构示意图 → kind "primitives"：
  {"kind":"primitives","nodes":[{"id":"V","label":"电源","position":[-2,0,0],"role":"source"},{"id":"R","label":"R","position":[2,0,0],"role":"resistor"}],"edges":[{"from":"V","to":"R","label":"导线"}],"label":"简短中文标题"}
  - nodes 1–40 个，id 唯一；edges 端点必须引用存在的节点 id。
  - role 可选：source / resistor / switch / junction / load 等（仅样式提示）。
  - 坐标平面优先 z≈0 的 2.5D 布局，量级 -4..4。`

/**
 * Generate a visualization from a natural-language description
 * (ball_stick | curve | primitives). Returns ok=false (never throws).
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
      // Accept any known kind; full validation happens via visualizationSchema.parse.
      z.object({ kind: z.enum(['ball_stick', 'curve', 'primitives']) }).passthrough(),
      {
        apiKey: config.apiKey,
        baseUrl: config.baseUrl,
        model: config.model,
        temperature: 0.3,
        maxTokens: 4000
      }
    )
    const visualization = visualizationSchema.parse(raw)
    return {
      ok: true,
      visualization,
      warnings: softGeometryWarnings(visualization)
    }
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    return { ok: false, reason: 'llm-failed', message: `生成失败：${message}` }
  }
}
