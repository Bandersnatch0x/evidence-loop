/**
 * T15 草稿题生成器：讲义文本 → 候选草稿题。
 *
 * 铁律（ADR-0001）：本文件是整条链路上唯一允许调用 LLM 的地方，它的产物
 * 只有 `GeneratedDraft`，永远带 `provenance.kind === 'llm_inference'`，
 * 且不含 score / evidence / attempt 任何字段。生成物不是 Question，必须经
 * 教师校对闸门才可能入库。
 *
 * 降级（PRD §配额与降级）：未配 `LLM_API_KEY`（或未开出境）时返回模板假草稿
 * 固定 2 题，Demo / 开发环境的校对流不被阻塞。
 */
import { z } from 'zod'
import type { QuestionType } from '../../shared/contracts'
import type {
  LlmInferenceProvenance,
  QuestionDraftShape
} from '../../shared/materialImport'

export const TEMPLATE_GENERATOR_MODEL = 'material-template.v1'

/** 模板降级固定产出的草稿题数（PRD：固定 2 题样例）。 */
export const TEMPLATE_DRAFT_COUNT = 2

export interface GenerateDraftsInput {
  rawText: string
  subject: string
  sourceLabel: string
}

export interface GeneratedDraft {
  payload: QuestionDraftShape
  sourceExcerpt: string
  confidence: number
  provenance: LlmInferenceProvenance
}

export interface DraftQuestionGenerator {
  /** 生成器标识，写入 job.generatorModel。 */
  readonly model: string
  /** true = 模板降级路径（无 LLM）。 */
  readonly degraded: boolean
  generate(input: GenerateDraftsInput): Promise<GeneratedDraft[]>
}

const MAX_EXCERPT_CHARS = 220

/** 优先生成的题型（PRD §生成物）。 */
const PREFERRED_TYPES: readonly QuestionType[] = [
  'choice',
  'fill_blank',
  'numeric'
]

const llmDraftSchema = z.object({
  stem: z.string().min(1).max(8_000),
  questionType: z.enum(['choice', 'fill_blank', 'numeric', 'essay']).default('fill_blank'),
  options: z.array(z.object({ id: z.string(), text: z.string() })).optional(),
  answerCandidate: z.string().optional(),
  suggestedKpIds: z.array(z.string()).optional(),
  suggestedDifficulty: z.number().int().min(1).max(5).optional(),
  sourceExcerpt: z.string().optional(),
  confidence: z.number().min(0).max(1).optional()
})

const llmResponseSchema = z.object({
  drafts: z.array(llmDraftSchema).min(1).max(50)
})

// ---------------------------------------------------------------------------
// 模板降级生成器
// ---------------------------------------------------------------------------

/**
 * 无 LLM 时的模板假草稿：固定 2 题（1 choice + 1 fill_blank），题干嵌入材料
 * 首尾片段，让教师能真实走通「并排校对 → 修正 → 确认」全流程。
 *
 * 注意：模板 **不填答案**（choice 的 correctOptionIds / fill_blank 的
 * acceptedAnswers 均为空）。答案权威只能来自教师，闸门会拒绝空答案确认。
 */
export class TemplateDraftQuestionGenerator implements DraftQuestionGenerator {
  public readonly model = TEMPLATE_GENERATOR_MODEL
  public readonly degraded = true

