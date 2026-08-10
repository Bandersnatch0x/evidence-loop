/**
 * AchievementIcon — 固定目录的克制图标（T20）。
 *
 * 白名单映射，**故意不做动态查表**：能出现在成就墙上的图标只有这 5 个，
 * 全是 lucide 线性单色。奖杯（Trophy）、皇冠（Crown）、金币（Coins）、
 * 火焰（Flame，连胜暗示）在这里根本没有入口 —— 这是 PRD「克制」边界的
 * 代码级落点，tests/achievements.test.ts 扫描本文件守护。
 */
import {
  CalendarCheck,
  CircleCheck,
  ListChecks,
  ShieldCheck,
  Wrench,
  type LucideIcon
} from 'lucide-react'
import type { AchievementId } from '../../../shared/achievements'

const ICONS: Record<AchievementId, LucideIcon> = {
  first_evidence_pass: ShieldCheck,
  repair_plus_20: Wrench,
  weak_kp_cleared: CircleCheck,
  streak_study_3: CalendarCheck,
  plan_day_done: ListChecks
}

interface AchievementIconProps {
  id: AchievementId
  size?: number
}

export function AchievementIcon({ id, size = 16 }: AchievementIconProps) {
  const Icon = ICONS[id]
  // strokeWidth 1.75 = 与全站线性图标一致；不做填充、不做渐变。
  return <Icon size={size} strokeWidth={1.75} aria-hidden />
}
