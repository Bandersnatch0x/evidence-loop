/**
 * Media gate — magic-byte sniffing + kind allowlist + per-kind size caps
 * (spec §9 table) + triangle verification (research §4.1/§5).
 *
 * Triangle: declaredKind/declaredBytes (client) vs actualBytes/actualHash
 * (server recompute) vs sniffedKind (magic bytes). A payload only proceeds to
 * quarantine when all three agree. Reference implementations stay tiny and
 * dependency-free: image magic is a handful of byte prefixes, video is the
 * ftyp-box / EBML marker, VTT is a textual header.
 */

export type MediaKind = 'image' | 'glb' | 'video' | 'vtt' | 'audio'

export const ALLOWED_KINDS: readonly MediaKind[] = [
  'image',
  'glb',
  'video',
  'vtt',
  'audio'
]

export interface KindLimit {
  maxBytes: number
  /** Hard cap on the very first sniff — keep under maxBytes. */
}

const KIND_LIMITS: Record<MediaKind, KindLimit> = {
  image: { maxBytes: 25 * 1024 * 1024 }, // spec §9: 图 25MiB / 40MP
  glb: { maxBytes: 200 * 1024 * 1024 }, // GLB 200MiB
  video: { maxBytes: 2 * 1024 ** 3 }, // 视频 2GiB / 120min
  vtt: { maxBytes: 2 * 1024 * 1024 }, // WebVTT 2MiB
  audio: { maxBytes: 250 * 1024 * 1024 } // 音频 250MiB / 120min
}

function isMediaKind(kind: string | null): kind is MediaKind {
  return kind !== null && ALLOWED_KINDS.includes(kind as MediaKind)
}

export function kindLimits(kind: string | null): KindLimit | null {
  if (isMediaKind(kind)) return KIND_LIMITS[kind]
  return null
}

/** Pure size-cap check; returns a human-readable reason or null when fine. */
export function validateMedia(kind: MediaKind, byteSize: number): string | null {
  const limit = KIND_LIMITS[kind]
  if (limit && byteSize > limit.maxBytes) {
    return `Payload of ${byteSize} bytes exceeds the ${kind} limit of ${limit.maxBytes}`
  }
  return null
}

/**
 * Sniff a media kind from magic bytes. Returns null when the payload is not a
 * recognized container. Only the header is read; full validation happens in
 * the worker (real parse, subprocess-isolated per research §5).
 */
export function detectKind(bytes: Uint8Array | Buffer): MediaKind | null {
  const b = bytes instanceof Buffer ? bytes : Buffer.from(bytes)
  const head = (offset: number, len: number) =>
    Buffer.from(b.subarray(offset, offset + len))

  // PNG: 89 50 4E 47 0D 0A 1A 0A
  if (
    b.length >= 8 &&
    b[0] === 0x89 &&
    b[1] === 0x50 &&
    b[2] === 0x4e &&
    b[3] === 0x47 &&
    b[4] === 0x0d &&
    b[5] === 0x0a &&
    b[6] === 0x1a &&
    b[7] === 0x0a
  ) {
    return 'image'
  }

  // JPEG: FF D8 FF
  if (b.length >= 3 && b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff) return 'image'

  // GIF: GIF87a / GIF89a
  const gif = head(0, 6).toString('latin1')
  if (gif === 'GIF87a' || gif === 'GIF89a') return 'image'

  // WebP: RIFF....WEBP
  if (
    b.length >= 12 &&
    head(0, 4).toString('latin1') === 'RIFF' &&
    head(8, 4).toString('latin1') === 'WEBP'
  ) {
    return 'image'
  }

  // glTF binary: 'glTF' + version (2.0)
  if (b.length >= 8 && head(0, 4).toString('latin1') === 'glTF') {
    const version = b[4]
    if (version === 2) return 'glb'
  }

  // MP4 / ISO BMFF: box size + 'ftyp' at offset 4
  if (
    b.length >= 12 &&
    head(4, 4).toString('latin1') === 'ftyp' &&
    b[0] === 0 &&
    b[1] === 0
  ) {
    return 'video'
  }

  // WebM / Matroska: EBML 1A 45 DF A3
  if (b.length >= 4 && b[0] === 0x1a && b[1] === 0x45 && b[2] === 0xdf && b[3] === 0xa3) {
    return 'video'
  }

  // WebVTT: UTF-8 'WEBVTT' at start (optionally with BOM)
  const text = b.length >= 6 ? b.subarray(0, 6).toString('utf8') : ''
  if (text === 'WEBVTT') return 'vtt'
  if (text.charCodeAt(0) === 0xfeff && b.subarray(1, 7).toString('utf8') === 'WEBVTT') {
    return 'vtt'
  }

  return null
}

/**
 * Canonical extension for the sniffed payload (mirrors detectKind's magic
 * branches but returns the exact extension used for CAS storage).
 */
export function detectExtension(bytes: Uint8Array | Buffer): string | null {
  const b = bytes instanceof Buffer ? bytes : Buffer.from(bytes)
  const head = (offset: number, len: number) =>
    Buffer.from(b.subarray(offset, offset + len))

  if (b.length >= 3 && b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff) return '.jpg'
  if (b.length >= 6 && (head(0, 6).toString('latin1') === 'GIF87a' || head(0, 6).toString('latin1') === 'GIF89a')) return '.gif'
  if (b.length >= 12 && head(0, 4).toString('latin1') === 'RIFF' && head(8, 4).toString('latin1') === 'WEBP') return '.webp'
  if (b.length >= 8 && b[0] === 0x89 && b[1] === 0x50 && b[2] === 0x4e && b[3] === 0x47) return '.png'
  if (b.length >= 8 && head(0, 4).toString('latin1') === 'glTF' && b[4] === 2) return '.glb'
  if (b.length >= 4 && b[0] === 0x1a && b[1] === 0x45 && b[2] === 0xdf && b[3] === 0xa3) return '.webm'
  if (b.length >= 12 && head(4, 4).toString('latin1') === 'ftyp') return '.mp4'
  const text = b.length >= 6 ? b.subarray(0, 6).toString('utf8') : ''
  if (text === 'WEBVTT' || (b.length >= 7 && b.subarray(1, 7).toString('utf8') === 'WEBVTT')) return '.vtt'
  return null
}

export interface TriangleInput {
  declaredKind: string
  declaredBytes: number
  actualBytes: number
  sniffedKind: MediaKind | null
}

export interface TriangleResult {
  ok: boolean
  reason?: string
}

/**
 * Triangle comparison of the three independent facts about a payload:
 * client-declared kind/size, server-recomputed actual size, magic-byte sniff.
 * Any disagreement fails closed (quarantine keeps the blob, worker emits
 * rejected and never commits).
 */
export function verifyTriangle(input: TriangleInput): TriangleResult {
  const { declaredKind, declaredBytes, actualBytes, sniffedKind } = input

  if (!sniffedKind) {
    return { ok: false, reason: 'unrecognized file signature' }
  }
  if (sniffedKind !== declaredKind) {
    return {
      ok: false,
      reason: `kind mismatch: declared ${declaredKind}, sniffed ${sniffedKind}`
    }
  }
  if (!(declaredKind in KIND_LIMITS)) {
    return { ok: false, reason: `kind not in allowlist: ${declaredKind}` }
  }
  if (actualBytes > declaredBytes) {
    return {
      ok: false,
      reason: `payload ${actualBytes} bytes is larger than declared ${declaredBytes}`
    }
  }
  const sizeError = validateMedia(declaredKind, actualBytes)
  if (sizeError) return { ok: false, reason: sizeError }
  return { ok: true }
}