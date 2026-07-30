import { z } from 'zod'
import type {
  ImportDraftItem,
  Provenance,
  QuestionType
} from '../../shared/contracts'

/**
 * LLM post-processing that turns raw OCR/parse text into structured question
 * candidates. Output is always provenance=llm_inference and never enters the
 * scoring loop (D2) — the teacher confirm gate is mandatory.
 *
 * Mirrors OpenAICompatibleFeedbackGenerator: optional cloud LLM with a local
 * heuristic fallback so offline demos still produce drafts.
 */

export interface QuestionSplitInput {
  rawText: string
  subject: string
  sourceLabel: string
}

export interface QuestionSplitter {
  split(input: QuestionSplitInput): Promise<ImportDraftItem[]>
}

const LOW_CONFIDENCE_THRESHOLD = 0.55

const llmItemSchema = z.object({
  stem: z.string().min(1).max(8_000),
  questionType: z
    .enum([
      'choice',
      'fill_blank',
      'numeric',
      'expression',
      'chem_equation',
      'code',
      'essay'
    ])
    .default('fill_blank'),
  options: z
    .array(z.object({ id: z.string(), text: z.string() }))
    .optional(),
  answerCandidate: z.string().optional(),
  suggestedKpIds: z.array(z.string()).optional(),
  suggestedDifficulty: z.number().int().min(1).max(5).optional(),
  confidence: z.number().min(0).max(1).optional()
})

const llmResponseSchema = z.object({
  items: z.array(llmItemSchema).min(1).max(100)
})

export class LocalHeuristicQuestionSplitter implements QuestionSplitter {
  public split(input: QuestionSplitInput): Promise<ImportDraftItem[]> {
    const blocks = splitIntoBlocks(input.rawText)
    if (blocks.length === 0) {
      return Promise.resolve([
        toItem(0, input.rawText.trim() || '（空文档）', {
          confidence: 0.2,
          model: 'local-heuristic.v1',
          sourceLabel: input.sourceLabel
        })
      ])
    }

    return Promise.resolve(
      blocks.map((block, index) => {
        const parsed = parseBlock(block)
        return toItem(index, parsed.stem, {
          questionType: parsed.questionType,
          options: parsed.options,
          answerCandidate: parsed.answerCandidate,
          payloadCandidate: parsed.payloadCandidate,
          confidence: parsed.confidence,
          model: 'local-heuristic.v1',
          sourceLabel: input.sourceLabel
        })
      })
    )
  }
}

interface OpenAICompatibleSplitOptions {
  apiKey: string
  baseUrl: string
  model: string
  fallback: QuestionSplitter
  /** When false, skip network and use fallback immediately (T10). */
  allowsEgress: boolean
}

export class OpenAICompatibleQuestionSplitter implements QuestionSplitter {
  public constructor(private readonly options: OpenAICompatibleSplitOptions) {}

