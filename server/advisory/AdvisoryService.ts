import type { AdvisorySuggestion } from '../../shared/contracts'
import type { ExecutableAssignment } from '../data/assignments'
import {
  analyzeEssay,
  type EssayMetrics
} from '../runner/EssayRunner'

/**
 * Subjective advisory layer (工单 028, ADR-0008 §2 / ADR-0006).
 *
 * The objective, reproducible dimensions of an essay are scored by
 * {@link EssayRunner} and enter the formal Rubric total. This layer covers the
 * remaining subjective dimensions (立意、洞察、论证质量、语言表达) that have **no
 * reproducible evidence**. It produces {@link AdvisorySuggestion}s — coaching
 * notes, never grades:
 *
 *   - every suggestion carries `provenance.kind = 'llm_inference'`
 *   - the type has no score/weight field, so it is structurally impossible to
 *     fold advisory output into a score
 *   - `requiresTeacherConfirmation` is literally `true`; teacher terminal
 *     judgement gates any influence on Cohort metrics
 *
 * The MVP generates advice from deterministic rules/templates over the same
 * objective metrics, so it needs no live LLM. A real LLM provider can be
 * injected via {@link AdvisoryProvider} without changing the scoring contract:
 * the provider's output is always re-stamped as advice here.
 */

/** How advice text is produced. Rule/template MVP or an injected LLM. */
export interface AdvisoryProvider {
  /** Stable identifier recorded in provenance.model. */
  readonly model: string
  /**
   * Produce advice bodies for the subjective dimensions. Implementations must
   * NOT return scores; only free-text coaching per dimension label.
   */
  compose(input: AdvisoryProviderInput): Promise<AdvisoryDraft[]> | AdvisoryDraft[]
}

/** Context handed to a provider. Read-only; the provider must not mutate it. */
export interface AdvisoryProviderInput {
  readonly submission: string
  readonly assignment: ExecutableAssignment
  readonly metrics: EssayMetrics
}

/** A provider's raw draft, before it is stamped with provenance here. */
export interface AdvisoryDraft {
  dimensionLabel: string
  suggestion: string
  /** Optional model self-reported confidence, echoed into provenance. */
  confidence?: number
}

export interface AdvisoryRequest {
  submission: string
  assignment: ExecutableAssignment
}

/** Subjective dimensions the MVP rule engine reasons about. */
const SUBJECTIVE_DIMENSIONS = [
  '立意与观点',
  '论证质量',
  '语言表达',
  '结构与逻辑'
] as const

/**
 * Deterministic rule/template provider. Derives coaching hints from the
 * objective metrics without asserting any grade. Same input ⇒ same advice.
 */
export class RuleBasedAdvisoryProvider implements AdvisoryProvider {
  public readonly model = 'advisory-rules.v1'

  public compose(input: AdvisoryProviderInput): AdvisoryDraft[] {
    const { metrics } = input
    return [
      this.thesisAdvice(metrics),
      this.argumentAdvice(metrics),
      this.languageAdvice(metrics),
      this.structureAdvice(metrics)
    ]
  }

  private thesisAdvice(metrics: EssayMetrics): AdvisoryDraft {
    const suggestion = metrics.hasThesis
      ? '文中可检测到明确的观点信号，建议进一步打磨立意的独特性与深度，让论点更有辨识度。'
      : '未检测到清晰的观点标记，建议在开头用一句话直接亮明中心论点，帮助读者把握立意。'
    return { dimensionLabel: '立意与观点', suggestion, confidence: 0.4 }
  }

  private argumentAdvice(metrics: EssayMetrics): AdvisoryDraft {
    const suggestion = metrics.hasSupport
      ? '文中出现了论据/举例信号，建议检查每个论点是否都配有具体、可信的支撑，避免泛泛而谈。'
      : '未检测到明显的论据或举例，建议补充数据、事例或引用来支撑论点，增强说服力。'
    return { dimensionLabel: '论证质量', suggestion, confidence: 0.4 }
  }

  private languageAdvice(metrics: EssayMetrics): AdvisoryDraft {
    const suggestion =
      metrics.averageSentenceLength > 40
        ? '平均句长偏长，建议适当拆分长句、控制节奏，让表达更清晰有力。'
        : '句子长度分布合理，建议在保持清晰的同时，尝试更丰富的句式与更精准的用词。'
    return { dimensionLabel: '语言表达', suggestion, confidence: 0.35 }
  }

  private structureAdvice(metrics: EssayMetrics): AdvisoryDraft {
    const suggestion = metrics.hasConclusion
      ? '结尾有收束信号，建议让结论回扣开头论点，形成呼应，提升整体逻辑闭环。'
      : '未检测到明确的结论段，建议补充一个总结段落，收束全文并重申立场。'
    return { dimensionLabel: '结构与逻辑', suggestion, confidence: 0.35 }
  }
}

export class AdvisoryService {
  private readonly provider: AdvisoryProvider

  public constructor(provider: AdvisoryProvider = new RuleBasedAdvisoryProvider()) {
    this.provider = provider
  }

  /**
   * Produce advisory suggestions for the subjective dimensions. Never returns
   * or mutates a score. Every item is stamped `llm_inference` + teacher-gated.
   */
  public async suggest(request: AdvisoryRequest): Promise<AdvisorySuggestion[]> {
    const { submission, assignment } = request
    const spec = assignment.runner
    const requiredKeywords =
      'kind' in spec && spec.kind === 'essay' ? spec.requiredKeywords ?? [] : []
    const metrics = analyzeEssay(submission, requiredKeywords)

    const drafts = await this.provider.compose({ submission, assignment, metrics })
    const extractedAt = new Date().toISOString()

    return drafts.map((draft, index) => this.stamp(draft, index, extractedAt))
  }

  /** Re-stamp any provider draft as teacher-gated, non-scoring advice. */
  private stamp(
    draft: AdvisoryDraft,
    index: number,
    extractedAt: string
  ): AdvisorySuggestion {
    return {
      id: `advisory-${index}-${slugify(draft.dimensionLabel)}`,
      dimensionLabel: draft.dimensionLabel,
      suggestion: draft.suggestion,
      provenance: {
        kind: 'llm_inference',
        sourceMessages: [draft.suggestion],
        model: this.provider.model,
        extractedAt,
        ...(draft.confidence !== undefined ? { confidence: draft.confidence } : {})
      },
      requiresTeacherConfirmation: true
    }
  }
}

/** Stable, ASCII-safe id fragment from a (possibly CJK) dimension label. */
function slugify(label: string): string {
  const ascii = label.replace(/[^A-Za-z0-9]+/gu, '-').replace(/^-+|-+$/gu, '')
  if (ascii.length > 0) return ascii.toLowerCase()
  // CJK label: derive a deterministic fragment from char codes.
  return [...label]
    .map((char) => char.codePointAt(0)?.toString(36) ?? '')
    .join('')
}

/** Dimensions the rule engine advises on; exported for tests/docs. */
export { SUBJECTIVE_DIMENSIONS }
