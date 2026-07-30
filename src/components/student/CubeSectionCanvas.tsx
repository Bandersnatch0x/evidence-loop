import { useEffect, useRef } from 'react'
import {
  CUBE_EDGES,
  parseVertexIds,
  projectToViewport,
  type Vec3
} from './cubeProjection'

/**
 * CubeSectionCanvas — 2D isometric visualization of a learner's submitted
 * section polygon over the cube skeleton. Per ADR-0010:
 *  - Renders the LEARNER'S submitted section, never the standard answer.
 *  - Vertices come from the assignment's GeometryRunnerSpec (the single
 *    source of truth shared with the GeometryRunner) — no hidden second table.
 *  - The render params (projection/sampleCount/vertexIds) are also recorded
 *    as a weight=0 render_artifact evidence by the runner, so the scene the
 *    teacher replays matches what the learner saw. The canvas itself is the
 *    presentation layer; scoring lives in the runner.
 */
export interface CubeSectionCanvasProps {
  /** Raw learner submission, e.g. `A,B,C,D`. */
  submission: string
  /** Vertex table from the assignment's GeometryRunnerSpec (A–H → 3-tuple). */
  vertices: Readonly<Record<string, Vec3>>
}

export function CubeSectionCanvas({ submission, vertices }: CubeSectionCanvasProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null)

  useEffect(() => {
    const canvas = canvasRef.current
    if (!canvas) return
    const ctx = canvas.getContext('2d')
    if (!ctx) return

    const width = canvas.width
    const height = canvas.height
    ctx.clearRect(0, 0, width, height)

    const vertexIds = Object.keys(vertices)
    if (vertexIds.length === 0) return
    const vertexPoints = vertexIds.map((id) => vertices[id]!)

    const fit = projectToViewport(vertexPoints, width, height, 28)
    const screenById = new Map<string, { x: number; y: number }>()
    vertexIds.forEach((id, i) => {
      screenById.set(id, fit.points[i]!)
    })

    // Cube edges (dim gray).
    ctx.strokeStyle = '#9ca3af'
    ctx.lineWidth = 1
    for (const [a, b] of CUBE_EDGES) {
      const pa = screenById.get(a)
      const pb = screenById.get(b)
      if (!pa || !pb) continue
      ctx.beginPath()
      ctx.moveTo(pa.x, pa.y)
      ctx.lineTo(pb.x, pb.y)
      ctx.stroke()
    }

    // Vertex labels.
    ctx.fillStyle = '#6b7280'
    ctx.font = '12px sans-serif'
    ctx.textAlign = 'center'
    for (const id of vertexIds) {
      const p = screenById.get(id)!
      ctx.fillText(id, p.x, p.y - 6)
    }

    // Section polygon from the learner's submission (highlighted).
    const submittedIds = parseVertexIds(submission)
    const knownIds = new Set(vertexIds)
    const sectionPoints = submittedIds
      .filter((id) => knownIds.has(id))
      .map((id) => screenById.get(id))
      .filter((p): p is { x: number; y: number } => p !== undefined)
    const uniqueSection = [...new Map(sectionPoints.map((p, i) => [`${i}:${p.x},${p.y}`, p])).values()]

    if (uniqueSection.length >= 3) {
      // Fill (translucent) + outline.
      ctx.beginPath()
      uniqueSection.forEach((p, i) => {
        if (i === 0) ctx.moveTo(p.x, p.y)
        else ctx.lineTo(p.x, p.y)
      })
      ctx.closePath()
      ctx.fillStyle = 'rgba(37, 99, 235, 0.18)'
      ctx.fill()
      ctx.strokeStyle = '#2563eb'
      ctx.lineWidth = 2.5
      ctx.stroke()
    } else if (uniqueSection.length > 0) {
      // Fewer than 3 valid points — draw what we have as a faint line/dots.
      ctx.strokeStyle = '#93c5fd'
      ctx.lineWidth = 2
      ctx.beginPath()
      uniqueSection.forEach((p, i) => {
        if (i === 0) ctx.moveTo(p.x, p.y)
        else ctx.lineTo(p.x, p.y)
      })
      ctx.stroke()
    } else {
      ctx.fillStyle = '#6b7280'
      ctx.font = '14px sans-serif'
      ctx.textAlign = 'center'
      ctx.fillText('提交顶点编号以查看截面', width / 2, height / 2)
    }
  }, [submission, vertices])

  return (
    <div className="cube-section-canvas" style={{ marginTop: 12 }}>
      <div style={{ fontSize: 13, color: '#374151', marginBottom: 4 }}>
        你的截面（蓝色高亮，实时反映当前提交）
      </div>
      <canvas
        ref={canvasRef}
        width={420}
        height={320}
        role="img"
        aria-label="正方体与当前提交截面的等轴测示意图"
      />
    </div>
  )
}
