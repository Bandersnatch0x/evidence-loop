/**
 * portfolioApi — T23 循证作品集导出的前端读取层。
 *
 * 独立于 src/lib/api.ts，复用 demo-role 请求头。两个端点都是 POST：
 *   - /api/student/portfolio/export  学生导出本人（body: { teachingUnitId }）
 *   - /api/teacher/portfolio/export  教师导出本单元在读学生（body: { studentId, teachingUnitId }）
 * 缺省响应是 zip 下载（content-disposition）；?format=json 返回 JSON 原文。
 * 导出即留痕（服务端台账 + 审计链），前端不做任何二次判定。
 */
import { DEMO_ROLE_HEADER, readStoredDemoRole } from '../../lib/demoRole'

const STUDENT_EXPORT_PATH = '/api/student/portfolio/export'
const TEACHER_EXPORT_PATH = '/api/teacher/portfolio/export'

interface ExportRequestInput {
  teachingUnitId: string
  studentId?: string
}

async function postExport(
  path: string,
  body: ExportRequestInput,
  format: 'zip' | 'json' = 'zip'
): Promise<Response> {
  const params = new URLSearchParams()
  if (format === 'json') params.set('format', 'json')
  const suffix = params.toString() === '' ? '' : `?${params.toString()}`
  return fetch(`${path}${suffix}`, {
    method: 'POST',
    headers: {
      accept: 'application/json',
      [DEMO_ROLE_HEADER]: readStoredDemoRole(),
      'content-type': 'application/json'
    },
    body: JSON.stringify(body)
  })
}

/** 学生导出本人证据包（zip 下载）。 */
export async function exportStudentPortfolioZip(
  teachingUnitId: string
): Promise<Blob> {
  const response = await postExport(STUDENT_EXPORT_PATH, { teachingUnitId })
  if (!response.ok) {
    const payload = (await response.json()) as { error?: string }
    throw new Error(payload.error ?? '导出失败')
  }
  return response.blob()
}

/** 教师导出指定学生的证据包（zip 下载）。 */
export async function exportTeacherPortfolioZip(
  studentId: string,
  teachingUnitId: string
): Promise<Blob> {
  const response = await postExport(TEACHER_EXPORT_PATH, {
    teachingUnitId,
    studentId
  })
  if (!response.ok) {
    const payload = (await response.json()) as { error?: string }
    throw new Error(payload.error ?? '导出失败')
  }
  return response.blob()
}

/** 导出 JSON 预览（响应原文）。 */
export async function exportPortfolioJson(
  teacher: boolean,
  input: ExportRequestInput
): Promise<unknown> {
  const response = await postExport(
    teacher ? TEACHER_EXPORT_PATH : STUDENT_EXPORT_PATH,
    input,
    'json'
  )
  if (!response.ok) {
    const payload = (await response.json()) as { error?: string }
    throw new Error(payload.error ?? '导出失败')
  }
  return (await response.json()) as unknown
}
