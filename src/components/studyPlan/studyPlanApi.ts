/**
 * studyPlanApi — T18 学习计划的前端读取层。
 *
 * 独立于 src/lib/api.ts（避免与并行票冲突），但复用同一套 demo-role
 * 请求头约定，行为一致。全部是只读 GET，唯一的 POST 是教师显式布置。
 */
import type { ApiError } from '../../../shared/contracts'
import type { StudyPlan, StudyPlanTask } from '../../../shared/studyPlan'
import { DEMO_ROLE_HEADER, readStoredDemoRole } from '../../lib/demoRole'

/** 与 server/studyPlan/studyPlanRoutes.ts 的 StudyPlanResponse 对齐。 */
export interface StudyPlanResponse {
  plan: StudyPlan
  today: StudyPlanTask[]
  taskCount: number
}

export interface AssignStudyPlanResult {
  planId: string
  algorithm: string
  kpIds: string[]
  taskCount: number
  assignment: unknown
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

/** 学生本周计划。 */
export function getStudyPlan(
  studentId: string,
  teachingUnitId: string
): Promise<StudyPlanResponse> {
  const params = new URLSearchParams({ studentId, unitId: teachingUnitId })
  return requestJson(`/api/student/study-plan?${params.toString()}`)
}

/** 强制重算（幂等：同一硬输入必得同一计划）。 */
export function regenerateStudyPlan(
  studentId: string,
  teachingUnitId: string
): Promise<StudyPlanResponse> {
  return requestJson('/api/student/study-plan/regenerate', {
    method: 'POST',
    body: JSON.stringify({ studentId, unitId: teachingUnitId })
  })
}

/** 教师只读查看某学生计划。 */
export function getStudentStudyPlanForTeacher(
  studentId: string,
  teachingUnitId: string
): Promise<StudyPlanResponse> {
  const params = new URLSearchParams({ unitId: teachingUnitId })
  return requestJson(
    `/api/teacher/students/${encodeURIComponent(studentId)}/study-plan?${params.toString()}`
  )
}

/** 教师一键布置。dayIndex 缺省 = 整周。 */
export function assignStudyPlan(input: {
  studentId: string
  teachingUnitId: string
  dayIndex?: number
}): Promise<AssignStudyPlanResult> {
  return requestJson('/api/teacher/study-plan/assign', {
    method: 'POST',
    body: JSON.stringify({
      studentId: input.studentId,
      unitId: input.teachingUnitId,
      ...(input.dayIndex !== undefined ? { dayIndex: input.dayIndex } : {})
    })
  })
}
