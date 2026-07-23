// @vitest-environment node

import { describe, expect, it } from 'vitest'
import type { KnowledgeGraph } from '../shared/contracts'
import {
  JsonKnowledgeStore,
  KnowledgeStoreError,
  defaultKnowledgeSeedPath
} from '../server/knowledge/KnowledgeStore'

describe('JsonKnowledgeStore (seed file)', () => {
  it('loads the packaged seed with the expected shape', async () => {
    const store = new JsonKnowledgeStore({ seedPath: defaultKnowledgeSeedPath })
    const graph = await store.getGraph()

    expect(graph.points.length).toBeGreaterThanOrEqual(5)
    expect(graph.points.length).toBeLessThanOrEqual(15)
    expect(graph.edges.length).toBeGreaterThanOrEqual(3)

    const codePoints = graph.points.filter((point) => !point.id.startsWith('kp.math.'))
    const mathPoints = graph.points.filter((point) => point.id.startsWith('kp.math.'))
    expect(codePoints.length).toBeGreaterThanOrEqual(3)
    expect(mathPoints.length).toBeGreaterThanOrEqual(2)

    const knownIds = new Set(graph.points.map((point) => point.id))
    for (const edge of graph.edges) {
      expect(knownIds.has(edge.kpId)).toBe(true)
      expect(knownIds.has(edge.prereqId)).toBe(true)
      expect(edge.strength).toBeGreaterThan(0)
      expect(edge.strength).toBeLessThanOrEqual(1)
    }
  })

  it('lists points and edges independently and matches getGraph()', async () => {
    const store = new JsonKnowledgeStore({ seedPath: defaultKnowledgeSeedPath })
    const [graph, points, edges] = await Promise.all([
      store.getGraph(),
      store.listPoints(),
      store.listEdges()
    ])

    expect(points).toEqual(graph.points)
    expect(edges).toEqual(graph.edges)
  })

  it('returns defensive copies so callers cannot mutate the cache', async () => {
    const store = new JsonKnowledgeStore({ seedPath: defaultKnowledgeSeedPath })
    const first = await store.getGraph()
    first.points[0]!.name = 'MUTATED'
    first.edges.length = 0

    const second = await store.getGraph()
    expect(second.points[0]!.name).not.toBe('MUTATED')
    expect(second.edges.length).toBeGreaterThan(0)
  })

  it('is idempotent: repeated instantiation yields the same graph', async () => {
    const a = new JsonKnowledgeStore({ seedPath: defaultKnowledgeSeedPath })
    const b = new JsonKnowledgeStore({ seedPath: defaultKnowledgeSeedPath })

    const [graphA, graphB] = await Promise.all([a.getGraph(), b.getGraph()])
    expect(graphA).toEqual(graphB)

    // Multiple calls against the same instance should also match.
    const graphAAgain = await a.getGraph()
    expect(graphAAgain).toEqual(graphA)
  })
})

describe('JsonKnowledgeStore (validation)', () => {
  it('detects a direct A -> B -> A cycle', async () => {
    const cyclic: KnowledgeGraph = {
      points: [
        { id: 'kp.a', name: 'A', weight: 1 },
        { id: 'kp.b', name: 'B', weight: 1 }
      ],
      edges: [
        { kpId: 'kp.a', prereqId: 'kp.b', strength: 1 },
        { kpId: 'kp.b', prereqId: 'kp.a', strength: 1 }
      ]
    }
    const store = new JsonKnowledgeStore({ seed: cyclic })

    await expect(store.getGraph()).rejects.toBeInstanceOf(KnowledgeStoreError)
    await expect(store.getGraph()).rejects.toThrow(/cycle detected/i)
  })

  it('detects a longer transitive cycle', async () => {
    const cyclic: KnowledgeGraph = {
      points: [
        { id: 'kp.a', name: 'A', weight: 1 },
        { id: 'kp.b', name: 'B', weight: 1 },
        { id: 'kp.c', name: 'C', weight: 1 }
      ],
      edges: [
        { kpId: 'kp.a', prereqId: 'kp.b', strength: 1 },
        { kpId: 'kp.b', prereqId: 'kp.c', strength: 1 },
        { kpId: 'kp.c', prereqId: 'kp.a', strength: 1 }
      ]
    }
    const store = new JsonKnowledgeStore({ seed: cyclic })

    await expect(store.getGraph()).rejects.toThrow(/cycle detected/i)
  })

  it('rejects edges that reference unknown knowledge points', async () => {
    const invalid: KnowledgeGraph = {
      points: [{ id: 'kp.a', name: 'A', weight: 1 }],
      edges: [{ kpId: 'kp.a', prereqId: 'kp.missing', strength: 1 }]
    }
    const store = new JsonKnowledgeStore({ seed: invalid })

    await expect(store.getGraph()).rejects.toThrow(/unknown prerequisite/i)
  })

  it('rejects self-referential edges', async () => {
    const invalid: KnowledgeGraph = {
      points: [{ id: 'kp.a', name: 'A', weight: 1 }],
      edges: [{ kpId: 'kp.a', prereqId: 'kp.a', strength: 1 }]
    }
    const store = new JsonKnowledgeStore({ seed: invalid })

    await expect(store.getGraph()).rejects.toThrow(/self-referential/i)
  })

  it('accepts a valid acyclic DAG with diamond dependencies', async () => {
    const diamond: KnowledgeGraph = {
      points: [
        { id: 'kp.root', name: 'Root', weight: 1 },
        { id: 'kp.left', name: 'Left', weight: 1 },
        { id: 'kp.right', name: 'Right', weight: 1 },
        { id: 'kp.leaf', name: 'Leaf', weight: 1 }
      ],
      edges: [
        { kpId: 'kp.left', prereqId: 'kp.root', strength: 1 },
        { kpId: 'kp.right', prereqId: 'kp.root', strength: 1 },
        { kpId: 'kp.leaf', prereqId: 'kp.left', strength: 1 },
        { kpId: 'kp.leaf', prereqId: 'kp.right', strength: 1 }
      ]
    }
    const store = new JsonKnowledgeStore({ seed: diamond })
    const graph = await store.getGraph()
    expect(graph.points).toHaveLength(4)
    expect(graph.edges).toHaveLength(4)
  })

  it('reports a helpful error when the seed file is missing', async () => {
    const store = new JsonKnowledgeStore({
      seedPath: 'D:/definitely-not-a-real-path/knowledge.seed.json'
    })

    await expect(store.getGraph()).rejects.toThrow(/missing/i)
  })
})
