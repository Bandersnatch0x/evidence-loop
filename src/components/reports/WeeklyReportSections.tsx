/**
 * WeeklyReportSections — 周报章节的共享渲染层（T19）。
 *
 * 教师预览与学生「我的周报」共用**同一个**组件：两边看到的是同一份报告、
 * 同一套分层标识，不存在「教师视图特供数字」。
 *
 * 分层呈现是硬要求（PRD 验收 2）：
 *   - evidence 层         实心徽章 + 每个数字标注锚点条数
 *   - advisory（AI 文案） 灰色虚线框 + 「AI 文案」灰标 + 模型来源
 *   - teacher_annotation  教师批注标记
 * 证据不足的章节照常出现，显示空态文案，绝不隐藏或用往期数据顶替。
 */
import { FileText, Info, ShieldCheck, Sparkles, UserPen } from 'lucide-react'
import {
  isAdvisoryNarrative,
  type WeeklyReport,
  type WeeklyReportItem,
  type WeeklyReportLayer,
  type WeeklyReportSection
} from '../../../shared/weeklyReport'
import { describeRefs } from './describeRefs'
import './weeklyReport.css'

const LAYER_LABEL: Record<WeeklyReportLayer, string> = {
  evidence: '证据层',
  advisory: 'AI 文案',
  teacher_annotation: '教师批注'
}

interface WeeklyReportSectionsProps {
  report: WeeklyReport
}

export function WeeklyReportSections({ report }: WeeklyReportSectionsProps) {
  return (
    <div className="weekly-report-sections">
      {report.sections.map((section) => (
        <SectionCard key={section.id} section={section} />
      ))}
    </div>
  )
}

function SectionCard({ section }: { section: WeeklyReportSection }) {
  return (
    <section
      className={`weekly-report-section weekly-report-section-${section.layer}`}
    >
      <header className="weekly-report-section-head">
        <h4>{section.title}</h4>
        <LayerBadge layer={section.layer} />
        {section.status === 'insufficient_evidence' ? (
          <span className="weekly-report-badge weekly-report-badge-empty">
            证据不足
          </span>
        ) : null}
      </header>

      {section.status === 'insufficient_evidence' ? (
        <p className="weekly-report-empty">
          {section.emptyStateText ?? '本区间暂无数据。'}
        </p>
      ) : (
        <>
          {section.metrics.length > 0 ? (
            <div className="weekly-report-metrics">
              {section.metrics.map((metric) => (
                <div key={metric.id} className="weekly-report-metric">
                  <span className="weekly-report-metric-value">
                    {metric.value}
                    {metric.unit ? <em>{metric.unit}</em> : null}
                  </span>
                  <span className="weekly-report-metric-label">
                    {metric.label}
                  </span>
                  <span className="weekly-report-metric-refs">
                    <ShieldCheck size={11} />
                    {metric.evidenceRefs.length} 条证据
                  </span>
                </div>
              ))}
            </div>
          ) : null}

          {section.series && section.series.length > 0 ? (
            <table className="weekly-report-table">
              <thead>
                <tr>
                  <th>日期</th>
                  <th>得分</th>
                  <th>题目</th>
                  <th>提交锚点</th>
                </tr>
              </thead>
              <tbody>
                {section.series.map((point) => (
                  <tr key={point.attemptId}>
                    <td>{point.date}</td>
                    <td className="num">{point.score}</td>
                    <td className="mono">{point.questionId}</td>
                    <td className="mono">{point.attemptId}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          ) : null}

          {section.items.length > 0 ? (
            <ul className="weekly-report-items">
              {section.items.map((item) => (
                <ItemRow key={item.id} item={item} />
              ))}
            </ul>
          ) : null}

          {section.notes && section.notes.length > 0 ? (
            <ul className="weekly-report-notes">
              {section.notes.map((note) => (
                <li key={note}>
                  <Info size={11} /> {note}
                </li>
              ))}
            </ul>
          ) : null}

          <NarrativeBox section={section} />
        </>
      )}
    </section>
  )
}

function ItemRow({ item }: { item: WeeklyReportItem }) {
  return (
    <li className={`weekly-report-item weekly-report-item-${item.layer}`}>
      <span className="weekly-report-item-label">{item.label}</span>
      {item.layer === 'evidence' ? null : <LayerBadge layer={item.layer} />}
      {item.detail !== undefined ? (
        <span className="weekly-report-item-detail">{item.detail}</span>
      ) : null}
      {item.evidenceRefs.length > 0 ? (
        <span className="weekly-report-item-refs">
          {describeRefs(item.evidenceRefs)}
        </span>
      ) : null}
    </li>
  )
}

/** AI 文案框。双保险：渲染前再验一次 provenance，不合格一个字都不显示。 */
function NarrativeBox({ section }: { section: WeeklyReportSection }) {
  const narrative = section.narrative
  if (!narrative || !isAdvisoryNarrative(narrative)) return null
  const model =
    narrative.provenance.kind === 'llm_inference'
      ? narrative.provenance.model
      : ''
  return (
    <aside className="weekly-report-narrative">
      <span className="weekly-report-badge weekly-report-badge-advisory">
        <Sparkles size={11} /> {LAYER_LABEL.advisory}
      </span>
      <p>{narrative.text}</p>
      <span className="weekly-report-narrative-src">
        来源：{model} · llm_inference · 不参与评分与统计
      </span>
    </aside>
  )
}

function LayerBadge({ layer }: { layer: WeeklyReportLayer }) {
  const Icon =
    layer === 'evidence'
      ? ShieldCheck
      : layer === 'advisory'
        ? Sparkles
        : UserPen
  return (
    <span className={`weekly-report-badge weekly-report-badge-${layer}`}>
      <Icon size={11} /> {LAYER_LABEL[layer]}
    </span>
  )
}

/** 报告页眉：学生标识、区间、算法版本、锚点总数。 */
export function WeeklyReportHeader({
  report,
  evidenceCount
}: {
  report: WeeklyReport
  evidenceCount: number
}) {
  return (
    <div className="weekly-report-head">
      <h3>
        <FileText size={18} /> 学情周报 · {report.displayName}
      </h3>
      <span className="weekly-report-meta">
        {report.window.from.slice(0, 10)} 至 {report.window.to.slice(0, 10)} ·{' '}
        {report.algorithm} · {evidenceCount} 条证据锚点
      </span>
    </div>
  )
}
