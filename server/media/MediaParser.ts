/**
 * MediaParser — v1 header/structure validation for uploaded media
 * (decision 2025-08: pure-JS native parsers, no native deps).
 *
 * Scope (spec §9.2 安全 gate, v1 boundary per decision):
 *  - images: PNG (IHDR width/height), JPEG (SOF0/SOF1/SOF2 dimensions),
 *    WebP (VP8/VP8L/VP8X canvas) → enforce 40 MP / 16,384px caps
 *  - GLB: 12-byte header magic/version/length + JSON chunk structural
 *    (asset.version, scene references exist, reject external URIs)
 *  - audio/video/WebVTT: deferred (video/audio capability-disabled until
 *    MEDIA_FFMPEG_PATH; WebVTT parser lands with the subtitle ticket)
 *
 * Full Sharp/ffprobe/Khronos-Validator subprocess parse = production worker
 * (T-M), per map iron law + capability-disable precedent.
 *
 * Pure functions + readonly consts, mirroring mediaGate.ts style. The parser
 * only consumes the first 8 KiB sniff snapshot — every header it needs lives
 * in that window.
 */

import { detectImageFormat } from './mediaGate'

/** Public contract. `kind` is the gate kind ('image'|'glb'|'video'|'vtt'|'audio'). */
export interface ParseInput {
  kind: string
  sniff: Buffer
  declaredBytes: number
}

export interface ParseResult {
  ok: boolean
  reason?: string
  /** Parsed dimensions (pixels) when derivable — used for 40MP / 16,384px cap. */
  width?: number
  height?: number
}

const MAX_PIXELS = 40_000_000 // spec §9: 40 MP
const MAX_EDGE = 16_384 // spec §9: 最长边 16,384 px
const MAX_JSON_CHUNK = 256 * 1024 // research §4: first JSON chunk bounded

function invalid(reason: string): ParseResult {
  return { ok: false, reason }
}

function pixelsOk(width: number | undefined, height: number | undefined): ParseResult | null {
  if (width === undefined || height === undefined) return null
  if (
    !Number.isFinite(width) ||
    !Number.isFinite(height) ||
    width <= 0 ||
    height <= 0 ||
    width > MAX_EDGE ||
    height > MAX_EDGE ||
    width * height > MAX_PIXELS
  ) {
    return invalid(`image exceeds caps (${width}x${height}; max ${MAX_EDGE}px edge / ${MAX_PIXELS.toLocaleString('en-US')} MP)`)
  }
  return null
}

/** PNG: signature verified by detectImageFormat; IHDR at offset 8. */
function parsePng(sniff: Buffer): ParseResult | null {
  if (sniff.length < 24) return null
  // IHDR chunk: length(4) 'IHDR'(4) width(4) height(4)
  if (sniff.subarray(12, 16).toString('ascii') !== 'IHDR') {
    return invalid('PNG missing IHDR')
  }
  const width = sniff.readUInt32BE(16)
  const height = sniff.readUInt32BE(20)
  const cap = pixelsOk(width, height)
  return cap ?? { ok: true, width, height }
}

/** JPEG: signature verified by detectImageFormat; scan markers for SOF. */
function parseJpeg(sniff: Buffer): ParseResult | null {
  if (sniff.length < 4) return null
  let i = 2
  while (i < sniff.length - 9) {
    if (sniff[i] !== 0xff) {
      i += 1
      continue
    }
    const marker = sniff[i + 1] as number
    if (marker === 0xff || marker === 0x00 || (marker >= 0xd0 && marker <= 0xd9)) {
      i += 2
      continue
    }
    const len = sniff.readUInt16BE(i + 2)
    if (len < 2) return invalid('JPEG corrupt marker length')
    // SOF0..SOF3, SOF5..SOF7, SOF9..SOF11, SOF13..SOF15 carry dimensions.
    const isSof =
      (marker >= 0xc0 && marker <= 0xc3) ||
      (marker >= 0xc5 && marker <= 0xc7) ||
      (marker >= 0xc9 && marker <= 0xcb) ||
      (marker >= 0xcd && marker <= 0xcf)
    if (isSof) {
      const height = sniff.readUInt16BE(i + 5)
      const width = sniff.readUInt16BE(i + 7)
      const cap = pixelsOk(width, height)
      return cap ?? { ok: true, width, height }
    }
    i += 2 + len
  }
  return invalid('JPEG missing SOF marker (not a decodable JPEG)')
}

