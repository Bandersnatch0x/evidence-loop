/**
 * AchievementEvidencePanel — 「这枚徽章凭什么给我」抽屉（T20 核心红线）。
 *
 * 每一枚徽章都必须能点开看到**自证来源**：这里逐条列出 evidenceRefs，
 * 每条都直指硬事实（Attempt id / Evidence 原子数 / 错题移出记录 /
 * 学习日 / T18 计划任务），学生和家长可以逐条核对。
 *
 * 三条前端红线：
 *   1. evidenceRefs 为空时**不渲染徽章内容**，改为醒目的数据异常提示 ——
 *      「没有证据就没有徽章」在 UI 层也不放行；
 *   2. 祝贺文案单独渲染在虚线框里并标注 AI 生成，与硬证据视觉分离；
 *   3. 这里不出现任何「积分 / 等级 / 稀有度」字样，因为数据里就没有。
 */
import { AlertTriangle, Link2, ShieldCheck, Sparkles } from 'lucide-react'
import { formatMoment } from './formatMoment'
import {
  describeEvidenceRef,
  findAchievementEntry,
  isCongratulationHint,
  type StudentAchievement
} from '../../../shared/achievements'
import './achievements.css'

interface AchievementEvidencePanelProps {
  achievement: StudentAchievement
}

export function AchievementEvidencePanel({
  achievement
}: AchievementEvidencePanelProps) {
  const entry = findAchievementEntry(achievement.achievementId)
  const hint = achievement.presentationHint

  // 不变量守卫：无证据的徽章不渲染成「成就」，而是明说数据异常。
  if (achievement.evidenceRefs.length === 0) {
    return (
      <div className="achievement-evidence" role="note">
        <p className="achievement-evidence-title">
          <AlertTriangle size={15} /> 该徽章缺少证据链，已拒绝展示
        </p>
        <p className="achievement-evidence-meta">
          徽章必须能追溯到确定性判定产生的证据。请联系管理员核查
          {' '}
          {achievement.achievementId}。
        </p>
      </div>
    )
  }

  return (
    <div className="achievement-evidence" role="note">
      <p className="achievement-evidence-title">
        <ShieldCheck size={15} /> 凭什么获得「{entry?.name ?? achievement.achievementId}」
      </p>
      <p className="achievement-evidence-meta">
        判定条件：{entry?.condition ?? '—'}
      </p>
      <p className="achievement-evidence-meta">
        获得于 {formatMoment(achievement.earnedAt)} · 判定算法{' '}
        {achievement.algorithm} · 证据 {achievement.evidenceRefs.length} 条
      </p>

      <ul className="achievement-evidence-list">
        {achievement.evidenceRefs.map((ref, index) => (
          <li key={`${ref.kind}-${String(index)}`}>
            <Link2 size={11} /> {describeEvidenceRef(ref)}
          </li>
        ))}
      </ul>

      {isCongratulationHint(hint) && hint !== undefined ? (
        <p className="achievement-hint">
          <Sparkles size={14} />
          <span>
            <strong>祝贺文案（AI 生成 · llm_inference，不参与判定）：</strong>
            {hint.text}
          </span>
        </p>
      ) : null}
    </div>
  )
}
