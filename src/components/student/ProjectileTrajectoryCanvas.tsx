import { useEffect, useRef } from 'react'
import { computeTrajectory } from './trajectoryEval'

/**
 * ProjectileTrajectoryCanvas — 2D visualization of the learner's submitted
 * y(t). Per ADR 0009 / slice decision:
 *  - Renders the LEARNER'S current submission, never the standard answer.
 *  - Fixed constants (v0, theta, g, t∈[0,tMax]) are declared by the question
 *    and shared with the (symbolic) runner — no hidden second source of truth.
 *  - Rendering params are NOT written as evidence; reproducibility rests on
 *    "submission string + fixed constants are already stored" (ADR 0009 未做项).
 */

export interface ProjectileTrajectoryCanvasProps {
  /** Raw learner submission, e.g. `y = v0*sin(theta)*t - 0.5*g*t^2`. */
  submission: string
  v0: number
  theta: number
  g: number
  tMax: number
  samples?: number
}

export function ProjectileTrajectoryCanvas({
  submission,
  v0,
  theta,
  g,
  tMax,
  samples = 200
}: ProjectileTrajectoryCanvasProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null)

  useEffect(() => {
    const canvas = canvasRef.current
    if (!canvas) return
    const ctx = canvas.getContext('2d')
    if (!ctx) return

    const width = canvas.width
    const height = canvas.height
    ctx.clearRect(0, 0, width, height)

    const points = computeTrajectory(submission, { v0, theta, g, tMax, samples })

    if (points === null) {
      ctx.fillStyle = '#6b7280'
      ctx.font = '14px sans-serif'
      ctx.textAlign = 'center'
      ctx.fillText('表达式无法求值', width / 2, height / 2)
      return
    }

    const ys = points.map((p) => p.y)
    let minY = Math.min(...ys, 0)
    let maxY = Math.max(...ys, 0)
    if (minY === maxY) {
      minY -= 1
      maxY += 1
    }
    const pad = (maxY - minY) * 0.1
    minY -= pad
    maxY += pad

    const left = 36
    const right = width - 12
    const top = 12
    const bottom = height - 28
    const toX = (t: number) => left + (t / tMax) * (right - left)
    const toY = (y: number) =>
      top + (1 - (y - minY) / (maxY - minY)) * (bottom - top)

    // Axes.
    ctx.strokeStyle = '#d1d5db'
    ctx.lineWidth = 1
    ctx.beginPath()
    ctx.moveTo(left, top)
    ctx.lineTo(left, bottom)
    ctx.lineTo(right, bottom)
    ctx.stroke()

    // Zero line if in range.
    if (minY <= 0 && maxY >= 0) {
      ctx.strokeStyle = '#e5e7eb'
      ctx.beginPath()
      ctx.moveTo(left, toY(0))
      ctx.lineTo(right, toY(0))
      ctx.stroke()
    }

    // Trajectory (learner's y(t)).
    ctx.strokeStyle = '#2563eb'
    ctx.lineWidth = 2
    ctx.beginPath()
    points.forEach((p, i) => {
      const x = toX(p.t)
      const y = toY(p.y)
      if (i === 0) ctx.moveTo(x, y)
      else ctx.lineTo(x, y)
    })
    ctx.stroke()

    // Axis labels.
    ctx.fillStyle = '#6b7280'
    ctx.font = '12px sans-serif'
    ctx.textAlign = 'center'
    ctx.fillText('t (s)', (left + right) / 2, height - 6)
    ctx.save()
    ctx.translate(12, (top + bottom) / 2)
    ctx.rotate(-Math.PI / 2)
    ctx.fillText('y (m)', 0, 0)
    ctx.restore()
  }, [submission, v0, theta, g, tMax, samples])

  return (
    <div className="trajectory-canvas" style={{ marginTop: 12 }}>
      <div style={{ fontSize: 13, color: '#374151', marginBottom: 4 }}>
        你的 y(t) 轨迹（实时反映当前提交）
      </div>
      <canvas
        ref={canvasRef}
        width={420}
        height={220}
        role="img"
        aria-label="当前提交的竖直位移随时间变化的曲线"
      />
    </div>
  )
}
