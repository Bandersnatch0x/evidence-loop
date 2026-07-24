import { mkdir, readFile, rename, writeFile } from 'node:fs/promises'
import { dirname } from 'node:path'
import type {
  Attempt,
  EvaluationHistoryItem,
  EvaluationResult,
  SessionMode
} from '../../shared/contracts'
import {
  ensureEvaluationProvenance,
  type EvaluationListFilters,
  type EvaluationStore
} from './EvaluationStore'

export interface AttemptListFilters {
  studentId?: string
  questionId?: string
  termId?: string
  teachingUnitId?: string
  mode?: SessionMode
}

/**
 * Attempt-aware evaluation store (T01 expand-contract).
 * Implements the existing EvaluationStore surface so MasteryService and the
 * HTTP layer can swap implementations without a hard cutover. JsonEvaluationStore
 * remains available for demo / legacy paths.
 */
export interface AttemptStore extends EvaluationStore {
  saveAttempt(attempt: Attempt): Promise<void>
  getAttempt(id: string): Promise<Attempt | undefined>
  listAttempts(filters?: AttemptListFilters): Promise<Attempt[]>
  deleteAttempt(id: string): Promise<boolean>
}

export function isAttemptStore(store: EvaluationStore): store is AttemptStore {
  return (
    typeof (store as AttemptStore).saveAttempt === 'function' &&
    typeof (store as AttemptStore).listAttempts === 'function' &&
    typeof (store as AttemptStore).getAttempt === 'function'
  )
}

/**
 * JSON-file AttemptStore. EvaluationStore methods project from Attempt.result
 * so callers that still speak EvaluationResult keep working.
 */
export class JsonAttemptStore implements AttemptStore {
  private writeChain: Promise<void> = Promise.resolve()
  private readonly memoryRecords: Attempt[] | null
  private readonly filePath: string | null

  public constructor(dataFile: string) {
    if (dataFile === ':memory:') {
      this.memoryRecords = []
      this.filePath = null
      return
    }
    this.memoryRecords = null
    this.filePath = dataFile
  }

  public saveAttempt(attempt: Attempt): Promise<void> {
    this.writeChain = this.writeChain.then(async () => {
      const normalized = normalizeAttempt(attempt)
      const all = await this.readAllAttempts()
      const next = [
        ...all.filter((item) => item.id !== normalized.id),
        normalized
      ]
      await this.persist(next)
    })
    return this.writeChain
  }

  public async getAttempt(id: string): Promise<Attempt | undefined> {
    await this.writeChain
    return (await this.readAllAttempts()).find((item) => item.id === id)
  }

  public async listAttempts(
    filters: AttemptListFilters = {}
  ): Promise<Attempt[]> {
    await this.writeChain
    return (await this.readAllAttempts())
      .filter(
        (item) =>
          (filters.studentId === undefined ||
            item.studentId === filters.studentId) &&
          (filters.questionId === undefined ||
            item.questionId === filters.questionId) &&
          (filters.termId === undefined || item.termId === filters.termId) &&
          (filters.teachingUnitId === undefined ||
            item.teachingUnitId === filters.teachingUnitId) &&
          (filters.mode === undefined || item.mode === filters.mode)
      )
      .sort((left, right) => right.createdAt.localeCompare(left.createdAt))
  }

  public deleteAttempt(id: string): Promise<boolean> {
    let deleted = false
    this.writeChain = this.writeChain.then(async () => {
      const all = await this.readAllAttempts()
      const next = all.filter((item) => item.id !== id)
      deleted = next.length !== all.length
      if (deleted) await this.persist(next)
    })
    return this.writeChain.then(() => deleted)
  }

  // ---------------------------------------------------------------------------
  // EvaluationStore projection (expand-contract)
  // ---------------------------------------------------------------------------

  public save(evaluation: EvaluationResult): Promise<void> {
    const attempt = evaluationToLegacyAttempt(evaluation)
    return this.saveAttempt(attempt)
  }

