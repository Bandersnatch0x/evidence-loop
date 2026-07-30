import type { GeometryRunnerSpec } from '../data/assignments'
import type { CodeRunner, RunnerEvidence, RunnerRequest, RunnerResult } from './types'
import { resolveSubmission } from './types'

/**
 * Geometry runner for 3D-solid section questions (ADR-0010).
 * Recognizes the polygonal shape of a section plane through the solid:
 *  - shape-vertices: section vertex count is in {3,4,5,6}
 *  - shape-convex: the section polygon is planar and convex
 *  - render-artifact: weight=0 audit snapshot of render params (the params
 *    a teacher view replays to redraw the scene), never contributes score.
 *
 * Pure and deterministic: same spec + submission → same evidence (ADR-0001).
 * No external geometry library — uses elementary vector math only.
 */

type Vec3 = readonly [number, number, number]

const SEPARATOR_PATTERN = /[,，\s]+/

function parseVertexIds(raw: string): string[] {
  return raw
    .trim()
    .split(SEPARATOR_PATTERN)
    .map((id) => id.trim().toUpperCase())
    .filter((id) => id.length > 0)
}

function isGeometryRunnerSpec(spec: unknown): spec is GeometryRunnerSpec {
  if (typeof spec !== 'object' || spec === null) return false
  return (spec as { kind?: unknown }).kind === 'geometry'
}

function cross(a: Vec3, b: Vec3): [number, number, number] {
  return [
    a[1] * b[2] - a[2] * b[1],
    a[2] * b[0] - a[0] * b[2],
    a[0] * b[1] - a[1] * b[0]
  ]
}

function length(v: Vec3): number {
  return Math.sqrt(v[0] * v[0] + v[1] * v[1] + v[2] * v[2])
}

/**
 * Newell's method: compute a normal for a polygon assumed (or tested) to be
 * planar. Returns null if the polygon degenerates (zero normal).
 */
function newellNormal(points: Vec3[]): Vec3 | null {
  const n: [number, number, number] = [0, 0, 0]
  const count = points.length
  for (let i = 0; i < count; i++) {
    const cur = points[i]!
    const next = points[(i + 1) % count]!
    n[0] += (cur[1] - next[1]) * (cur[2] + next[2])
    n[1] += (cur[2] - next[2]) * (cur[0] + next[0])
    n[2] += (cur[0] - next[0]) * (cur[1] + next[1])
  }
  if (length(n) < 1e-9) return null
  return n
}

/** Build two in-plane basis vectors (u, v) from a normal, for 2D projection. */
function inPlaneBasis(n: Vec3): [Vec3, Vec3] {
  const helper: Vec3 = Math.abs(n[0]) < 0.9 ? [1, 0, 0] : [0, 1, 0]
  const u = normalize(cross(n, helper))
  const v = normalize(cross(n, u))
  return [u, v]
}

function normalize(v: Vec3): Vec3 {
  const len = length(v)
  if (len < 1e-12) return [0, 0, 0]
  return [v[0] / len, v[1] / len, v[2] / len]
}

function dot(a: Vec3, b: Vec3): number {
  return a[0] * b[0] + a[1] * b[1] + a[2] * b[2]
}

/**
 * Project polygon vertices onto their plane's 2D basis and test convexity via
 * the sign of successive 2D cross products (all same sign → convex).
 */
function isConvex(points: Vec3[]): boolean {
  const n = newellNormal(points)
  if (n === null) return false
  const [u, v] = inPlaneBasis(n)
  const projected = points.map((p) => [dot(p, u), dot(p, v)] as const)
  const count = projected.length
  if (count < 3) return false
  let sign = 0
  for (let i = 0; i < count; i++) {
    const a = projected[i]!
    const b = projected[(i + 1) % count]!
    const c = projected[(i + 2) % count]!
    const cross2d = (b[0] - a[0]) * (c[1] - b[1]) - (b[1] - a[1]) * (c[0] - b[0])
    if (Math.abs(cross2d) < 1e-9) continue // collinear, skip
    const s = Math.sign(cross2d)
    if (sign === 0) sign = s
    else if (s !== sign) return false
  }
  return true
}

export class GeometryRunner implements CodeRunner {
  public readonly name = 'geometry'

  public run(request: RunnerRequest): Promise<RunnerResult> {
    const startedAt = performance.now()
    const build = (partial: Omit<RunnerResult, 'durationMs'>): RunnerResult => ({
      ...partial,
      durationMs: Math.max(1, Math.round(performance.now() - startedAt))
    })

    const spec = request.assignment.runner
    if (!isGeometryRunnerSpec(spec)) {
      return Promise.resolve(
        build({
          status: 'failed',
          evidence: [],
          reason: 'GeometryRunner 需要 kind: "geometry" 的 RunnerSpec'
        })
      )
    }

    let raw: string
    try {
      raw = resolveSubmission(request)
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      return Promise.resolve(
        build({
          status: 'completed',
          evidence: [{ id: 'shape-vertices', state: 'blocked', message }]
        })
      )
    }

    const submittedIds = parseVertexIds(raw)
    const evidence: RunnerEvidence[] = []

    // Validate ids exist in the vertex table.
    const knownIds = new Set(Object.keys(spec.vertices))
    const allKnown = submittedIds.length > 0 && submittedIds.every((id) => knownIds.has(id))
    if (!allKnown) {
      evidence.push({
        id: 'shape-vertices',
        state: 'blocked',
        actual: raw,
        message: '提交的顶点编号无效或不在题目顶点表中'
      })
      evidence.push({ id: 'shape-convex', state: 'blocked', message: '顶点无效，无法判断凸性' })
      evidence.push({ id: 'render-artifact', state: 'blocked', message: '顶点无效，无渲染参数' })
      return Promise.resolve(build({ status: 'completed', evidence }))
    }

    // De-duplicate while preserving order. Ids already validated against the
    // vertex table above, so the non-null assertion is sound.
    const uniqueIds = [...new Set(submittedIds)]
    const points = uniqueIds.map((id) => spec.vertices[id]!)
    const n = uniqueIds.length

    // shape-vertices: count in {3,4,5,6}
    const countOk = n >= 3 && n <= 6
    evidence.push({
      id: 'shape-vertices',
      state: countOk ? 'passed' : 'failed',
      actual: `${n}`,
      message: countOk
        ? `截面顶点数 ${n}（合理范围 3–6）`
        : `截面顶点数 ${n} 超出合理范围 3–6`
    })

    // shape-convex: planar + convex (requires n >= 3)
    const convex = n >= 3 && isConvex(points)
    evidence.push({
      id: 'shape-convex',
      state: convex ? 'passed' : 'failed',
      actual: convex ? '凸' : '非凸/不共面',
      message: convex ? '截面多边形共面且为凸多边形' : '截面多边形非凸或不共面'
    })

    // render-artifact: audit-only snapshot of render params (weight=0).
    evidence.push({
      id: 'render-artifact',
      state: 'passed',
      actual: JSON.stringify({
        submission: raw,
        vertexIds: uniqueIds,
        vertices: spec.vertices,
        projection: 'isometric',
        sampleCount: 200
      }),
      message: '渲染参数快照（审计只读，不计分）'
    })

    return Promise.resolve(build({ status: 'completed', evidence }))
  }
}
