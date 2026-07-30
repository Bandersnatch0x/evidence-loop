/**
 * cubeProjection — pure isometric projection for the cube-section canvas.
 *
 * Per ADR 0009 / ADR-0010: the canvas renders the LEARNER'S submitted section
 * polygon over the shared cube skeleton. Vertices come from the assignment's
 * GeometryRunnerSpec (the single source of truth shared with the runner);
 * the projection is a pure function so it can be unit-tested without a DOM.
 *
 * Isometric projection maps (x,y,z) → 2D via:
 *   screenX = (x - y) * cos(30°)
 *   screenY = (x + y) * sin(30°) - z
 * A standard iso triad; the cube's 12 edges and the section polygon share it.
 */

const COS30 = Math.cos(Math.PI / 6) // ≈0.866 — 30°
const SIN30 = Math.sin(Math.PI / 6) // 0.5

export type Vec3 = readonly [number, number, number]

export interface ProjectedPoint {
  x: number
  y: number
}

/** Project a single 3D point to 2D isometric screen coords (unscaled, uncentered). */
export function projectIso(point: Vec3): ProjectedPoint {
  const [x, y, z] = point
  return {
    x: (x - y) * COS30,
    y: (x + y) * SIN30 - z
  }
}

/**
 * Project a list of 3D points and fit them into a width×height viewport with
 * a margin. Returns the projected 2D points (in screen pixels) plus the scale
 * and origin used, so a caller can overlay additional geometry if needed.
 */
export function projectToViewport(
  points: readonly Vec3[],
  width: number,
  height: number,
  margin = 24
): { points: ProjectedPoint[]; scale: number; originX: number; originY: number } {
  if (points.length === 0) {
    return { points: [], scale: 1, originX: 0, originY: 0 }
  }
  const projected = points.map(projectIso)
  const xs = projected.map((p) => p.x)
  const ys = projected.map((p) => p.y)
  const minX = Math.min(...xs)
  const maxX = Math.max(...xs)
  const minY = Math.min(...ys)
  const maxY = Math.max(...ys)
  const spanX = maxX - minX || 1
  const spanY = maxY - minY || 1
  const scale = Math.min(
    (width - margin * 2) / spanX,
    (height - margin * 2) / spanY
  )
  const originX = (width - spanX * scale) / 2 - minX * scale
  const originY = (height - spanY * scale) / 2 - minY * scale
  return {
    points: projected.map((p) => ({
      x: p.x * scale + originX,
      y: p.y * scale + originY
    })),
    scale,
    originX,
    originY
  }
}

/** The 12 edges of a cube keyed by vertex-id pairs, given a vertex id set. */
export const CUBE_EDGES: ReadonlyArray<readonly [string, string]> = [
  ['A', 'B'], ['B', 'C'], ['C', 'D'], ['D', 'A'], // bottom face
  ['E', 'F'], ['F', 'G'], ['G', 'H'], ['H', 'E'], // top face
  ['A', 'E'], ['B', 'F'], ['C', 'G'], ['D', 'H'] // verticals
]

/** Parse a comma/space/Chinese-comma separated vertex-id submission. */
export function parseVertexIds(raw: string): string[] {
  return raw
    .trim()
    .split(/[,，\s]+/)
    .map((id) => id.trim().toUpperCase())
    .filter((id) => id.length > 0)
}

/**
 * Unit cube vertices (side 2, centered at origin), keys A..H.
 * ponytail: this duplicates the vertex table in cubeSectionAssignment's
 * GeometryRunnerSpec (server/data/assignments.ts). The two must stay in sync
 * — both encode the same physical cube. Kept duplicated rather than threading
 * the server RunnerSpec into the client `Assignment` type (physics-projectile-y
 * follows the same convention for v0/theta/g). Drift is bounded by
 * tests/geometryAssignment.test.ts + tests/cubeSectionCanvas.test.ts.
 */
export const UNIT_CUBE_VERTICES: Readonly<Record<string, Vec3>> = {
  A: [-1, -1, -1],
  B: [1, -1, -1],
  C: [1, 1, -1],
  D: [-1, 1, -1],
  E: [-1, -1, 1],
  F: [1, -1, 1],
  G: [1, 1, 1],
  H: [-1, 1, 1]
}
