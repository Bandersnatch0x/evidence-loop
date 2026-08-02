/**
 * sceneImport — whitelist importers for the SceneDocument (spec §4.7).
 *
 * Two entry points:
 *   - importSvg: parse an SVG fragment into geometry2D primitives. Uses a
 *     hand-rolled, entity-expansion-free scanner (XXE defense) that only
 *     recognizes the whitelisted subset tags; anything else is rejected —
 *     explicit rejection, never silent drops of dangerous content.
 *   - importGlb: validate a GLB byte buffer through the T-B media gate
 *     (MediaParser.parseMedia) and surface a whitelist verdict.
 *
 * No XML parser, no DOCTYPE handling, no external entity expansion — the
 * scanner is a pure string walk over the whitelisted element set.
 */
import { parseMedia } from '../media/MediaParser'
import type { Geometry2DPrimitive } from './sceneDocumentSchema'

/** Mirror of the schema font whitelist for import-time filtering. */
const WEB_SAFE_FONT_NAMES = new Set([
  'serif',
  'sans-serif',
  'monospace',
  'Arial',
  'Helvetica',
  'Times New Roman',
  'Courier New',
  'Georgia',
  'Verdana',
  'Noto Sans',
  'Noto Serif',
  'Noto Sans Math',
  'KaTeX_Main'
])

export interface ImportResult<T> {
  ok: boolean
  data?: T
  error?: string
}

/** Whitespace-insensitive attribute extractor: name="value" or name='value'. */
function extractAttributes(tagBody: string): Map<string, string> {
  const attrs = new Map<string, string>()
  const re = /([A-Za-z_:][A-Za-z0-9_.:-]*)\s*=\s*("([^"]*)"|'([^']*)')/g
  let m: RegExpExecArray | null
  while ((m = re.exec(tagBody)) !== null) {
    attrs.set(m[1]!, (m[3] ?? m[4]) ?? '')
  }
  return attrs
}

function numAttr(attrs: Map<string, string>, name: string): number | undefined {
  const v = attrs.get(name)
  if (v === undefined) return undefined
  const n = Number(v)
  return Number.isFinite(n) ? n : undefined
}

/**
 * Import an SVG fragment into SceneDocument geometry2D primitives.
 * Rejects DOCTYPE, entities, scripts, and any non-whitelisted tag.
 */
