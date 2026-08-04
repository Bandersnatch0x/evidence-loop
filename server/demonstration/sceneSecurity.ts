/**
 * sceneSecurity — static guards on a SceneDocument (spec §4.8).
 *
 * Zero-script: the document is pure data — no executable code, no eval/Function,
 * no dynamic import, no arbitrary URL fetch. These guards are belt-and-braces
 * static checks run at load/publish time; the zod schema is the primary gate.
 *
 * Guards:
 *   - checkUrlWhitelist: any URL-ish string must reference MediaAsset blobs or
 *     the official YouTube/Vimeo embed domains.
 *   - checkFontWhitelist: font families must be web-safe (mirror of schema, but
 *     standalone so the player can run it without zod).
 *   - checkResourceBudget: node/triangle/texture/animation caps (spec §6.5).
 *   - assertZeroScript: string scan for eval-ish patterns across the doc.
 */
import type { SceneDocument } from './sceneDocumentSchema'

export interface SecurityIssue {
  code: 'url-not-whitelisted' | 'font-not-whitelisted' | 'resource-over-budget' | 'script-like-string'
  message: string
}

/** Official embed domains for external videos (spec §4.8, ticket 03). */
const EMBED_DOMAINS = ['youtube.com', 'youtu.be', 'player.vimeo.com', 'vimeo.com']

