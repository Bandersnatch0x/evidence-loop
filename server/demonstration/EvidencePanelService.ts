/**
 * EvidencePanelService - reviewer evidence panel (spec §5.2, decision 04,
 * ticket T-F).
 *
 * Assembles everything a reviewer needs to decide a version: the immutable
 * playable snapshot, the resolved media manifest (blob hash / type / size /
 * processing state), external-video references + health, the derivation source
 * chain + attribution, the license + AI disclosure, and the report + review
 * history for the work.
 *
 * IRON LAW (spec §2.8 / §3.4): the panel NEVER surfaces student, grade,
 * attempt, mastery or teaching-org private data. Reviewers govern the public
 * library only. The assembled shape is asserted by tests to carry no such
 * fields.
 */
import type { Database } from 'better-sqlite3'
import { DemoVersionNotFoundError } from './DemonstrationService'
import { safeParseSceneDocument, type SceneDocument } from './sceneDocumentSchema'

export interface PanelMediaEntry {
  assetId: string | null
  blobHash: string
  purpose: string
  kind: string | null
  assetStatus: string | null
  displayName: string | null
  mediaType: string | null
  byteSize: number | null
  scanStatus: string | null
}

export interface PanelExternalVideo {
  id: string
  provider: string
  providerVideoId: string
  canonicalUrl: string
  health: string
  checkedAt: string | null
}

export interface PanelVersionSummary {
  id: string
  status: string
  frozenAt: string
  reviewerNote: string | null
}

export interface PanelReportSummary {
  id: string
  category: string
  reason: string
  status: string
  createdAt: string
  reporterId: string
}

export interface EvidencePanel {
  version: {
    id: string
    demonstrationId: string
    status: string
    frozenAt: string
    classification: string
    license: string
    aiDisclosure: string
    reviewerNote: string | null
  }
  authorId: string
  /** Immutable playable snapshot (read-tolerant; null only if storage corrupt). */
  snapshot: SceneDocument | null
  snapshotValid: boolean
  mediaManifest: PanelMediaEntry[]
  externalVideos: PanelExternalVideo[]
  sourceChain: {
    sourceDemoId: string
    sourceVersionId: string
    originalAuthorId: string
  } | null
  reports: PanelReportSummary[]
  reviewHistory: PanelVersionSummary[]
}

interface VersionRow {
  id: string
  demonstration_id: string
  status: string
  snapshot_document_json: string
  classification: string
  license: string
  ai_disclosure: string
  source_chain_json: string | null
  media_manifest_json: string
  reviewer_note: string | null
  frozen_at: string
}

interface ManifestEntry {
  id?: string
  blobHash?: string
  purpose?: string
}

export interface EvidencePanelServiceOptions {
  db: Database
}

export class EvidencePanelService {
  private readonly db: Database

  public constructor(options: EvidencePanelServiceOptions) {
    this.db = options.db
  }

