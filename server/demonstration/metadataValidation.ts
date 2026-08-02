/**
 * Library metadata validation (decision 11, ticket T-E) — required fields an
 * author MUST fill before a version can be submitted to the library. The
 * reviewer additionally verifies/corrects these at approval (fields freeze
 * with the version snapshot; T-F wires the correction panel).
 *
 * Required: title, description, subject, grade, format, space, behavior.
 * Optional: kpIds (knowledge point links), coverBlobHash.
 */

export const REQUIRED_META_FIELDS = [
  'title',
  'description',
  'subject',
  'grade',
  'format',
  'space',
  'behavior'
] as const

export class MetadataValidationError extends Error {
  public constructor(message: string) {
    super(message)
    this.name = 'MetadataValidationError'
  }
}

/** Allowed values for the multi-dimension classification (map #2 + decision 11). */
export const FORMATS = ['scene', 'video'] as const
export const SPACES = ['2d', '3d'] as const
export const BEHAVIORS = ['static', 'animation', 'interactive'] as const

export interface LibraryMeta {
  title?: unknown
  description?: unknown
  subject?: unknown
  grade?: unknown
  format?: unknown
  space?: unknown
  behavior?: unknown
  kpIds?: unknown
  coverBlobHash?: unknown
}

/**
 * Validate the demo root's meta_json against library requirements. Returns a
 * list of missing/invalid fields; empty = valid. Caller (submit) fails the
 * publish when any issue exists.
 */
export function validateLibraryMeta(meta: LibraryMeta): string[] {
  const issues: string[] = []
  for (const field of REQUIRED_META_FIELDS) {
    const v = meta[field]
    if (typeof v !== 'string' || v.trim() === '') {
      issues.push(`missing or empty required field: ${field}`)
    }
  }
  if (meta.kpIds !== undefined && !Array.isArray(meta.kpIds)) {
    issues.push('kpIds must be an array')
  }
  if (meta.coverBlobHash !== undefined && typeof meta.coverBlobHash !== 'string') {
    issues.push('coverBlobHash must be a string')
  }
  const format = meta.format
  if (typeof format === 'string' && !(FORMATS as readonly string[]).includes(format)) {
    issues.push(`format must be one of ${FORMATS.join('/')}`)
  }
  const space = meta.space
  if (typeof space === 'string' && !(SPACES as readonly string[]).includes(space)) {
    issues.push(`space must be one of ${SPACES.join('/')}`)
  }
  const behavior = meta.behavior
  if (typeof behavior === 'string' && !(BEHAVIORS as readonly string[]).includes(behavior)) {
    issues.push(`behavior must be one of ${BEHAVIORS.join('/')}`)
  }
  return issues
}