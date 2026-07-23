import type { EssayRunnerSpec } from '../data/assignments'
import type { CodeRunner, RunnerEvidence, RunnerRequest, RunnerResult } from './types'
import { resolveSubmission } from './types'

/**
 * Essay / subjective-question runner (工单 028, ADR-0008 §2).
 *
 * Produces ONLY objective, deterministic evidence — the reproducible
 * dimensions of a written answer (字数、段落、句长、错别字/标点、结构完整性、
 * 关键词覆盖). Every metric is a pure function of the submission text, so the
 * same input always yields the same evidence (同入同出). These map to
 * `structural_metric` / `lint_result` EvidenceKind criteria and enter the
 * formal score (typically ~40% of an essay rubric).
 *
 * Subjective dimensions (立意、洞察、论证质量) are deliberately NOT touched
 * here — they live in the AdvisoryLayer (server/advisory) and never enter the
 * score. This runner has no LLM dependency and emits no numeric judgement of
 * quality beyond mechanical thresholds.
 */

/** Thresholds are deterministic knobs; defaults hold when spec omits them. */
export interface EssayRunnerOptions {
  /** Upper bound for 字数 when the spec supplies only a floor. */
  maxWords?: number
  /** Minimum distinct paragraphs for a complete structure. */
  minParagraphs?: number
  /** Inclusive average-sentence-length band, in 字. */
  sentenceLengthBand?: readonly [min: number, max: number]
  /** Max allowed heuristic spelling/punctuation issues before failing lint. */
  maxLintIssues?: number
}

const DEFAULT_MAX_WORDS = 1_200
const DEFAULT_MIN_PARAGRAPHS = 3
const DEFAULT_SENTENCE_BAND: readonly [number, number] = [8, 45]
const DEFAULT_MAX_LINT_ISSUES = 3
const DEFAULT_MIN_WORDS = 200

/** Structural signals extracted deterministically from the submission. */
export interface EssayMetrics {
  wordCount: number
  paragraphCount: number
  sentenceCount: number
  averageSentenceLength: number
  keywordHits: string[]
  keywordMisses: string[]
  lintIssues: string[]
  hasThesis: boolean
  hasSupport: boolean
  hasConclusion: boolean
}

const CJK_PATTERN = /[㐀-鿿豈-﫿]/gu
const LATIN_WORD_PATTERN = /[A-Za-z0-9]+/gu
const SENTENCE_TERMINATORS = /[。！？!?…]+/u
const THESIS_MARKERS = ['我认为', '观点', '主张', '论点', '认为', '立场', '首先']
const SUPPORT_MARKERS = ['因为', '例如', '比如', '由于', '数据', '研究', '其次', '此外', '证明']
const CONCLUSION_MARKERS = ['总之', '综上', '因此', '所以', '总而言之', '最后', '结论']

/**
 * 字数 for mixed CJK / Latin text: every CJK ideograph counts as one 字, and
 * each run of Latin letters/digits counts as one word. Deterministic and
 * whitespace-insensitive.
 */
export function countWords(text: string): number {
  const cjk = text.match(CJK_PATTERN)?.length ?? 0
  const latin = text.match(LATIN_WORD_PATTERN)?.length ?? 0
  return cjk + latin
}

/** Paragraphs are non-empty blocks separated by one or more blank lines. */
export function splitParagraphs(text: string): string[] {
  return text
    .split(/\n\s*\n/u)
    .map((block) => block.trim())
    .filter((block) => block.length > 0)
}

/** Sentences split on CJK/Latin terminal punctuation; empties dropped. */
export function splitSentences(text: string): string[] {
  return text
    .split(SENTENCE_TERMINATORS)
    .map((part) => part.trim())
    .filter((part) => part.length > 0)
}

/**
 * Deterministic spelling/punctuation heuristics — mechanical red flags only,
 * never a judgement of meaning:
 *   - repeated punctuation (，， 。。 !!)
 *   - a full-width comma/period directly followed by whitespace + more text
 *     with no space rule violated is skipped; we flag ASCII+CJK punctuation mix
 *   - trailing sentence with no terminator
 */
