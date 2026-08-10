/**
 * T22 闪卡草稿生成器：转写文本 → 候选闪卡（front=概念/术语, back=解释）。
 *
 * 铁律（ADR-0001）：本文件是闪卡链路上**唯一**允许调用 LLM 的地方，产物只有
 * `GeneratedFlashcard`，永远带 `provenance.kind === 'llm_inference'`，且不含
 * score / evidence / attempt / MasteryProfile 任何字段。生成物不是题库题，
 * 必须经教师校对闸门才可能入库。
 *
 * 正面溯源红线（PRD §闪卡）：front 必须能在原文中找到（服务端 `verifyFrontIsGrounded`
 * 强制校验，未通过即剔除）。模板降级路径的 front 直接抽取原文片段，结构性保证
 * 可溯源 —— LLM 路径由服务层兜底回落到模板，因此**永远不会有编造概念入库**。
 *
 * 降级（照 T15 `TemplateDraftQuestionGenerator` 思路）：未配 `LLM_API_KEY`
 * （或未开出境）时返回模板假草稿固定 2 张，**back 留空**，让校对闸门被真实触发。
 */
import { z } from 'zod'
import type {
  LlmInferenceProvenance,
  FlashcardSourceKind
} from '../../shared/flashcardDraft'

export const TEMPLATE_FLASHCARD_MODEL = 'flashcard-template.v1'

/** 模板降级固定产出的闪卡草稿数（照 T15：固定 2 条样例）。 */
export const TEMPLATE_FLASHCARD_COUNT = 2

export interface GenerateFlashcardsInput {
  rawText: string
  subject: string
  sourceLabel: string
  /** job 的 sourceKind，随 provenance 记录。 */
  sourceKind: FlashcardSourceKind
}

export interface GeneratedFlashcard {
  front: string
  back: string
  sourceExcerpt: string
  confidence: number
  provenance: LlmInferenceProvenance
}

export interface FlashcardDraftGenerator {
  /** 生成器标识，写入 job.generatorModel。 */
  readonly model: string
  /** true = 模板降级路径（无 LLM）。 */
  readonly degraded: boolean
  generate(input: GenerateFlashcardsInput): Promise<GeneratedFlashcard[]>
}

const MAX_EXCERPT_CHARS = 220

const llmFlashcardSchema = z.object({
  front: z.string().min(1).max(500),
  back: z.string().min(1).max(4_000),
  sourceExcerpt: z.string().optional(),
  confidence: z.number().min(0).max(1).optional()
})

const llmResponseSchema = z.object({
  flashcards: z.array(llmFlashcardSchema).min(1).max(30)
})

// ---------------------------------------------------------------------------
// 模板降级生成器
// ---------------------------------------------------------------------------

/**
 * 无 LLM 时的模板假草稿：固定 2 张闪卡。front 直接抽取原文片段（结构性可溯源，
 * `frontGrounded` 恒为 true）；**back 留空** —— 答案权威只能来自教师，
 * 闸门会拒绝空 back 确认（与 T15「模板草稿刻意留空答案」同构）。
 */
export class TemplateFlashcardDraftGenerator implements FlashcardDraftGenerator {
  public readonly model = TEMPLATE_FLASHCARD_MODEL
  public readonly degraded = true

  public generate(input: GenerateFlashcardsInput): Promise<GeneratedFlashcard[]> {
    const candidates = pickTermCandidates(input.rawText, TEMPLATE_FLASHCARD_COUNT)
    const now = new Date().toISOString()
    const drafts: GeneratedFlashcard[] = candidates.map((candidate) => ({
      front: candidate.term,
      back: '',
      sourceExcerpt: candidate.excerpt,
      confidence: 0.3,
      provenance: makeProvenance(
        this.model,
        input.sourceLabel,
        input.sourceKind,
        0.3,
        now
      )
    }))
    return Promise.resolve(drafts)
  }
}

// ---------------------------------------------------------------------------
// LLM 生成器（境内 OpenAI 兼容端点），失败一律回落模板
// ---------------------------------------------------------------------------

export interface OpenAICompatibleFlashcardGeneratorOptions {
  apiKey: string
  baseUrl: string
  model: string
  fallback: FlashcardDraftGenerator
  /** T10：未显式开出境时不发网络请求，直接降级。 */
  allowsEgress: boolean
}

