import { useEffect, useState } from 'react'
import { AlertTriangle, Bell, Check } from 'lucide-react'
import type { StudentTipItem } from '../../../shared/contracts'
import { listStudentTips, markStudentTipRead } from '../../lib/api'

interface TeacherTipsInboxProps {
  /** Bump to force reload after role/session changes. */
  refreshKey?: number
}

/**
 * T14 student inbox for teacher tips. Unread first; mark-read is per delivery.
 */
export function TeacherTipsInbox({ refreshKey = 0 }: TeacherTipsInboxProps) {
  const [items, setItems] = useState<StudentTipItem[]>([])
  const [error, setError] = useState<string>()
  const [loading, setLoading] = useState(true)
  const [busyId, setBusyId] = useState<string>()

  const load = async () => {
    setLoading(true)
    try {
      const list = await listStudentTips()
      setItems(list)
      setError(undefined)
    } catch (loadError: unknown) {
      setError(loadError instanceof Error ? loadError.message : '老师提示加载失败')
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    void load()
  }, [refreshKey])

  const unread = items.filter((item) => item.readAt === undefined).length

  const markRead = async (tipId: string) => {
    setBusyId(tipId)
    try {
      const updated = await markStudentTipRead(tipId)
      setItems((prev) =>
        prev
          .map((item) => (item.id === tipId ? { ...item, ...updated } : item))
          .sort((a, b) => {
            const aUnread = a.readAt === undefined ? 0 : 1
            const bUnread = b.readAt === undefined ? 0 : 1
            if (aUnread !== bUnread) return aUnread - bUnread
            return b.createdAt.localeCompare(a.createdAt)
          })
      )
    } catch (markError: unknown) {
      setError(markError instanceof Error ? markError.message : '标记已读失败')
    } finally {
      setBusyId(undefined)
    }
  }

  return (
    <section className="teacher-tips-inbox" aria-labelledby="teacher-tips-title">
      <h3 id="teacher-tips-title">
        <Bell size={18} style={{ verticalAlign: 'middle' }} /> 老师提示
        {unread > 0 ? (
          <span className="tip-unread-badge" aria-label={`${unread} 条未读`}>
            {unread}
          </span>
        ) : null}
      </h3>
      <p className="muted">教师手写短提示（非系统作业、不改分数）。</p>

      {loading ? <p className="muted">加载中…</p> : null}
      {error !== undefined ? (
        <div className="error-banner">
          <AlertTriangle size={18} /> {error}
        </div>
      ) : null}
      {!loading && error === undefined && items.length === 0 ? (
        <p className="muted">暂无老师提示。</p>
      ) : null}

      {items.length > 0 ? (
        <ul className="tip-list">
          {items.map((item) => {
            const unreadItem = item.readAt === undefined
            return (
              <li
                key={item.id}
                className={unreadItem ? 'tip-row unread' : 'tip-row'}
              >
                <div className="tip-body">{item.body}</div>
                <div className="tip-actions">
                  <span className="muted tip-meta">{item.createdAt}</span>
                  {unreadItem ? (
                    <button
                      type="button"
                      className="mark-read-btn"
                      disabled={busyId === item.id}
                      onClick={() => void markRead(item.id)}
                    >
                      <Check size={14} /> 标为已读
                    </button>
                  ) : (
                    <span className="mode-badge practice">已读</span>
                  )}
                </div>
              </li>
            )
          })}
        </ul>
      ) : null}
    </section>
  )
}
