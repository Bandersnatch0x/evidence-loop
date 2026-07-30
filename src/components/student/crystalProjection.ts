/**
 * crystalProjection — pure unit-cell geometry for crystal-structure
 * visualization (ADR-0014). Same {atoms, bonds} shape as moleculeProjection;
 * reuses MoleculeGeometry so the shared BallStick components render both.
 *
 * Coordinates are fractional unit-cell positions in [0,1]³; CrystalScene maps
 * them into view-space. Bond lists are generated from nearest-neighbour
 * distances so coordination is faithful:
 *  - NaCl (rock salt): Cl⁻ on FCC (corners + face centres) + Na⁺ in octahedral
 *    holes (edge centres + body centre). Each body-centre Na is 6-coordinate
 *    (octahedron of face-centre Cl).
 *  - Diamond: two interpenetrating FCC sublattices offset by (¼,¼,¼). Each
 *    interior C is 4-coordinate tetrahedral, C–C–C angle = arccos(-⅓) ≈ 109.47°.
 *
 * Per ADR 0013/0014: geometry is a pure canonical constant — reproducible,
 * not evidence. Scoring rests on the fill_blank text match (structure name).
 */
import type { MoleculeGeometry, Vec3 } from './moleculeProjection'

const HALF = 0.5
const QUARTER = 0.25
const THREE_Q = 0.75

function dist(a: Vec3, b: Vec3): number {
  const dx = a[0] - b[0]
  const dy = a[1] - b[1]
  const dz = a[2] - b[2]
  return Math.sqrt(dx * dx + dy * dy + dz * dz)
}

/** Build atoms + bonds for a crystal with two interpenetrating FCC-like sets,
 *  bonding an A–B pair when its distance matches `target` (within tol). */
function buildIonic(
  elementA: string,
  positionsA: Vec3[],
  elementB: string,
  positionsB: Vec3[],
  target: number,
  tol = 0.01
): MoleculeGeometry {
  const atoms = [
    ...positionsA.map((p, i) => ({ id: `${elementA}${i}`, element: elementA, position: p })),
    ...positionsB.map((p, i) => ({ id: `${elementB}${i}`, element: elementB, position: p }))
  ]
  const bonds: { from: string; to: string }[] = []
  for (const a of atoms.filter((x) => x.element === elementA)) {
    for (const b of atoms.filter((x) => x.element === elementB)) {
      if (Math.abs(dist(a.position, b.position) - target) <= tol) {
        bonds.push({ from: a.id, to: b.id })
      }
    }
  }
  return { atoms, bonds }
}

/** Build a single-element covalent crystal, bonding pairs at `target`. */
function buildCovalent(
  element: string,
  positions: Vec3[],
  target: number,
  tol = 0.01
): MoleculeGeometry {
  const atoms = positions.map((p, i) => ({ id: `${element}${i}`, element, position: p }))
  const bonds: { from: string; to: string }[] = []
  for (let i = 0; i < atoms.length; i++) {
    for (let j = i + 1; j < atoms.length; j++) {
      const a = atoms[i]!
      const b = atoms[j]!
      if (Math.abs(dist(a.position, b.position) - target) <= tol) {
        bonds.push({ from: a.id, to: b.id })
      }
    }
  }
  return { atoms, bonds }
}

// NaCl rock-salt unit cell. Cl⁻ at FCC sites (8 corners + 6 face centres);
// Na⁺ at octahedral holes (12 edge centres + 1 body centre). Nearest
// Na–Cl distance = ½ a.
const NACL_CL: Vec3[] = [
  // 8 corners
  [0, 0, 0], [1, 0, 0], [0, 1, 0], [0, 0, 1],
  [1, 1, 0], [1, 0, 1], [0, 1, 1], [1, 1, 1],
  // 6 face centres
  [HALF, HALF, 0], [HALF, 0, HALF], [0, HALF, HALF],
  [HALF, HALF, 1], [HALF, 1, HALF], [1, HALF, HALF]
]
const NACL_NA: Vec3[] = [
  // 12 edge centres
  [HALF, 0, 0], [0, HALF, 0], [0, 0, HALF],
  [1, HALF, 0], [1, 0, HALF], [HALF, 1, 0],
  [0, 1, HALF], [HALF, 0, 1], [0, HALF, 1],
  [1, 1, HALF], [1, HALF, 1], [HALF, 1, 1],
  // body centre
  [HALF, HALF, HALF]
]

/** NaCl rock-salt unit cell (27 atoms, 6:6 octahedral coordination). */
export const NACL_GEOMETRY: MoleculeGeometry = buildIonic('Cl', NACL_CL, 'Na', NACL_NA, HALF)

// Diamond cubic unit cell: two interpenetrating FCC sublattices offset by
// (¼,¼,¼). C–C nearest-neighbour distance = √3/4 ≈ 0.4330.
const DIAMOND_C: Vec3[] = [
  // FCC sublattice A
  [0, 0, 0], [HALF, HALF, 0], [HALF, 0, HALF], [0, HALF, HALF],
  // FCC sublattice B (offset ¼,¼,¼)
  [QUARTER, QUARTER, QUARTER], [THREE_Q, THREE_Q, QUARTER],
  [THREE_Q, QUARTER, THREE_Q], [QUARTER, THREE_Q, THREE_Q]
]
const CC_BOND = Math.sqrt(3) / 4

/** Diamond cubic unit cell (8 atoms, 4-coordinate tetrahedral). */
export const DIAMOND_GEOMETRY: MoleculeGeometry = buildCovalent('C', DIAMOND_C, CC_BOND)

/** Map assignment id → canonical crystal unit-cell geometry. */
export const CRYSTAL_GEOMETRIES: Readonly<Record<string, MoleculeGeometry>> = {
  'chem-crystal-nacl': NACL_GEOMETRY,
  'chem-crystal-diamond': DIAMOND_GEOMETRY
}

/** Unit-cell corner positions [0,1]³ for the wireframe (shared by all cubic
 *  cells rendered at a=1). */
export const CELL_CORNERS: readonly Vec3[] = [
  [0, 0, 0], [1, 0, 0], [1, 1, 0], [0, 1, 0],
  [0, 0, 1], [1, 0, 1], [1, 1, 1], [0, 1, 1]
]
export const CELL_EDGES: ReadonlyArray<readonly [number, number]> = [
  [0, 1], [1, 2], [2, 3], [3, 0],
  [4, 5], [5, 6], [6, 7], [7, 4],
  [0, 4], [1, 5], [2, 6], [3, 7]
]
