/**
 * ISO → 本地可读。解析失败原样返回（不编造时间）。T20 共用格式化。
 *
 * 独立成文件而不是放在 AchievementEvidencePanel.tsx —— 组件文件只导出组件，
 * 纯函数走独立文件，避免 react-refresh 误报。
 */
export function formatMoment(iso: string): string {
  const date = new Date(iso)
  if (Number.isNaN(date.getTime())) return iso
  return date.toLocaleString('zh-CN', {
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit'
  })
}
