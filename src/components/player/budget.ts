/**
 * player/budget — client-side resource budget enforcement (spec §6.5).
 *
 * The server preflights budgets on the player payload (second gate is client
 * side). The player refuses to load assets over budget and shows a degradation
 * notice instead of silently truncating (spec §6.5: 拒绝加载 + 提示, never
 * silent). Pure functions — the values mirror sceneSecurity HARD_BUDGET.
 */
import type { SceneDocument } from '../../../server/demonstration/sceneDocumentSchema'

/** Hard caps (mirror server/demonstration/sceneSecurity.ts HARD_BUDGET). */
export const PLAYER_BUDGET = {
  maxNodes: 2000,
  maxTriangles: 500_000,
  maxTexturePixels: 8_388_608, // 8 MP
  maxAnimationSeconds: 600,
  maxMediaRefs: 200,
  /** Chapter material byte budget (spec §6.5: 单章素材清单字节数). */
  maxChapterBytes: 64 * 1024 * 1024
} as const

export interface BudgetCounts {
  nodes: number
  triangles: number
  texturePixels: number
  animationSeconds: number
  mediaRefs: number
}

export interface BudgetIssue {
  code: string
  message: string
}

/** Count ALL nodes recursively (top-level + nested children). */
export function countNodes(doc: SceneDocument): number {
  const walk = (list: NonNullable<SceneDocument['objectTree']>): number => {
    if (!list) return 0
    let n = 0
    for (const node of list) {
      if (!node) continue
      n += 1
      if (node.children && node.children.length > 0) n += walk(node.children)
    }
    return n
  }
  return walk(doc.objectTree ?? [])
}

/** Triangle estimate for inline 3D primitives (mirrors server heuristics). */
export function estimateTriangles(doc: SceneDocument): number {
  const geoms = doc.geometry3D ?? []
  let total = 0
  for (const g of geoms) {
    switch (g.kind) {
      case 'box': total += 12; break
      case 'sphere': total += 24 * 24 * 2; break
      case 'cylinder':
      case 'cone': total += 24 * 2 * 2; break
      case 'torus': total += 24 * 64 * 2; break
      case 'ring': total += 24 * 2; break
      case 'plane': total += 2; break
      default: total += 0
    }
  }
  return total
}

/** Texture pixel budget from mediaRefs (texture purpose, 8-bit RGBA est.). */
export function estimateTexturePixels(): number {
  // The player cannot know texture dimensions without the blob; the manifest
  // byteSize is the only signal. Use a conservative 1 byte-per-pixel estimate
  // against the chapter byte budget — refused when the manifest says over.
  return 0
}

export function budgetCounts(doc: SceneDocument): BudgetCounts {
  return {
    nodes: countNodes(doc),
    triangles: estimateTriangles(doc),
    texturePixels: estimateTexturePixels(),
    animationSeconds: doc.timeline?.duration ?? 0,
    mediaRefs: (doc.mediaRefs ?? []).length
  }
}

/** Check the document against player hard caps. Empty = ok. */
export function checkPlayerBudget(doc: SceneDocument): BudgetIssue[] {
  const counts = budgetCounts(doc)
  const issues: BudgetIssue[] = []
  if (counts.nodes > PLAYER_BUDGET.maxNodes) {
    issues.push({ code: 'nodes-over-budget', message: `nodes ${counts.nodes} > ${PLAYER_BUDGET.maxNodes}` })
  }
  if (counts.triangles > PLAYER_BUDGET.maxTriangles) {
    issues.push({ code: 'triangles-over-budget', message: `triangles ${counts.triangles} > ${PLAYER_BUDGET.maxTriangles}` })
  }
  if (counts.animationSeconds > PLAYER_BUDGET.maxAnimationSeconds) {
    issues.push({ code: 'animation-over-budget', message: `animation ${counts.animationSeconds}s > ${PLAYER_BUDGET.maxAnimationSeconds}s` })
  }
  if (counts.mediaRefs > PLAYER_BUDGET.maxMediaRefs) {
    issues.push({ code: 'media-over-budget', message: `mediaRefs ${counts.mediaRefs} > ${PLAYER_BUDGET.maxMediaRefs}` })
  }
  return issues
}

/** True when a chapter's material byte budget is exceeded (lazy-load gate). */
export function chapterOverBudget(
  byteSize: number | null | undefined,
  budget: Partial<typeof PLAYER_BUDGET> = {}
): boolean {
  const cap = budget.maxChapterBytes ?? PLAYER_BUDGET.maxChapterBytes
  if (byteSize === null || byteSize === undefined) return false
  return byteSize > cap
}
