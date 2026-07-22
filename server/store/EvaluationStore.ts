import { mkdir, readFile, rename, writeFile } from 'node:fs/promises'
import { dirname } from 'node:path'
import type {
  EvaluationHistoryItem,
  EvaluationResult
} from '../../shared/contracts'

export interface EvaluationStore {
  save(evaluation: EvaluationResult): Promise<void>
  get(id: string): Promise<EvaluationResult | undefined>
  list(assignmentId?: string): Promise<EvaluationHistoryItem[]>
  latest(assignmentId: string): Promise<EvaluationResult | undefined>
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
      const next = [
        ...evaluations.filter((item) => item.id !== evaluation.id),
        evaluation
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

  public async get(id: string): Promise<EvaluationResult | undefined> {
    await this.writeChain
    return (await this.readAll()).find((item) => item.id === id)
  }

  public async latest(
    assignmentId: string
  ): Promise<EvaluationResult | undefined> {
    await this.writeChain
    return (await this.readAll())
      .filter((item) => item.assignmentId === assignmentId)
      .sort((left, right) => right.createdAt.localeCompare(left.createdAt))[0]
  }

  public async list(assignmentId?: string): Promise<EvaluationHistoryItem[]> {
    await this.writeChain
    return (await this.readAll())
      .filter(
        (item) => assignmentId === undefined || item.assignmentId === assignmentId
      )
      .sort((left, right) => right.createdAt.localeCompare(left.createdAt))
      .map(
        ({ id, assignmentId: taskId, attempt, createdAt, score, scoreDelta, status }) => ({
          id,
          assignmentId: taskId,
          attempt,
          createdAt,
          score,
          scoreDelta,
          status
        })
      )
  }

  private async readAll(): Promise<EvaluationResult[]> {
    if (this.memoryRecords) {
      return [...this.memoryRecords]
    }

    if (!this.filePath) {
      return []
    }

    try {
      const contents = (await readFile(this.filePath, 'utf8')).replace(/^\uFEFF/, '')
      const parsed = JSON.parse(contents) as unknown
      return Array.isArray(parsed) ? (parsed as EvaluationResult[]) : []
    } catch (error) {
      if (error instanceof Error && 'code' in error && error.code === 'ENOENT') {
        return []
      }
      throw error
    }
  }
}
