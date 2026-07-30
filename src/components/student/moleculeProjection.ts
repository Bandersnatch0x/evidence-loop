/**
 * moleculeProjection — pure 3D geometry + isometric projection for VSEPR
 * ball-and-stick visualization (ADR-0012).
 *
 * Per ADR 0009/0010/0012: the canvas renders the molecule as the learner would
 * see it, not as a "standard answer". Molecular geometry (bond positions) is
 * derived from the VSEPR shape name, not from the student's submission — the
 * submission is the shape *name* (text), and the canvas draws the canonical
 * 3D arrangement for that shape. Scoring rests on the text match, not the
 * rendered geometry.
 *
 * Isometric projection reuses the cubeProjection convention:
 *   screenX = (x - y) * cos(30°)
 *   screenY = (x + y) * sin(30°) - z
 * Same formula, no new dependency.
 */

const COS30 = Math.cos(Math.PI / 6)
const SIN30 = Math.sin(Math.PI / 6)

export type Vec3 = readonly [number, number, number]

export interface Atom {
  id: string
  element: string
  position: Vec3
}

export interface Bond {
  from: string
  to: string
}

export interface MoleculeGeometry {
  atoms: readonly Atom[]
  bonds: readonly Bond[]
}

export interface ProjectedPoint {
  x: number
  y: number
}

/** Project a single 3D point to 2D isometric screen coords. */
export function projectIso(point: Vec3): ProjectedPoint {
  const [x, y, z] = point
  return {
    x: (x - y) * COS30,
    y: (x + y) * SIN30 - z
  }
}

/** Project all atoms and fit into a width×height viewport with margin. */
export function projectMolecule(
  molecule: MoleculeGeometry,
  width: number,
  height: number,
  margin = 28
): {
  points: Map<string, ProjectedPoint>
  scale: number
  originX: number
  originY: number
} {
  const positions = molecule.atoms.map((a) => a.position)
  if (positions.length === 0) {
    return { points: new Map(), scale: 1, originX: 0, originY: 0 }
  }
  const projected = positions.map(projectIso)
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
  const points = new Map<string, ProjectedPoint>()
  molecule.atoms.forEach((atom, i) => {
    const p = projected[i]!
    points.set(atom.id, {
      x: p.x * scale + originX,
      y: p.y * scale + originY
    })
  })
  return { points, scale, originX, originY }
}

/**
 * Tetrahedral geometry (CH4): center C at origin, 4 H at the alternating
 * vertices of a cube (±1,±1,±1) normalized to bond length 1. All H-C-H angles
 * are arccos(-1/3) ≈ 109.47°, the true VSEPR tetrahedral angle.
 */
function tetrahedralAtoms(centerElement: string, terminal: string, bondLength = 1): Atom[] {
  const r = bondLength / Math.sqrt(3) // normalize (±1,±1,±1) to unit length
  const corners: Vec3[] = [
    [1, 1, 1],
    [1, -1, -1],
    [-1, 1, -1],
    [-1, -1, 1]
  ]
  return [
    { id: 'C', element: centerElement, position: [0, 0, 0] },
    ...corners.map((c, i) => ({
      id: `H${i + 1}`,
      element: terminal,
      position: [c[0] * r, c[1] * r, c[2] * r] as Vec3
    }))
  ]
}

/** Methane CH4 — tetrahedral. */
export const METHANE_GEOMETRY: MoleculeGeometry = {
  atoms: tetrahedralAtoms('C', 'H'),
  bonds: [
    { from: 'C', to: 'H1' },
    { from: 'C', to: 'H2' },
    { from: 'C', to: 'H3' },
    { from: 'C', to: 'H4' }
  ]
}

/**
 * Bent geometry (H2O): center O at origin, 2 H in the xz plane at the VSEPR
 * bond angle. Water's H-O-H angle ≈ 104.5° (compressed from tetrahedral by
 * the two lone pairs). Only bonds + atoms drawn; lone pairs are not rendered
 * (ponytail: YAGNI precise repulsion visualization).
 */
function bentAtoms(
  centerElement: string,
  terminal: string,
  bondAngleDeg: number,
  bondLength = 1
): Atom[] {
  const half = (bondAngleDeg * Math.PI) / 180 / 2
  return [
    { id: 'O', element: centerElement, position: [0, 0, 0] },
    {
      id: 'H1',
      element: terminal,
      position: [bondLength * Math.cos(half), 0, bondLength * Math.sin(half)]
    },
    {
      id: 'H2',
      element: terminal,
      position: [bondLength * Math.cos(half), 0, -bondLength * Math.sin(half)]
    }
  ]
}

/** Water H2O — bent, ~104.5°. */
export const WATER_GEOMETRY: MoleculeGeometry = {
  atoms: bentAtoms('O', 'H', 104.5),
  bonds: [
    { from: 'O', to: 'H1' },
    { from: 'O', to: 'H2' }
  ]
}

/** Map assignment id → canonical molecular geometry for the canvas. */
export const MOLECULE_GEOMETRIES: Readonly<Record<string, MoleculeGeometry>> = {
  'chem-vsepr-methane': METHANE_GEOMETRY,
  'chem-vsepr-water': WATER_GEOMETRY
}

/** Element → display color (CPK-ish, minimal palette). */
export const ELEMENT_COLORS: Readonly<Record<string, string>> = {
  C: '#374151', // dark gray
  O: '#dc2626', // red
  H: '#e5e7eb', // light gray
  Na: '#9333ea', // purple (crystal, ADR-0014)
  Cl: '#16a34a' // green (crystal, ADR-0014)
}
