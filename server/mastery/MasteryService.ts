import { createHash, createHmac, timingSafeEqual } from 'node:crypto'
import type Database from 'better-sqlite3'
import type {
  EvaluationResult,
  MasteryEvidence,
  MasteryProfileMap,
  MasterySnapshot,
  MasteryTimelineEntry,
  Provenance
} from '../../shared/contracts'
import type { EvaluationStore } from '../store/EvaluationStore'
import {
  computeMastery,
  MASTERY_ALGORITHM_VERSION
} from './computeMastery'

const GENESIS_HASH = '0'.repeat(64)

interface MasteryRow {
  id: number
  student_id: string
  kp_id: string
  score: number
  evidence_ids: string
  computed_at: string
  algorithm_version: string
  prev_hash: string
  hmac: string
}

export interface MasteryServiceOptions {
  db: Database.Database
  hmacSecret: string
  evaluationStore: EvaluationStore
}

export class MasteryService {
  private readonly db: Database.Database
  private readonly hmacSecret: string
  private readonly evaluationStore: EvaluationStore
  private readonly insertStatement: Database.Statement
  private lastHash = GENESIS_HASH

  public constructor(options: MasteryServiceOptions) {
    if (options.hmacSecret.trim() === '') {
      throw new Error('MasteryService requires a non-empty HMAC secret')
    }
    this.db = options.db
    this.hmacSecret = options.hmacSecret
    this.evaluationStore = options.evaluationStore

    this.insertStatement = this.db.prepare(`
      INSERT INTO mastery_scores (
        student_id, kp_id, score, evidence_ids, computed_at,
        algorithm_version, prev_hash, hmac
      ) VALUES (
        @student_id, @kp_id, @score, @evidence_ids, @computed_at,
        @algorithm_version, @prev_hash, @hmac
      )
    `)

    const tip = this.db
      .prepare(
        `SELECT hmac FROM mastery_scores ORDER BY id DESC LIMIT 1`
      )
      .get() as { hmac: string } | undefined
    if (tip) {
      // Chain tip is the payload hash stored before signing; recover from last row.
      const last = this.db
        .prepare(
          `SELECT * FROM mastery_scores ORDER BY id DESC LIMIT 1`
        )
        .get() as MasteryRow | undefined
      if (last) {
        this.lastHash = computeMasteryPayloadHash({
          studentId: last.student_id,
          kpId: last.kp_id,
          score: last.score,
          evidenceIdsJson: last.evidence_ids,
          computedAt: last.computed_at,
          algorithmVersion: last.algorithm_version,
          prevHash: last.prev_hash
        })
      }
    }
  }

  /**
   * Recompute mastery for one student × knowledge point from all stored evidence.
   * Appends a new mastery_scores row (never updates).
   */
  public async recompute(
    studentId: string,
    kpId: string
  ): Promise<MasterySnapshot> {
    const evidences = await this.collectEvidence(studentId, kpId)
    const score = computeMastery(evidences)
    const evidenceIds = evidences.map((item) => item.id)
    const computedAt = new Date().toISOString()
    const evidenceIdsJson = JSON.stringify(evidenceIds)
    const prevHash = this.lastHash
    const payloadHash = computeMasteryPayloadHash({
      studentId,
      kpId,
      score,
      evidenceIdsJson,
      computedAt,
      algorithmVersion: MASTERY_ALGORITHM_VERSION,
      prevHash
    })
    const hmac = signHash(payloadHash, this.hmacSecret)

    this.insertStatement.run({
      student_id: studentId,
      kp_id: kpId,
      score,
      evidence_ids: evidenceIdsJson,
      computed_at: computedAt,
      algorithm_version: MASTERY_ALGORITHM_VERSION,
      prev_hash: prevHash,
      hmac
    })

    this.lastHash = payloadHash

    // Dual-write provenance pointer onto the evaluations SQLite projection when present.
    this.upsertEvaluationProvenancePointers(studentId, evidenceIds)

    return {
      score,
      evidenceIds,
      computedAt,
      algorithmVersion: MASTERY_ALGORITHM_VERSION
    }
  }

  /**
   * After a completed evaluation, recompute every knowledge point touched by its evidence.
   */
  public async recomputeFromEvaluation(
    evaluation: EvaluationResult
  ): Promise<string[]> {
    const studentId = evaluation.studentId
    if (!studentId || evaluation.status !== 'completed') {
      return []
    }

    const kpIds = extractKpIds(evaluation)
    for (const kpId of kpIds) {
      await this.recompute(studentId, kpId)
    }
    return kpIds
  }

  public getProfile(studentId: string): MasteryProfileMap {
    const rows = this.db
      .prepare(
        `
        SELECT m.*
        FROM mastery_scores m
        INNER JOIN (
          SELECT student_id, kp_id, MAX(id) AS max_id
          FROM mastery_scores
          WHERE student_id = @studentId
          GROUP BY student_id, kp_id
        ) latest
          ON m.id = latest.max_id
        `
      )
      .all({ studentId }) as MasteryRow[]

    const profile: MasteryProfileMap = {}
    for (const row of rows) {
      profile[row.kp_id] = rowToSnapshot(row)
    }
    return profile
  }