const WEB_SAFE_FONTS = new Set([
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

const HARD_BUDGET = {
  maxNodes: 2000,
  maxTriangles: 500_000,
  maxTexturePixels: 8_388_608, // 8 MP
  maxAnimationSeconds: 600,
  maxMediaRefs: 200
}

/**
 * Resolve the resource budget from environment config (ticket T-M §9.1:
 * 配置值 ≠ 代码常量). Env overrides apply per cap; defaults stay the spec
 * HARD_BUDGET so unconfigured servers keep the same guardrails.
 */
export function resolveResourceBudget(
  env: NodeJS.ProcessEnv = process.env
): typeof HARD_BUDGET {
  return {
    maxNodes: intEnv(env.DEMO_BUDGET_MAX_NODES, HARD_BUDGET.maxNodes),
    maxTriangles: intEnv(env.DEMO_BUDGET_MAX_TRIANGLES, HARD_BUDGET.maxTriangles),
    maxTexturePixels: intEnv(env.DEMO_BUDGET_MAX_TEXTURE_PIXELS, HARD_BUDGET.maxTexturePixels),
    maxAnimationSeconds: intEnv(env.DEMO_BUDGET_MAX_ANIMATION_SECONDS, HARD_BUDGET.maxAnimationSeconds),
    maxMediaRefs: intEnv(env.DEMO_BUDGET_MAX_MEDIA_REFS, HARD_BUDGET.maxMediaRefs)
  }
}

function intEnv(raw: string | undefined, fallback: number): number {
  if (raw === undefined || raw === '') return fallback
  const n = Number(raw)
  return Number.isFinite(n) && n > 0 ? n : fallback
}

/** Count ALL nodes recursively (top-level + nested children). */
function countNodes(doc: SceneDocument): number {
  let count = 0
  const walk = (list: readonly unknown[]): void => {
    for (const n of list) {
      count += 1
      const node = n as { children?: readonly unknown[] } | null
      if (node && typeof node === 'object' && Array.isArray(node.children)) {
        walk(node.children)
      }
    }
  }
  walk(doc.objectTree ?? [])
  return count
}

/**
 * Estimate triangle count from inline 3D primitives (spec §6.5 budget).
 * Sphere/cylinder/cone/torus/ring are tessellated; box/plane are fixed 12 tris.
 */
function estimateTriangles(doc: SceneDocument): number {
  let tris = 0
  for (const g of doc.geometry3D ?? []) {
    if (g.kind === 'gltf') continue // GLB capped at upload (T-B gate)
    switch (g.kind) {
      case 'box':
      case 'plane':
        tris += 12
        break
      case 'sphere':
        tris += (g.segments ?? 24) * (g.segments ?? 24) * 2
        break
      case 'cylinder':
      case 'cone':
        tris += (g.radialSegments ?? 24) * 4
        break
      case 'torus':
        tris += (g.radialSegments ?? 24) * (g.tubularSegments ?? 64) * 2
        break
      case 'ring':
        tris += (g.thetaSegments ?? 24) * 2
        break
    }
  }
  return tris
}

/**
 * Scan a document's strings for URL-ish patterns and check each against the
 * whitelist. Returns issues; empty array = clean.
 */
export function checkUrlWhitelist(doc: SceneDocument): SecurityIssue[] {
  const issues: SecurityIssue[] = []
  const urlRe = /(?:https?:)?\/\/[^\s"']+/g
  const strings: string[] = []

  // Collect every string surface that could hold a URL: mediaRefs labels,
  // formula tex, geometry2D text content, chapter titles, interaction labels.
  for (const ref of doc.mediaRefs ?? []) {
    if (ref.label) strings.push(ref.label)
  }
  for (const f of doc.fontsAndFormulas?.formulas ?? []) {
    strings.push(f.tex)
  }
  for (const g of doc.geometry2D ?? []) {
    if (g.shape === 'text' && g.text) strings.push(g.text)
  }
  for (const ch of doc.timeline?.chapters ?? []) {
    strings.push(ch.title)
  }
  for (const i of doc.interactions ?? []) {
    if (i.type === 'view-switch') {
      for (const v of i.viewpoints) strings.push(v.label)
    } else if (i.type === 'step-visibility') {
      for (const s of i.steps) if (s.label) strings.push(s.label)
    } else if (i.type === 'pick-highlight' && i.label) strings.push(i.label)
  }

  for (const s of strings) {
    for (const m of s.match(urlRe) ?? []) {
      try {
        const host = new URL(m, 'https://placeholder.invalid').hostname.toLowerCase()
        const ok = EMBED_DOMAINS.some((d) => host === d || host.endsWith(`.${d}`))
        if (!ok) {
          issues.push({ code: 'url-not-whitelisted', message: `URL ${m} not in whitelist` })
        }
      } catch {
        issues.push({ code: 'url-not-whitelisted', message: `malformed URL: ${m}` })
      }
    }
  }
  return issues
}

/** Check fonts against the web-safe whitelist. */
export function checkFontWhitelist(doc: SceneDocument): SecurityIssue[] {
  const issues: SecurityIssue[] = []
  for (const f of doc.fontsAndFormulas?.fonts ?? []) {
    if (!WEB_SAFE_FONTS.has(f)) {
      issues.push({ code: 'font-not-whitelisted', message: `font ${f} not web-safe` })
    }
  }
  return issues
}

/** Resource budget caps (spec §6.5 + env-configurable via resolveResourceBudget). */
export function checkResourceBudget(doc: SceneDocument): SecurityIssue[] {
  const budget = resolveResourceBudget()
  const issues: SecurityIssue[] = []
  const nodeCount = countNodes(doc)
  if (nodeCount > budget.maxNodes) {
    issues.push({ code: 'resource-over-budget', message: `nodes ${nodeCount} > ${budget.maxNodes}` })
  }
  const tris = estimateTriangles(doc)
  if (tris > budget.maxTriangles) {
    issues.push({ code: 'resource-over-budget', message: `estimated triangles ${tris} > ${budget.maxTriangles}` })
  }
  const dur = doc.timeline?.duration ?? 0
  if (dur > budget.maxAnimationSeconds) {
    issues.push({ code: 'resource-over-budget', message: `timeline ${dur}s > ${budget.maxAnimationSeconds}s` })
  }
  const refs = (doc.mediaRefs ?? []).length
  if (refs > budget.maxMediaRefs) {
    issues.push({ code: 'resource-over-budget', message: `mediaRefs ${refs} > ${budget.maxMediaRefs}` })
  }
  return issues
}

/** Zero-script scan: reject eval-ish constructs anywhere in the doc's strings. */
const SCRIPT_PATTERNS = [
  /\beval\s*\(/,
  /\bFunction\s*\(/,
  /\bnew\s+Function\b/,
  /\bimport\s*\(/,
  /\brequire\s*\(/,
  /\bglobalThis\b/,
  /\bwindow\./,
  /\bdocument\./
]

export function assertZeroScript(doc: SceneDocument): SecurityIssue[] {
  const issues: SecurityIssue[] = []
  const blobs: string[] = [JSON.stringify(doc)]
  // Also scan font names + formula tex individually for a clearer path in message.
  const paths: Array<[string, string]> = []
  for (const f of doc.fontsAndFormulas?.formulas ?? []) paths.push([`fontsAndFormulas.formulas[].tex`, f.tex])
  for (const e of doc.editorMetadata ? [JSON.stringify(doc.editorMetadata)] : []) paths.push(['editorMetadata', e])

  for (const [path, s] of paths) {
    for (const re of SCRIPT_PATTERNS) {
      if (re.test(s)) {
        issues.push({ code: 'script-like-string', message: `script-like pattern in ${path}: ${re.source}` })
      }
    }
  }
  if (issues.length === 0) {
    // Whole-doc serialization catch-all for any other string field.
    for (const re of SCRIPT_PATTERNS) {
      if (blobs.some((b) => re.test(b))) {
        issues.push({ code: 'script-like-string', message: `script-like pattern in document: ${re.source}` })
      }
    }
  }
  return issues
}

/** Run the full set of security guards; returns all issues (empty = ok). */
export function runSecurityGuards(doc: SceneDocument): SecurityIssue[] {
  return [
    ...checkUrlWhitelist(doc),
    ...checkFontWhitelist(doc),
    ...checkResourceBudget(doc),
    ...assertZeroScript(doc)
  ]
}