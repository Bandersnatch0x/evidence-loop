import { useEffect, useState } from 'react'
import {
  CheckCircle2,
  Clock3,
  FileCheck2,
  Flag,
  Layers,
  RefreshCw,
  ShieldCheck
} from 'lucide-react'
import {
  getReviewerQueue,
  type ReviewerQueueReport,
  type ReviewerQueueVersion
} from '../../lib/api'
import { ErrorBanner } from '../Banner'

function formatDateTime(value: string): string {
  try {
    return new Intl.DateTimeFormat('zh-CN', {
      month: 'numeric',
      day: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
      hour12: false
    }).format(new Date(value))
  } catch {
    return value
  }
}

const REPORT_CATEGORY_LABELS: Record<string, string> = {
  copyright: '版权争议',
  illegal: '违法违规',
  inappropriate: '内容不当',
  spam: '垃圾营销',
  other: '其他问题'
}

export function ReviewerQueueView() {
  const [versions, setVersions] = useState<ReviewerQueueVersion[]>([])
  const [reports, setReports] = useState<ReviewerQueueReport[]>([])
  const [isLoading, setIsLoading] = useState(true)
  const [error, setError] = useState<string>()
  const [activeTab, setActiveTab] = useState<'versions' | 'reports'>('versions')

  const loadQueue = async () => {
    setIsLoading(true)
    setError(undefined)
    try {
      const data = await getReviewerQueue()
      setVersions(data.versions ?? [])
      setReports(data.reports ?? [])
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : '获取审核队列失败')
    } finally {
      setIsLoading(false)
    }
  }

  useEffect(() => {
    void loadQueue()
  }, [])

  if (isLoading) {
    return (
      <div className="view-loading" role="status" aria-live="polite">
        <span className="loading-bar" />
        正在读取公共库待审队列...
      </div>
    )
  }

  const totalPending = versions.length + reports.length

  return (
    <div className="page-view reviewer-view">
      <header className="page-heading reviewer-heading">
        <div>
          <h1>公共库审核</h1>
          <p>教学演示与公共资源同行评审 · 审核入库与合规处置</p>
        </div>
        <div className="reviewer-header-actions">
          <span className="open-badge">
            <ShieldCheck size={15} /> 共 {totalPending} 项待处理
          </span>
          <button
            type="button"
            className="secondary-button"
            onClick={() => void loadQueue()}
            aria-label="刷新队列"
          >
            <RefreshCw size={14} /> 刷新
          </button>
        </div>
      </header>

      {error && <ErrorBanner>{error}</ErrorBanner>}

      <div className="reviewer-tabs-row" role="tablist" aria-label="审核分类">
        <button
          type="button"
          role="tab"
          aria-selected={activeTab === 'versions'}
          className={`reviewer-tab ${activeTab === 'versions' ? 'is-active' : ''}`}
          onClick={() => setActiveTab('versions')}
        >
          <Layers size={15} />
          待审演示版本
          <span className="tab-count-badge">{versions.length}</span>
        </button>
        <button
          type="button"
          role="tab"
          aria-selected={activeTab === 'reports'}
          className={`reviewer-tab ${activeTab === 'reports' ? 'is-active' : ''}`}
          onClick={() => setActiveTab('reports')}
        >
          <Flag size={15} />
          待处理举报
          <span className="tab-count-badge">{reports.length}</span>
        </button>
      </div>

      <section className="reviewer-tab-body">
        {activeTab === 'versions' ? (
          versions.length === 0 ? (
            <div className="reviewer-empty-card" role="status">
              <CheckCircle2 size={24} className="reviewer-empty-icon" />
              <h3>暂无待审核的演示版本</h3>
              <p>所有教师提交的教学演示已完成同行评审或已上线。</p>
            </div>
          ) : (
            <ul className="reviewer-card-list">
              {versions.map((ver) => (
                <li key={ver.id} className="reviewer-card-item">
                  <div className="reviewer-card-head">
                    <div className="reviewer-card-title-group">
                      <FileCheck2 size={16} className="reviewer-card-icon" />
                      <strong>演示 #{ver.demonstrationId}</strong>
                      <span className="reviewer-pill version-pill">版本 {ver.id}</span>
                      <span className="reviewer-pill classification-pill">
                        {ver.classification || '通用演示'}
                      </span>
                    </div>
                    <span className="reviewer-card-time">
                      <Clock3 size={13} /> 提交于 {formatDateTime(ver.frozenAt)}
                    </span>
                  </div>
                  <div className="reviewer-card-footer">
                    <span className="status-label">待同行评审</span>
                    <span className="reviewer-card-hint">
                      由教师同行对教学内容、演示规范及无障碍特征进行核验
                    </span>
                  </div>
                </li>
              ))}
            </ul>
          )
        ) : reports.length === 0 ? (
          <div className="reviewer-empty-card" role="status">
            <CheckCircle2 size={24} className="reviewer-empty-icon" />
            <h3>暂无待处理的合规举报</h3>
            <p>公共库资源运行正常，未收到新的违规或不当内容反馈。</p>
          </div>
        ) : (
          <ul className="reviewer-card-list">
            {reports.map((rep) => (
              <li key={rep.id} className="reviewer-card-item is-report">
                <div className="reviewer-card-head">
                  <div className="reviewer-card-title-group">
                    <Flag size={16} className="reviewer-card-icon report-icon" />
                    <strong>举报 #{rep.id}</strong>
                    <span className="reviewer-pill category-pill">
                      {REPORT_CATEGORY_LABELS[rep.category] ?? rep.category}
                    </span>
                    <span className="reviewer-target">
                      关联演示 #{rep.demonstrationId}
                    </span>
                  </div>
                  <span className="reviewer-card-time">
                    举报人：{rep.reporterId}
                  </span>
                </div>
                <p className="reviewer-report-reason">举报理由：{rep.reason}</p>
                <div className="reviewer-card-footer">
                  <span className="status-label report-status">状态：{rep.status}</span>
                </div>
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  )
}
