import { describe, expect, it } from 'vitest'
import { importGlb, importSvg } from '../server/demonstration/sceneImport'

/** Minimal valid GLB: header + JSON chunk (passes T-B parseMedia gate). */
function realGlb(): Buffer {
  const json = Buffer.from(
    JSON.stringify({ asset: { version: '2.0' }, scene: 0, scenes: [{ nodes: [] }] }),
    'utf8'
  )
  const h = Buffer.alloc(20)
  h.writeUInt32LE(0x46546c67, 0)
  h.writeUInt32LE(2, 4)
  h.writeUInt32LE(20 + json.length, 8)
  h.writeUInt32LE(json.length, 12)
  h.writeUInt32LE(0x4e4f534a, 16)
  return Buffer.concat([h, json])
}

describe('sceneImport — SVG whitelist (XXE defense)', () => {
  it('imports rect/circle/line/path/text', () => {
    const svg = '<svg><rect x="0" y="0" width="10" height="5"/><circle cx="5" cy="5" r="2"/><line x1="0" y1="0" x2="1" y2="1"/><path d="M0 0L10 10Z"/><text x="1" y="2">Hello</text></svg>'
    const r = importSvg(svg)
    expect(r.ok).toBe(true)
    if (!r.ok || !r.data) return
    expect(r.data.length).toBe(5)
    expect(r.data[0]).toMatchObject({ id: 'svg-1', shape: 'rect', width: 10 })
    expect(r.data[4]).toMatchObject({ shape: 'text', text: 'Hello' })
  })

  it('rejects DOCTYPE (XXE vector)', () => {
    const r = importSvg('<!DOCTYPE svg [<!ENTITY xxe SYSTEM "file:///etc/passwd">]><svg><text>&xxe;</text></svg>')
    expect(r.ok).toBe(false)
    if (!r.ok) expect(r.error).toContain('DOCTYPE')
  })

  it('rejects ENTITY declarations', () => {
    const r = importSvg('<svg><rect width="1" height="1"/><!ENTITY x "y"></svg>')
    expect(r.ok).toBe(false)
    if (!r.ok) expect(r.error).toContain('ENTITY')
  })

  it('rejects <script> tags', () => {
    const r = importSvg('<svg><script>window.pwned=1</script><rect width="1" height="1"/></svg>')
    expect(r.ok).toBe(false)
    if (!r.ok) expect(r.error).toContain('script')
  })

  it('rejects non-whitelisted tags', () => {
    const r = importSvg('<svg><foreignObject><iframe src="https://x"/></foreignObject></svg>')
    expect(r.ok).toBe(false)
  })

  it('rejects entities in attribute values', () => {
    const r = importSvg('<svg><text x="0" y="0">&#106;&#97;&#118;&#97;&#115;&#99;&#114;&#105;&#112;&#116;</text></svg>')
    expect(r.ok).toBe(false)
  })

  it('rejects empty SVG with no primitives', () => {
    const r = importSvg('<svg></svg>')
    expect(r.ok).toBe(false)
  })

  it('imports polygon with ≥3 points and rejects <3', () => {
    const good = importSvg('<svg><polygon points="0,0 1,0 1,1"/></svg>')
    if (!good.ok || !good.data) throw new Error('expected ok')
    expect(good.data.length).toBe(1)
    const bad = importSvg('<svg><polygon points="0,0 1,0"/></svg>')
    expect(bad.ok).toBe(false)
  })

  it('preserves whitelisted font-family and font-size on text import', () => {
    const r = importSvg('<svg><text x="0" y="0" font-family="Arial" font-size="24">Hi</text></svg>')
    expect(r.ok).toBe(true)
    if (!r.ok || !r.data) return
    const t = r.data[0] as Extract<NonNullable<typeof r.data>[0], { shape: 'text' }>
    expect(t.shape).toBe('text')
    expect(t.fontFamily).toBe('Arial')
    expect(t.fontSize).toBe(24)
  })

  it('drops non-whitelisted font-family (never injects into CSS)', () => {
    const r = importSvg('<svg><text x="0" y="0" font-family="Comic Sans">Hi</text></svg>')
    expect(r.ok).toBe(true)
    if (!r.ok || !r.data) return
    const t = r.data[0] as Extract<NonNullable<typeof r.data>[0], { shape: 'text' }>
    expect(t.shape).toBe('text')
    expect(t.fontFamily).toBeUndefined()
  })
})

describe('sceneImport — glTF/GLB whitelist', () => {
  it('accepts a structurally valid GLB through the T-B gate', () => {
    const r = importGlb(realGlb())
    expect(r.ok).toBe(true)
    if (r.ok && r.data) expect(r.data.kind).toBe('glb')
  })

  it('refuses a bad-magic GLB', () => {
    const b = realGlb()
    b.writeUInt32LE(0xdeadbeef, 0)
    const r = importGlb(b)
    expect(r.ok).toBe(false)
  })

  it('refuses a GLB whose declared length and buffer disagree', () => {
    const b = realGlb()
    const r = importGlb(Buffer.concat([b, Buffer.alloc(50)]))
    expect(r.ok).toBe(false)
  })
})