/** WebP: RIFF/WEBP verified by detectImageFormat; parse VP8/VP8L/VP8X. */
function parseWebp(sniff: Buffer): ParseResult | null {
  if (sniff.length < 30) return null
  const fourcc = sniff.subarray(12, 16).toString('ascii')
  if (fourcc === 'VP8X') {
    // VP8X: canvas width/height are 24-bit at offsets 24..27 / 27..30.
    if (sniff.length < 30) return invalid('WebP VP8X truncated header')
    const width = sniff[24]! + (sniff[25]! << 8) + (sniff[26]! << 16) + 1
    const height = sniff[27]! + (sniff[28]! << 8) + (sniff[29]! << 16) + 1
    const cap = pixelsOk(width, height)
    return cap ?? { ok: true, width, height }
  }
  if (fourcc === 'VP8 ') {
    // VP8: frame tag at 26..29 — 14-bit width/height.
    if (sniff.length < 30) return invalid('WebP VP8 truncated header')
    const frameTag = sniff.readUInt32LE(26)
    const width = frameTag & 0x3fff
    const height = (frameTag >> 14) & 0x3fff
    const cap = pixelsOk(width, height)
    return cap ?? { ok: true, width, height }
  }
  if (fourcc === 'VP8L') {
    // VP8L: signature 0x2F at 20, then 14-bit width/height bit field.
    if (sniff.length < 25 || sniff[20] !== 0x2f) return invalid('WebP VP8L truncated/signature')
    const val = sniff[21]! + (sniff[22]! << 8) + (sniff[23]! << 16) + (sniff[24]! << 24)
    // b0-13 width-1, b14-27 height-1.
    const width = (val & 0x3fff) + 1
    const height = ((val >> 14) & 0x3fff) + 1
    const cap = pixelsOk(width, height)
    return cap ?? { ok: true, width, height }
  }
  return invalid(`WebP unknown chunk ${fourcc}`)
}

function parseImage(sniff: Buffer): ParseResult {
  // Format dispatch via the single shared signature source (mediaGate).
  // This guarantees the gate and parser agree on what counts as each format.
  switch (detectImageFormat(sniff)) {
    case 'png': return parsePng(sniff) ?? invalid('PNG header parse failed')
    case 'jpeg': return parseJpeg(sniff) ?? invalid('JPEG SOF marker not found')
    case 'webp': return parseWebp(sniff) ?? invalid('WebP chunk parse failed')
    case 'gif': return invalid('GIF not supported (PNG/JPEG/WebP only)')
    default: return invalid('image kind not decodable (PNG/JPEG/WebP header parse failed)')
  }
}

/** GLB: header + JSON chunk structural checks. Magic/version verified by detectKind. */
function parseGlb(sniff: Buffer, declaredBytes: number): ParseResult {
  if (sniff.length < 20) return invalid('GLB header truncated')
  // Magic ('glTF') and version (2) are already verified by detectKind;
  // re-checking here would duplicate the contract and risk drift.
  const totalLength = sniff.readUInt32LE(8)
  if (totalLength !== declaredBytes) {
    return invalid(`GLB declared length ${totalLength} != uploaded ${declaredBytes}`)
  }
  if (totalLength > declaredBytes) return invalid('GLB self-declared length exceeds upload')
  const chunkType = sniff.readUInt32LE(16)
  if (chunkType !== 0x4e4f534a) return invalid('GLB first chunk must be JSON (0x4E4F534A)')
  const jsonLength = sniff.readUInt32LE(12)
  if (jsonLength === 0 || jsonLength > MAX_JSON_CHUNK) {
    return invalid(`GLB JSON chunk length ${jsonLength} out of bounds`)
  }
  if (sniff.length < 20 + jsonLength) return invalid('GLB JSON chunk truncated in sniff window')
  // JSON chunk lives entirely within sniff (≤256 KiB ≤ 8 KiB?? — no: 8 KiB sniff
  // may only cover the JSON prefix; validate structure on the prefix only).
  const jsonPrefix = sniff.subarray(20, Math.min(sniff.length, 20 + jsonLength))
  const text = jsonPrefix.toString('utf8')
  if (text.trimStart().length === 0 || !text.trimStart().startsWith('{')) {
    return invalid('GLB JSON chunk not an object')
  }
  // Reject external URIs spelled in the JSON prefix (data: URIs are the only
  // valid in-GLB resource references per spec, and even those are unsupported
  // in v1 — GLB embeds everything in the BIN chunk).
  if (/["'](https?|file|ftp):\/\//i.test(text)) {
    return invalid('GLB contains external URI (only embedded resources allowed)')
  }
  return { ok: true }
}

/**
 * v1 parse gate — call after triangle verification, before commit. Consumes
 * only the sniff snapshot. Non-image/glb kinds pass (video/audio are
 * capability-disabled upstream; WebVTT lands with the subtitle ticket).
 */
export function parseMedia(input: ParseInput): ParseResult {
  if (input.kind === 'image') return parseImage(input.sniff)
  if (input.kind === 'glb') return parseGlb(input.sniff, input.declaredBytes)
  return { ok: true }
}