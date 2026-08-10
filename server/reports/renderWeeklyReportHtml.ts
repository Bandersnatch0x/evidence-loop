/**
 * renderWeeklyReportHtml — 打印友好的周报 HTML（T19，MVP-0 导出形态）。
 *
 * 纯函数：`WeeklyReport` → 一整页自包含 HTML 字符串（内联样式，无外部资源，
 * 无脚本），浏览器直接 Ctrl+P 另存 PDF。服务端不引入任何 PDF 依赖。
 *
 * 三条渲染铁律：
 *   1. **分层可见**：evidence 层打实心徽章，AI 文案打灰色虚线框 + 「AI 文案」
 *      标记，teacher_annotation 打教师批注标记。看报告的人一眼能分清
 *      「这是判出来的」还是「这是写出来的」。
 *   2. **空态诚实**：证据不足的章节照常出现在页面上，显示空态文案，
 *      不隐藏、不用往期数据顶替。
 *   3. **转义一切**：所有动态内容（含教师提示正文）都过 `escapeHtml`，
 *      报告是要转发给家长的，绝不能变成 XSS 载体。
 */
import {
  isAdvisoryNarrative,
  type WeeklyReport,
  type WeeklyReportEvidenceRef,
  type WeeklyReportItem,
  type WeeklyReportSection
} from '../../shared/weeklyReport'

const LAYER_LABEL = {
  evidence: '证据层',
  advisory: 'AI 文案',
  teacher_annotation: '教师批注'
} as const

/** 报告 → 完整 HTML 文档。 */
export function renderWeeklyReportHtml(report: WeeklyReport): string {
  const title = `学情周报 · ${report.displayName}`
  const range = `${report.window.from.slice(0, 10)} 至 ${report.window.to.slice(0, 10)}`

  return `<!DOCTYPE html>
<html lang="zh-CN">
<head>
<meta charset="utf-8" />
<meta name="viewport" content="width=device-width, initial-scale=1" />
<title>${escapeHtml(title)}</title>
<style>${PRINT_CSS}</style>
</head>
<body>
<main class="report">
  <header class="report-head">
    <h1>学情周报</h1>
    <dl class="report-meta">
      <div><dt>学生标识</dt><dd>${escapeHtml(report.displayName)}</dd></div>
      <div><dt>教学单元</dt><dd>${escapeHtml(report.teachingUnitId)}</dd></div>
      <div><dt>学期</dt><dd>${escapeHtml(report.termId)}</dd></div>
      <div><dt>统计区间</dt><dd>${escapeHtml(range)}</dd></div>
      <div><dt>生成时间</dt><dd>${escapeHtml(report.generatedAt)}</dd></div>
      <div><dt>算法版本</dt><dd>${escapeHtml(report.algorithm)}</dd></div>
    </dl>
    ${
      report.status === 'insufficient_evidence'
        ? `<p class="report-banner">本区间内没有采集到足够的学习证据，以下章节均为空态。系统不会用推测内容填充报告。</p>`
        : ''
    }
  </header>

  ${report.sections.map(renderSection).join('\n  ')}

  <footer class="report-foot">
    <p>报告中的每一个数字均可追溯到确定性判题证据（Attempt / 掌握度快照 / 错题记录 / 复习卡片），共 ${String(
      report.evidenceRefs.length
    )} 条锚点。</p>
    <p>标注「${LAYER_LABEL.advisory}」的段落由语言模型生成，仅作叙述性说明，不参与任何评分与统计。</p>
    <p>练习（practice）成绩不计入正式掌握度与成绩单。</p>
  </footer>
</main>
</body>
</html>`
}

function renderSection(section: WeeklyReportSection): string {
  const badge = `<span class="badge badge-${section.layer}">${escapeHtml(
    LAYER_LABEL[section.layer]
  )}</span>`

  if (section.status === 'insufficient_evidence') {
    return `<section class="section section-empty">
    <h2>${escapeHtml(section.title)} ${badge}<span class="badge badge-empty">证据不足</span></h2>
    <p class="empty-text">${escapeHtml(section.emptyStateText ?? '本区间暂无数据。')}</p>
  </section>`
  }

  return `<section class="section">
    <h2>${escapeHtml(section.title)} ${badge}</h2>
    ${renderMetrics(section)}
    ${renderSeries(section)}
    ${renderItems(section)}
    ${renderNotes(section)}
    ${renderNarrative(section)}
  </section>`
}

