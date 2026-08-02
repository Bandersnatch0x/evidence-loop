/**
 * Forward migrations for SceneDocument (spec §4.6).
 *
 * Version snapshots are IMMUTABLE (ticket 02). Reading an old version runs a
 * pure, in-memory migration to the current format; it NEVER writes back to the
 * snapshot. Migration failure → static alternative + explicit message (caller
 * surfaces it; render level degrades).
 *
 * Policy: support N-2 — a document older than MIN_SUPPORTED_VERSION is refused
 * (downgrade to static with a message).
 */
import type { SceneDocument } from './sceneDocumentSchema'
import {
  compareVersions,
  isVersionSupported,
  MIN_SUPPORTED_VERSION,
  SCENE_FORMAT_VERSION,
  sceneDocumentSchema
} from './sceneDocumentSchema'

export type MigrationResult =
  | { ok: true; document: SceneDocument; migratedFrom: string }
  | { ok: false; error: string }

/**
 * Migrate a doc to the current format in-memory. Pure — no I/O, no mutation of
 * the input snapshot (returns a deep-cloned doc when migration is a no-op).
 */
export function migrateToLatest(raw: unknown): MigrationResult {
  let version: string | undefined
  try {
    version = (raw as { documentMeta: { sceneFormatVersion?: string } }).documentMeta
      ?.sceneFormatVersion
  } catch {
    version = undefined
  }
  if (version === undefined) {
    return { ok: false, error: 'document has no sceneFormatVersion' }
  }
  if (!isVersionSupported(version)) {
    return {
      ok: false,
      error: `sceneFormatVersion ${version} is older than N-2 floor ${MIN_SUPPORTED_VERSION}; refusing (downgrade to static)`
    }
  }
  if (compareVersions(version, SCENE_FORMAT_VERSION) > 0) {
    return {
      ok: false,
      error: `sceneFormatVersion ${version} is newer than the player (${SCENE_FORMAT_VERSION}); refusing`
    }
  }
  if (compareVersions(version, SCENE_FORMAT_VERSION) === 0) {
    // Already current — validate through the zod trust gate (never trust the
    // caller's raw shape) and deep-clone so callers can mutate safely.
    const parsed = sceneDocumentSchema.safeParse(raw)
    if (!parsed.success) {
      return {
        ok: false,
        error: `document failed validation: ${parsed.error.issues.map((i) => i.message).join('; ')}`
      }
    }
    return { ok: true, document: structuredClone(parsed.data), migratedFrom: version }
  }
  // Future migrations chain here: version < current runs one or more per-version
  // transforms. v1.0 is the initial format, so this is currently unreachable.
  return {
    ok: false,
    error: `no migration path from ${version} to ${SCENE_FORMAT_VERSION}`
  }
}