export class OpenAICompatibleFlashcardDraftGenerator
  implements FlashcardDraftGenerator
{
  public readonly degraded = false

  public constructor(
    private readonly options: OpenAICompatibleFlashcardGeneratorOptions
  ) {}

  public get model(): string {
    return this.options.model
  }

  public async generate(input: GenerateFlashcardsInput): Promise<GeneratedFlashcard[]> {
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
                  '你是转写出题助手。从转写文本中抽取闪卡草稿，只输出 JSON：' +
                  '{"flashcards":[{"front":"材料里真实出现的概念/术语（不得编造材料外的概念）",' +
                  '"back":"对该概念的简洁解释","sourceExcerpt":"原文片段","confidence":0.8}]}。' +
                  'front 必须是原文中能找到的词或短语；如材料无明确术语就返回空数组。' +
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
        throw new Error(`flashcard draft generation failed with HTTP ${String(response.status)}`)
      }
      const body = (await response.json()) as {
        choices?: Array<{ message?: { content?: string } }>
      }
      const content = body.choices?.[0]?.message?.content
      if (!content) throw new Error('flashcard draft generation response had no content')
      const jsonMatch = content.match(/\{[\s\S]*\}/)
      if (!jsonMatch) throw new Error('flashcard draft generation response was not JSON')

      const parsed = llmResponseSchema.parse(JSON.parse(jsonMatch[0]))
      const now = new Date().toISOString()
      return parsed.flashcards.map((card) => ({
        front: card.front.trim(),
        back: card.back.trim(),
        sourceExcerpt: truncate(card.sourceExcerpt ?? card.front),
        confidence: card.confidence ?? 0.7,
        provenance: makeProvenance(
          this.options.model,
          input.sourceLabel,
          input.sourceKind,
          card.confidence ?? 0.7,
          now
        )
      }))
    } catch {
      // 生成失败不阻塞：回落模板草稿，教师照常校对/手工录入。
      return this.options.fallback.generate(input)
    }
  }
}

/**
 * 工厂：无 `LLM_API_KEY`（或缺 baseUrl / model / 出境开关）→ 模板降级。
 * 与 T15 `createDraftQuestionGenerator` / T04 `createQuestionSplitter` 同构。
 */
export function createFlashcardDraftGenerator(
  environment: NodeJS.ProcessEnv = process.env
): FlashcardDraftGenerator {
  const fallback = new TemplateFlashcardDraftGenerator()
  const apiKey = environment.LLM_API_KEY
  const baseUrl = environment.LLM_BASE_URL
  const model = environment.LLM_MODEL
  const allowsEgress =
    environment.LLM_ALLOW_EGRESS === 'true' ||
    environment.FLASHCARD_LLM_EGRESS === 'true'

  if (!apiKey || !baseUrl || !model || !allowsEgress) {
    return fallback
  }
  return new OpenAICompatibleFlashcardDraftGenerator({
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
  sourceKind: FlashcardSourceKind,
  confidence: number,
  extractedAt: string
): LlmInferenceProvenance {
  return {
    kind: 'llm_inference',
    sourceMessages: [`${sourceLabel}:${sourceKind}`],
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

export interface TermCandidate {
  term: string
  excerpt: string
}

/**
 * 从原文抽取 `count` 个「像术语」的候选 front。启发式：
 * 对每个非空段落，取连续非标点字符的最长游程（中文/字母数字串）作为术语，
 * 段落首行作为并排校对原文片段。由此保证 front 一定出现在原文中（可溯源）。
 */
export function pickTermCandidates(rawText: string, count: number): TermCandidate[] {
  const paragraphs = rawText
    .replace(/\r\n/g, '\n')
    .split(/\n{1,}/)
    .map((part) => part.trim())
    .filter((part) => part.length > 0)
  const picked: TermCandidate[] = []
  for (const paragraph of paragraphs) {
    const term = longestRun(paragraph)
    if (term.length >= 2) {
      picked.push({ term, excerpt: truncate(paragraph) })
      if (picked.length >= count) break
    }
  }
  if (picked.length === 0 && paragraphs[0]) {
    picked.push({
      term: longestRun(paragraphs[0]) || paragraphs[0].slice(0, 12),
      excerpt: truncate(paragraphs[0])
    })
  }
  return picked
}

/** 返回文本中最长的连续「非空白非标点」游程（术语启发式）。 */
function longestRun(text: string): string {
  const runs = text.match(/[\p{L}\p{N}]+/gu) ?? []
  let longest = ''
  for (const run of runs) {
    if (run.length > longest.length) longest = run
  }
  return longest
}
