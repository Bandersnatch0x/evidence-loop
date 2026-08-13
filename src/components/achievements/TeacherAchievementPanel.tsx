/**
 * TeacherAchievementPanel — 教师班级聚合视图（T20）。
 *
 * **只计数，不排名。** 每一行是「某枚徽章有多少人达成 / 全班多少人」，
 * 顺序恒为固定目录顺序 —— 刻意不按 earnedCount 排序，因为排序本身就是
 * 排行榜。这里没有学生姓名、没有名次、没有「第一名」高亮，服务端也不
 * 下发这些数据（AchievementSummaryResponse 里根本没有学生字段）。
 *
 * 教师从这里读到的是覆盖率信号 —— 「只有 3/28 清掉了薄弱点」是教学动作
 * 的输入，不是评比材料。
 */
import { useEffect, useState } from 'react'
import { AlertTriangle, ShieldCheck, Users } from 'lucide-react'
import {
  getAchievementSummary,
  type AchievementSummaryResponse
} from './achievementsApi'
import { AchievementIcon } from './AchievementIcon'
import './achievements.css'

interface TeacherAchievementPanelProps {
  teachingUnitId: string
  refreshKey?: number
}

export function TeacherAchievementPanel({
  teachingUnitId,
  refreshKey = 0
}: TeacherAchievementPanelProps) {
  const [data, setData] = useState<AchievementSummaryResponse>()
  const [error, setError] = useState<string>()
  const [isLoading, setIsLoading] = useState(true)

  useEffect(() => {
    let cancelled = false
    setIsLoading(true)
    setError(undefined)
    getAchievementSummary(teachingUnitId)
      .then((loaded) => {
        if (!cancelled) setData(loaded)
      })
      .catch((loadError: unknown) => {
        if (!cancelled) {
          setError(
            loadError instanceof Error ? loadError.message : '班级成就概览加载失败'
          )
        }
      })
      .finally(() => {
        if (!cancelled) setIsLoading(false)
      })
    return () => {
      cancelled = true
    }
  }, [teachingUnitId, refreshKey])

  const total = data?.studentCount ?? 0

  return (
    <section className="achievements" aria-labelledby="achievements-summary-title">
      <header className="achievements-header">
        <h3 id="achievements-summary-title">
          <Users size={18} strokeWidth={1.75} /> 班级成就覆盖率
        </h3>
        <span className="achievements-provenance">
          <ShieldCheck size={13} />
          只计数 · 无排名
        </span>
      </header>

      {isLoading ? (
        <p className="achievements-note">正在按硬事实统计…</p>
      ) : null}

      {error !== undefined ? (
        <div className="error-banner" role="alert">
          <AlertTriangle size={18} /> {error}
        </div>
      ) : null}

      {data !== undefined && total === 0 ? (
        <p className="achievements-empty">该教学单元暂无在读学生。</p>
      ) : null}

      {data !== undefined && total > 0 ? (
        <>
          <div className="achievements-summary">
            {data.catalog.map((entry) => {
              const count =
                data.counts.find((item) => item.achievementId === entry.id)
                  ?.earnedCount ?? 0
              const ratio = total === 0 ? 0 : Math.round((count / total) * 100)
              return (
                <div className="achievements-summary-row" key={entry.id}>
                  <span className="achievements-summary-name">
                    <AchievementIcon id={entry.id} size={14} />
                    {entry.name}
                  </span>
                  <span
                    className="achievements-summary-bar"
                    role="img"
                    aria-label={`${entry.name}：${String(count)} / ${String(total)} 人达成`}
                  >
                    <span style={{ width: `${String(ratio)}%` }} />
                  </span>
                  <span className="achievements-summary-count">
                    {count} / {total}
                  </span>
                </div>
              )
            })}
          </div>
          <p className="achievements-note">
            算法 {data.algorithm} · 仅统计确定性规则判定的结果；不展示学生个人
            名单，也不做班内排名。
          </p>
        </>
      ) : null}
    </section>
  )
}
