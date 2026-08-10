/**
 * PortfolioExportPanel — T23 循证作品集导出面板。
 *
 * 双角色：
 *   - 学生模式（studentId = 自己）：一键导出本人证据包 zip；
 *   - 教师模式（可指定学生）：导出本单元在读学生的证据包 zip。
 *
 * 三条前端红线：
 *   1. 导出是**只读投影** —— 前端只发起 POST 并下载 blob，不做任何评分、
 *      不改写任何数据；服务端负责「无证据不入包」；
 *   2. 面板上不展示真实姓名/手机号/邮箱（服务端已做隐私净化，前端不绕过）；
 *   3. 每次导出都有服务端留痕（台账 + 审计链），面板只呈现成功/失败状态。
 */
import { useState } from 'react'
import { AlertTriangle, Download, FileArchive, RefreshCw } from 'lucide-react'
import {
  exportStudentPortfolioZip,
  exportTeacherPortfolioZip
} from './portfolioApi'
import './portfolio.css'

export interface PortfolioExportPanelProps {
  /** student 模式 = 学生本人；teacher 模式 = 教师指定学生。 */
  mode: 'student' | 'teacher'
  /** student 模式必填（本人 id）；teacher 模式可缺省（从单元选）。 */
  studentId?: string
  /** 教学单元 id（demo 环境固定 tu-demo）。 */
  teachingUnitId: string
  /** 可选：学生姓名/别名（仅展示用，教师模式友好提示）。 */
  displayName?: string
}

export function PortfolioExportPanel({
  mode,
  studentId,
  teachingUnitId,
  displayName
}: PortfolioExportPanelProps) {
  const [targetStudentId, setTargetStudentId] = useState(studentId ?? '')
  const [isExporting, setIsExporting] = useState(false)
  const [error, setError] = useState<string>()
  const [done, setDone] = useState<string>()

  const handleExport = () => {
    const effectiveStudentId =
      mode === 'student' ? (studentId ?? '') : targetStudentId.trim()
    if (effectiveStudentId === '') {
      setError('请先选择/填写学生，再导出证据包。')
      return
    }
    setIsExporting(true)
    setError(undefined)
    setDone(undefined)

    const request =
      mode === 'student'
        ? exportStudentPortfolioZip(teachingUnitId)
        : exportTeacherPortfolioZip(effectiveStudentId, teachingUnitId)

    void request
      .then((blob) => {
        const url = URL.createObjectURL(blob)
        const anchor = document.createElement('a')
        anchor.href = url
        anchor.download = `evidence-portfolio-${effectiveStudentId}.zip`
        document.body.appendChild(anchor)
        anchor.click()
        anchor.remove()
        URL.revokeObjectURL(url)
        setDone(
          mode === 'student'
            ? '证据包已导出并开始下载。'
            : `已导出 ${effectiveStudentId} 的证据包并开始下载。`
        )
      })
      .catch((exportError: unknown) => {
        setError(exportError instanceof Error ? exportError.message : '导出失败')
      })
      .finally(() => setIsExporting(false))
  }

  return (
    <section className="portfolio-panel" aria-labelledby="portfolio-title">
      <header className="portfolio-header">
        <h3 id="portfolio-title">
          <FileArchive size={18} /> 循证作品集导出
        </h3>
        <span className="portfolio-provenance">只读投影 · 无证据不入包</span>
      </header>

      <p className="portfolio-note">
        导出物只包含可追溯到 Evidence / 掌握度快照 / 徽章证据链的内容；
        不包含真实姓名、手机号、邮箱。导出动作在服务端留痕。
      </p>

      {mode === 'teacher' ? (
        <label className="portfolio-student-picker">
          学生
          <input
            value={targetStudentId}
            onChange={(event) => setTargetStudentId(event.target.value)}
            placeholder={displayName ? `${displayName}（或输入学号）` : '输入学生学号'}
          />
        </label>
      ) : null}

      {error !== undefined ? (
        <div className="error-banner">
          <AlertTriangle size={18} /> {error}
        </div>
      ) : null}
      {done !== undefined ? <div className="success-banner">{done}</div> : null}

      <div className="portfolio-actions">
        <button
          type="button"
          className="primary-button"
          disabled={isExporting}
          onClick={handleExport}
        >
          {isExporting ? (
            <RefreshCw size={14} className="is-spinning" />
          ) : (
            <Download size={14} />
          )}{' '}
          {isExporting
            ? '导出中…'
            : mode === 'student'
              ? '导出我的证据包'
              : '导出证据包（zip）'}
        </button>
      </div>
    </section>
  )
}
