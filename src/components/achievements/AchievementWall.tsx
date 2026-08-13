/**
 * AchievementWall — 学生成就墙（T20）。
 *
 * 平铺固定目录 5 枚徽章：克制图标 + 名称 + **一句话硬条件**（学生看到的
 * 就是判定逻辑本身，没有隐藏规则）。已获得的可点开看自证来源。
 *
 * 边界：
 *   * 只渲染服务端判定结果，前端**不做任何条件判断** ——「是否获得」永远
 *     由确定性内核说了算；
 *   * 未获得只写事实差距（`progress.detail`），不写「加油/再接再厉」；
 *   * `unavailable`（如 T18 计划未接线）明说「判定输入不可用」，不伪装成
 *     「还没达成」；
 *   * 页面上没有积分、没有名次、没有与他人比较的任何字样。
 */
import { useCallback, useEffect, useState } from 'react'
import { AlertTriangle, Award, RefreshCw, ShieldCheck } from 'lucide-react'
import {
  findUnbackedAchievements,
  type AchievementId,
  type AchievementProgress,
  type StudentAchievement
} from '../../../shared/achievements'
import {
  getAchievements,
  syncAchievements,
  type AchievementSyncResponse,
  type AchievementWallResponse
} from './achievementsApi'
import { AchievementEvidencePanel } from './AchievementEvidencePanel'
import { AchievementIcon } from './AchievementIcon'
import { AchievementToast } from './AchievementToast'
import './achievements.css'

interface AchievementWallProps {
  studentId: string
  /** 缺省时 plan_day_done 报 unavailable，其余 4 枚照常判定。 */
  teachingUnitId?: string
  /** 变更即重新拉取（与 StudyPlanTimeline 的 refreshKey 约定一致）。 */
  refreshKey?: number
  /**
   * true = 交完卷回来，走 sync（判定 + 落库 + 弹新徽章 toast）；
   * false/缺省 = 纯只读浏览。
   */
  syncOnLoad?: boolean
}

export function AchievementWall({
  studentId,
  teachingUnitId,
  refreshKey = 0,
  syncOnLoad = false
}: AchievementWallProps) {
  const [data, setData] = useState<AchievementWallResponse>()
  const [error, setError] = useState<string>()
  const [isLoading, setIsLoading] = useState(true)
  const [openId, setOpenId] = useState<AchievementId>()
  const [toasts, setToasts] = useState<StudentAchievement[]>([])

  const load = useCallback(
    (withSync: boolean) => {
      setIsLoading(true)
      setError(undefined)
      const request = withSync
        ? syncAchievements(studentId, teachingUnitId)
        : getAchievements(studentId, teachingUnitId)
      return request
        .then((loaded) => {
          setData(loaded)
          if ('newlyEarned' in loaded) {
            setToasts((loaded as AchievementSyncResponse).newlyEarned)
          }
        })
        .catch((loadError: unknown) => {
          setError(
            loadError instanceof Error ? loadError.message : '成就加载失败'
          )
        })
        .finally(() => {
          setIsLoading(false)
        })
    },
    [studentId, teachingUnitId]
  )

  useEffect(() => {
    let cancelled = false
    void load(syncOnLoad).then(() => {
      if (cancelled) setToasts([])
    })
    return () => {
      cancelled = true
    }
  }, [load, syncOnLoad, refreshKey])

  const earnedById = new Map(
    (data?.earned ?? []).map((item) => [item.achievementId, item])
  )
  const progressById = new Map(
    (data?.progress ?? []).map((item) => [item.id, item])
  )
  // 出站不变量：任何一枚无证据的徽章都整体降级为错误提示，而非渲染出去。
  const unbacked = findUnbackedAchievements(data?.earned ?? [])

  return (
    <section className="achievements" aria-labelledby="achievements-title">
      <header className="achievements-header">
        <h3 id="achievements-title">
          <Award size={18} strokeWidth={1.75} /> 循证成就
        </h3>
        <span className="achievements-provenance">
          <ShieldCheck size={13} />
          规则判定 · 每枚可追溯到证据
        </span>
      </header>

      {toasts.map((achievement) => (
        <AchievementToast
          key={achievement.achievementId}
          achievement={achievement}
          onInspect={(item) => {
            setOpenId(item.achievementId)
          }}
          onDismiss={() => {
            setToasts((current) =>
              current.filter(
                (item) => item.achievementId !== achievement.achievementId
              )
            )
          }}
        />
      ))}

      {isLoading ? (
        <p className="achievements-note">正在按硬事实重新判定…</p>
      ) : null}

      {error !== undefined ? (
        <div className="error-banner" role="alert">
          <AlertTriangle size={18} /> {error}
        </div>
      ) : null}

      {unbacked.length > 0 ? (
        <div className="error-banner" role="alert">
          <AlertTriangle size={18} /> 检测到缺少证据链的徽章（
          {unbacked.join('、')}），已拒绝展示。
        </div>
      ) : null}

      {data !== undefined ? (
        <>
          <div className="achievements-grid">
            {data.catalog.map((entry) => {
              const earned = earnedById.get(entry.id)
              const progress = progressById.get(entry.id)
              const status = earned ? 'earned' : (progress?.status ?? 'locked')
              const isOpen = openId === entry.id
              return (
                <button
                  key={entry.id}
                  type="button"
                  className={`achievement-card is-${status}`}
                  onClick={() => {
                    setOpenId(isOpen ? undefined : entry.id)
                  }}
                  disabled={!earned}
                  aria-expanded={earned ? isOpen : undefined}
                >
                  <span className="achievement-card-top">
                    <AchievementIcon id={entry.id} />
                    <span className="achievement-card-name">{entry.name}</span>
                  </span>
                  <span className="achievement-card-condition">
                    {entry.condition}
                  </span>
                  <span className="achievement-card-detail">
                    {describeStatus(status, progress, earned)}
                  </span>
                  {earned ? (
                    <span className="achievement-card-cta">
                      {isOpen ? '收起证据' : '看凭什么 →'}
                    </span>
                  ) : null}
                </button>
              )
            })}
          </div>

          {openId !== undefined && earnedById.get(openId) ? (
            <AchievementEvidencePanel
              achievement={earnedById.get(openId) as StudentAchievement}
            />
          ) : null}

          <div className="achievements-note">
            已达成 {data.earnedCount} / {data.totalCount} · 判定算法{' '}
            {data.algorithm} ·{' '}
            <button
              type="button"
              className="link-button"
              onClick={() => void load(false)}
            >
              <RefreshCw size={12} /> 重新判定
            </button>
          </div>
          <p className="achievements-note">
            成就只由确定性规则判定，不参与任何评分，也不与其他同学比较。
          </p>
        </>
      ) : null}
    </section>
  )
}

/** 状态文案：只陈述可核对的事实，不做激励话术。 */
function describeStatus(
  status: string,
  progress: AchievementProgress | undefined,
  earned: StudentAchievement | undefined
): string {
  if (earned) {
    return `已达成 · 证据 ${earned.evidenceRefs.length} 条`
  }
  if (status === 'unavailable') {
    return progress?.detail ?? '判定所需的硬输入暂不可用。'
  }
  return progress?.detail ?? '尚未达成。'
}