  /** Assemble the evidence panel for a version id. */
  public forVersion(versionId: string): EvidencePanel {
    const version = this.db
      .prepare(
        `SELECT id, demonstration_id, status, snapshot_document_json, classification,
                license, ai_disclosure, source_chain_json, media_manifest_json,
                reviewer_note, frozen_at
         FROM demonstration_versions WHERE id = ?`
      )
      .get(versionId) as VersionRow | undefined
    if (!version) throw new DemoVersionNotFoundError(versionId)

    const demo = this.db
      .prepare(`SELECT owner_id FROM teaching_demonstrations WHERE id = ?`)
      .get(version.demonstration_id) as { owner_id: string } | undefined
    // A version always has a demo row; defend anyway.
    const authorId = demo?.owner_id ?? ''

    // Read-tolerant snapshot parse (spec §4.4): an illegal OR corrupt snapshot
    // downgrades to null + snapshotValid=false rather than crashing the panel.
    // The raw JSON.parse is guarded too - a non-JSON snapshot row must not 500
    // the reviewer panel (source_chain_json / media_manifest_json are guarded
    // the same way below).
    let parsed: ReturnType<typeof safeParseSceneDocument>
    try {
      parsed = safeParseSceneDocument(JSON.parse(version.snapshot_document_json))
    } catch {
      parsed = {
        success: false,
        error: 'snapshot document is not valid JSON',
        issues: []
      }
    }

    // Source chain is frozen on the version (spec §2.1/§5.1) - authoritative.
    let sourceChain: EvidencePanel['sourceChain'] = null
    if (version.source_chain_json) {
      try {
        sourceChain = JSON.parse(version.source_chain_json) as EvidencePanel['sourceChain']
      } catch {
        sourceChain = null
      }
    }

    // Resolve the media manifest: video-purpose entries -> external_video_refs;
    // every other entry -> media_assets + media_blobs (hash/type/size/state).
    let manifestEntries: ManifestEntry[] = []
    try {
      manifestEntries = JSON.parse(version.media_manifest_json) as ManifestEntry[]
    } catch {
      manifestEntries = []
    }
    const mediaManifest: PanelMediaEntry[] = []
    const externalVideos: PanelExternalVideo[] = []
    for (const entry of manifestEntries) {
      const purpose = entry.purpose ?? ''
      const asset = entry.id
        ? (this.db
            .prepare(
              `SELECT kind, status, display_name AS displayName
               FROM media_assets WHERE id = ?`
            )
            .get(entry.id) as
            | { kind: string; status: string; displayName: string }
            | undefined)
        : undefined

      // A video-purpose ref can identify either a hosted MediaAsset or an
      // ExternalVideoRef. Existing assets win so hosted video remains visible
      // in the material manifest; otherwise resolve the allowlisted external ref.
      if (!asset && purpose === 'video' && entry.id) {
        const ref = this.db
          .prepare(
            `SELECT id, provider, provider_video_id AS providerVideoId,
                    canonical_url AS canonicalUrl, health, checked_at AS checkedAt
             FROM external_video_refs WHERE id = ?`
          )
          .get(entry.id) as PanelExternalVideo | undefined
        if (ref) externalVideos.push(ref)
        continue
      }

      const blob = entry.blobHash
        ? (this.db
            .prepare(
              `SELECT media_type AS mediaType, byte_size AS byteSize, scan_status AS scanStatus
               FROM media_blobs WHERE hash = ?`
            )
            .get(entry.blobHash) as
            | { mediaType: string; byteSize: number; scanStatus: string }
            | undefined)
        : undefined
      mediaManifest.push({
        assetId: entry.id ?? null,
        blobHash: entry.blobHash ?? '',
        purpose,
        kind: asset?.kind ?? null,
        assetStatus: asset?.status ?? null,
        displayName: asset?.displayName ?? null,
        mediaType: blob?.mediaType ?? null,
        byteSize: blob?.byteSize ?? null,
        scanStatus: blob?.scanStatus ?? null
      })
    }

    // Reports against this demonstration (evidence-panel 举报历史).
    const reports = this.db
      .prepare(
        `SELECT id, category, reason, status, created_at AS createdAt, reporter_id AS reporterId
         FROM publication_reports WHERE demonstration_id = ?
         ORDER BY created_at ASC`
      )
      .all(version.demonstration_id) as PanelReportSummary[]

    // Full review history for the work (all versions, status + note + time).
    const reviewHistory = this.db
      .prepare(
        `SELECT id, status, frozen_at AS frozenAt, reviewer_note AS reviewerNote
         FROM demonstration_versions WHERE demonstration_id = ?
         ORDER BY frozen_at ASC`
      )
      .all(version.demonstration_id) as PanelVersionSummary[]

    return {
      version: {
        id: version.id,
        demonstrationId: version.demonstration_id,
        status: version.status,
        frozenAt: version.frozen_at,
        classification: version.classification,
        license: version.license,
        aiDisclosure: version.ai_disclosure,
        reviewerNote: version.reviewer_note
      },
      authorId,
      snapshot: parsed.success ? parsed.document : null,
      snapshotValid: parsed.success,
      mediaManifest,
      externalVideos,
      sourceChain,
      reports,
      reviewHistory
    }
  }
}