export function importSvg(svg: string): ImportResult<Geometry2DPrimitive[]> {
  if (svg.includes('<!DOCTYPE') || svg.includes('<!ENTITY')) {
    return { ok: false, error: 'SVG contains DOCTYPE/ENTITY — refused (XXE defense)' }
  }
  if (svg.toLowerCase().includes('<script')) {
    return { ok: false, error: 'SVG contains <script> — refused' }
  }
  if (svg.includes('&')) {
    // Allow only the 5 XML predefined escapes (no expansion risk); any other
    // entity — numeric dec/hex, or custom name — is a potential XXE vector.
    const stripped = svg.replace(/&(amp|lt|gt|quot|apos);/g, '')
    if (stripped.includes('&')) {
      return { ok: false, error: 'SVG contains non-predefined entities — refused' }
    }
  }

  const primitives: Geometry2DPrimitive[] = []
  // Match any <tag ...> — content between tags is ignored (we only import geometry).
  const tagRe = /<([A-Za-z][A-Za-z0-9]*)([^>]*)>/g
  let m: RegExpExecArray | null
  let idCounter = 0
  const nextId = (): string => `svg-${++idCounter}`

  const allowed = new Set(['svg', 'rect', 'circle', 'ellipse', 'line', 'polyline', 'polygon', 'path', 'text', 'g'])

  while ((m = tagRe.exec(svg)) !== null) {
    const tag = m[1]!.toLowerCase()
    const body = m[2] ?? ''
    if (!allowed.has(tag)) {
      return { ok: false, error: `SVG tag <${tag}> not in whitelist — refused` }
    }
    if (tag === 'g' || tag === 'svg') continue // container — children handled below
    const attrs = extractAttributes(body)

    switch (tag) {
      case 'rect': {
        const x = numAttr(attrs, 'x') ?? 0
        const y = numAttr(attrs, 'y') ?? 0
        const width = numAttr(attrs, 'width')
        const height = numAttr(attrs, 'height')
        if (width === undefined || height === undefined) return { ok: false, error: 'rect missing width/height' }
        primitives.push({
          id: nextId(),
          shape: 'rect',
          x,
          y,
          width,
          height,
          rx: numAttr(attrs, 'rx'),
          ry: numAttr(attrs, 'ry')
        })
        break
      }
      case 'circle': {
        const cx = numAttr(attrs, 'cx') ?? 0
        const cy = numAttr(attrs, 'cy') ?? 0
        const r = numAttr(attrs, 'r')
        if (r === undefined) return { ok: false, error: 'circle missing r' }
        primitives.push({ id: nextId(), shape: 'circle', cx, cy, r })
        break
      }
      case 'ellipse': {
        const cx = numAttr(attrs, 'cx') ?? 0
        const cy = numAttr(attrs, 'cy') ?? 0
        const rx = numAttr(attrs, 'rx')
        const ry = numAttr(attrs, 'ry')
        if (rx === undefined || ry === undefined) return { ok: false, error: 'ellipse missing rx/ry' }
        primitives.push({ id: nextId(), shape: 'ellipse', cx, cy, rx, ry })
        break
      }
      case 'line': {
        const x1 = numAttr(attrs, 'x1') ?? 0
        const y1 = numAttr(attrs, 'y1') ?? 0
        const x2 = numAttr(attrs, 'x2') ?? 0
        const y2 = numAttr(attrs, 'y2') ?? 0
        primitives.push({ id: nextId(), shape: 'line', x1, y1, x2, y2 })
        break
      }
      case 'polyline': {
        const pts = attrs.get('points')
        if (!pts) return { ok: false, error: 'polyline missing points' }
        const points = parsePoints(pts)
        if (points.length < 2) return { ok: false, error: 'polyline needs ≥2 points' }
        primitives.push({ id: nextId(), shape: 'polyline', points })
        break
      }
      case 'polygon': {
        const pts = attrs.get('points')
        if (!pts) return { ok: false, error: 'polygon missing points' }
        const points = parsePoints(pts)
        if (points.length < 3) return { ok: false, error: 'polygon needs ≥3 points' }
        primitives.push({ id: nextId(), shape: 'polygon', points })
        break
      }
      case 'path': {
        const d = attrs.get('d')
        if (!d) return { ok: false, error: 'path missing d' }
        primitives.push({ id: nextId(), shape: 'path', d })
        break
      }
      case 'text': {
        const x = numAttr(attrs, 'x') ?? 0
        const y = numAttr(attrs, 'y') ?? 0
        // Text content sits between the open and close tag. Pull it forward.
        const text = textContentAfter(svg, m.index)
        const fontFamily = attrs.get('font-family')
        const fontSize = numAttr(attrs, 'font-size')
        // Presentation attrs survive only when they pass the whitelist — a
        // non-web-safe font is dropped (defaults), never injected into CSS.
        const fontOk = fontFamily !== undefined && WEB_SAFE_FONT_NAMES.has(fontFamily)
        primitives.push({
          id: nextId(),
          shape: 'text',
          x,
          y,
          text,
          ...(fontOk
            ? { fontFamily: fontFamily as Extract<Geometry2DPrimitive, { shape: 'text' }>['fontFamily'] }
            : {}),
          ...(fontSize !== undefined ? { fontSize } : {})
        })
        break
      }
    }
  }
  if (primitives.length === 0) {
    return { ok: false, error: 'SVG contained no importable primitives' }
  }
  return { ok: true, data: primitives }
}

function parsePoints(spec: string): Array<[number, number]> {
  const parts = spec.trim().split(/[\s,]+/)
  const out: Array<[number, number]> = []
  for (let i = 0; i + 1 < parts.length; i += 2) {
    const x = Number(parts[i])
    const y = Number(parts[i + 1])
    if (!Number.isFinite(x) || !Number.isFinite(y)) continue
    out.push([x, y])
  }
  return out
}

/** Extract text node content after a <text ...> open tag, until the matching close. */
function textContentAfter(svg: string, openIndex: number): string {
  const rest = svg.slice(openIndex)
  const close = rest.indexOf('</text>')
  const gt = rest.indexOf('>')
  if (close === -1 || gt === -1 || close < gt) return ''
  const content = rest.slice(gt + 1, close)
  return content
    .replace(/<[^>]*>/g, '')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .trim()
    .slice(0, 500)
}

/** Allowed GLB feature surface (spec §4.7 — whitelist, not pass-everything). */
export type GlbWhitelistVerdict = {
  kind: 'image' | 'glb' | 'video' | 'vtt' | 'audio'
  ok: boolean
  error?: string
}

/**
 * Validate a GLB upload through the T-B media gate and state the whitelist
 * verdict. A GLB that fails the structural gate is REFUSED (never silently
 * rendered wrong — spec §6.3).
 */
export function importGlb(bytes: Buffer): ImportResult<GlbWhitelistVerdict> {
  const parsed = parseMedia({ kind: 'glb', sniff: bytes, declaredBytes: bytes.length })
  if (!parsed.ok) {
    return { ok: false, error: parsed.reason ?? 'GLB gate failed' }
  }
  return { ok: true, data: { kind: 'glb', ok: true } }
}