function renderMetrics(section: WeeklyReportSection): string {
  if (section.metrics.length === 0) return ''
  const cells = section.metrics
    .map(
      (metric) => `<div class="metric">
        <span class="metric-value">${escapeHtml(String(metric.value))}${
          metric.unit ? `<em>${escapeHtml(metric.unit)}</em>` : ''
        }</span>
        <span class="metric-label">${escapeHtml(metric.label)}</span>
        <span class="metric-refs">${String(metric.evidenceRefs.length)} 条证据</span>
      </div>`
    )
    .join('\n      ')
  return `<div class="metrics">\n      ${cells}\n    </div>`
}

function renderSeries(section: WeeklyReportSection): string {
  const series = section.series
  if (!series || series.length === 0) return ''
  const rows = series
    .map(
      (point) => `<tr>
        <td>${escapeHtml(point.date)}</td>
        <td class="num">${escapeHtml(String(point.score))}</td>
        <td class="mono">${escapeHtml(point.questionId)}</td>
        <td class="mono">${escapeHtml(point.attemptId)}</td>
      </tr>`
    )
    .join('\n        ')
  return `<table class="table">
      <thead><tr><th>日期</th><th>得分</th><th>题目</th><th>提交锚点</th></tr></thead>
      <tbody>
        ${rows}
      </tbody>
    </table>`
}

function renderItems(section: WeeklyReportSection): string {
  if (section.items.length === 0) return ''
  return `<ul class="items">
      ${section.items.map(renderItem).join('\n      ')}
    </ul>`
}

function renderItem(item: WeeklyReportItem): string {
  const layerMark =
    item.layer === 'evidence'
      ? ''
      : `<span class="badge badge-${item.layer}">${escapeHtml(
          LAYER_LABEL[item.layer]
        )}</span>`
  return `<li class="item item-${item.layer}">
        <span class="item-label">${escapeHtml(item.label)}</span> ${layerMark}
        ${item.detail ? `<span class="item-detail">${escapeHtml(item.detail)}</span>` : ''}
        <span class="item-refs">${describeRefs(item.evidenceRefs)}</span>
      </li>`
}

function renderNotes(section: WeeklyReportSection): string {
  const notes = section.notes
  if (!notes || notes.length === 0) return ''
  return `<ul class="notes">
      ${notes.map((note) => `<li>${escapeHtml(note)}</li>`).join('\n      ')}
    </ul>`
}

function renderNarrative(section: WeeklyReportSection): string {
  const narrative = section.narrative
  // 双保险：渲染层再验一次 provenance，不合格的文案一个字都不印。
  if (!narrative || !isAdvisoryNarrative(narrative)) return ''
  const model =
    narrative.provenance.kind === 'llm_inference' ? narrative.provenance.model : ''
  return `<aside class="narrative">
      <span class="badge badge-advisory">${escapeHtml(LAYER_LABEL.advisory)}</span>
      <p>${escapeHtml(narrative.text)}</p>
      <span class="narrative-src">来源：${escapeHtml(
        model
      )} · llm_inference · 不参与评分</span>
    </aside>`
}

/** 锚点摘要 —— 打印页不展开完整 id 列表，只给类型与数量，保持可读。 */
function describeRefs(refs: WeeklyReportEvidenceRef[]): string {
  if (refs.length === 0) return ''
  const counts = new Map<string, number>()
  for (const ref of refs) {
    counts.set(ref.kind, (counts.get(ref.kind) ?? 0) + 1)
  }
  const parts = [...counts.entries()]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([kind, count]) => `${refKindLabel(kind)}×${String(count)}`)
  return escapeHtml(`证据：${parts.join('、')}`)
}

function refKindLabel(kind: string): string {
  switch (kind) {
    case 'attempt':
      return '提交'
    case 'mastery_snapshot':
      return '掌握度快照'
    case 'mistake_entry':
      return '错题'
    case 'review_card':
      return '复习卡'
    case 'teacher_tip':
      return '教师提示'
    default:
      return kind
  }
}

/** HTML 实体转义。报告要转发给家长，任何动态内容都必须过这里。 */
export function escapeHtml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;')
}

