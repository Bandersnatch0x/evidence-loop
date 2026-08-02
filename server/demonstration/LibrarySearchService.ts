/**
 * LibrarySearchService — public library discovery (spec §5.4, decision 11,
 * ticket T-E).
 *
 * Visibility: only the CURRENT published (latest approved) version of each
 * demo is searchable; private/draft/rejected never surface.
 *
 * Search = field-weighted full-text over title/description/subject/kp/分类;
 * filters = structured facets (subject/grade/format/space/behavior/license);
 * sort = structural relevance first, then citation count (trusted signal) —
 * play/favorite heat never participates in default ordering (hotness ≠
 * quality, decision 11).
 *
 * Results carry metadata + cover reference only — no playback content.
 */
import type { Database } from 'better-sqlite3'

export interface LibraryFilters {
  subject?: string
  grade?: string
  kp?: string
  format?: string
  space?: string
  behavior?: string
  license?: string
}

export interface LibraryQuery {
  q?: string
  filters?: LibraryFilters
  sort?: 'relevance' | 'citations'
  limit?: number
  offset?: number
}

export interface LibraryCard {
  id: string
  versionId: string
  /** Human-readable version sequence within the demo (1, 2, 3…). */
  versionSeq: number
  title: string
  description: string
  subject: string
  grade: string
  kpIds: string[]
  format: string
  space: string
  behavior: string
  license: string
  authorId: string
  /** Health of the demo's external media (spec §5.4 card 健康状态). */
  health: 'healthy' | 'degraded' | 'unavailable' | 'unknown'
  source: 'original' | 'derived'
  citationCount: number
  /** Cover reference — media blob hash or null. */
  coverBlobHash: string | null
  /** Relevance score (sort=relevance). */
  score: number
}

export interface LibraryResult {
  total: number
  items: LibraryCard[]
}

/** Field weights for structural relevance (decision 11: 学科/学段/知识点 匹配优先). */
const FIELD_WEIGHTS: Array<[string, number]> = [
  ['title', 3],
  ['description', 2],
  ['subject', 2],
  ['kp', 1.5],
  ['format', 1],
  ['space', 1],
  ['behavior', 1],
  ['author', 1],
  ['license', 0.5],
  ['source', 0.5]
]

/** Parsed root meta — typed fields, safe to stringify. */
interface ParsedMeta {
  title?: string
  description?: string
  subject?: string
  grade?: string
  kpIds?: string[]
  format?: string
  space?: string
  behavior?: string
  coverBlobHash?: string
  derivedFrom?: unknown
}

function parseMeta(json: string): ParsedMeta {
  try {
    const raw = JSON.parse(json) as Record<string, unknown>
    return {
      title: typeof raw.title === 'string' ? raw.title : undefined,
      description: typeof raw.description === 'string' ? raw.description : undefined,
      subject: typeof raw.subject === 'string' ? raw.subject : undefined,
      grade: typeof raw.grade === 'string' ? raw.grade : undefined,
      kpIds: Array.isArray(raw.kpIds) ? (raw.kpIds as string[]) : undefined,
      format: typeof raw.format === 'string' ? raw.format : undefined,
      space: typeof raw.space === 'string' ? raw.space : undefined,
      behavior: typeof raw.behavior === 'string' ? raw.behavior : undefined,
      coverBlobHash: typeof raw.coverBlobHash === 'string' ? raw.coverBlobHash : undefined,
      derivedFrom: raw.derivedFrom
    }
  } catch {
    return {}
  }
}

function tokenize(text: string): string[] {
  return text
    .toLowerCase()
    .replace(/[^\p{L}\p{N}\s-]/gu, ' ')
    .split(/\s+/)
    .filter(Boolean)
}

export class LibrarySearchService {
  private readonly db: Database

  public constructor(db: Database) {
    this.db = db
  }

