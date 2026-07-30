import { useEffect, useRef } from 'react'
import { computeXYTrajectory } from './trajectoryEval'

/**
 * ProjectileXYCanvas — 2D visualization of the learner's submitted x(t),y(t)
 * in physical x-y space (the actual parabola, not t-vs-y). Per ADR-0011:
 *  - Renders the LEARNER'S current submission, never the standard answer.
 *  - Fixed constants (v0, theta, g, tMax) are shared with the (symbolic)
 *    runner and declared by the question — no hidden second source of truth.
 *  - Same non-evidence stance as ADR 0009: rendering params are not written
 *    as evidence; reproducibility rests on "submission + fixed constants are
 *    already stored". The teacher replays by recomputing the trajectory.
 */
export interface ProjectileXYCanvasProps {
  submission: string
  v0: number
  theta: number
  g: number
  tMax: number
  samples?: number
}

export function ProjectileXYCanvas({
  submission,
  v0,
  theta,
  g,
  tMax,
  samples = 200
}: ProjectileXYCanvasProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null)

  useEffect(() => {
    const canvas = canvasRef.current
    if (!canvas) return
    const ctx = canvas.getContext('2d')
    if (!ctx) return

    const width = canvas.width
    const height = canvas.height
    ctx.clearRect(0, 0, width, height)

    const points = computeXYTrajectory(submission, { v0, theta, g, tMax, samples })

    if (points === null) {
      ctx.fillStyle = '#6b7280'
      ctx.font = '14px sans-serif'
      ctx.textAlign = 'center'
      ctx.fillText('需同时提交 x 和 y 分量', width / 2, height / 2)
      return
    }

    const xs = points.map((p) => p.x)
    const ys = points.map((p) => p.y)
    let minX = Math.min(...xs, 0)
    let maxX = Math.max(...xs, 0)
    let minY = Math.min(...ys, 0)
    let maxY = Math.max(...ys, 0)
    if (minX === maxX) {
      minX -= 1
      maxX += 1
    }
    if (minY === maxY) {
      minY -= 1
      maxY += 1
    }
    const padX = (maxX - minX) * 0.08
    const padY = (maxY - minY) * 0.1
    minX -= padX
    maxX += padX
    minY -= padY
    maxY += padY

    const left = 36
    const right = width - 16
    const top = 14
    const bottom = height - 28
    // Equal aspect so the parabola isn't visually distorted.
    const scaleX = (right - left) / (maxX - minX)
    const scaleY = (bottom - top) / (maxY - minY)
    const scale = Math.min(scaleX, scaleY)
    const plotW = (maxX - minX) * scale
    const plotH = (maxY - minY) * scale
    const originX = left + ((right - left) - plotW) / 2
    const originY = top + ((bottom - top) - plotH) / 2
    const toX = (x: number) => originX + (x - minX) * scale
    const toY = (y: number) => originY + plotH - (y - minY) * scale

    // Axes.
    ctx.strokeStyle = '#d1d5db'
    ctx.lineWidth = 1
    ctx.beginPath()
    if (minX <= 0 && maxX >= 0) {
      ctx.moveTo(toX(0), top)
      ctx.lineTo(toX(0), bottom)
    }
    if (minY <= 0 && maxY >= 0) {
      ctx.moveTo(left, toY(0))
      ctx.lineTo(right, toY(0))
    }
    ctx.stroke()

    // Trajectory (learner's x(t),y(t)).
    ctx.strokeStyle = '#2563eb'
    ctx.lineWidth = 2
    ctx.beginPath()
    points.forEach((p, i) => {
      const px = toX(p.x)
      const py = toY(p.y)
      if (i === 0) ctx.moveTo(px, py)
      else ctx.lineTo(px, py)
    })
    ctx.stroke()

    // Launch point marker (t=0).
    const start = points[0]
    if (start) {
      ctx.fillStyle = '#2563eb'
      ctx.beginPath()
      ctx.arc(toX(start.x), toY(start.y), 3, 0, Math.PI * 2)
      ctx.fill()
    }

    // Axis labels.
    ctx.fillStyle = '#6b7280'
    ctx.font = '12px sans-serif'
    ctx.textAlign = 'center'
    ctx.fillText('x (m)', (left + right) / 2, height - 6)
    ctx.save()
    ctx.translate(12, (top + bottom) / 2)
    ctx.rotate(-Math.PI / 2)
    ctx.fillText('y (m)', 0, 0)
    ctx.restore()
  }, [submission, v0, theta, g, tMax, samples])

  return (
    <div className="projectile-xy-canvas" style={{ marginTop: 12 }}>
      <div style={{ fontSize: 13, color: '#374151', marginBottom: 4 }}>
        你的斜抛轨迹（物理 x-y 空间，实时反映当前提交）
      </div>
      <canvas
        ref={canvasRef}
        width={420}
        height={260}
        role="img"
        aria-label="当前提交的斜抛运动在物理 x-y 平面的轨迹曲线"
      />
    </div>
  )
}