/**
 * 打印样式。刻意保守：1px 发丝边框、零阴影、无网页字体，
 * A4 单栏，`@media print` 下去掉背景色以省墨。
 */
const PRINT_CSS = `
:root {
  --ink: #1c1c1e;
  --ink-muted: #6b6b70;
  --line: #d8d8dc;
  --indigo: #3b3ba8;
  --indigo-wash: #eeeef8;
}
* { box-sizing: border-box; }
body {
  margin: 0;
  padding: 24px;
  color: var(--ink);
  font-family: -apple-system, "Segoe UI", "PingFang SC", "Microsoft YaHei", sans-serif;
  font-size: 13px;
  line-height: 1.6;
  background: #fff;
}
.report { max-width: 760px; margin: 0 auto; }
h1 { margin: 0 0 12px; font-size: 20px; font-weight: 650; }
h2 {
  display: flex; align-items: center; gap: 8px; flex-wrap: wrap;
  margin: 0 0 10px; font-size: 14px; font-weight: 650;
}
.report-head { padding-bottom: 14px; border-bottom: 1px solid var(--line); }
.report-meta { display: grid; grid-template-columns: repeat(3, 1fr); gap: 6px 16px; margin: 0; }
.report-meta div { display: flex; gap: 6px; }
.report-meta dt { color: var(--ink-muted); font-size: 11px; }
.report-meta dd { margin: 0; font-size: 11px; word-break: break-all; }
.report-banner {
  margin: 12px 0 0; padding: 8px 10px; color: var(--ink-muted);
  font-size: 11px; border: 1px dashed var(--line); border-radius: 6px;
}
.section { padding: 14px 0; border-bottom: 1px solid var(--line); page-break-inside: avoid; }
.section-empty .empty-text { margin: 0; color: var(--ink-muted); font-size: 12px; }
.badge {
  display: inline-block; padding: 1px 7px; font-size: 11px; font-weight: 650;
  border-radius: 999px; border: 1px solid var(--line);
}
.badge-evidence { color: var(--indigo); background: var(--indigo-wash); border-color: transparent; }
.badge-advisory { color: var(--ink-muted); border-style: dashed; }
.badge-teacher_annotation { color: var(--ink-muted); }
.badge-empty { color: var(--ink-muted); border-style: dashed; }
.metrics { display: grid; grid-template-columns: repeat(4, 1fr); gap: 8px; margin-bottom: 10px; }
.metric { padding: 8px 10px; border: 1px solid var(--line); border-radius: 6px; }
.metric-value { display: block; font-size: 18px; font-weight: 650; }
.metric-value em { margin-left: 2px; font-size: 11px; font-style: normal; font-weight: 400; color: var(--ink-muted); }
.metric-label { display: block; font-size: 11px; }
.metric-refs { display: block; font-size: 11px; color: var(--ink-muted); }
.table { width: 100%; border-collapse: collapse; margin-bottom: 10px; font-size: 11px; }
.table th, .table td { padding: 5px 8px; text-align: left; border-bottom: 1px solid var(--line); }
.table th { color: var(--ink-muted); font-weight: 650; }
.table .num { text-align: right; }
.table .mono { font-family: ui-monospace, Menlo, Consolas, monospace; word-break: break-all; }
.items { margin: 0 0 10px; padding-left: 18px; }
.item { margin-bottom: 6px; }
.item-label { font-weight: 650; }
.item-detail { display: block; color: var(--ink-muted); font-size: 11px; }
.item-refs { display: block; color: var(--ink-muted); font-size: 11px; }
.notes { margin: 0; padding-left: 18px; color: var(--ink-muted); font-size: 11px; }
.narrative {
  display: block; margin-top: 10px; padding: 9px 11px;
  border: 1px dashed var(--line); border-radius: 6px;
}
.narrative p { margin: 6px 0 4px; color: var(--ink-muted); font-size: 12px; }
.narrative-src { color: var(--ink-muted); font-size: 11px; }
.report-foot { padding-top: 12px; color: var(--ink-muted); font-size: 11px; }
.report-foot p { margin: 0 0 4px; }
@media print {
  body { padding: 0; }
  .badge-evidence { background: transparent; border-color: var(--line); }
  .section { page-break-inside: avoid; }
}
`
