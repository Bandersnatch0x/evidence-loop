import type { FeedbackContext } from '../domain/feedback'
import type { StandardSolution } from '../../shared/contracts'
import {
  buildTutoringContext,
  type TutoringContext
} from '../questionbank/solution'

/**
 * Deterministic template fallbacks when the LLM is unavailable (TR2 §4.3).
 * Never blocks the practice loop; never invents numeric answers beyond evidence.
 */

export function buildExplainTemplate(
  context: FeedbackContext,
  solution?: StandardSolution
): string {
  const tutoring = buildTutoringContext(solution)
  const failed = context.evidence.filter((item) => item.state !== 'passed')
  const focus = context.diagnoses[0]?.title ?? failed[0]?.label ?? '关键证据'

  if (tutoring.mode === 'rag_restate' && tutoring.ragContent) {
    const steps =
      tutoring.ragKeyPoints && tutoring.ragKeyPoints.length > 0
        ? `关键步骤：${tutoring.ragKeyPoints.slice(0, 3).join('；')}。`
        : ''
    return [
      `针对「${context.assignment.title}」的讲解（基于教师标准解析）：`,
      tutoring.ragContent.length > 280
        ? `${tutoring.ragContent.slice(0, 280)}…`
        : tutoring.ragContent,
      steps,
      failed.length > 0
        ? `你当前未通过的证据集中在「${focus}」，对照上述解析检查对应步骤。`
        : `当前得分 ${String(context.score)} 分，可对照解析巩固思路。`,
      '分数以可验证证据为准，本讲解仅供理解参考。'
    ]
      .filter((part) => part.length > 0)
      .join('')
  }

  if (failed.length === 0) {
    return `本题证据已全部通过（${String(context.score)} 分）。建议用自己的话复述解题思路，并尝试变式巩固。分数以证据为准。`
  }

  const evidenceHints = failed
    .slice(0, 2)
    .map((item) => item.message)
    .join('；')
  return `当前得分 ${String(context.score)} 分，优先处理「${focus}」。证据提示：${evidenceHints}。先定位卡点再重做，不要跳过中间步骤。分数以可验证证据为准。`
}

export function buildSocraticTemplate(
  context: FeedbackContext,
  message: string,
  lowEffortStreak: number,
  solution?: StandardSolution
): string {
  if (lowEffortStreak >= 3) {
    return '你已经连续多次只索取提示而没有展示自己的尝试。请先说明你卡在哪一步、已经试过什么，再继续提示。'
  }

  const failed = context.evidence.filter((item) => item.state !== 'passed')
  const focus = context.diagnoses[0]?.title ?? failed[0]?.label ?? '题目要求'
  const tutoring = buildTutoringContext(solution)
  const lower = message.trim().toLowerCase()

  if (
    lower.includes('答案') ||
    lower.includes('直接告诉') ||
    lower.includes('完整解')
  ) {
    return `我不会直接给出原题答案。先想：本题与「${focus}」相关的第一步应该做什么？请用一句话说出你的想法。`
  }

  if (tutoring.mode === 'rag_restate' && tutoring.ragKeyPoints?.[0]) {
    return `我们先不看原题完整解法。若用同构例题练习，第一步通常是：${tutoring.ragKeyPoints[0]}。你在原题上对应这一步做到哪了？`
  }

  return `我们用苏格拉底方式推进：关于「${focus}」，你目前最卡的是哪一小步？请只回答这一处。`
}

export function buildDialogueTemplate(
  context: FeedbackContext,
  message: string,
  solution?: StandardSolution
): string {
  const tutoring = buildTutoringContext(solution)
  const failed = context.evidence.filter((item) => item.state !== 'passed')
  const focus = context.diagnoses[0]?.title ?? failed[0]?.label ?? '本题要点'
  const q = message.trim()

  if (tutoring.mode === 'rag_restate' && tutoring.ragContent) {
    return `关于「${q.slice(0, 40)}」：标准解析强调围绕「${focus}」展开。你可以对照解析中的对应步骤自查，但最终得分仍以证据为准。还想追问哪一步？`
  }

  return `关于「${q.slice(0, 40)}」：结合当前证据，建议先聚焦「${focus}」。可以换个角度描述你的疑问（例如“为什么这一步需要…”），我会继续解释，但不会改分或编造未在证据中的结论。`
}

export function explainDisclaimer(tutoring: TutoringContext): string | undefined {
  if (tutoring.requiresDisclaimer) {
    return 'AI 辅导仅供参考，可能有误；分数以可验证证据为准。'
  }
  return 'AI 辅导仅供理解参考；分数以可验证证据为准。'
}
