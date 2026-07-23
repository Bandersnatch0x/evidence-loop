// @vitest-environment node

import { describe, expect, it } from 'vitest'
import {
  JsonKnowledgeStore,
  defaultKnowledgeSeedPath
} from '../server/knowledge/KnowledgeStore'

/**
 * Issue #029: full-subject knowledge graph (junior + senior high, 9 subjects
 * plus the pre-existing code/math points). These tests assert the packaged
 * seed loads cleanly (KnowledgeStore already enforces acyclicity + schema),
 * covers every subject, and encodes sensible junior -> senior prerequisite
 * chains. They intentionally avoid touching KnowledgeStore internals.
 */

const SUBJECTS = [
  'math',
  'physics',
  'chemistry',
  'chinese',
  'english',
  'biology',
  'politics',
  'history',
  'geography'
] as const

function subjectOf(id: string): string | null {
  // ids look like kp.<subject>.<topic>.<point>; code seeds (kp.function.*)
  // do not carry a subject in our enumeration and are ignored here.
  const parts = id.split('.')
  return parts.length >= 2 ? parts[1]! : null
}

describe('subject knowledge graph (issue #029)', () => {
  it('loads the packaged seed without cycles or schema errors', async () => {
    const store = new JsonKnowledgeStore({ seedPath: defaultKnowledgeSeedPath })
    // getGraph() runs full validation incl. DFS cycle detection; a throw here
    // means the seed is malformed.
    const graph = await store.getGraph()

    expect(graph.points.length).toBeGreaterThanOrEqual(100)
    expect(graph.points.length).toBeLessThanOrEqual(200)
    expect(graph.edges.length).toBeGreaterThanOrEqual(50)
  })

  it('preserves the original code + math points for backward compatibility', async () => {
    const store = new JsonKnowledgeStore({ seedPath: defaultKnowledgeSeedPath })
    const ids = new Set((await store.listPoints()).map((point) => point.id))

    for (const legacyId of [
      'kp.function.definition',
      'kp.list.iteration',
      'kp.recursion.base_case',
      'kp.recursion.step',
      'kp.string.reversal',
      'kp.math.algebra.simplify',
      'kp.math.algebra.factor',
      'kp.math.algebra.quadratic'
    ]) {
      expect(ids.has(legacyId)).toBe(true)
    }
  })

  it('covers every enumerated subject with several representative points', async () => {
    const store = new JsonKnowledgeStore({ seedPath: defaultKnowledgeSeedPath })
    const points = await store.listPoints()

    for (const subject of SUBJECTS) {
      const subjectPoints = points.filter((point) => subjectOf(point.id) === subject)
      expect(
        subjectPoints.length,
        `subject "${subject}" should have >= 8 knowledge points`
      ).toBeGreaterThanOrEqual(8)
    }
  })

  it('keeps every parentId and edge endpoint resolvable within the graph', async () => {
    const store = new JsonKnowledgeStore({ seedPath: defaultKnowledgeSeedPath })
    const graph = await store.getGraph()
    const ids = new Set(graph.points.map((point) => point.id))

    for (const point of graph.points) {
      if (point.parentId !== undefined) {
        expect(ids.has(point.parentId), `parent of ${point.id}`).toBe(true)
      }
    }
    for (const edge of graph.edges) {
      expect(ids.has(edge.kpId)).toBe(true)
      expect(ids.has(edge.prereqId)).toBe(true)
      expect(edge.strength).toBeGreaterThanOrEqual(0)
      expect(edge.strength).toBeLessThanOrEqual(1)
    }
  })

  it('encodes sensible junior -> senior prerequisite chains', async () => {
    const store = new JsonKnowledgeStore({ seedPath: defaultKnowledgeSeedPath })
    const edges = await store.listEdges()
    const hasEdge = (kpId: string, prereqId: string): boolean =>
      edges.some((edge) => edge.kpId === kpId && edge.prereqId === prereqId)

    // Physics: Newton's first law precedes the second law (junior -> senior).
    expect(
      hasEdge(
        'kp.physics.mechanics.newton_second_law',
        'kp.physics.mechanics.newton_first_law'
      )
    ).toBe(true)

    // Math: quadratic equation depends on factoring (junior algebra chain),
    // and the derivative depends on the limit (senior calculus chain).
    expect(hasEdge('kp.math.algebra.quadratic', 'kp.math.algebra.factor')).toBe(true)
    expect(hasEdge('kp.math.calculus.derivative', 'kp.math.calculus.limit')).toBe(true)

    // Chinese: advanced classical reading builds on basic classical reading.
    expect(
      hasEdge(
        'kp.chinese.reading.classical_advanced',
        'kp.chinese.reading.classical_chinese'
      )
    ).toBe(true)

    // Biology: DNA-level genetics builds on Mendelian genetics.
    expect(hasEdge('kp.biology.genetics.dna', 'kp.biology.genetics.mendel')).toBe(true)
  })
})
