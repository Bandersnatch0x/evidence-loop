import { describe, expect, it } from 'vitest'
import { parseMedia } from '../server/media/MediaParser'


/** Minimal valid PNG header (bit depth 8, color type 6). */
function pngHeader(width: number, height: number): Buffer {
  const b = Buffer.alloc(26)
  Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]).copy(b, 0)
  b.writeUInt32BE(13, 8) // IHDR length
  b.write('IHDR', 12, 'ascii')
  b.writeUInt32BE(width, 16)
  b.writeUInt32BE(height, 20)
  b[24] = 8 // bit depth
  b[25] = 6 // color type
  return b
}

/** Minimal JPEG: SOI + SOF0 marker with dimensions. */
function jpegHeader(width: number, height: number): Buffer {
  const b = Buffer.alloc(20)
  b[0] = 0xff
  b[1] = 0xd8 // SOI
  b[2] = 0xff
  b[3] = 0xc0 // SOF0
  b.writeUInt16BE(11, 4) // length
  b[6] = 8 // precision
  b.writeUInt16BE(height, 7)
  b.writeUInt16BE(width, 9)
  return b
}

/** Minimal WebP RIFF header with VP8X canvas. */
function webpHeader(width: number, height: number): Buffer {
  const b = Buffer.alloc(30)
  b.write('RIFF', 0, 'ascii')
  b.writeUInt32LE(20, 4)
  b.write('WEBP', 8, 'ascii')
  b.write('VP8X', 12, 'ascii')
  b.writeUInt32LE(10, 16)
  b[20] = 0x0c // flags
  const w = width - 1
  const h = height - 1
  b[24] = w & 0xff
  b[25] = (w >> 8) & 0xff
  b[26] = (w >> 16) & 0xff
  b[27] = h & 0xff
  b[28] = (h >> 8) & 0xff
  b[29] = (h >> 16) & 0xff
  return b
}

/** Minimal GLB: header + JSON chunk with asset + scene (no BIN). */
function glbHeader(totalLength: number, json: string): Buffer {
  const jsonBuf = Buffer.from(json, 'utf8')
  const b = Buffer.alloc(20)
  b.writeUInt32LE(0x46546c67, 0) // glTF magic
  b.writeUInt32LE(2, 4) // version
  b.writeUInt32LE(totalLength, 8) // total length
  b.writeUInt32LE(jsonBuf.length, 12)
  b.writeUInt32LE(0x4e4f534a, 16) // 'JSON'
  return Buffer.concat([b, jsonBuf])
}

