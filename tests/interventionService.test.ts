// @vitest-environment node

import { describe, expect, it } from 'vitest'
import type {
  KpPrerequisite,
  MasteryProfileMap,
  MasterySnapshot
} from '../shared/contracts'
import {
  KnowledgeDagError,
  walkPrereqsRecursive
} from '../server/mastery/knowledgeDag'
import {
  InterventionService,
  type MasteryProfileReader
} from '../server/mastery/InterventionService'
import { JsonKnowledgeStore } from '../server/knowledge/KnowledgeStore'

function edge(kpId: string, prereqId: string): KpPrerequisite {
  return { kpId, prereqId, strength: 1 }
}

function point(id: string): { id: string; name: string; weight: number } {
  return { id, name: id, weight: 1 }
}

function snapshot(score: number): MasterySnapshot {
  return {
    score,
    evidenceIds: [],
    computedAt: '2026-01-01T00:00:00.000Z',
    algorithmVersion: 'simple.v1'
  }
}

function profileOf(scores: Record<string, number>): MasteryProfileMap {
  const profile: MasteryProfileMap = {}
  for (const [kpId, score] of Object.entries(scores)) {
    profile[kpId] = snapshot(score)
  }
  return profile
}

function readerFor(scores: Record<string, number>): MasteryProfileReader {
  const profile = profileOf(scores)
  return { getProfile: () => profile }
}

describe('walkPrereqsRecursive', () => {
  it('returns the topological prerequisite chain (foundational first) for A -> B -> C', () => {
    // C depends on B depends on A. Query C.
    const edges = [edge('C', 'B'), edge('B', 'A')]
    expect(walkPrereqsRecursive(edges, 'C')).toEqual(['A', 'B'])
  })

  it('returns an empty chain when a node has no prerequisites', () => {
    expect(walkPrereqsRecursive([edge('C', 'B')], 'B')).toEqual([])
  })

  it('places shared prerequisites before dependents in a diamond DAG', () => {
    // D depends on B and C; B and C both depend on A.
    const edges = [edge('D', 'B'), edge('D', 'C'), edge('B', 'A'), edge('C', 'A')]
    const chain = walkPrereqsRecursive(edges, 'D')

    expect(new Set(chain)).toEqual(new Set(['A', 'B', 'C']))
    // A is foundational: it must appear before both B and C.
    expect(chain.indexOf('A')).toBeLessThan(chain.indexOf('B'))
    expect(chain.indexOf('A')).toBeLessThan(chain.indexOf('C'))
    // A is only listed once even though two paths reach it.
    expect(chain.filter((id) => id === 'A')).toHaveLength(1)
  })

  it('throws KnowledgeDagError on a cycle', () => {
    const edges = [edge('A', 'B'), edge('B', 'C'), edge('C', 'A')]
    expect(() => walkPrereqsRecursive(edges, 'A')).toThrow(KnowledgeDagError)
  })
})

describe('InterventionService.suggestNextIntervention', () => {
  it('returns the first unmastered prerequisite along a simple chain', async () => {
    // C -> B -> A. A mastered, B not. Query C. Expect B.
    const knowledge = new JsonKnowledgeStore({
      seed: {
        points: [point('A'), point('B'), point('C')],
        edges: [edge('C', 'B'), edge('B', 'A')]
      }
    })
    const service = new InterventionService({
      knowledge,
      mastery: readerFor({ A: 0.9, B: 0.4, C: 0.2 })
    })

    const result = await service.suggestNextIntervention('student-1', 'C')
    expect(result.targetKp).toBe('B')
    expect(result.weakKp).toBe('C')
    expect(result.chain).toEqual(['A', 'B'])
  })

  it('returns the foundational gap first in a diamond DAG', async () => {
    // D -> {B, C} -> A. A unmastered → intervention starts at A.
    const knowledge = new JsonKnowledgeStore({
      seed: {
        points: [point('A'), point('B'), point('C'), point('D')],
        edges: [edge('D', 'B'), edge('D', 'C'), edge('B', 'A'), edge('C', 'A')]
      }
    })
    const service = new InterventionService({
      knowledge,
      mastery: readerFor({ A: 0.3, B: 0.9, C: 0.9, D: 0.1 })
    })

    const result = await service.suggestNextIntervention('student-1', 'D')
    expect(result.targetKp).toBe('A')
  })

  it('falls back to the weak point itself when every prerequisite is mastered', async () => {
    const knowledge = new JsonKnowledgeStore({
      seed: {
        points: [point('A'), point('B'), point('C')],
        edges: [edge('C', 'B'), edge('B', 'A')]
      }
    })
    const service = new InterventionService({
      knowledge,
      mastery: readerFor({ A: 0.9, B: 0.8, C: 0.1 })
    })

    const result = await service.suggestNextIntervention('student-1', 'C')
    expect(result.targetKp).toBe('C')
  })

  it('treats a prerequisite with no mastery record as unmastered (score 0)', async () => {
    const knowledge = new JsonKnowledgeStore({
      seed: {
        points: [point('A'), point('B')],
        edges: [edge('B', 'A')]
      }
    })
    const service = new InterventionService({
      knowledge,
      mastery: readerFor({ B: 0.1 }) // A has no record at all
    })

    const result = await service.suggestNextIntervention('student-1', 'B')
    expect(result.targetKp).toBe('A')
  })

  it('uses exactly MASTERY_THRESHOLD (0.6) as the mastered gate', async () => {
    const knowledge = new JsonKnowledgeStore({
      seed: {
        points: [point('A'), point('B')],
        edges: [edge('B', 'A')]
      }
    })
    // A at exactly 0.6 counts as mastered (score < threshold is unmastered).
    const service = new InterventionService({
      knowledge,
      mastery: readerFor({ A: 0.6, B: 0.1 })
    })

    const result = await service.suggestNextIntervention('student-1', 'B')
    expect(result.targetKp).toBe('B')
  })
})
