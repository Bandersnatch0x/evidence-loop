/**
 * Geometry sanity checks for teacher/student visualizations (ADR-0015).
 *
 * - hardGeometryIssues: must-fail (degenerate / impossible data) — wired into
 *   zod superRefine so parse/adopt reject them.
 * - softGeometryWarnings: advisory only (unusual but renderable) — returned
 *   alongside LLM generate for the teacher/student to review.
 *
 * Not a full chemistry/physics simulator — only cheap deterministic bounds.
 */
import type { Visualization } from '../../shared/contracts'

const MIN_BOND = 0.15
const MAX_BOND = 4.5
const COORD_BOUND = 50

type Vec3 = readonly [number, number, number]

function dist(a: Vec3, b: Vec3): number {
  return Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2])
}

function outOfBounds(p: Vec3): boolean {
  return (
    Math.abs(p[0]) > COORD_BOUND ||
    Math.abs(p[1]) > COORD_BOUND ||
    Math.abs(p[2]) > COORD_BOUND
  )
}

function allSamePoint(points: readonly Vec3[]): boolean {
  if (points.length < 2) return false
  const [x0, y0, z0] = points[0]!
  return points.every(
    (p) => p[0] === x0 && p[1] === y0 && p[2] === z0
  )
}

/** Hard rejects — empty/degenerate geometry that should never store. */
export function hardGeometryIssues(data: Visualization): string[] {
  const issues: string[] = []

  if (data.kind === 'ball_stick') {
    for (const atom of data.atoms) {
      if (outOfBounds(atom.position)) {
        issues.push(`原子 ${atom.id} 坐标超出合理范围 (±${COORD_BOUND})`)
      }
    }
    const byId = new Map(data.atoms.map((a) => [a.id, a.position] as const))
    for (const bond of data.bonds) {
      const from = byId.get(bond.from)
      const to = byId.get(bond.to)
      if (!from || !to) continue
      const d = dist(from, to)
      if (d < 1e-6) {
        issues.push(`键 ${bond.from}-${bond.to} 长度为 0（原子重叠）`)
      } else if (d > MAX_BOND * 2) {
        issues.push(
          `键 ${bond.from}-${bond.to} 过长 (${d.toFixed(2)}，上限约 ${MAX_BOND * 2})`
        )
      }
    }
  }

  if (data.kind === 'curve') {
    if (allSamePoint(data.points)) {
      issues.push('曲线 points 全部重合，无法形成折线')
    }
    for (const p of data.points) {
      if (outOfBounds(p)) {
        issues.push(`曲线点坐标超出合理范围 (±${COORD_BOUND})`)
        break
      }
    }
    if (data.secondaryPoints) {
      if (allSamePoint(data.secondaryPoints)) {
        issues.push('secondaryPoints 全部重合')
      }
      for (const p of data.secondaryPoints) {
        if (outOfBounds(p)) {
          issues.push(`secondaryPoints 坐标超出合理范围 (±${COORD_BOUND})`)
          break
        }
      }
    }
    if (data.crossBars) {
      for (let i = 0; i < data.crossBars.length; i++) {
        const bar = data.crossBars[i]!
        if (dist(bar[0], bar[1]) < 1e-6) {
          issues.push(`crossBars[${i}] 两端点重合`)
        }
      }
    }
  }

  if (data.kind === 'primitives') {
    for (const node of data.nodes) {
      if (outOfBounds(node.position)) {
        issues.push(`节点 ${node.id} 坐标超出合理范围 (±${COORD_BOUND})`)
      }
    }
    if (allSamePoint(data.nodes.map((n) => n.position))) {
      issues.push('所有节点位置重合，图元无法展开')
    }
    for (const edge of data.edges) {
      if (edge.from === edge.to) {
        issues.push(`边不能自环: ${edge.from}`)
      }
    }
  }

  return issues
}

/** Soft advisories — renderable but suspicious for teaching accuracy. */
export function softGeometryWarnings(data: Visualization): string[] {
  const warnings: string[] = []

  if (data.kind === 'ball_stick') {
    const byId = new Map(data.atoms.map((a) => [a.id, a.position] as const))
    for (const bond of data.bonds) {
      const from = byId.get(bond.from)
      const to = byId.get(bond.to)
      if (!from || !to) continue
      const d = dist(from, to)
      if (d > 0 && d < MIN_BOND) {
        warnings.push(`键 ${bond.from}-${bond.to} 偏短 (${d.toFixed(2)})`)
      } else if (d > MAX_BOND) {
        warnings.push(`键 ${bond.from}-${bond.to} 偏长 (${d.toFixed(2)})`)
      }
    }
    if (data.atoms.length > 80) {
      warnings.push(`原子数较多 (${data.atoms.length})，预览可能较卡`)
    }
  }

  if (data.kind === 'curve') {
    if (data.points.length < 10) {
      warnings.push('曲线采样点较少，螺旋/轨迹可能不平滑')
    }
    if (data.secondaryPoints && data.crossBars === undefined) {
      warnings.push('双链曲线未提供 crossBars（碱基对横线）；DNA 演示可补横档')
    }
    if (
      data.secondaryPoints &&
      Math.abs(data.points.length - data.secondaryPoints.length) >
        Math.max(data.points.length, data.secondaryPoints.length) * 0.5
    ) {
      warnings.push('双链采样点数差异较大，显示可能不对称')
    }
  }

  if (data.kind === 'primitives') {
    if (data.edges.length === 0 && data.nodes.length > 1) {
      warnings.push('多个节点但无边，电路/结构连线可能缺失')
    }
  }

  return warnings
}
