import { createHash } from 'node:crypto'
import { extname, join, normalize, sep } from 'node:path'

/** Root directory for content-addressed media (relative to project data/). */
export const MEDIA_DIR_NAME = 'media' as const

/**
 * Resolve the content-addressed relative path for a media blob.
 * Layout: `data/media/<sha256>.<ext>` — DB stores this relative path only;
 * never BLOB columns. Cloud migration swaps the storage prefix, not the path.
 */
export function mediaRelativePath(contentHash: string, extension: string): string {
  const hash = normalizeHash(contentHash)
  const ext = normalizeExtension(extension)
  return join(MEDIA_DIR_NAME, `${hash}${ext}`).replace(/\\/g, '/')
}

/**
 * Absolute filesystem path under a data root (e.g. project `data/`).
 */
export function mediaAbsolutePath(
  dataRoot: string,
  contentHash: string,
  extension: string
): string {
  return join(dataRoot, mediaRelativePath(contentHash, extension))
}

/**
 * SHA-256 hex digest of raw bytes (content addressing).
 */
export function hashMediaBytes(bytes: Uint8Array | Buffer): string {
  return createHash('sha256').update(bytes).digest('hex')
}

/**
 * Derive extension from an original filename (fallback `.bin`).
 */
export function extensionFromFilename(filename: string): string {
  const ext = extname(filename)
  return ext.length > 0 ? ext : '.bin'
}

/**
 * Reject path traversal: resolved path must stay under dataRoot/media.
 */
export function assertMediaPathSafe(dataRoot: string, relativePath: string): string {
  const normalized = normalize(relativePath).replace(/\\/g, '/')
  if (
    normalized.includes('..') ||
    normalized.startsWith('/') ||
    !normalized.startsWith(`${MEDIA_DIR_NAME}/`)
  ) {
    throw new Error(`Unsafe media path: ${relativePath}`)
  }
  const absolute = normalize(join(dataRoot, normalized))
  const mediaRoot = normalize(join(dataRoot, MEDIA_DIR_NAME))
  if (absolute !== mediaRoot && !absolute.startsWith(mediaRoot + sep)) {
    throw new Error(`Media path escapes media root: ${relativePath}`)
  }
  return absolute
}

function normalizeHash(hash: string): string {
  const trimmed = hash.trim().toLowerCase()
  if (!/^[a-f0-9]{64}$/.test(trimmed)) {
    throw new Error('Media content hash must be a 64-char lowercase hex SHA-256')
  }
  return trimmed
}

function normalizeExtension(extension: string): string {
  const raw = extension.trim().toLowerCase()
  if (raw.length === 0) return '.bin'
  const withDot = raw.startsWith('.') ? raw : `.${raw}`
  if (!/^\.[a-z0-9]{1,8}$/.test(withDot)) {
    throw new Error(`Unsupported media extension: ${extension}`)
  }
  return withDot
}
