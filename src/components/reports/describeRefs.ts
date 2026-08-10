/**
 * 锚点摘要（类型 × 数量），避免在页面上铺开一长串 id（T19）。
 *
 * 独立成文件而不是放在 WeeklyReportSections.tsx —— 组件文件只导出组件，
 * 纯函数走独立文件，避免 react-refresh 误报。
 */
import type { WeeklyReportEvidenceRef } from '../../../shared/weeklyReport'

const REF_KIND_LABEL: Record<string, string> = {
  attempt: '作答',
  mistake_entry: '错题',
  teacher_tip: '教师提示',
  review_card: '复习卡',
  mastery_snapshot: '掌握度'
}

export function describeRefs(refs: WeeklyReportEvidenceRef[]): string {
  const counts = new Map<string, number>()
  for (const ref of refs) {
    counts.set(ref.kind, (counts.get(ref.kind) ?? 0) + 1)
  }
  const parts = [...counts.entries()]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([kind, count]) => `${REF_KIND_LABEL[kind] ?? kind}×${count}`)
  return `证据：${parts.join('、')}`
}
