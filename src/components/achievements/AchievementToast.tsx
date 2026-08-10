/**
 * AchievementToast — 新徽章的**非阻塞**提示（T20）。
 *
 * 克制约定（PRD）：
 *   * 不是 modal，不遮挡内容，不打断答题流；用 role="status" +
 *     aria-live="polite" 让读屏也不抢话；
 *   * 一句话说清「凭什么」，并给一个「看证据」的入口，而不是「太棒了！」；
 *   * 动效由 CSS 控制，`prefers-reduced-motion: reduce` 时完全无动画；
 *   * 可随时关掉，关掉不损失任何信息（成就墙里永远查得到）。
 *
 * 组件本身不做定时自动消失 —— 由调用方决定，避免学生还没读完就没了。
 */
import { useEffect, useState } from 'react'
import { X } from 'lucide-react'
import {
  findAchievementEntry,
  type StudentAchievement
} from '../../../shared/achievements'
import { AchievementIcon } from './AchievementIcon'
import './achievements.css'

interface AchievementToastProps {
  achievement: StudentAchievement
  onDismiss: () => void
  /** 点「看证据」跳到成就墙对应卡片。缺省时不渲染该入口。 */
  onInspect?: (achievement: StudentAchievement) => void
}

export function AchievementToast({
  achievement,
  onDismiss,
  onInspect
}: AchievementToastProps) {
  const entry = findAchievementEntry(achievement.achievementId)
  const [isHovered, setIsHovered] = useState(false)

  useEffect(() => {
    if (isHovered) return
    const timer = setTimeout(() => {
      onDismiss()
    }, 5000)
    return () => clearTimeout(timer)
  }, [onDismiss, isHovered])

  return (
    <div
      className="achievement-toast"
      role="status"
      aria-live="polite"
      onMouseEnter={() => setIsHovered(true)}
      onMouseLeave={() => setIsHovered(false)}
    >
      <AchievementIcon id={achievement.achievementId} size={17} />
      <div className="achievement-toast-body">
        <span className="achievement-toast-title">
          已达成：{entry?.name ?? achievement.achievementId}
        </span>
        {/* 陈述硬条件与证据条数，不用感叹号、不用情绪词。 */}
        <span className="achievement-toast-detail">
          {entry?.condition ?? '判定条件见成就墙'} · 证据{' '}
          {achievement.evidenceRefs.length} 条
        </span>
        {onInspect ? (
          <button
            type="button"
            className="link-button"
            onClick={() => {
              onInspect(achievement)
            }}
          >
            看证据
          </button>
        ) : null}
      </div>
      <button
        type="button"
        className="achievement-toast-dismiss"
        onClick={onDismiss}
        aria-label="关闭提示"
      >
        <X size={14} />
      </button>
    </div>
  )
}
