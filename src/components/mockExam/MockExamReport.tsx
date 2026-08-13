/**
 * MockExamReport — 模拟考交卷报告（T16）。
 *
 * 分科分节：每科的客观得分 + KP 诊断，再给跨学科「共性薄弱」与失败证据 TopN。
 *
 * 边界：
 *   * 页面上的每一个分数都直接来自服务端 report（源头是确定性 Runner 写下的
 *     证据分），前端不做任何再计算、再加权；
 *   * 失败证据的文案原样展示，不做 LLM 改写；
 *   * 待教师终裁的主观建议只显示条数，明示「不计入分数」。
 */
import { useEffect, useState } from 'react'
import { AlertTriangle, ShieldCheck, TriangleAlert } from 'lucide-react'
import type { MockExamPaperReport } from '../../../shared/mockExam'
import { subjectLabel } from '../../lib/labels'
import { getMockExamReport } from './mockExamApi'
import './mockExam.css'
import { ErrorBanner } from '../../components/Banner'

interface MockExamReportProps {
  paperId: string
  /** 教师查看他人报告时传入；学生端留空 = 看自己的。 */
  studentId?: string
  /** 「去错题本」入口，由父级路由决定跳哪里。 */
  onOpenMistakeBook?: (kpIds: string[]) => void
}

export function MockExamReport({
  paperId,
  studentId,
  onOpenMistakeBook
}: MockExamReportProps) {
  const [report, setReport] = useState<MockExamPaperReport>()
  const [error, setError] = useState<string>()
  const [isLoading, setIsLoading] = useState(true)

  useEffect(() => {
    let cancelled = false
    setIsLoading(true)
    setError(undefined)
    getMockExamReport(paperId, studentId)
      .then((payload) => {
        if (!cancelled) setReport(payload.report)
      })
      .catch((loadError: unknown) => {
        if (!cancelled) {
          setError(loadError instanceof Error ? loadError.message : '报告加载失败')
        }
      })
      .finally(() => {
        if (!cancelled) setIsLoading(false)
      })
    return () => {
      cancelled = true
    }
  }, [paperId, studentId])

  if (isLoading) return <p className="mock-exam-note">加载中…</p>
  if (error !== undefined) {
    return (
      <ErrorBanner>{error}</ErrorBanner>
    )
  }
  if (report === undefined) return null

  return (
    <section className="mock-exam" aria-labelledby="mock-exam-report-title">
      <header className="mock-exam-header">
        <h3 id="mock-exam-report-title">{report.title} · 交卷报告</h3>
        <span className="mock-exam-provenance">
          <ShieldCheck size={13} />
          分数全部来自确定性证据
        </span>
      </header>

      <p className="mock-exam-note">
        {report.answeredCount}/{report.questionCount} 题已作答 · 通过{' '}
        {report.passedCount} 题 · 平均分 {report.averageScore}
        {report.notStartedCount > 0
          ? ` · ${String(report.notStartedCount)} 题未作答`
          : ''}
      </p>

      {report.subjects.map((section) => (
        <div key={section.subject} className="mock-exam-section">
          <h4>
            {subjectLabel(section.subject)} · {section.answeredCount}/
            {section.questionCount} 题 · 平均分 {section.averageScore}
          </h4>
          <ul className="mock-exam-kp-list">
            {section.kpDiagnoses.map((kp) => (
              <li key={kp.kpId}>
                <span className="mock-exam-kp">{kp.kpId}</span>
                <span className="mock-exam-note">
                  {kp.passed}/{kp.total} 通过（正确率 {kp.accuracy}）
                </span>
              </li>
            ))}
          </ul>
        </div>
      ))}

      {report.commonWeakKps.length > 0 ? (
        <div className="mock-exam-section">
          <h4>跨学科共性薄弱</h4>
          <ul className="mock-exam-kp-list">
            {report.commonWeakKps.map((kp) => (
              <li key={`${kp.subject}-${kp.kpId}`}>
                <span className="mock-exam-kp">{kp.kpId}</span>
                <span className="mock-exam-note">
                  {subjectLabel(kp.subject)} · 正确率 {kp.accuracy}
                </span>
              </li>
            ))}
          </ul>
          <button
            type="button"
            className="ghost-button"
            onClick={() => {
              onOpenMistakeBook?.(report.commonWeakKps.map((kp) => kp.kpId))
            }}
          >
            去错题本针对性重练
          </button>
        </div>
      ) : null}

      {report.failedEvidence.length > 0 ? (
        <div className="mock-exam-section">
          <h4>失败证据 Top {report.failedEvidence.length}</h4>
          <ul className="mock-exam-evidence">
            {report.failedEvidence.map((item) => (
              <li key={`${item.questionId}-${item.evidenceId}`}>
                <strong>{item.label}</strong>
                <span className="mock-exam-note">{item.message}</span>
                {item.expected !== undefined ? (
                  <span className="mock-exam-note">
                    期望 {item.expected} / 实际 {item.actual ?? '—'}
                  </span>
                ) : null}
              </li>
            ))}
          </ul>
        </div>
      ) : null}

      {report.pendingTeacherReview > 0 ? (
        <p className="mock-exam-note">
          <TriangleAlert size={12} /> {report.pendingTeacherReview}{' '}
          条主观题建议待教师终裁，不计入以上分数。
        </p>
      ) : null}
    </section>
  )
}
