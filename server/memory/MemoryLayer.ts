import type Database from 'better-sqlite3'
import {
  migrateMemorySchema,
  openMemoryDatabase
} from '../db/memorySchema'
import { MasteryService } from '../mastery/MasteryService'
import { ReviewScheduler } from '../review/ReviewScheduler'
import type { EvaluationStore } from '../store/EvaluationStore'

export interface MemoryLayerOptions {
  dbPath: string
  hmacSecret: string
  evaluationStore: EvaluationStore
  /** Optional pre-opened DB (needed so :memory: is shared across services). */
  database?: Database.Database
}

/**
 * Owns the shared SQLite connection for mastery_scores + review_cards
 * (same physical file as audit when paths match — ADR-0007).
 */
export class MemoryLayer {
  private readonly db: Database.Database
  private readonly ownsDb: boolean
  public readonly mastery: MasteryService
  public readonly review: ReviewScheduler

  public constructor(options: MemoryLayerOptions) {
    this.ownsDb = options.database === undefined
    if (options.database) {
      this.db = options.database
      migrateMemorySchema(this.db)
    } else {
      this.db = openMemoryDatabase(options.dbPath)
    }

    this.mastery = new MasteryService({
      db: this.db,
      hmacSecret: options.hmacSecret,
      evaluationStore: options.evaluationStore
    })
    this.review = new ReviewScheduler({
      db: this.db,
      hmacSecret: options.hmacSecret
    })
  }

  public close(): void {
    if (this.ownsDb) {
      this.db.close()
    }
  }
}
