/**
 * playerRoutes — read-only student player payload endpoint (spec §5.1/§6).
 *
 * GET /api/demonstrations/:id/versions/:versionId/player
 *
 * Returns the immutable published snapshot payload ONLY:
 *   - scene document (parsed + validated, N-2 migrated)
 *   - render level negotiation result (capabilities)
 *   - media manifest (blob hashes / types / sizes / scan status) + external
 *     video health for the evidence-isolated player
 *   - cover / subtitle media refs (accessibility path)
 *   - resource budget preflight result
 *
 * Iron laws (map #11 / spec §6.12):
 *   - drafts are never served
 *   - soft-deleted / taken-down works are never served
 *   - no teaching/grade/student/cohort data in the payload
 *   - the player never receives student submissions (this endpoint is GET-only)
 *   - no content mutation, no audit write (view-only)
 */
import { respondJson } from '../http/httpUtils'
import type { IncomingMessage, ServerResponse } from 'node:http'
import type { Database } from 'better-sqlite3'
import type { DemonstrationReferenceView } from '../../shared/contracts'
import { safeParseSceneDocument } from './sceneDocumentSchema'
import { negotiateCapabilities, type DeviceCapability } from './capabilities'
import { runSecurityGuards, checkResourceBudget } from './sceneSecurity'

export interface PlayerMediaEntry {
  assetId: string | null
  blobHash: string
  purpose: string
  mediaType: string | null
  byteSize: number | null
  scanStatus: string | null
  /** External video health for video-purpose refs resolved to external_video_refs. */
  externalHealth: string | null
  /** Resolved provider for external video refs (youtube|vimeo). */
  provider: string | null
  /** Resolved canonical URL (only for allowlisted official domains). */
  canonicalUrl: string | null
}

export interface PlayerPayload {
  demonstrationId: string
  versionId: string
  status: 'approved'
  document: unknown
  renderLevel: 'full' | 'simplified' | 'static-alternative' | 'refuse'
  reasons: string[]
  mediaManifest: PlayerMediaEntry[]
  coverRef: { id: string; blobHash: string } | null
  subtitleRef: { id: string; blobHash: string } | null
  budget: {
    ok: boolean
    issues: string[]
    nodes: number
    triangles: number
    durationSeconds: number
    mediaRefs: number
  }
  /** External video refs (for chapter playback; health surfaced to player). */
  externalVideos: Array<{
    id: string
    provider: string
    providerVideoId: string
    canonicalUrl: string
    health: string
  }>
}

export interface PlayerRouteContext {
  db: Database
  /** Device capability probe supplied by the player (or default for SSR). */
  device?: DeviceCapability
  /** Reference service for student KP-bound demonstration listing (知识点页). */
  references?: { listStudentReferencesForKp: (kpId: string) => DemonstrationReferenceView[] }
  getRole?: () => string
}



interface VersionRow {
  status: string
  snapshot_document_json: string
  media_manifest_json: string | null
  demonstration_id: string
}

interface DemoRow {
  deleted_at: string | null
}

interface MediaAssetRow {
  media_type: string | null
  byte_size: number | null
  scan_status: string | null
}

interface ExternalVideoRow {
  provider: string
  provider_video_id: string
  canonical_url: string
  health: string
}

/**
 * handlePlayerApi — read-only player endpoints. Returns true when handled.
 */