  public generate(input: GenerateDraftsInput): Promise<GeneratedDraft[]> {
    const excerpts = pickExcerpts(input.rawText, TEMPLATE_DRAFT_COUNT)
    const now = new Date().toISOString()

    const drafts: GeneratedDraft[] = [
      {
        payload: {
          stem: `根据材料片段「${excerpts[0] ?? ''}」，下列说法正确的是？（模板草稿，请教师补全选项与答案）`,
          questionType: 'choice',
          options: [
            { id: 'A', text: '（待教师填写）' },
            { id: 'B', text: '（待教师填写）' },
            { id: 'C', text: '（待教师填写）' },
            { id: 'D', text: '（待教师填写）' }
          ],
          payload: { kind: 'choice', correctOptionIds: [] },
          kpIds: [],
          difficulty: 3
        },
        sourceExcerpt: excerpts[0] ?? '',
        confidence: 0.3,
        provenance: makeProvenance(this.model, input.sourceLabel, 0.3, now)
      },
      {
        payload: {
          stem: `根据材料片段「${excerpts[1] ?? excerpts[0] ?? ''}」，填空：______。（模板草稿，请教师补全答案）`,
          questionType: 'fill_blank',
          payload: { kind: 'fill_blank', acceptedAnswers: [] },
          kpIds: [],
          difficulty: 3
        },
        sourceExcerpt: excerpts[1] ?? excerpts[0] ?? '',
        confidence: 0.3,
        provenance: makeProvenance(this.model, input.sourceLabel, 0.3, now)
      }
    ]
    return Promise.resolve(drafts)
  }
}

// ---------------------------------------------------------------------------
// LLM 生成器（境内 OpenAI 兼容端点），失败一律回落模板
// ---------------------------------------------------------------------------

export interface OpenAICompatibleDraftGeneratorOptions {
  apiKey: string
  baseUrl: string
  model: string
  fallback: DraftQuestionGenerator
  /** T10：未显式开出境时不发网络请求，直接降级。 */
  allowsEgress: boolean
}

export class OpenAICompatibleDraftQuestionGenerator
  implements DraftQuestionGenerator
{
  public readonly degraded = false

  public constructor(
    private readonly options: OpenAICompatibleDraftGeneratorOptions
  ) {}

  public get model(): string {
    return this.options.model
  }

  public async generate(input: GenerateDraftsInput): Promise<GeneratedDraft[]> {
    if (!this.options.allowsEgress) {
      return this.options.fallback.generate(input)
    }
    try {
      const response = await fetch(
        `${this.options.baseUrl.replace(/\/$/, '')}/chat/completions`,
        {
          method: 'POST',
          headers: {
            authorization: `Bearer ${this.options.apiKey}`,
            'content-type': 'application/json'
          },
          body: JSON.stringify({
            model: this.options.model,
            temperature: 0.2,
            messages: [
              {
                role: 'system',
                content:
                  '你是讲义出题助手。把材料拆成候选题目草稿，只输出 JSON：' +
                  '{"drafts":[{"stem":"...","questionType":"choice|fill_blank|numeric|essay",' +
                  '"options":[{"id":"A","text":"..."}],"answerCandidate":"...",' +
                  '"suggestedKpIds":[],"suggestedDifficulty":3,"sourceExcerpt":"原文片段","confidence":0.8}]}。' +
                  '优先 choice / fill_blank / numeric，最多 1 道 essay 提纲题。' +
                  '这是草稿，必须由老师校对确认；不得评分、不得编造学号姓名。'
              },
              {
                role: 'user',
                content: JSON.stringify({
                  subject: input.subject,
                  text: input.rawText.slice(0, 20_000)
                })
              }
            ]
          }),
          signal: AbortSignal.timeout(12_000)
        }
      )
      if (!response.ok) {
        throw new Error(`draft generation failed with HTTP ${String(response.status)}`)
      }
      const body = (await response.json()) as {
        choices?: Array<{ message?: { content?: string } }>
      }
      const content = body.choices?.[0]?.message?.content
      if (!content) throw new Error('draft generation response had no content')
      const jsonMatch = content.match(/\{[\s\S]*\}/)
      if (!jsonMatch) throw new Error('draft generation response was not JSON')

      const parsed = llmResponseSchema.parse(JSON.parse(jsonMatch[0]))
      const now = new Date().toISOString()
      return parsed.drafts.map((draft) => {
        const confidence = draft.confidence ?? 0.7
        const shape: QuestionDraftShape = {
          stem: draft.stem,
          questionType: draft.questionType,
          payload: buildAnswerDraft(draft.questionType, draft.answerCandidate),
          kpIds: draft.suggestedKpIds ?? [],
          difficulty: draft.suggestedDifficulty ?? 3
        }
        if (draft.options && draft.options.length > 0) {
          shape.options = draft.options
        }
        return {
          payload: shape,
          sourceExcerpt: truncate(draft.sourceExcerpt ?? draft.stem),
          confidence,
          provenance: makeProvenance(
            this.options.model,
            input.sourceLabel,
            confidence,
            now
          )
        }
      })
    } catch {
      // 生成失败不阻塞题库：回落模板草稿，教师照常校对/手工录入。
      return this.options.fallback.generate(input)
    }
  }
}

