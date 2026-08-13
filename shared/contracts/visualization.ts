/** Visualization schemas for 2D/3D demos (ADR-0013/0014/0015). */

// ---------------------------------------------------------------------------
// Teacher-authored visualization (ADR-0015).
// A teacher describes a scene in natural language → an LLM proposes a ball-stick
// geometry → the teacher previews it in 3D and confirms → it is stored on the
// Question and rendered by the unified visualizer suite. This is the
// *presentation* layer only; it never enters the scoring evidence chain.
// ---------------------------------------------------------------------------

/** One atom in a ball-stick visualization: id, element symbol, 3D position. */
export interface VisualizationAtom {
  id: string
  element: string
  position: readonly [number, number, number]
}

/** A bond between two atom ids. */
export interface VisualizationBond {
  from: string
  to: string
}

/**
 * Ball-stick visualization payload (ADR-0015 MVP). Covers molecules, crystals,
 * and structures expressible as atoms + bonds. The `kind` discriminant leaves
 * room for curve/primitive kinds without a schema rewrite.
 */
export interface BallStickVisualization {
  kind: 'ball_stick'
  atoms: readonly VisualizationAtom[]
  bonds: readonly VisualizationBond[]
  /** Optional human label shown above the canvas. */
  label?: string
}

/**
 * Curve visualization (Phase 4 / ADR-0015 extension). Pre-sampled 3D polyline
 * points — magnetic helices, DNA strands, trajectories. Pure data + zod
 * validation; no expression evaluation. Optional secondaryPoints draws a
 * second strand (DNA double helix). Optional crossBars draw base-pair rungs
 * between strands (Phase 8).
 */
export interface CurveVisualization {
  kind: 'curve'
  /** Primary curve polyline, each point [x, y, z]. */
  points: readonly (readonly [number, number, number])[]
  /** Optional second strand (e.g. DNA complementary helix). */
  secondaryPoints?: readonly (readonly [number, number, number])[]
  /**
   * Optional base-pair / rung segments: each item is two endpoints
   * [[x,y,z], [x,y,z]] typically linking the two strands.
   */
  crossBars?: readonly (readonly [
    readonly [number, number, number],
    readonly [number, number, number]
  ])[]
  /** Optional human label shown above the canvas. */
  label?: string
}

/** Node in a primitives graph (circuit, cell schematic, etc.). */
export interface VisualizationNode {
  id: string
  /** Display label (e.g. "电源", "R", "开关"). */
  label?: string
  position: readonly [number, number, number]
  /**
   * Optional visual role for color/size (not a separate schema kind).
   * Unknown values fall back to default styling.
   */
  role?: string
}

/** Edge between two node ids in a primitives graph. */
export interface VisualizationEdge {
  from: string
  to: string
  /** Optional edge label (e.g. "I", "导线"). */
  label?: string
}

/**
 * Primitives visualization (Phase 7 / ADR-0015). Node+edge graphs for
 * circuits, simple cell maps, etc. Same pure-data + zod boundary as
 * ball_stick/curve — no layout solver.
 */
export interface PrimitivesVisualization {
  kind: 'primitives'
  nodes: readonly VisualizationNode[]
  edges: readonly VisualizationEdge[]
  /** Optional human label shown above the canvas. */
  label?: string
}

/** Union of all visualization kinds. Discriminant scales per ADR-0015. */
export type Visualization =
  | BallStickVisualization
  | CurveVisualization
  | PrimitivesVisualization