export function handlePlayerApi(
  request: IncomingMessage,
  response: ServerResponse,
  pathname: string,
  ctx: PlayerRouteContext
): boolean {
  if (request.method !== 'GET') return false

  // GET /api/demonstrations/by-kp/:kpId — student KP-bound references (知识点页).
  // No auth gate beyond the session (student-facing read-only display).
  const kpMatch = pathname.match(/^\/api\/demonstrations\/by-kp\/([^/]+)$/)
  if (kpMatch) {
    if (ctx.getRole?.() !== 'student') {
      respondJson(response, 403, { error: 'KP demonstrations require student role' })
      return true
    }
    const kpId = decodeURIComponent(kpMatch[1] ?? '')
    if (!ctx.references) {
      respondJson(response, 503, { error: 'reference service unavailable' })
      return true
    }
    const demonstrations = ctx.references.listStudentReferencesForKp(kpId)
    respondJson(response, 200, { demonstrations })
    return true
  }

  const match = pathname.match(
    /^\/api\/demonstrations\/([^/]+)\/versions\/([^/]+)\/player$/
  )
  if (!match) return false

  const demonstrationId = decodeURIComponent(match[1] ?? '')
  const versionId = decodeURIComponent(match[2] ?? '')

  const version = ctx.db
    .prepare(
      `SELECT status, snapshot_document_json, media_manifest_json, demonstration_id
       FROM demonstration_versions WHERE id = ?`
    )
    .get(versionId) as VersionRow | undefined

  if (!version) {
    respondJson(response, 404, { error: 'version not found' })
    return true
  }
  if (version.demonstration_id !== demonstrationId) {
    respondJson(response, 404, { error: 'version not found' })
    return true
  }

  // Only approved (published) snapshots are playable — drafts/pending/rejected
  // are never served (spec §6: the player interprets immutable published snapshots).
  if (version.status !== 'approved') {
    respondJson(response, 404, { error: 'version is not published' })
    return true
  }

  // Soft-deleted / taken-down works are never served.
  const demo = ctx.db
    .prepare(`SELECT deleted_at FROM teaching_demonstrations WHERE id = ?`)
    .get(demonstrationId) as DemoRow | undefined
  if (!demo || demo.deleted_at !== null) {
    respondJson(response, 404, { error: 'demonstration not found' })
    return true
  }

  const parsed = safeParseSceneDocument(JSON.parse(version.snapshot_document_json))
  if (!parsed.success) {
    respondJson(response, 200, {
      demonstrationId,
      versionId,
      status: 'approved',
      renderLevel: 'refuse',
      reasons: ['snapshot failed validation: ' + parsed.error],
      document: null,
      mediaManifest: [],
      coverRef: null,
      subtitleRef: null,
      budget: { ok: false, issues: [parsed.error], nodes: 0, triangles: 0, durationSeconds: 0, mediaRefs: 0 },
      externalVideos: []
    } satisfies PlayerPayload)
    return true
  }

  const document = parsed.document

  // Security guards: zero-script + whitelists + resource budget (hard caps).
  const securityIssues = runSecurityGuards(document)
  if (securityIssues.length > 0) {
    respondJson(response, 200, {
      demonstrationId,
      versionId,
      status: 'approved',
      renderLevel: 'refuse',
      reasons: securityIssues.map((i) => i.message),
      document: null,
      mediaManifest: [],
      coverRef: null,
      subtitleRef: null,
      budget: { ok: false, issues: securityIssues.map((i) => i.message), nodes: 0, triangles: 0, durationSeconds: 0, mediaRefs: 0 },
      externalVideos: []
    } satisfies PlayerPayload)
    return true
  }

  // Capability negotiation — the device probe comes from the player; when the
  // server is asked (SSR/probe-less) it stays permissive (full) and the player
  // re-negotiates client-side before asset load.
  const device: DeviceCapability = ctx.device ?? {
    webgl: 'webgl2',
    tier: 'high',
    prefersReducedMotion: false,
    maxTextureSize: 4096
  }
  const renderLevel = negotiateCapabilities(document, device)
  const reasons: string[] = []
  if (renderLevel !== 'full') reasons.push(`device renders at level: ${renderLevel}`)

  // Media manifest: video-purpose refs resolve to external_video_refs when no
  // hosted asset exists; otherwise map to media_assets + media_blobs.
  const manifestEntries: Array<{ id?: string; blobHash?: string; purpose?: string }> = []
  try {
    const raw = version.media_manifest_json
    if (raw) manifestEntries.push(...(JSON.parse(raw) as typeof manifestEntries))
  } catch {
    // Manifest is a freeze of the scene doc — tolerate corrupt rows read-only.
  }
  const mediaManifest: PlayerMediaEntry[] = []
  const externalVideos: PlayerPayload['externalVideos'] = []
  for (const entry of manifestEntries) {
    const purpose = entry.purpose ?? ''
    const asset = entry.id
      ? (ctx.db
          .prepare(
            `SELECT kind, status, original_blob_hash AS blob_hash FROM media_assets WHERE id = ?`
          )
          .get(entry.id) as
          | { kind: string; status: string; blob_hash: string }
          | undefined)
      : undefined
    const blob = asset?.blob_hash
      ? (ctx.db
          .prepare(
            `SELECT media_type, byte_size, scan_status FROM media_blobs WHERE hash = ?`
          )
          .get(asset.blob_hash) as MediaAssetRow | undefined)
      : entry.blobHash
        ? (ctx.db
            .prepare(
              `SELECT media_type, byte_size, scan_status FROM media_blobs WHERE hash = ?`
            )
            .get(entry.blobHash) as MediaAssetRow | undefined)
        : undefined
    if (!asset && purpose === 'video' && entry.id) {
      const ext = ctx.db
        .prepare(
          `SELECT provider, provider_video_id, canonical_url, health FROM external_video_refs WHERE id = ?`
        )
        .get(entry.id) as ExternalVideoRow | undefined
      if (ext) {
        externalVideos.push({
          id: entry.id,
          provider: ext.provider,
          providerVideoId: ext.provider_video_id,
          canonicalUrl: ext.canonical_url,
          health: ext.health
        })
        mediaManifest.push({
          assetId: entry.id,
          blobHash: entry.blobHash ?? '',
          purpose,
          mediaType: 'external/video',
          byteSize: null,
          scanStatus: null,
          externalHealth: ext.health,
          provider: ext.provider,
          canonicalUrl: ext.canonical_url
        })
        continue
      }
    }
    mediaManifest.push({
      assetId: entry.id ?? null,
      blobHash: entry.blobHash ?? '',
      purpose,
      mediaType: blob?.media_type ?? null,
      byteSize: blob?.byte_size ?? null,
      scanStatus: blob?.scan_status ?? null,
      externalHealth: null,
      provider: null,
      canonicalUrl: null
    })
  }

  // Accessibility refs: cover (thumbnail) + subtitle (WebVTT blob) from mediaRefs.
  const refs = document.mediaRefs ?? []
  const coverRef =
    refs.find((r) => r.purpose === 'thumbnail' && r.blobHash) ??
    refs.find((r) => r.purpose === 'video' && !r.assetId) ??
    null
  const subtitleRef = refs.find((r) => r.purpose === 'subtitle' && r.blobHash) ?? null

  // Budget preflight — resource counts for the player's second gate.
  const budget = checkResourceBudget(document)
  const docForCounts = document as {
    objectTree?: Array<{ children?: unknown[] }>
    geometry3D?: Array<{ kind: string }>
    timeline?: { duration?: number }
    mediaRefs?: unknown[]
  }
  const countNodes = (list: Array<{ children?: unknown[] }> | undefined): number => {
    if (!list) return 0
    let n = 0
    for (const node of list) {
      n += 1
      if (node.children) n += countNodes(node.children as Array<{ children?: unknown[] }>)
    }
    return n
  }
  const nodes = countNodes(docForCounts.objectTree)
  const triangles = estimateTriangles(docForCounts.geometry3D ?? [])
  const durationSeconds = docForCounts.timeline?.duration ?? 0
  const mediaRefs = (docForCounts.mediaRefs ?? []).length

  respondJson(response, 200, {
    demonstrationId,
    versionId,
    status: 'approved',
    document,
    renderLevel,
    reasons,
    mediaManifest,
    coverRef: coverRef ? { id: coverRef.id, blobHash: coverRef.blobHash } : null,
    subtitleRef: subtitleRef ? { id: subtitleRef.id, blobHash: subtitleRef.blobHash } : null,
    budget: {
      ok: budget.length === 0,
      issues: budget.map((i) => i.message),
      nodes,
      triangles,
      durationSeconds,
      mediaRefs
    },
    externalVideos
  } satisfies PlayerPayload)
  return true
}

/** Triangle estimate for budget reporting (mirrors sceneSecurity heuristics). */
function estimateTriangles(geoms: Array<{ kind: string }>): number {
  let total = 0
  for (const g of geoms) {
    switch (g.kind) {
      case 'box': total += 12; break
      case 'sphere': total += 24 * 24 * 2; break
      case 'cylinder':
      case 'cone': total += 24 * 2 * 2; break
      case 'torus': total += 24 * 64 * 2; break
      case 'ring': total += 24 * 2; break
      case 'plane': total += 2; break
      default: total += 0
    }
  }
  return total
}