  public async split(input: QuestionSplitInput): Promise<ImportDraftItem[]> {
    if (!this.options.allowsEgress) {
      return this.options.fallback.split(input)
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
            temperature: 0.1,
            messages: [
              {
                role: 'system',
                content:
                  '你是试卷结构化助手。把文本拆成题目草稿，只输出 JSON：' +
                  '{"items":[{"stem":"...","questionType":"choice|fill_blank|numeric|expression|chem_equation|code|essay",' +
                  '"options":[{"id":"A","text":"..."}],"answerCandidate":"...","suggestedKpIds":[],"suggestedDifficulty":3,"confidence":0.8}]}。' +
                  '不得评分、不得编造学号/姓名。这是草稿，需老师校对。'
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
        throw new Error(`LLM split failed with HTTP ${response.status}`)
      }

      const payload = (await response.json()) as {
        choices?: Array<{ message?: { content?: string } }>
      }
      const content = payload.choices?.[0]?.message?.content
      if (!content) throw new Error('LLM split response had no content')

      const jsonMatch = content.match(/\{[\s\S]*\}/)
      if (!jsonMatch) throw new Error('LLM split response was not JSON')

      const parsed = llmResponseSchema.parse(JSON.parse(jsonMatch[0]))
      return parsed.items.map((item, index) =>
        toItem(index, item.stem, {
          questionType: item.questionType,
          options: item.options,
          answerCandidate: item.answerCandidate,
          payloadCandidate: buildPayloadCandidate(
            item.questionType,
            item.options,
            item.answerCandidate
          ),
          suggestedKpIds: item.suggestedKpIds,
          suggestedDifficulty: item.suggestedDifficulty,
          confidence: item.confidence ?? 0.7,
          model: this.options.model,
          sourceLabel: input.sourceLabel
        })
      )
    } catch {
      return this.options.fallback.split(input)
    }
  }
}

export function createQuestionSplitter(
  environment: NodeJS.ProcessEnv = process.env
): QuestionSplitter {
  const fallback = new LocalHeuristicQuestionSplitter()
  const apiKey = environment.LLM_API_KEY
  const baseUrl = environment.LLM_BASE_URL
  const model = environment.LLM_MODEL
  const allowsEgress =
    environment.LLM_ALLOW_EGRESS === 'true' ||
    environment.IMPORT_LLM_EGRESS === 'true'

  if (!apiKey || !baseUrl || !model || !allowsEgress) {
    return fallback
  }

  return new OpenAICompatibleQuestionSplitter({
    apiKey,
    baseUrl,
    model,
    fallback,
    allowsEgress
  })
}

// ---------------------------------------------------------------------------
// Local heuristic helpers
// ---------------------------------------------------------------------------

interface ParsedBlock {
  stem: string
  questionType: QuestionType
  options?: Array<{ id: string; text: string }>
  answerCandidate?: string
  payloadCandidate?: unknown
  confidence: number
}

const NUMBERED_SPLIT =
  /(?=^\s*(?:\d{1,3}[.、．]|[一二三四五六七八九十百]+[、．.])\s*)/m

function splitIntoBlocks(rawText: string): string[] {
  const normalized = rawText.replace(/\r\n/g, '\n').trim()
  if (normalized.length === 0) return []

  const parts = normalized
    .split(NUMBERED_SPLIT)
    .map((part) => part.trim())
    .filter((part) => part.length > 0)

  if (parts.length >= 2) return parts

  // Fallback: double-newline paragraphs.
  const paragraphs = normalized
    .split(/\n{2,}/)
    .map((part) => part.trim())
    .filter((part) => part.length > 0)
  return paragraphs.length > 0 ? paragraphs : [normalized]
}

function parseBlock(block: string): ParsedBlock {
  const lines = block
    .split('\n')
    .map((line) => line.trim())
    .filter((line) => line.length > 0)

  const optionLines: Array<{ id: string; text: string }> = []
  let answerCandidate: string | undefined
  const stemLines: string[] = []

  for (const line of lines) {
    const optionMatch = line.match(/^([A-Da-d])[.、．)）]\s*(.+)$/)
    if (optionMatch?.[1] && optionMatch[2] !== undefined) {
      optionLines.push({
        id: optionMatch[1].toUpperCase(),
        text: optionMatch[2]
      })
      continue
    }
    const answerMatch = line.match(
      /^(?:答案|参考答案|正确答案)[：:]\s*(.+)$/i
    )
    if (answerMatch?.[1]) {
      answerCandidate = answerMatch[1].trim()
      continue
    }
    stemLines.push(line)
  }

  const stem = stripLeadingNumber(stemLines.join('\n') || block)
  const questionType: QuestionType =
    optionLines.length >= 2 ? 'choice' : inferNonChoiceType(answerCandidate)

  return {
    stem,
    questionType,
    options: optionLines.length > 0 ? optionLines : undefined,
    answerCandidate,
    payloadCandidate: buildPayloadCandidate(
      questionType,
      optionLines.length > 0 ? optionLines : undefined,
      answerCandidate
    ),
    confidence: optionLines.length >= 2 || answerCandidate ? 0.75 : 0.45
  }
}

