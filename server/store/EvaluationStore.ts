import { mkdir, readFile, rename, writeFile } from 'node:fs/promises'
import { dirname } from 'node:path'
import type {
  EvaluationHistoryItem,
  EvaluationResult,
  Provenance
} from '../../shared/contracts'
import { DEFAULT_EVIDENCE_PROVENANCE } from '../../shared/contracts'

export interface EvaluationListFilters {
  assignmentId?: string
  studentId?: string
}

export interface EvaluationStore {
  save(evaluation: EvaluationResult): Promise<void>
  get(id: string): Promise<EvaluationResult | undefined>
  list(filters?: EvaluationListFilters | string): Promise<EvaluationHistoryItem[]>
  listResults(filters?: EvaluationListFilters): Promise<EvaluationResult[]>
  latest(assignmentId: string): Promise<EvaluationResult | undefined>
  /**
   * Right-to-erasure (GDPR / 被遗忘权). Hard-deletes a single evaluation
   * record. Returns true when a record was removed, false when the id was
   * not found. Callers must enforce ownership before invoking.
   */
  delete(id: string): Promise<boolean>
}

/**
 * Ensure provenance is present (JSON migration for pre-012 evaluation records).
 */
export function ensureEvaluationProvenance(
  evaluation: EvaluationResult
): EvaluationResult {
  if (isValidProvenance(evaluation.provenance)) {
    return evaluation
  }

  const evidenceIds = evaluation.evidence.map((item) => item.id)
  const provenance: Provenance = {
    kind: 'evidence',
    evidenceIds,
    algorithm: 'simple.v1'
  }
  return { ...evaluation, provenance }
}

function isValidProvenance(value: unknown): value is Provenance {
  if (typeof value !== 'object' || value === null) return false
  const record = value as { kind?: unknown }
  return (
    record.kind === 'evidence' ||
    record.kind === 'llm_inference' ||
    record.kind === 'learner_self_report' ||
    record.kind === 'teacher_annotation'
  )
}

export class JsonEvaluationStore implements EvaluationStore {
  private writeChain: Promise<void> = Promise.resolve()
  private readonly memoryRecords: EvaluationResult[] | null
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

  public save(evaluation: EvaluationResult): Promise<void> {
    this.writeChain = this.writeChain.then(async () => {
      const evaluations = await this.readAll()
      const withProvenance = ensureEvaluationProvenance({
        ...evaluation,
        provenance:
          evaluation.provenance ??
          ({
            kind: 'evidence',
            evidenceIds: evaluation.evidence.map((item) => item.id),
            algorithm: 'simple.v1'
          } satisfies Provenance)
      })
      const next = [
        ...evaluations.filter((item) => item.id !== withProvenance.id),
        withProvenance
      ]

      if (this.memoryRecords) {
        this.memoryRecords.splice(0, this.memoryRecords.length, ...next)
        return
      }

      if (!this.filePath) {
        throw new Error('Evaluation store has no writable target')
      }

      await mkdir(dirname(this.filePath), { recursive: true })
      const temporaryPath = `${this.filePath}.tmp`
      await writeFile(temporaryPath, JSON.stringify(next, null, 2), 'utf8')
      await rename(temporaryPath, this.filePath)
    })

    return this.writeChain
  }

  /**
   * Right-to-erasure (GDPR-style): permanently remove one evaluation record.
   * Returns true when a record was deleted, false when the id was not found.
   * Serialized through writeChain so it never races a concurrent save.
   */
  public delete(id: string): Promise<boolean> {
    let deleted = false
    this.writeChain = this.writeChain.then(async () => {
      const evaluations = await this.readAll()
      const next = evaluations.filter((item) => item.id !== id)
      deleted = next.length !== evaluations.length
      if (!deleted) return

      if (this.memoryRecords) {
        this.memoryRecords.splice(0, this.memoryRecords.length, ...next)
        return
      }

      if (!this.filePath) {
        throw new Error('Evaluation store has no writable target')
      }

      await mkdir(dirname(this.filePath), { recursive: true })
      const temporaryPath = `${this.filePath}.tmp`
      await writeFile(temporaryPath, JSON.stringify(next, null, 2), 'utf8')
      await rename(temporaryPath, this.filePath)
    })

    return this.writeChain.then(() => deleted)
  }

  public async get(id: string): Promise<EvaluationResult | undefined> {
    await this.writeChain
    const found = (await this.readAll()).find((item) => item.id === id)
    return found ? ensureEvaluationProvenance(found) : undefined
  }

  public async latest(
    assignmentId: string
  ): Promise<EvaluationResult | undefined> {
    await this.writeChain
    const found = (await this.readAll())
      .filter((item) => item.assignmentId === assignmentId)
      .sort((left, right) => right.createdAt.localeCompare(left.createdAt))[0]
    return found ? ensureEvaluationProvenance(found) : undefined
  }

  public async list(
    filters?: EvaluationListFilters | string
  ): Promise<EvaluationHistoryItem[]> {
    await this.writeChain
    const normalized =
      typeof filters === 'string'
        ? { assignmentId: filters }
        : (filters ?? {})

    return (await this.readAll())
      .filter(
        (item) =>
          (normalized.assignmentId === undefined ||
            item.assignmentId === normalized.assignmentId) &&
          (normalized.studentId === undefined ||
            item.studentId === normalized.studentId)
      )
      .sort((left, right) => right.createdAt.localeCompare(left.createdAt))
      .map(
        ({
          id,
          assignmentId: taskId,
          attempt,
          createdAt,
          score,
          scoreDelta,
          status,
          studentId
        }) => ({
          id,
          assignmentId: taskId,
          attempt,
          createdAt,
          score,
          scoreDelta,
          status,
          studentId
        })
      )
  }

  public async listResults(
    filters: EvaluationListFilters = {}
  ): Promise<EvaluationResult[]> {
    await this.writeChain
    return (await this.readAll())
      .filter(
        (item) =>
          (filters.assignmentId === undefined ||
            item.assignmentId === filters.assignmentId) &&
          (filters.studentId === undefined ||
            item.studentId === filters.studentId)
      )
      .sort((left, right) => right.createdAt.localeCompare(left.createdAt))
      .map(ensureEvaluationProvenance)
  }

  private async readAll(): Promise<EvaluationResult[]> {
    if (this.memoryRecords) {
      return this.memoryRecords.map((item) =>
        ensureEvaluationProvenance({
          ...item,
          provenance: item.provenance ?? DEFAULT_EVIDENCE_PROVENANCE
        })
      )
    }

    if (!this.filePath) {
      return []
    }

    try {
      const contents = (await readFile(this.filePath, 'utf8')).replace(/^\uFEFF/, '')
      const parsed = JSON.parse(contents) as unknown
      if (!Array.isArray(parsed)) return []
      return (parsed as EvaluationResult[]).map((item) =>
        ensureEvaluationProvenance({
          ...item,
          provenance: item.provenance ?? DEFAULT_EVIDENCE_PROVENANCE
        })
      )
    } catch (error) {
      if (error instanceof Error && 'code' in error && error.code === 'ENOENT') {
        return []
      }
      throw error
    }
  }
}