export function detectLintIssues(text: string): string[] {
  const issues: string[] = []

  if (/([，。！？；：、])\1/u.test(text)) {
    issues.push('检测到重复标点')
  }
  if (/[,.;:!?]{2,}/u.test(text)) {
    issues.push('检测到重复的半角标点')
  }
  if (/[，。！？；：][A-Za-z]/u.test(text) || /[a-zA-Z][，。！？；：]/u.test(text)) {
    issues.push('检测到中英文标点与字符紧邻，疑似标点误用')
  }
  if (/\s{3,}/u.test(text)) {
    issues.push('检测到多余连续空白')
  }
  const trimmed = text.trimEnd()
  if (trimmed.length > 0 && !/[。！？!?…"』」）)]$/u.test(trimmed)) {
    issues.push('结尾缺少句末标点')
  }

  return issues
}

/** Whether any marker in the list appears verbatim in the text. */
function containsAny(text: string, markers: readonly string[]): boolean {
  return markers.some((marker) => text.includes(marker))
}

/** Extract every objective metric. Pure: same text ⇒ same result. */
export function analyzeEssay(
  text: string,
  requiredKeywords: readonly string[]
): EssayMetrics {
  const paragraphs = splitParagraphs(text)
  const sentences = splitSentences(text)
  const wordCount = countWords(text)
  const averageSentenceLength =
    sentences.length === 0
      ? 0
      : Math.round((wordCount / sentences.length) * 10) / 10

  const keywordHits: string[] = []
  const keywordMisses: string[] = []
  for (const keyword of requiredKeywords) {
    if (text.includes(keyword)) {
      keywordHits.push(keyword)
    } else {
      keywordMisses.push(keyword)
    }
  }

  return {
    wordCount,
    paragraphCount: paragraphs.length,
    sentenceCount: sentences.length,
    averageSentenceLength,
    keywordHits,
    keywordMisses,
    lintIssues: detectLintIssues(text),
    hasThesis: containsAny(text, THESIS_MARKERS),
    hasSupport: containsAny(text, SUPPORT_MARKERS),
    hasConclusion: containsAny(text, CONCLUSION_MARKERS)
  }
}

function isEssayRunnerSpec(spec: unknown): spec is EssayRunnerSpec {
  return (
    typeof spec === 'object' &&
    spec !== null &&
    'kind' in spec &&
    spec.kind === 'essay'
  )
}

export class EssayRunner implements CodeRunner {
  public readonly name = 'essay-objective'

  private readonly maxWords: number
  private readonly minParagraphs: number
  private readonly sentenceLengthBand: readonly [number, number]
  private readonly maxLintIssues: number

  public constructor(options: EssayRunnerOptions = {}) {
    this.maxWords = options.maxWords ?? DEFAULT_MAX_WORDS
    this.minParagraphs = options.minParagraphs ?? DEFAULT_MIN_PARAGRAPHS
    this.sentenceLengthBand = options.sentenceLengthBand ?? DEFAULT_SENTENCE_BAND
    this.maxLintIssues = options.maxLintIssues ?? DEFAULT_MAX_LINT_ISSUES
  }

  public run(request: RunnerRequest): Promise<RunnerResult> {
    const startedAt = performance.now()
    const spec = request.assignment.runner

    if (!isEssayRunnerSpec(spec)) {
      return Promise.resolve(
        this.failedResult(
          startedAt,
          'Essay runner requires an EssayRunnerSpec (questionType: essay).'
        )
      )
    }

    const submission = resolveSubmission(request)
    if (submission.trim().length === 0) {
      return Promise.resolve({
        status: 'rejected',
        durationMs: this.elapsed(startedAt),
        evidence: [],
        reason: '提交为空，作文题至少需要正文内容。'
      })
    }

    const minWords = spec.minWords ?? DEFAULT_MIN_WORDS
    const requiredKeywords = spec.requiredKeywords ?? []
    const metrics = analyzeEssay(submission, requiredKeywords)

    const evidence: RunnerEvidence[] = [
      this.wordCountEvidence(metrics, minWords),
      this.paragraphEvidence(metrics),
      this.sentenceLengthEvidence(metrics),
      this.lintEvidence(metrics),
      this.structureEvidence(metrics),
      this.keywordEvidence(metrics, requiredKeywords)
    ]

    return Promise.resolve({
      status: 'completed',
      durationMs: this.elapsed(startedAt),
      evidence
    })
  }

  private wordCountEvidence(metrics: EssayMetrics, minWords: number): RunnerEvidence {
    const withinRange =
      metrics.wordCount >= minWords && metrics.wordCount <= this.maxWords
    return {
      id: 'word-count',
      state: withinRange ? 'passed' : 'failed',
      actual: String(metrics.wordCount),
      message: withinRange
        ? `字数 ${metrics.wordCount} 在 ${minWords}–${this.maxWords} 区间内`
        : `字数 ${metrics.wordCount} 不在要求区间 ${minWords}–${this.maxWords}`
    }
  }

  private paragraphEvidence(metrics: EssayMetrics): RunnerEvidence {
    const enough = metrics.paragraphCount >= this.minParagraphs
    return {
      id: 'paragraph-count',
      state: enough ? 'passed' : 'failed',
      actual: String(metrics.paragraphCount),
      message: enough
        ? `段落数 ${metrics.paragraphCount} 达到最低要求 ${this.minParagraphs}`
        : `段落数 ${metrics.paragraphCount} 少于要求的 ${this.minParagraphs} 段`
    }
  }

  private sentenceLengthEvidence(metrics: EssayMetrics): RunnerEvidence {
    const [min, max] = this.sentenceLengthBand
    const inBand =
      metrics.averageSentenceLength >= min &&
      metrics.averageSentenceLength <= max
    return {
      id: 'sentence-length',
      state: inBand ? 'passed' : 'failed',
      actual: String(metrics.averageSentenceLength),
      message: inBand
        ? `平均句长 ${metrics.averageSentenceLength} 字，节奏适中`
        : `平均句长 ${metrics.averageSentenceLength} 字，建议控制在 ${min}–${max} 字`
    }
  }

  private lintEvidence(metrics: EssayMetrics): RunnerEvidence {
    const clean = metrics.lintIssues.length <= this.maxLintIssues
    return {
      id: 'spelling-punctuation',
      state: clean ? 'passed' : 'failed',
      actual: String(metrics.lintIssues.length),
      message: clean
        ? metrics.lintIssues.length === 0
          ? '未发现错别字/标点启发式问题'
          : `发现 ${metrics.lintIssues.length} 处轻微标点问题，在容许范围内`
        : `发现 ${metrics.lintIssues.length} 处标点/书写问题：${metrics.lintIssues.join('；')}`
    }
  }

  private structureEvidence(metrics: EssayMetrics): RunnerEvidence {
    const complete = metrics.hasThesis && metrics.hasSupport && metrics.hasConclusion
    const missing: string[] = []
    if (!metrics.hasThesis) missing.push('论点')
    if (!metrics.hasSupport) missing.push('支撑')
    if (!metrics.hasConclusion) missing.push('结论')
    return {
      id: 'structure-completeness',
      state: complete ? 'passed' : 'failed',
      actual: complete ? '论点/支撑/结论齐备' : `缺少：${missing.join('、')}`,
      message: complete
        ? '结构完整：论点、支撑与结论均可检测到'
        : `结构不完整，缺少：${missing.join('、')}`
    }
  }

  private keywordEvidence(
    metrics: EssayMetrics,
    requiredKeywords: readonly string[]
  ): RunnerEvidence {
    if (requiredKeywords.length === 0) {
      return {
        id: 'keyword-coverage',
        state: 'passed',
        actual: '无关键词要求',
        message: '本题未设置关键词要求，默认通过'
      }
    }
    const allHit = metrics.keywordMisses.length === 0
    return {
      id: 'keyword-coverage',
      state: allHit ? 'passed' : 'failed',
      actual: `${metrics.keywordHits.length}/${requiredKeywords.length}`,
      message: allHit
        ? `覆盖全部关键词：${metrics.keywordHits.join('、')}`
        : `缺少关键词：${metrics.keywordMisses.join('、')}`
    }
  }

  private failedResult(startedAt: number, reason: string): RunnerResult {
    return {
      status: 'failed',
      durationMs: this.elapsed(startedAt),
      evidence: [],
      reason
    }
  }

  private elapsed(startedAt: number): number {
    return Math.max(1, Math.round(performance.now() - startedAt))
  }
}