function stripLeadingNumber(stem: string): string {
  return stem
    .replace(/^\s*\d{1,3}[.、．]\s*/, '')
    .replace(/^\s*[一二三四五六七八九十百]+[、．.]\s*/, '')
    .trim()
}

function inferNonChoiceType(answer: string | undefined): QuestionType {
  if (!answer) return 'fill_blank'
  if (/^-?\d+(\.\d+)?$/.test(answer)) return 'numeric'
  if (/[=＋+]/.test(answer) && /[A-Za-z]/.test(answer)) return 'expression'
  if (/[=→]/.test(answer) && /[A-Z][a-z]?\d*/.test(answer)) {
    return 'chem_equation'
  }
  return 'fill_blank'
}

function buildPayloadCandidate(
  questionType: QuestionType,
  options: Array<{ id: string; text: string }> | undefined,
  answerCandidate: string | undefined
): unknown {
  switch (questionType) {
    case 'choice': {
      const ids =
        answerCandidate
          ?.toUpperCase()
          .split(/[,，\s]+/)
          .filter((id) => /^[A-D]$/.test(id)) ?? []
      return {
        kind: 'choice',
        correctOptionIds: ids.length > 0 ? ids : options?.[0] ? [options[0].id] : []
      }
    }
    case 'fill_blank':
      return {
        kind: 'fill_blank',
        acceptedAnswers: answerCandidate ? [answerCandidate] : []
      }
    case 'numeric': {
      const expected = answerCandidate ? Number(answerCandidate) : NaN
      return {
        kind: 'numeric',
        expected: Number.isFinite(expected) ? expected : 0,
        tolerance: 0
      }
    }
    case 'expression':
      return {
        kind: 'expression',
        expectedLatex: answerCandidate ?? ''
      }
    case 'chem_equation':
      return {
        kind: 'chem_equation',
        expectedEquation: answerCandidate ?? ''
      }
    case 'code':
      return {
        kind: 'python',
        functionName: 'solution',
        tests: []
      }
    case 'essay':
      return {
        kind: 'essay',
        dimensions: []
      }
    case 'geometry':
      // Geometry questions are authored by hand, not OCR-imported; emit an
      // empty spec so the switch stays exhaustive — importers override later.
      return {
        kind: 'geometry',
        vertices: {},
        sectionVertexIds: []
      }
    default: {
      const exhaustive: never = questionType
      return exhaustive
    }
  }
}

function toItem(
  index: number,
  stem: string,
  fields: {
    questionType?: QuestionType
    options?: Array<{ id: string; text: string }>
    answerCandidate?: string
    payloadCandidate?: unknown
    suggestedKpIds?: string[]
    suggestedDifficulty?: number
    confidence: number
    model: string
    sourceLabel: string
  }
): ImportDraftItem {
  const confidence = fields.confidence
  const provenance: Extract<Provenance, { kind: 'llm_inference' }> = {
    kind: 'llm_inference',
    sourceMessages: [fields.sourceLabel],
    model: fields.model,
    extractedAt: new Date().toISOString(),
    confidence
  }

  const item: ImportDraftItem = {
    index,
    stem,
    questionType: fields.questionType ?? 'fill_blank',
    suggestedKpIds: fields.suggestedKpIds ?? [],
    confidence,
    status: confidence < LOW_CONFIDENCE_THRESHOLD ? 'low_confidence' : 'pending',
    provenance
  }
  if (fields.options) item.options = fields.options
  if (fields.answerCandidate) item.answerCandidate = fields.answerCandidate
  if (fields.payloadCandidate !== undefined) {
    item.payloadCandidate = fields.payloadCandidate
  }
  if (fields.suggestedDifficulty !== undefined) {
    item.suggestedDifficulty = fields.suggestedDifficulty
  }
  return item
}
