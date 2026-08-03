/**
 * player/svgPrimitives — pure SVG primitive rendering helpers for the player
 * 2D renderer (spec §6.1 #1). Kept separate from the component file so fast
 * refresh only tracks components.
 */
import type { ReactNode } from 'react'
import type { Geometry2DPrimitive } from '../../../server/demonstration/sceneDocumentSchema'

export function colorToString(color: unknown): string {
  if (typeof color === 'string') return color
  if (Array.isArray(color) && color.length === 3) {
    const [r, g, b] = color as [number, number, number]
    const to8 = (v: number) => Math.round(Math.max(0, Math.min(1, v)) * 255)
    return `rgb(${to8(r)},${to8(g)},${to8(b)})`
  }
  return 'currentColor'
}

/** Render a single 2D primitive to SVG elements. */
export function render2DPrimitive(
  primitive: Geometry2DPrimitive,
  key: string,
  opts: { fill: string; stroke: string; visible: boolean }
): ReactNode {
  const common = {
    key,
    fill: opts.fill,
    stroke: opts.stroke,
    visibility: opts.visible ? 'visible' as const : 'hidden' as const
  }
  switch (primitive.shape) {
    case 'rect':
      return (
        <rect
          {...common}
          x={primitive.x}
          y={primitive.y}
          width={primitive.width}
          height={primitive.height}
          rx={primitive.rx ?? 0}
          ry={primitive.ry ?? 0}
        />
      )
    case 'circle':
      return (
        <circle {...common} cx={primitive.cx} cy={primitive.cy} r={primitive.r} />
      )
    case 'ellipse':
      return (
        <ellipse
          {...common}
          cx={primitive.cx}
          cy={primitive.cy}
          rx={primitive.rx}
          ry={primitive.ry}
        />
      )
    case 'line':
      return (
        <line
          {...common}
          x1={primitive.x1}
          y1={primitive.y1}
          x2={primitive.x2}
          y2={primitive.y2}
        />
      )
    case 'polyline':
      return (
        <polyline {...common} points={primitive.points.map((p) => p.join(',')).join(' ')} />
      )
    case 'polygon':
      return (
        <polygon {...common} points={primitive.points.map((p) => p.join(',')).join(' ')} />
      )
    case 'path':
      return <path {...common} d={primitive.d} />
    case 'text':
      return (
        <text {...common} x={primitive.x} y={primitive.y} fontSize={primitive.fontSize ?? 16}>
          {primitive.text}
        </text>
      )
  }
}
