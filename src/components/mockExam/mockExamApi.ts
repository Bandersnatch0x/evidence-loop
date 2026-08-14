/**
 * mockExamApi — T16 跨学科模拟考的前端调用层。
 *
 * 独立于 src/lib/api.ts（避免与并行票冲突），复用同一套 demo-role 请求头约定。
 * 只有「保存 / 布置」是写动作，其余全部只读。前端不做任何选题放行判断 ——
 * 教师改过的题号列表回到服务端会被重新过闸门。
 */
import type { ApiError } from '../../../shared/contracts'
import type {
  MockExamPaperReport,
  MockExamPaperSubmitResult,
  MockExamPlan,
  MockExamPlanView,
  MockExamSuggestion,
  MockExamWarning
} from '../../../shared/mockExam'
import { DEMO_ROLE_HEADER, readStoredDemoRole } from '../../lib/demoRole'

/** 与 server/mockExam/MockExamService.ts 的 SaveMockExamResult 对齐。 */
export interface SaveMockExamResponse extends MockExamPlanView {
  warnings: MockExamWarning[]
}

export interface MockExamReportResponse {
  report: MockExamPaperReport
  gateNotice: string
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
    throw new Error(apiError.details?.join('；') ?? apiError.error)
  }
  return payload as T
}

/** 生成建议卷（不落库，教师可继续删题换题）。 */
export function suggestMockExam(input: {
  teachingUnitIds: string[]
  classId?: string
  title?: string
  count?: number
  duration?: number
}): Promise<MockExamSuggestion> {
  return requestJson('/api/teacher/mock-exams/suggest', {
    method: 'POST',
    body: JSON.stringify(input)
  })
}

/** 保存草稿；publish=true 时同时一键布置全班（测评态）。 */
export function saveMockExam(input: {
  teachingUnitIds: string[]
  questionIds: string[]
  planId?: string
  classId?: string
  title?: string
  duration?: number
  publish?: boolean
  studentIds?: string[]
  dueAt?: string
}): Promise<SaveMockExamResponse> {
  return requestJson('/api/teacher/mock-exams', {
    method: 'POST',
    body: JSON.stringify(input)
  })
}

/** 读取已保存的卷面 + KP 覆盖。 */
export function getMockExam(planId: string): Promise<MockExamPlanView> {
  return requestJson(
    `/api/teacher/mock-exams/${encodeURIComponent(planId)}`
  )
}

/** 学生本人已布置的真实模拟考。 */
export function listStudentMockExams(): Promise<{
  plans: MockExamPlan[]
  gateNotice: string
}> {
  return requestJson('/api/student/mock-exams')
}

/** 交卷报告。学生只能读自己的；教师可传 studentId。 */
export function getMockExamReport(
  paperId: string,
  studentId?: string
): Promise<MockExamReportResponse> {
  const params = new URLSearchParams()
  if (studentId !== undefined && studentId !== '') {
    params.set('studentId', studentId)
  }
  const query = params.toString()
  return requestJson(
    `/api/student/papers/${encodeURIComponent(paperId)}/report${query === '' ? '' : `?${query}`}`
  )
}

/**
 * 学生交卷（成套）。服务端确认 + 只读报告投影，不重新判分——
 * 每题分数仍来自各 Attempt 自己的评价（Q3.4 口径：Attempt 才是聚合根）。
 */
export function submitPaperExam(
  paperId: string
): Promise<MockExamPaperSubmitResult> {
  return requestJson(
    `/api/student/papers/${encodeURIComponent(paperId)}/submit`,
    { method: 'POST' }
  )
}
