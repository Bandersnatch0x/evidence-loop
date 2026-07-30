import { useEffect, useRef } from 'react'
import {
  ELEMENT_COLORS,
  MOLECULE_GEOMETRIES,
  projectMolecule,
  type MoleculeGeometry
} from './moleculeProjection'

/**
 * MoleculeCanvas — 3D ball-and-stick visualization of a molecule's canonical
 * VSEPR geometry (ADR-0012). Renders the molecule's true 3D arrangement via
 * isometric projection (no Three.js — same projection as CubeSectionCanvas).
 *
 * Important: the canvas draws the molecule for the assignment's shape, NOT
 * the student's submitted text. Scoring rests on the text match (ObjectiveValidator);
 * the canvas is the presentation layer that shows the learner the geometry they
 * should be visualizing. Per ADR 0009/0011/0012, render params are not written
 * as evidence — reproducibility rests on the canonical geometry being pure
 * and shared via MOLECULE_GEOMETRIES.
 */
export interface MoleculeCanvasProps {
  /** Assignment id, used to look up the canonical geometry. */
  assignmentId: string
}

const ATOM_RADIUS: Readonly<Record<string, number>> = {
  C: 10,
  O: 11,
  H: 7
}

export function MoleculeCanvas({ assignmentId }: MoleculeCanvasProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null)

  useEffect(() => {
    const canvas = canvasRef.current
    if (!canvas) return
    const ctx = canvas.getContext('2d')
    if (!ctx) return

    const width = canvas.width
    const height = canvas.height
    ctx.clearRect(0, 0, width, height)

    const molecule: MoleculeGeometry | undefined = MOLECULE_GEOMETRIES[assignmentId]
    if (!molecule) return

    const fit = projectMolecule(molecule, width, height, 36)

    // Bonds (drawn first, behind atoms).
    ctx.strokeStyle = '#9ca3af'
    ctx.lineWidth = 3
    for (const bond of molecule.bonds) {
      const a = fit.points.get(bond.from)
      const b = fit.points.get(bond.to)
      if (!a || !b) continue
      ctx.beginPath()
      ctx.moveTo(a.x, a.y)
      ctx.lineTo(b.x, b.y)
      ctx.stroke()
    }

    // Atoms (drawn after bonds, on top).
    for (const atom of molecule.atoms) {
      const p = fit.points.get(atom.id)
      if (!p) continue
      const radius = ATOM_RADIUS[atom.element] ?? 8
      ctx.beginPath()
      ctx.arc(p.x, p.y, radius, 0, Math.PI * 2)
      ctx.fillStyle = ELEMENT_COLORS[atom.element] ?? '#6b7280'
      ctx.fill()
      ctx.strokeStyle = '#1f2937'
      ctx.lineWidth = 1
      ctx.stroke()
      // Element label.
      ctx.fillStyle = atom.element === 'H' ? '#374151' : '#f9fafb'
      ctx.font = '10px sans-serif'
      ctx.textAlign = 'center'
      ctx.textBaseline = 'middle'
      ctx.fillText(atom.element, p.x, p.y)
    }
  }, [assignmentId])

  return (
    <div className="molecule-canvas" style={{ marginTop: 12 }}>
      <div style={{ fontSize: 13, color: '#374151', marginBottom: 4 }}>
        分子空间构型（等轴测 3D 示意）
      </div>
      <canvas
        ref={canvasRef}
        width={360}
        height={300}
        role="img"
        aria-label={`${assignmentId} 分子的三维球棍模型示意图`}
      />
    </div>
  )
}
