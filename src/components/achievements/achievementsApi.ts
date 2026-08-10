/**
 * achievementsApi — T20 成就的前端读取层。
 *
 * 独立于 src/lib/api.ts（避免与并行票冲突），复用同一套 demo-role 请求头。
 * 只有三个端点，且**没有**任何 leaderboard / ranking / points 形状 ——
 * 前端即使想画排行榜，也没有数据可画。
 */
import type { ApiError } from '../../../shared/contracts'
import type {
  AchievementCatalogEntry,
  AchievementProgress,
  StudentAchievement
} from '../../../shared/achievements'
import { DEMO_ROLE_HEADER, readStoredDemoRole } from '../../lib/demoRole'

/** 与 server/achievements/achievementRoutes.ts 的 AchievementWallResponse 对齐。 */
export interface AchievementWallResponse {
  studentId: string
  algorithm: string
  evaluatedAt: string
  catalog: AchievementCatalogEntry[]
  earned: StudentAchievement[]
  progress: AchievementProgress[]
  earnedCount: number
  totalCount: number
}

export interface AchievementSyncResponse extends AchievementWallResponse {
  /** 本次新点亮的徽章。空数组 = 不弹 toast。 */
  newlyEarned: StudentAchievement[]
}

export interface AchievementSummaryResponse {
  teachingUnitId: string
  algorithm: string
  studentCount: number
  catalog: AchievementCatalogEntry[]
  counts: Array<{ achievementId: string; earnedCount: number }>
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

/** 学生成就墙（只读投影，不落库）。unitId 缺省时 plan_day_done 报 unavailable。 */
export function getAchievements(
  studentId: string,
  teachingUnitId?: string
): Promise<AchievementWallResponse> {
  const params = new URLSearchParams({ studentId })
  if (teachingUnitId !== undefined && teachingUnitId !== '') {
    params.set('unitId', teachingUnitId)
  }
  return requestJson(`/api/student/achievements?${params.toString()}`)
}

/** 判定 + 落库新徽章。幂等：已获得的不会重复出现在 newlyEarned。 */
export function syncAchievements(
  studentId: string,
  teachingUnitId?: string
): Promise<AchievementSyncResponse> {
  return requestJson('/api/student/achievements/sync', {
    method: 'POST',
    body: JSON.stringify({
      studentId,
      ...(teachingUnitId !== undefined && teachingUnitId !== ''
        ? { unitId: teachingUnitId }
        : {})
    })
  })
}

/** 教师班级聚合**计数**（无逐学生明细、无排名）。 */
export function getAchievementSummary(
  teachingUnitId: string
): Promise<AchievementSummaryResponse> {
  const params = new URLSearchParams({ unitId: teachingUnitId })
  return requestJson(`/api/teacher/achievements/summary?${params.toString()}`)
}
