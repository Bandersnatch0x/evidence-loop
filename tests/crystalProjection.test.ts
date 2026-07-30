// @vitest-environment node

import { describe, expect, it } from 'vitest'
import type { MoleculeGeometry, Vec3 } from '../src/components/student/moleculeProjection'
import {
  CELL_CORNERS,
  CELL_EDGES,
  DIAMOND_GEOMETRY,
  NACL_GEOMETRY
} from '../src/components/student/crystalProjection'

function dist(a: Vec3, b: Vec3): number {
  const dx = a[0] - b[0]
  const dy = a[1] - b[1]
  const dz = a[2] - b[2]
  return Math.sqrt(dx * dx + dy * dy + dz * dz)
}

/** Count bonds incident on an atom id in the geometry. */
function coordination(geometry: MoleculeGeometry, atomId: string): number {
  return geometry.bonds.filter((b) => b.from === atomId || b.to === atomId).length
}

describe('NaCl unit cell', () => {
  it('has 27 atoms (14 Cl + 13 Na)', () => {
    const cl = NACL_GEOMETRY.atoms.filter((a) => a.element === 'Cl').length
    const na = NACL_GEOMETRY.atoms.filter((a) => a.element === 'Na').length
    expect(cl).toBe(14)
    expect(na).toBe(13)
    expect(NACL_GEOMETRY.atoms.length).toBe(27)
  })

  it('body-centre Na is 6-coordinate (octahedral)', () => {
    const bodyNa = NACL_GEOMETRY.atoms.find(
      (a) => a.element === 'Na' && a.position[0] === 0.5 && a.position[1] === 0.5 && a.position[2] === 0.5
    )
    expect(bodyNa).toBeDefined()
    expect(coordination(NACL_GEOMETRY, bodyNa!.id)).toBe(6)
  })

  it('all Na–Cl bonds have length 0.5 (½ a)', () => {
    const byId = new Map(NACL_GEOMETRY.atoms.map((a) => [a.id, a.position]))
    for (const bond of NACL_GEOMETRY.bonds) {
      const a = byId.get(bond.from)!
      const b = byId.get(bond.to)!
      expect(dist(a, b)).toBeCloseTo(0.5, 6)
    }
  })
})

describe('Diamond unit cell', () => {
  it('has 8 C atoms, all carbon', () => {
    expect(DIAMOND_GEOMETRY.atoms.length).toBe(8)
    expect(DIAMOND_GEOMETRY.atoms.every((a) => a.element === 'C')).toBe(true)
  })

  it('interior sublattice-B C is 4-coordinate tetrahedral', () => {
    // The (¼,¼,¼) atom is interior; its full 4 neighbours are within the cell.
    const interior = DIAMOND_GEOMETRY.atoms.find(
      (a) => a.position[0] === 0.25 && a.position[1] === 0.25 && a.position[2] === 0.25
    )
    expect(interior).toBeDefined()
    expect(coordination(DIAMOND_GEOMETRY, interior!.id)).toBe(4)
  })

  it('C–C bond angle at the interior atom is arccos(-1/3) ≈ 109.47°', () => {
    const interior = DIAMOND_GEOMETRY.atoms.find(
      (a) => a.position[0] === 0.25 && a.position[1] === 0.25 && a.position[2] === 0.25
    )!
    const byId = new Map(DIAMOND_GEOMETRY.atoms.map((a) => [a.id, a.position]))
    const neighbourIds = DIAMOND_GEOMETRY.bonds
      .filter((b) => b.from === interior.id || b.to === interior.id)
      .map((b) => (b.from === interior.id ? b.to : b.from))
    // Vectors from interior to each neighbour.
    const vecs = neighbourIds.map((id) => {
      const p = byId.get(id)!
      return [p[0] - interior.position[0], p[1] - interior.position[1], p[2] - interior.position[2]] as const
    })
    expect(vecs.length).toBe(4)
    const angle = (u: readonly number[], v: readonly number[]): number => {
      const dot = u[0]! * v[0]! + u[1]! * v[1]! + u[2]! * v[2]!
      const lu = Math.hypot(u[0]!, u[1]!, u[2]!)
      const lv = Math.hypot(v[0]!, v[1]!, v[2]!)
      return (Math.acos(dot / (lu * lv)) * 180) / Math.PI
    }
    for (let i = 0; i < vecs.length; i++) {
      for (let j = i + 1; j < vecs.length; j++) {
        expect(angle(vecs[i]!, vecs[j]!)).toBeCloseTo(109.47, 1)
      }
    }
  })
})

describe('unit-cell wireframe', () => {
  it('has 8 corners and 12 edges', () => {
    expect(CELL_CORNERS.length).toBe(8)
    expect(CELL_EDGES.length).toBe(12)
  })
})