/**
 * 工厂：无 `LLM_API_KEY`（或缺 baseUrl / model / 出境开关）→ 模板降级。
 * 与 T04 `createQuestionSplitter` 同构。
 */
export function createDraftQuestionGenerator(
  environment: NodeJS.ProcessEnv = process.env
): DraftQuestionGenerator {
  const fallback = new TemplateDraftQuestionGenerator()
  const apiKey = environment.LLM_API_KEY
  const baseUrl = environment.LLM_BASE_URL
  const model = environment.LLM_MODEL
  const allowsEgress =
    environment.LLM_ALLOW_EGRESS === 'true' ||
    environment.MATERIAL_IMPORT_LLM_EGRESS === 'true'

  if (!apiKey || !baseUrl || !model || !allowsEgress) {
    return fallback
  }
  return new OpenAICompatibleDraftQuestionGenerator({
    apiKey,
    baseUrl,
    model,
    fallback,
    allowsEgress
  })
}

// ---------------------------------------------------------------------------
// helpers
// ---------------------------------------------------------------------------

function makeProvenance(
  model: string,
  sourceLabel: string,
  confidence: number,
  extractedAt: string
): LlmInferenceProvenance {
  return {
    kind: 'llm_inference',
    sourceMessages: [sourceLabel],
    model,
    extractedAt,
    confidence
  }
}

function truncate(text: string): string {
  const normalized = text.replace(/\s+/g, ' ').trim()
  return normalized.length > MAX_EXCERPT_CHARS
    ? `${normalized.slice(0, MAX_EXCERPT_CHARS)}…`
    : normalized
}

/** 从材料里挑 `count` 段有内容的片段，供并排校对显示。 */
function pickExcerpts(rawText: string, count: number): string[] {
  const paragraphs = rawText
    .replace(/\r\n/g, '\n')
    .split(/\n{1,}/)
    .map((part) => part.trim())
    .filter((part) => part.length > 0)
  const picked: string[] = []
  for (const paragraph of paragraphs) {
    picked.push(truncate(paragraph))
    if (picked.length >= count) break
  }
  if (picked.length === 0) picked.push(truncate(rawText))
  return picked
}

/**
 * LLM 的 answerCandidate 只用于**预填草稿**，绝不等于答案权威。
 * 无候选时留空结构，闸门会因「答案为空」拒绝确认。
 */
function buildAnswerDraft(
  questionType: QuestionType,
  answerCandidate: string | undefined
): unknown {
  const answer = answerCandidate?.trim()
  switch (questionType) {
    case 'choice': {
      const ids =
        answer
          ?.toUpperCase()
          .split(/[,，\s]+/)
          .filter((id) => /^[A-H]$/.test(id)) ?? []
      return { kind: 'choice', correctOptionIds: ids }
    }
    case 'fill_blank':
      return { kind: 'fill_blank', acceptedAnswers: answer ? [answer] : [] }
    case 'numeric': {
      const expected = answer !== undefined ? Number(answer) : Number.NaN
      return Number.isFinite(expected)
        ? { kind: 'numeric', expected, tolerance: 0 }
        : { kind: 'numeric', tolerance: 0 }
    }
    case 'essay':
      return { kind: 'essay' }
    default:
      return undefined
  }
}

export { PREFERRED_TYPES as MATERIAL_IMPORT_PREFERRED_TYPES }
