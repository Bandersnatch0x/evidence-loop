/**
 * taskTemplateApi — 复赛 item 3 知识点任务模板的前端调用层。
 *
 * 读：模板目录；写：一键部署（复用服务端 AssignmentService，前端不放行判断）。
 */
import type { ApiError, DeployTaskTemplateResult } from '../../../shared/contracts'
import { DEMO_ROLE_HEADER, readStoredDemoRole } from '../../lib/demoRole'

export interface TaskTemplateView {
  id: string
  name: string
  subject: string
  kpIds: string[]
  kpNames: string[]
  questionId: string
  description: string
  estimatedMinutes: number
  difficulty: 1 | 2 | 3
}

export interface TaskTemplateListResponse {
  templates: TaskTemplateView[]
}

async function requestJson<T>(input: string, init?: RequestInit): Promise<T> {
  const response = await fetch(input, {
    ...init,
    headers: {
      accept: 'application/json',
      [DEMO_ROLE_HEADER]: readStoredDemoRole(),
      ...(init?.body ? { 'content-type': 'application/json' } : {}),
      ...init?.headers
    }
  })
  const payload = (await response.json()) as T | ApiError
  if (!response.ok) {
    const apiError = payload as ApiError
    throw new Error(apiError.error ?? `Request failed: ${response.status}`)
  }
  return payload as T
}

export function listTaskTemplates(): Promise<TaskTemplateListResponse> {
  return requestJson<TaskTemplateListResponse>('/api/teacher/task-templates')
}

export function deployTaskTemplate(
  templateId: string,
  input: { teachingUnitId: string; studentIds?: string[] }
): Promise<DeployTaskTemplateResult> {
  return requestJson<DeployTaskTemplateResult>(
    `/api/teacher/task-templates/${encodeURIComponent(templateId)}/deploy`,
    {
      method: 'POST',
      body: JSON.stringify(input)
    }
  )
}
