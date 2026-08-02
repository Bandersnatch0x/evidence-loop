// @vitest-environment node

import { describe, expect, it } from 'vitest'
import {
  ALLOWED_KINDS,
  detectKind,
  kindLimits,
  validateMedia,
  verifyTriangle
} from '../server/media/mediaGate'

/**
 * T-B slice 3 — media gate: magic-byte sniffing, kind allowlist, per-kind size
 * caps (spec §9 table: 图 25MiB / GLB 200MiB / 视频 2GiB / WebVTT 2MiB),
 * triangle comparison (declared vs recomputed vs DB, research §4.1/§5).
 */

describe('detectKind (magic bytes)', () => {
  it('detects PNG, JPEG, WebP, GIF from headers', () => {
    // PNG: 89 50 4E 47 0D 0A 1A 0A
    expect(detectKind(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))).toBe('image')
    // JPEG: FF D8 FF
    expect(detectKind(Buffer.from([0xff, 0xd8, 0xff, 0xe0]))).toBe('image')
    // WebP: RIFF....WEBP
    const riff = Buffer.concat([Buffer.from('RIFF'), Buffer.from([0, 0, 0, 0]), Buffer.from('WEBP')])
    expect(detectKind(riff)).toBe('image')
    // GIF: GIF87a / GIF89a
    expect(detectKind(Buffer.from('GIF89a'))).toBe('image')
  })

  it('detects glTF binary (glb)', () => {
    // glTF header: 'glTF' + version
    expect(detectKind(Buffer.concat([Buffer.from('glTF'), Buffer.from([2, 0, 0, 0])]))).toBe('glb')
  })

  it('detects video from container signatures and WebVTT text', () => {
    // MP4: ftyp box (size[4] + 'ftyp'[4] + major_brand[4])
    expect(
      detectKind(Buffer.from([0, 0, 0, 0x18, 0x66, 0x74, 0x79, 0x70, 0x69, 0x73, 0x6f, 0x6d]))
    ).toBe('video')
    // WebM: 1A 45 DF A3 (EBML), then 'webm' in doc type
    expect(detectKind(Buffer.from([0x1a, 0x45, 0xdf, 0xa3]))).toBe('video')
    // WebVTT: WEBVTT header
    expect(detectKind(Buffer.from('WEBVTT\n\n1\n00:00:00.000 --> 00:00:02.000\nHi'))).toBe('vtt')
  })

  it('returns null for unrecognized bytes', () => {
    expect(detectKind(Buffer.from('plain text not webvtt'))).toBeNull()
    expect(detectKind(Buffer.alloc(8))).toBeNull()
    expect(detectKind(Buffer.from([0x4d, 0x5a]))).toBeNull() // MZ/PE
  })
})

describe('kind allowlist + size caps', () => {
  it('allows exactly the spec kinds', () => {
    expect(ALLOWED_KINDS).toEqual(
      expect.arrayContaining(['image', 'glb', 'video', 'vtt', 'audio'])
    )
    expect(ALLOWED_KINDS.length).toBe(5)
  })

  it('enforces per-kind byte caps from spec §9', () => {
    const imageCap = kindLimits('image')?.maxBytes
    expect(imageCap).toBe(25 * 1024 * 1024)
    expect(kindLimits('glb')?.maxBytes).toBe(200 * 1024 * 1024)
    expect(kindLimits('video')?.maxBytes).toBe(2 * 1024 ** 3)
    expect(kindLimits('vtt')?.maxBytes).toBe(2 * 1024 * 1024)
  })

  it('rejects over-limit payloads', () => {
    const err = validateMedia('image', 25 * 1024 * 1024 + 1)
    expect(err).toMatch(/limit/)
    expect(validateMedia('image', 25 * 1024 * 1024)).toBeNull()
  })
})

describe('verifyTriangle', () => {
  it('accepts when declared kind == sniffed kind and size within cap', () => {
    const png = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])
    const result = verifyTriangle({
      declaredKind: 'image',
      declaredBytes: png.length,
      actualBytes: png.length,
      sniffedKind: detectKind(png)
    })
    expect(result?.ok).toBe(true)
  })

  it('rejects when sniffed kind disagrees with declared kind', () => {
    const png = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])
    const result = verifyTriangle({
      declaredKind: 'glb',
      declaredBytes: png.length,
      actualBytes: png.length,
      sniffedKind: detectKind(png)
    })
    expect(result?.ok).toBe(false)
    expect(result?.reason).toMatch(/kind mismatch/)
  })

  it('rejects when actual bytes exceed declared (size lie)', () => {
    const png = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])
    const result = verifyTriangle({
      declaredKind: 'image',
      declaredBytes: png.length - 1,
      actualBytes: png.length,
      sniffedKind: detectKind(png)
    })
    expect(result?.ok).toBe(false)
    expect(result?.reason).toMatch(/larger than declared/)
  })

  it('rejects an unknown sniffed kind', () => {
    const payload = Buffer.from('total garbage string')
    const result = verifyTriangle({
      declaredKind: 'vtt',
      declaredBytes: payload.length,
      actualBytes: payload.length,
      sniffedKind: detectKind(payload)
    })
    expect(result?.ok).toBe(false)
  })
})