  /** Current published versions (latest approved per demo) with citation counts. */
  private currentPublished(): Array<{
    versionId: string
    demoId: string
    ownerId: string
    versionSeq: number
    metaJson: string
    classification: string
    license: string
    citationCount: number
  }> {
    // Latest approved version per demo that is NOT soft-deleted; versionSeq is
    // the 1-based position of this version among the demo's approved versions
    // ordered by freeze time (human-readable 固定版本号).
    const rows = this.db
      .prepare(
        `SELECT v.id AS versionId, v.demonstration_id AS demoId,
                d.owner_id AS ownerId, v.classification, v.license,
                d.meta_json AS metaJson,
                (SELECT COUNT(*) FROM demonstration_references r WHERE r.demo_version_id = v.id) AS citationCount,
                (SELECT COUNT(*) FROM demonstration_versions v2
                 WHERE v2.demonstration_id = v.demonstration_id AND v2.status = 'approved'
                   AND v2.frozen_at <= v.frozen_at) AS versionSeq
         FROM demonstration_versions v
         JOIN teaching_demonstrations d ON d.id = v.demonstration_id
         WHERE v.status = 'approved' AND d.deleted_at IS NULL
           AND v.id = (
             SELECT v2.id FROM demonstration_versions v2
             WHERE v2.demonstration_id = v.demonstration_id AND v2.status = 'approved'
             ORDER BY v2.frozen_at DESC LIMIT 1
           )`
      )
      .all() as Array<{
      versionId: string
      demoId: string
      ownerId: string
      classification: string
      license: string
      metaJson: string
      citationCount: number
      versionSeq: number
    }>
    return rows.map((r) => ({
      versionId: r.versionId,
      demoId: r.demoId,
      ownerId: r.ownerId,
      versionSeq: r.versionSeq,
      metaJson: r.metaJson,
      classification: r.classification,
      license: r.license,
      citationCount: r.citationCount
    }))
  }

  private buildCard(row: {
    versionId: string
    demoId: string
    ownerId: string
    versionSeq: number
    metaJson: string
    classification: string
    license: string
    citationCount: number
    health: 'healthy' | 'degraded' | 'unavailable' | 'unknown'
  }, score: number): LibraryCard {
    const meta = parseMeta(row.metaJson)
    return {
      id: row.demoId,
      versionId: row.versionId,
      versionSeq: row.versionSeq,
      title: meta.title ?? '',
      description: meta.description ?? '',
      subject: meta.subject ?? '',
      grade: meta.grade ?? '',
      kpIds: meta.kpIds ?? [],
      format: meta.format ?? '',
      space: meta.space ?? '',
      behavior: meta.behavior ?? '',
      license: row.license,
      authorId: row.ownerId,
      health: row.health,
      source: meta.derivedFrom ? 'derived' : 'original',
      citationCount: row.citationCount,
      coverBlobHash: meta.coverBlobHash ?? null,
      score
    }
  }

  /**
   * Aggregate external-video health for a version's media refs (spec §5.4
   * card 健康状态). Any unavailable → unavailable; else any degraded → degraded;
   * references exist but all healthy → healthy; no refs → healthy.
   */
  private versionHealth(versionId: string): 'healthy' | 'degraded' | 'unavailable' | 'unknown' {
    const manifest = this.db
      .prepare(`SELECT media_manifest_json FROM demonstration_versions WHERE id = ?`)
      .get(versionId) as { media_manifest_json: string } | undefined
    if (!manifest) return 'unknown'
    let refs: Array<{ id: string; purpose: string }> = []
    try {
      refs = JSON.parse(manifest.media_manifest_json) as Array<{ id: string; purpose: string }>
    } catch {
      return 'unknown'
    }
    const videoRefs = refs.filter((r) => r.purpose === 'video')
    if (videoRefs.length === 0) return 'healthy'
    const healths = videoRefs
      .map((r) => {
        const row = this.db
          .prepare(`SELECT health FROM external_video_refs WHERE id = ?`)
          .get(r.id) as { health: string } | undefined
        return row?.health ?? 'unknown'
      })
      .filter((h): h is string => h !== 'unknown')
    if (healths.some((h) => h === 'unavailable')) return 'unavailable'
    if (healths.some((h) => h === 'degraded')) return 'degraded'
    return healths.length === videoRefs.length ? 'healthy' : 'unknown'
  }