  public getTimeline(studentId: string, kpId: string): MasteryTimelineEntry[] {
    const rows = this.db
      .prepare(
        `
        SELECT *
        FROM mastery_scores
        WHERE student_id = @studentId AND kp_id = @kpId
        ORDER BY computed_at ASC, id ASC
        `
      )
      .all({ studentId, kpId }) as MasteryRow[]

    return rows.map(rowToTimeline)
  }

  public verifyChain(): boolean {
    const rows = this.db
      .prepare(`SELECT * FROM mastery_scores ORDER BY id ASC`)
      .all() as MasteryRow[]

    let expectedPrev = GENESIS_HASH
    for (const row of rows) {
      if (row.prev_hash !== expectedPrev) return false
      const payloadHash = computeMasteryPayloadHash({
        studentId: row.student_id,
        kpId: row.kp_id,
        score: row.score,
        evidenceIdsJson: row.evidence_ids,
        computedAt: row.computed_at,
        algorithmVersion: row.algorithm_version,
        prevHash: row.prev_hash
      })
      const expectedHmac = signHash(payloadHash, this.hmacSecret)
      if (!signaturesMatch(expectedHmac, row.hmac)) return false
      expectedPrev = payloadHash
    }
    return true
  }

  private async collectEvidence(
    studentId: string,
    kpId: string
  ): Promise<MasteryEvidence[]> {
    const results = await this.evaluationStore.listResults({ studentId })
    const evidences: MasteryEvidence[] = []

    for (const evaluation of results) {
      if (evaluation.status !== 'completed') continue
      for (const item of evaluation.evidence) {
        if (item.conceptId !== kpId) continue
        evidences.push({
          id: `${evaluation.id}:${item.id}`,
          score: item.state === 'passed' ? 1 : 0,
          weight: item.weight,
          kpId,
          createdAt: evaluation.createdAt
        })
      }
    }

    return evidences
  }

  private upsertEvaluationProvenancePointers(
    studentId: string,
    evidenceIds: string[]
  ): void {
    // evidence ids look like "eval_xxx:criterion-id" — project evaluation-level provenance.
    const evaluationIds = new Set<string>()
    for (const composite of evidenceIds) {
      const separator = composite.indexOf(':')
      if (separator > 0) {
        evaluationIds.add(composite.slice(0, separator))
      }
    }

    const upsert = this.db.prepare(`
      INSERT INTO evaluations (id, student_id, provenance)
      VALUES (@id, @student_id, @provenance)
      ON CONFLICT(id) DO UPDATE SET
        provenance = excluded.provenance,
        student_id = COALESCE(excluded.student_id, evaluations.student_id)
    `)

    for (const evaluationId of evaluationIds) {
      const provenance: Provenance = {
        kind: 'evidence',
        evidenceIds: evidenceIds.filter((id) => id.startsWith(`${evaluationId}:`)),
        algorithm: MASTERY_ALGORITHM_VERSION
      }
      upsert.run({
        id: evaluationId,
        student_id: studentId,
        provenance: JSON.stringify(provenance)
      })
    }
  }
}

export function extractKpIds(evaluation: EvaluationResult): string[] {
  const ids = new Set<string>()
  for (const item of evaluation.evidence) {
    if (item.conceptId) ids.add(item.conceptId)
  }
  return [...ids]
}

function rowToSnapshot(row: MasteryRow): MasterySnapshot {
  return {
    score: row.score,
    evidenceIds: parseEvidenceIds(row.evidence_ids),
    computedAt: row.computed_at,
    algorithmVersion: row.algorithm_version
  }
}

function rowToTimeline(row: MasteryRow): MasteryTimelineEntry {
  return {
    id: row.id,
    studentId: row.student_id,
    kpId: row.kp_id,
    score: row.score,
    evidenceIds: parseEvidenceIds(row.evidence_ids),
    computedAt: row.computed_at,
    algorithmVersion: row.algorithm_version
  }
}

function parseEvidenceIds(raw: string): string[] {
  try {
    const parsed: unknown = JSON.parse(raw)
    if (!Array.isArray(parsed)) return []
    return parsed.filter((item): item is string => typeof item === 'string')
  } catch {
    return []
  }
}

function computeMasteryPayloadHash(input: {
  studentId: string
  kpId: string
  score: number
  evidenceIdsJson: string
  computedAt: string
  algorithmVersion: string
  prevHash: string
}): string {
  const payload = [
    input.studentId,
    input.kpId,
    String(input.score),
    input.evidenceIdsJson,
    input.computedAt,
    input.algorithmVersion,
    input.prevHash
  ].join('\n')
  return createHash('sha256').update(payload, 'utf8').digest('hex')
}

function signHash(hash: string, secret: string): string {
  return createHmac('sha256', secret).update(hash, 'utf8').digest('hex')
}

function signaturesMatch(left: string, right: string): boolean {
  try {
    const leftBuf = Buffer.from(left, 'hex')
    const rightBuf = Buffer.from(right, 'hex')
    if (leftBuf.length === 0 || leftBuf.length !== rightBuf.length) {
      return false
    }
    return timingSafeEqual(leftBuf, rightBuf)
  } catch {
    return false
  }
}