  public async get(id: string): Promise<EvaluationResult | undefined> {
    const attempt = await this.getAttempt(id)
    return attempt ? ensureEvaluationProvenance(attempt.result) : undefined
  }

  public async latest(
    assignmentId: string
  ): Promise<EvaluationResult | undefined> {
    const attempts = await this.listAttempts({ questionId: assignmentId })
    const found = attempts[0]
    return found ? ensureEvaluationProvenance(found.result) : undefined
  }

  public async list(
    filters?: EvaluationListFilters | string
  ): Promise<EvaluationHistoryItem[]> {
    const normalized =
      typeof filters === 'string'
        ? { assignmentId: filters }
        : (filters ?? {})
    const attempts = await this.listAttempts({
      studentId: normalized.studentId,
      questionId: normalized.assignmentId
    })
    return attempts.map((attempt) => {
      const result = ensureEvaluationProvenance(attempt.result)
      return {
        id: result.id,
        assignmentId: result.assignmentId,
        attempt: result.attempt,
        createdAt: result.createdAt,
        score: result.score,
        scoreDelta: result.scoreDelta,
        status: result.status,
        studentId: result.studentId
      }
    })
  }

  public async listResults(
    filters: EvaluationListFilters = {}
  ): Promise<EvaluationResult[]> {
    const attempts = await this.listAttempts({
      studentId: filters.studentId,
      questionId: filters.assignmentId
    })
    return attempts.map((attempt) => ensureEvaluationProvenance(attempt.result))
  }

  public delete(id: string): Promise<boolean> {
    return this.deleteAttempt(id)
  }

  private async persist(attempts: Attempt[]): Promise<void> {
    if (this.memoryRecords) {
      this.memoryRecords.splice(0, this.memoryRecords.length, ...attempts)
      return
    }
    if (!this.filePath) {
      throw new Error('Attempt store has no writable target')
    }
    await mkdir(dirname(this.filePath), { recursive: true })
    const temporaryPath = `${this.filePath}.tmp`
    await writeFile(temporaryPath, JSON.stringify(attempts, null, 2), 'utf8')
    await rename(temporaryPath, this.filePath)
  }

  private async readAllAttempts(): Promise<Attempt[]> {
    if (this.memoryRecords) {
      return this.memoryRecords.map(normalizeAttempt)
    }
    if (!this.filePath) return []
    try {
      const contents = (await readFile(this.filePath, 'utf8')).replace(
        /^\uFEFF/,
        ''
      )
      const parsed = JSON.parse(contents) as unknown
      if (!Array.isArray(parsed)) return []
      return (parsed as Attempt[]).map(normalizeAttempt)
    } catch (error) {
      if (error instanceof Error && 'code' in error && error.code === 'ENOENT') {
        return []
      }
      throw error
    }
  }
}

function normalizeAttempt(attempt: Attempt): Attempt {
  const result = ensureEvaluationProvenance({
    ...attempt.result,
    // Keep studentId aligned with the aggregate root when present.
    studentId: attempt.result.studentId ?? attempt.studentId
  })
  return {
    ...attempt,
    mode: attempt.mode === 'practice' ? 'practice' : 'assessment',
    result
  }
}

/**
 * Wrap a bare EvaluationResult as an Attempt for EvaluationStore.save callers
 * that have not yet been migrated to saveAttempt. Defaults to assessment so
 * existing demo scoring continues to update formal mastery (D1).
 */
export function evaluationToLegacyAttempt(
  evaluation: EvaluationResult
): Attempt {
  const result = ensureEvaluationProvenance(evaluation)
  return {
    id: result.id,
    studentId: result.studentId ?? 'unknown-student',
    questionId: result.assignmentId,
    teachingUnitId: 'legacy-teaching-unit',
    termId: 'legacy-term',
    mode: 'assessment',
    createdAt: result.createdAt,
    result
  }
}
