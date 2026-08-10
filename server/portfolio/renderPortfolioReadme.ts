/**
 * renderPortfolioReadme — 作品集包的 README.md（人类可读摘要，T23）。
 *
 * 纯函数：`PortfolioPackage` → Markdown 字符串。包内数据入站时已做过
 * PII 净化，这里只做投影，不再触碰任何自由文本。
 *
 * 三条渲染铁律（与 T19 打印 HTML 同精神）：
 *   1. **证据分层可见**：每条 Attempt 给出证据原子计数与通过/失败明细，
 *      教师批注单独标注「教师批注」；
 *   2. **空态诚实**：attempts 为空时写明「没有符合默认选题且带证据的提交」，
 *      不编造任何条目；
 *   3. **覆盖可追溯**：封面含学生化名、教学单元、导出时间、算法与量规版本。
 */
import type { PortfolioPackage } from '../../shared/portfolio'

/** 包 → 完整 README.md。 */
export function renderPortfolioReadme(pkg: PortfolioPackage): string {
  const { meta } = pkg
  const lines: string[] = []

  lines.push('# 能力证据包 / 作品集')
  lines.push('')
  lines.push('> 本文件由系统确定性聚合生成，仅供实训报告 / 竞赛材料使用。')
  lines.push('')
  lines.push('## 封面')
  lines.push('')
  lines.push(`| 字段 | 值 |`)
  lines.push(`| --- | --- |`)
  lines.push(`| 学生标识（化名） | ${meta.studentAlias} |`)
  lines.push(`| 教学单元 | ${meta.teachingUnitId} |`)
  lines.push(`| 导出时间 | ${meta.exportedAt} |`)
  lines.push(`| 算法版本 | ${meta.algorithmVersion} |`)
  lines.push(`| 量规版本 | ${meta.rubricVersion} |`)
  lines.push('')

  if (pkg.attempts.length === 0) {
    lines.push('## 条目')
    lines.push('')
    lines.push('本包没有符合默认选题（assessment + code/essay）且带有证据的提交。')
    lines.push('')
    lines.push('> 系统不编造内容：没有证据就没有作品集条目。')
    lines.push('')
    return lines.join('\n')
  }

  lines.push(`## 条目（${String(pkg.attempts.length)}）`)
  lines.push('')

  for (const attempt of pkg.attempts) {
    const passed = attempt.evidence.filter((item) => item.passed).length
    const failed = attempt.evidence.length - passed
    lines.push(`### ${attempt.questionMeta.title || attempt.attemptId}`)
    lines.push('')
    lines.push(`- 提交锚点：\`${attempt.attemptId}\``)
    lines.push(
      `- 题目：\`${attempt.questionMeta.questionId}\`` +
        (attempt.questionMeta.questionType
          ? ` · ${attempt.questionMeta.questionType}`
          : '') +
        (attempt.questionMeta.subject
          ? ` · ${attempt.questionMeta.subject}`
          : '') +
        (attempt.questionMeta.kpIds.length > 0
          ? ` · KP：${attempt.questionMeta.kpIds.join(', ')}`
          : '')
    )
    lines.push(
      `- 得分：${String(attempt.score)}/${String(attempt.maxScore)}（确定性 Runner 判定）`
    )
    lines.push(
      `- 证据：${String(attempt.evidence.length)} 条（通过 ${String(passed)} / 失败 ${String(failed)}）`
    )
    lines.push(`- 提交指纹（sha256）：\`${attempt.submissionHash}\``)
    lines.push(`- 提交时间：${attempt.timestamp}`)

    if (attempt.teacherAnnotation) {
      lines.push(
        `- **教师批注**：${attempt.teacherAnnotation.comment}（${attempt.teacherAnnotation.teacherId}，${attempt.teacherAnnotation.at}）`
      )
    }
    lines.push('')
  }

  lines.push('---')
  lines.push('')
  lines.push('> 作品集中每一个数字都可追溯到确定性判题证据（Attempt / Evidence 原子）。')
  lines.push('> 练习（practice）成绩不计入本包。')
  lines.push('')
  return lines.join('\n')
}
