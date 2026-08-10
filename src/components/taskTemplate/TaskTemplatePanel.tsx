/**
 * TaskTemplatePanel — 复赛 item 3 知识点任务模板面板。
 *
 * 教师侧「循证工具」里的模板目录：每张卡片 = 任务配置（预置题）+ 量规
 * （题自带 criteria）+ 知识诊断（kp 绑定）。一键部署到教学单元，复用
 * AssignmentService；部署结果展示布置的学生数。铁律：模板不写分。
 */
import { useEffect, useState } from 'react'
import { BookOpenCheck, Rocket } from 'lucide-react'
import {
  deployTaskTemplate,
  listTaskTemplates,
  type TaskTemplateView
} from './taskTemplateApi'

const DEMO_UNIT = 'tu-demo'

export function TaskTemplatePanel() {
  const [templates, setTemplates] = useState<TaskTemplateView[]>([])
  const [error, setError] = useState<string | null>(null)
  const [deploying, setDeploying] = useState<string | null>(null)
  const [deployed, setDeployed] = useState<Record<string, string>>({})

  useEffect(() => {
    listTaskTemplates()
      .then((response) => setTemplates(response.templates))
      .catch((err: unknown) => {
        setError(err instanceof Error ? err.message : '加载任务模板失败')
      })
  }, [])

  async function handleDeploy(template: TaskTemplateView): Promise<void> {
    setDeploying(template.id)
    setError(null)
    try {
      const result = await deployTaskTemplate(template.id, {
        teachingUnitId: DEMO_UNIT
      })
      setDeployed((previous) => ({
        ...previous,
        [template.id]: `已布置 ${result.assignment.studentIds.length} 名学生`
      }))
    } catch (err) {
      setError(
        err instanceof Error ? err.message : `部署 ${template.name} 失败`
      )
    } finally {
      setDeploying(null)
    }
  }

  return (
    <div className="task-template-panel">
      {error && <p className="task-template-error" role="alert">{error}</p>}
      {templates.length === 0 && !error && (
        <p className="muted">模板库为空。</p>
      )}
      <ul className="task-template-grid">
        {templates.map((template) => (
          <li key={template.id} className="task-template-card">
            <header>
              <BookOpenCheck size={16} aria-hidden="true" />
              <h4>{template.name}</h4>
              <span className="task-template-subject">{template.subject}</span>
            </header>
            <p className="task-template-desc">{template.description}</p>
            <ul className="task-template-kps" aria-label="绑定知识点">
              {template.kpNames.map((kp) => (
                <li key={kp}>{kp}</li>
              ))}
            </ul>
            <footer>
              <span className="task-template-meta">
                约 {template.estimatedMinutes} 分钟 · 难度{' '}
                {'★'.repeat(template.difficulty)}
              </span>
              <button
                type="button"
                className="task-template-deploy"
                disabled={deploying === template.id}
                onClick={() => void handleDeploy(template)}
              >
                <Rocket size={14} aria-hidden="true" />
                {deploying === template.id ? '部署中…' : '一键部署'}
              </button>
            </footer>
            {deployed[template.id] && (
              <p className="task-template-result" role="status">
                {deployed[template.id]}
              </p>
            )}
          </li>
        ))}
      </ul>
    </div>
  )
}
