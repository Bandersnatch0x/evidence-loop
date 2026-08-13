import { useCallback, useEffect, useState } from 'react'
import { AlertTriangle, Bell, Check } from 'lucide-react'
import type { StudentTipItem } from '../../../shared/contracts'
import { listStudentTips, markStudentTipRead } from '../../lib/api'

interface TeacherTipsInboxProps {
  /** Bump from parent to re-fetch after practice actions. */
  refreshKey?: number
  /** P0: replay a tip-bound question in practice mode. */
  onStartQuestion?: (questionId: string, mode: 'practice' | 'assessment') => void
}

/**
 * T14 — student inbox for teacher tips (站内消息).
 * Unread first; mark-read is per-student delivery only.
 */
export function TeacherTipsInbox({ refreshKey = 0, onStartQuestion }: TeacherTipsInboxProps) {
  const [items, setItems] = useState<StudentTipItem[]>([])
  const [error, setError] = useState<string>()
  const [loading, setLoading] = useState(true)
  const [busyId, setBusyId] = useState<string>()

  const refresh = useCallback(() => {
    setLoading(true)
    setError(undefined)
    listStudentTips()
      .then(setItems)
      .catch((loadError: unknown) => {
        setError(loadError instanceof Error ? loadError.message : '老师提示加载失败')
      })
      .finally(() => {
        setLoading(false)
      })
  }, [])

  useEffect(() => {
    refresh()
  }, [refresh, refreshKey])

  const unreadCount = items.filter((item) => item.readAt === undefined).length

  const markRead = async (tipId: string) => {
    setBusyId(tipId)
    setError(undefined)
    try {
      const updated = await markStudentTipRead(tipId)
      setItems((prev) =>
        prev
          .map((item) => (item.id === tipId ? updated : item))
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
        {unreadCount > 0 ? (
          <span className="unread-badge" aria-label={`${String(unreadCount)} 条未读`}>
            {unreadCount}
          </span>
        ) : null}
      </h3>

      {loading ? <p className="muted">加载中…</p> : null}
      {error !== undefined ? (
        <div className="error-banner">
          <AlertTriangle size={18} /> {error}
        </div>
      ) : null}
      {!loading && error === undefined && items.length === 0 ? (
        <p className="muted">暂时没有老师提示。</p>
      ) : null}

      {items.length > 0 ? (
        <ul className="tip-list">
          {items.map((item) => {
            const unread = item.readAt === undefined
            return (
              <li
                key={item.id}
                className={unread ? 'tip-row unread' : 'tip-row'}
              >
                <div className="tip-body">{item.body}</div>
                <div className="muted tip-meta">
                  {item.createdAt}
                  {item.kpIds && item.kpIds.length > 0
                    ? ` · KP ${item.kpIds.join(', ')}`
                    : ''}
                  {item.questionId ? ` · 题 ${item.questionId}` : ''}
                </div>
                {unread ? (
                  <button
                    type="button"
                    className="ghost"
                    disabled={busyId === item.id}
                    onClick={() => {
                      void markRead(item.id)
                    }}
                  >
                    <Check size={14} />{' '}
                    {busyId === item.id ? '标记中…' : '标为已读'}
                  </button>
                ) : (
                  <span className="muted tip-read">已读 {item.readAt}</span>
                )}
                {item.questionId && onStartQuestion ? (
                  <button
                    type="button"
                    className="ghost tip-replay"
                    onClick={() => onStartQuestion(item.questionId!, 'practice')}
                  >
                    立即重练
                  </button>
                ) : null}
              </li>
            )
          })}
        </ul>
      ) : null}
    </section>
  )
}