describe('MediaParser v1 header/structure parse', () => {
  it('accepts valid PNG with dimensions in limits', () => {
    const sniff = Buffer.alloc(8 * 1024)
    pngHeader(1920, 1080).copy(sniff)
    const r = parseMedia({ kind: 'image', sniff, declaredBytes: 10_000 })
    expect(r.ok).toBe(true)
    expect(r.width).toBe(1920)
    expect(r.height).toBe(1080)
  })

  it('rejects PNG exceeding 40 MP', () => {
    const sniff = Buffer.alloc(8 * 1024)
    pngHeader(8000, 6000).copy(sniff) // 48 MP
    const r = parseMedia({ kind: 'image', sniff, declaredBytes: 10_000 })
    expect(r.ok).toBe(false)
    expect(r.reason).toContain('caps')
  })

  it('rejects PNG exceeding 16,384px edge', () => {
    const sniff = Buffer.alloc(8 * 1024)
    pngHeader(20_000, 100).copy(sniff)
    const r = parseMedia({ kind: 'image', sniff, declaredBytes: 10_000 })
    expect(r.ok).toBe(false)
  })

  it('rejects PNG missing IHDR', () => {
    const sniff = Buffer.alloc(8 * 1024)
    const b = Buffer.alloc(16)
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]).copy(b, 0)
    b.writeUInt32BE(13, 8)
    b.write('XXXX', 12, 'ascii')
    b.copy(sniff)
    const r = parseMedia({ kind: 'image', sniff, declaredBytes: 10_000 })
    expect(r.ok).toBe(false)
    expect(r.reason).toContain('IHDR')
  })

  it('accepts valid JPEG within limits', () => {
    const sniff = Buffer.alloc(8 * 1024)
    jpegHeader(1024, 768).copy(sniff)
    const r = parseMedia({ kind: 'image', sniff, declaredBytes: 10_000 })
    expect(r.ok).toBe(true)
    expect(r.width).toBe(1024)
    expect(r.height).toBe(768)
  })

  it('rejects JPEG beyond 40 MP', () => {
    const sniff = Buffer.alloc(8 * 1024)
    jpegHeader(9000, 5000).copy(sniff) // 45 MP
    const r = parseMedia({ kind: 'image', sniff, declaredBytes: 10_000 })
    expect(r.ok).toBe(false)
    expect(r.reason).toContain('caps')
  })

  it('rejects JPEG with no SOF (polyglot exe disguised as jpg)', () => {
    const sniff = Buffer.alloc(8 * 1024)
    sniff[0] = 0xff
    sniff[1] = 0xd8
    // garbage after SOI, no SOF marker
    const r = parseMedia({ kind: 'image', sniff, declaredBytes: 10_000 })
    expect(r.ok).toBe(false)
    expect(r.reason).toContain('SOF')
  })

  it('accepts valid WebP VP8X within limits', () => {
    const sniff = Buffer.alloc(8 * 1024)
    webpHeader(400, 300).copy(sniff)
    const r = parseMedia({ kind: 'image', sniff, declaredBytes: 10_000 })
    expect(r.ok).toBe(true)
  })

  it('rejects WebP beyond 40 MP', () => {
    const sniff = Buffer.alloc(8 * 1024)
    webpHeader(9000, 8000).copy(sniff) // 72 MP
    const r = parseMedia({ kind: 'image', sniff, declaredBytes: 10_000 })
    expect(r.ok).toBe(false)
  })

  it('rejects image kind with unrecognizable bytes', () => {
    const r = parseMedia({ kind: 'image', sniff: Buffer.from('not an image at all'), declaredBytes: 10_000 })
    expect(r.ok).toBe(false)
    expect(r.reason).toContain('PNG/JPEG/WebP')
  })

  it('accepts valid GLB with embedded scene', () => {
    const json = JSON.stringify({ asset: { version: '2.0' }, scene: 0, scenes: [{ nodes: [] }] })
    const glb = glbHeader(20 + json.length, json)
    const sniff = Buffer.alloc(8 * 1024)
    glb.copy(sniff)
    const r = parseMedia({ kind: 'glb', sniff, declaredBytes: glb.length })
    expect(r.ok).toBe(true)
  })

  it('rejects GLB bad magic', () => {
    const json = JSON.stringify({ asset: { version: '2.0' } })
    const glb = glbHeader(20 + json.length, json)
    glb.writeUInt32LE(0xdeadbeef, 0)
    const r = parseMedia({ kind: 'glb', sniff: glb, declaredBytes: glb.length })
    expect(r.ok).toBe(false)
    expect(r.reason).toContain('magic')
  })

  it('rejects GLB unsupported version', () => {
    const json = JSON.stringify({ asset: { version: '2.0' } })
    const glb = glbHeader(20 + json.length, json)
    glb.writeUInt32LE(1, 4)
    const r = parseMedia({ kind: 'glb', sniff: glb, declaredBytes: glb.length })
    expect(r.ok).toBe(false)
    expect(r.reason).toContain('version')
  })

  it('rejects GLB self-declared length mismatch', () => {
    const json = JSON.stringify({ asset: { version: '2.0' } })
    const glb = glbHeader(20 + json.length, json)
    const r = parseMedia({ kind: 'glb', sniff: glb, declaredBytes: glb.length + 512 })
    expect(r.ok).toBe(false)
    expect(r.reason).toContain('declared length')
  })

  it('rejects GLB JSON chunk with external URI', () => {
    const json = JSON.stringify({ asset: { version: '2.0' }, images: [{ uri: 'https://evil.example/x.png' }] })
    const glb = glbHeader(20 + json.length, json)
    const r = parseMedia({ kind: 'glb', sniff: glb, declaredBytes: glb.length })
    expect(r.ok).toBe(false)
    expect(r.reason).toContain('external URI')
  })

  it('rejects GLB first chunk not JSON', () => {
    const json = JSON.stringify({ asset: { version: '2.0' } })
    const glb = glbHeader(20 + json.length, json)
    glb.writeUInt32LE(0x0042494e, 16) // 'BIN\0'
    const r = parseMedia({ kind: 'glb', sniff: glb, declaredBytes: glb.length })
    expect(r.ok).toBe(false)
    expect(r.reason).toContain('chunk')
  })

  it('passes non-image/glb kinds through', () => {
    expect(parseMedia({ kind: 'vtt', sniff: Buffer.alloc(10), declaredBytes: 10 }).ok).toBe(true)
    expect(parseMedia({ kind: 'video', sniff: Buffer.alloc(10), declaredBytes: 10 }).ok).toBe(true)
    expect(parseMedia({ kind: 'audio', sniff: Buffer.alloc(10), declaredBytes: 10 }).ok).toBe(true)
  })
})