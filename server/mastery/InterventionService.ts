import type {
  InterventionSuggestion,
  MasteryProfileMap
} from '../../shared/contracts'
import type { KnowledgeStore } from '../knowledge/KnowledgeStore'
import { MASTERY_THRESHOLD } from '../config/mastery'
import { walkPrereqsRecursive } from './knowledgeDag'

/**
 * Read-only view of mastery scores the intervention diagnosis depends on.
 * Kept minimal so the service can accept a MasteryService directly without
 * importing the memory layer (ADR-0006: server/mastery must never reach into
 * server/memory or any LLM runtime — intervention is a pure hard-fact walk).
 */
export interface MasteryProfileReader {
  getProfile(studentId: string): MasteryProfileMap
}

export interface InterventionServiceOptions {
  knowledge: KnowledgeStore
  mastery: MasteryProfileReader
}

/**
 * Dependency-chain diagnosis (ADR-0007 §4).
 *
 * When a learner is stuck on `weakKp`, walk its prerequisite chain and point
 * at the earliest prerequisite whose mastery score is still below
 * MASTERY_THRESHOLD. If every prerequisite is mastered, the learner's gap is
 * the weak point itself, so `targetKp` falls back to `weakKp`.
 */
export class InterventionService {
  private readonly knowledge: KnowledgeStore
  private readonly mastery: MasteryProfileReader

  public constructor(options: InterventionServiceOptions) {
    this.knowledge = options.knowledge
    this.mastery = options.mastery
  }

  public async suggestNextIntervention(
    studentId: string,
    weakKp: string
  ): Promise<InterventionSuggestion> {
    const edges = await this.knowledge.listEdges()
    const chain = walkPrereqsRecursive(edges, weakKp)
    const profile = this.mastery.getProfile(studentId)

    // Chain is topological (most foundational first), so the first unmastered
    // prerequisite is the earliest gap to close.
    for (const prereqId of chain) {
      if (scoreOf(profile, prereqId) < MASTERY_THRESHOLD) {
        return { studentId, weakKp, targetKp: prereqId, chain }
      }
    }

    return { studentId, weakKp, targetKp: weakKp, chain }
  }
}

function scoreOf(profile: MasteryProfileMap, kpId: string): number {
  const snapshot = profile[kpId]
  return snapshot ? snapshot.score : 0
}
