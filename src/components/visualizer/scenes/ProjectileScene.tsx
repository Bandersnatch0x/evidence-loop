/**
 * ProjectileScene — 2D canvas scene for projectile trajectories (ADR-0013).
 * Kept on 2D canvas (not R3F) because a projectile y(t)/x-y curve is a 2D
 * parametric curve; routing it through a 600KB 3D engine would be a gold
 * hammer (per ADR-0011, reaffirmed in ADR-0013).
 *
 * Two sub-modes by assignment id:
 *  - physics-projectile-xy: physical x-y space parabola (computeXYTrajectory)
 *  - physics-projectile-y:   y(t) vs time (computeTrajectory)
 *
 * Reproducibility rests on "submission string + fixed constants are already
 * stored" — render params are not evidence (ADR-0009/0011 未做项). Renders the
 * LEARNER'S current submission, never the standard answer.
 */
import { useEffect, useRef } from 'react'
import { computeTrajectory, computeXYTrajectory } from '../../student/trajectoryEval'

/** Fixed constants shared with the (symbolic) runner — same as App.tsx. */
const V0 = 10
const THETA = Math.PI / 4
const G = 9.8
const T_MAX = 2

export interface ProjectileSceneProps {
  assignmentId: string
  submission: string
}

export function ProjectileScene({ assignmentId, submission }: ProjectileSceneProps) {
  const isXY = assignmentId === 'physics-projectile-xy'
  const canvasRef = useRef<HTMLCanvasElement>(null)

  useEffect(() => {
    const canvas = canvasRef.current
    if (!canvas) return
    const ctx = canvas.getContext('2d')
    if (!ctx) return
    const width = canvas.width
    const height = canvas.height
    ctx.clearRect(0, 0, width, height)

    if (isXY) {
      drawXY(ctx, width, height, submission)
    } else {
      drawYT(ctx, width, height, submission)
    }
  }, [assignmentId, isXY, submission])

  return (
    <div className={isXY ? 'projectile-xy-canvas' : 'trajectory-canvas'} style={{ marginTop: 12 }}>
      <div style={{ fontSize: 13, color: '#374151', marginBottom: 4 }}>
        {isXY
          ? '你的斜抛轨迹（物理 x-y 空间，实时反映当前提交）'
          : '你的 y(t) 轨迹（实时反映当前提交）'}
      </div>
      <canvas
        ref={canvasRef}
        width={420}
        height={isXY ? 260 : 220}
        role="img"
        aria-label={
          isXY
            ? '当前提交的斜抛运动在物理 x-y 平面的轨迹曲线'
            : '当前提交的竖直位移随时间变化的曲线'
        }
      />
    </div>
  )
}

function drawXY(
  ctx: CanvasRenderingContext2D,
  width: number,
  height: number,
  submission: string
) {
  const points = computeXYTrajectory(submission, {
    v0: V0,
    theta: THETA,
    g: G,
    tMax: T_MAX,
    samples: 200
  })
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
  const scale = Math.min((right - left) / (maxX - minX), (bottom - top) / (maxY - minY))
  const plotW = (maxX - minX) * scale
  const plotH = (maxY - minY) * scale
  const originX = left + ((right - left) - plotW) / 2
  const originY = top + ((bottom - top) - plotH) / 2
  const toX = (x: number) => originX + (x - minX) * scale
  const toY = (y: number) => originY + plotH - (y - minY) * scale

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

  const start = points[0]
  if (start) {
    ctx.fillStyle = '#2563eb'
    ctx.beginPath()
    ctx.arc(toX(start.x), toY(start.y), 3, 0, Math.PI * 2)
    ctx.fill()
  }
  ctx.fillStyle = '#6b7280'
  ctx.font = '12px sans-serif'
  ctx.textAlign = 'center'
  ctx.fillText('x (m)', (left + right) / 2, height - 6)
  ctx.save()
  ctx.translate(12, (top + bottom) / 2)
  ctx.rotate(-Math.PI / 2)
  ctx.fillText('y (m)', 0, 0)
  ctx.restore()
}

function drawYT(
  ctx: CanvasRenderingContext2D,
  width: number,
  height: number,
  submission: string
) {
  const points = computeTrajectory(submission, {
    v0: V0,
    theta: THETA,
    g: G,
    tMax: T_MAX,
    samples: 200
  })
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
  const toX = (t: number) => left + (t / T_MAX) * (right - left)
  const toY = (y: number) =>
    top + (1 - (y - minY) / (maxY - minY)) * (bottom - top)

  ctx.strokeStyle = '#d1d5db'
  ctx.lineWidth = 1
  ctx.beginPath()
  ctx.moveTo(left, top)
  ctx.lineTo(left, bottom)
  ctx.lineTo(right, bottom)
  ctx.stroke()
  if (minY <= 0 && maxY >= 0) {
    ctx.strokeStyle = '#e5e7eb'
    ctx.beginPath()
    ctx.moveTo(left, toY(0))
    ctx.lineTo(right, toY(0))
    ctx.stroke()
  }
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
  ctx.fillStyle = '#6b7280'
  ctx.font = '12px sans-serif'
  ctx.textAlign = 'center'
  ctx.fillText('t (s)', (left + right) / 2, height - 6)
  ctx.save()
  ctx.translate(12, (top + bottom) / 2)
  ctx.rotate(-Math.PI / 2)
  ctx.fillText('y (m)', 0, 0)
  ctx.restore()
}