  /** Relevance score: field-weighted token hits. */
  private relevanceScore(row: {
    metaJson: string
    classification: string
    license: string
    ownerId: string
  }, queryTokens: string[], meta: ParsedMeta): number {
    const haystack: Record<string, string> = {
      title: meta.title ?? '',
      description: meta.description ?? '',
      subject: meta.subject ?? '',
      kp: (meta.kpIds ?? []).join(' ').toLowerCase(),
      format: meta.format ?? '',
      space: meta.space ?? '',
      behavior: meta.behavior ?? '',
      author: row.ownerId ?? ''
    }
    // classification also contributes (license/grade hints).
    haystack.subject = `${haystack.subject} ${row.classification}`.toLowerCase()
    // license/source weights from the version row.
    haystack.license = row.license.toLowerCase()
    haystack.source = meta.derivedFrom ? 'derived' : 'original'
    let score = 0
    for (const [field, weight] of FIELD_WEIGHTS) {
      const text = haystack[field] ?? ''
      for (const t of queryTokens) {
        if (text.includes(t)) score += weight
      }
    }
    return score
  }

  private matchesFilters(meta: ParsedMeta, filters: LibraryFilters): boolean {
    const get = (k: keyof ParsedMeta): string => {
      const v = meta[k]
      return typeof v === 'string' ? v.toLowerCase() : ''
    }
    if (filters.subject && get('subject') !== filters.subject.toLowerCase()) return false
    if (filters.grade && get('grade') !== filters.grade.toLowerCase()) return false
    if (filters.format && get('format') !== filters.format.toLowerCase()) return false
    if (filters.space && get('space') !== filters.space.toLowerCase()) return false
    if (filters.behavior && get('behavior') !== filters.behavior.toLowerCase()) return false
    if (filters.kp) {
      const kpIds = meta.kpIds ?? []
      if (!kpIds.includes(filters.kp)) return false
    }
    return true
  }

  public search(query: LibraryQuery): LibraryResult {
    const tokens = query.q ? tokenize(query.q) : []
    const filters = query.filters ?? {}
    const limit = query.limit ?? 50
    const offset = query.offset ?? 0

    const rows = this.currentPublished()
    const cards: LibraryCard[] = []
    for (const row of rows) {
      const meta = parseMeta(row.metaJson)
      if (!this.matchesFilters(meta, filters)) continue
      // License filter comes from the version row, not meta (version attribute,
      // never author-controlled metadata — kept separate from matchesFilters).
      if (filters.license && row.license !== filters.license) continue
      const score = tokens.length > 0 ? this.relevanceScore(row, tokens, meta) : 0
      // No query + no filters → all published surface (score 0).
      if (tokens.length > 0 && score === 0) continue
      cards.push(this.buildCard({ ...row, health: this.versionHealth(row.versionId) }, score))
    }

    // Sort: relevance first (structural), then citation count (trusted signal),
    // then health (unavailable sinks below healthy — spec §5.4 quality signal).
    const healthRank = (h: LibraryCard['health']): number =>
      h === 'healthy' ? 0 : h === 'degraded' ? 1 : h === 'unknown' ? 2 : 3
    if (query.sort === 'citations') {
      cards.sort(
        (a, b) =>
          b.citationCount - a.citationCount ||
          b.score - a.score ||
          healthRank(a.health) - healthRank(b.health)
      )
    } else {
      cards.sort(
        (a, b) =>
          b.score - a.score ||
          b.citationCount - a.citationCount ||
          healthRank(a.health) - healthRank(b.health)
      )
    }

    const total = cards.length
    return { total, items: cards.slice(offset, offset + limit) }
  }

  /** Facet values for the filter UI (distinct values across published). */
  public facets(): Record<string, string[]> {
    const counts: Record<string, Set<string>> = {
      subject: new Set(),
      grade: new Set(),
      format: new Set(),
      space: new Set(),
      behavior: new Set(),
      license: new Set()
    }
    for (const row of this.currentPublished()) {
      const meta = parseMeta(row.metaJson)
      for (const key of ['subject', 'grade', 'format', 'space', 'behavior'] as const) {
        const v = (meta[key] ?? '').trim()
        if (v) counts[key]?.add(v)
      }
      if (row.license) counts.license?.add(row.license)
    }
    const out: Record<string, string[]> = {}
    for (const [k, s] of Object.entries(counts)) {
      out[k] = [...s].sort()
    }
    return out
  }
}