import type { KpPrerequisite } from '../../shared/contracts'

export class KnowledgeDagError extends Error {
  public constructor(message: string) {
    super(message)
    this.name = 'KnowledgeDagError'
  }
}

/**
 * Walk the prerequisite DAG upward from `kpId` and return every transitive
 * prerequisite in topological order (most foundational first), excluding
 * `kpId` itself.
 *
 * Edges point from a knowledge point to its prerequisites (`kpId` depends on
 * `prereqId`). Post-order DFS therefore yields prerequisites before the nodes
 * that depend on them, so callers can diagnose the earliest gap first.
 *
 * Defensive cycle detection: KnowledgeStore already rejects cyclic seeds, but
 * a corrupt data source would otherwise loop forever — a back-edge throws
 * `KnowledgeDagError` instead of hanging.
 */
export function walkPrereqsRecursive(
  edges: readonly KpPrerequisite[],
  kpId: string
): string[] {
  const prereqsOf = new Map<string, string[]>()
  for (const edge of edges) {
    const neighbours = prereqsOf.get(edge.kpId)
    if (neighbours) {
      neighbours.push(edge.prereqId)
    } else {
      prereqsOf.set(edge.kpId, [edge.prereqId])
    }
  }

  type Color = 'gray' | 'black'
  const colors = new Map<string, Color>()
  const stack: string[] = []
  const order: string[] = []

  const visit = (node: string): void => {
    colors.set(node, 'gray')
    stack.push(node)

    for (const prereq of prereqsOf.get(node) ?? []) {
      const color = colors.get(prereq)
      if (color === 'gray') {
        const start = stack.indexOf(prereq)
        const cyclePath =
          start >= 0 ? [...stack.slice(start), prereq] : [prereq, prereq]
        throw new KnowledgeDagError(
          `Prerequisite cycle detected: ${cyclePath.join(' -> ')}`
        )
      }
      if (color === undefined) {
        visit(prereq)
      }
    }

    colors.set(node, 'black')
    stack.pop()
    order.push(node)
  }

  visit(kpId)

  // Post-order places foundational prerequisites first and `kpId` last;
  // callers want the prerequisite chain only.
  return order.filter((id) => id !== kpId)
}
