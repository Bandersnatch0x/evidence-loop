/**
 * 全计划锚点构成的一句话摘要，用于页脚审计提示（T18）。
 *
 * 独立成文件而不是放在 StudyPlanDayColumn.tsx —— 组件文件只导出组件，
 * 纯函数走独立文件，避免 react-refresh 误报。
 */
import type { StudyPlanEvidenceRef } from '../../../shared/studyPlan'

export function evidenceSummary(refs: StudyPlanEvidenceRef[]): string {
  const cards = refs.filter((ref) => ref.kind === 'review_card').length
  const snapshots = refs.filter((ref) => ref.kind === 'mastery_snapshot').length
  if (cards === 0 && snapshots === 0) return '暂无证据锚点'
  return `证据锚点 ${cards} 张复习卡 / ${snapshots} 条掌握度快照`
}
