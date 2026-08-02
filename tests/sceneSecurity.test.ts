import { describe, expect, it } from 'vitest'
import {
  assertZeroScript,
  checkFontWhitelist,
  checkResourceBudget,
  checkUrlWhitelist,
  runSecurityGuards
} from '../server/demonstration/sceneSecurity'
import { parseSceneDocument } from '../server/demonstration/sceneDocumentSchema'

const baseDoc = () =>
  parseSceneDocument({
    documentMeta: { sceneFormatVersion: '1.0' }
  })

describe('sceneSecurity guards', () => {
  it('clean minimal doc passes all guards', () => {
    const doc = baseDoc()
    expect(runSecurityGuards(doc)).toEqual([])
  })

  it('flags external non-whitelisted URL in mediaRef label', () => {
    const doc = parseSceneDocument({
      documentMeta: { sceneFormatVersion: '1.0' },
      mediaRefs: [
        {
          id: 'm',
          blobHash: 'a'.repeat(64),
          purpose: 'video',
          label: 'watch https://evil.example/x'
        }
      ]
    })
    const issues = checkUrlWhitelist(doc)
    expect(issues.length).toBe(1)
    expect(issues[0]?.code).toBe('url-not-whitelisted')
  })

  it('allows YouTube and Vimeo embed URLs', () => {
    const doc = parseSceneDocument({
      documentMeta: { sceneFormatVersion: '1.0' },
      mediaRefs: [
        {
          id: 'm',
          blobHash: 'a'.repeat(64),
          purpose: 'video',
          label: 'https://www.youtube.com/watch?v=abc https://player.vimeo.com/video/123'
        }
      ]
    })
    expect(checkUrlWhitelist(doc)).toEqual([])
  })

  it('flags non-web-safe font (defense-in-depth beyond schema enum)', () => {
    // The zod schema already rejects Comic Sans, but the guard is a second
    // belt at load time — feed a doc-shaped object that bypasses parse.
    const doc = {
      documentMeta: { sceneFormatVersion: '1.0' },
      runtimeVersion: { sceneFormatVersion: '1.0', capabilities: [] },
      viewerConfig: {},
      fontsAndFormulas: { fonts: ['Comic Sans'], formulas: [] }
    }
    const issues = checkFontWhitelist(doc as never)
    expect(issues.length).toBe(1)
    expect(issues[0]?.code).toBe('font-not-whitelisted')
  })

  it('flags resource over-budget nodes', () => {
    const doc = parseSceneDocument({
      documentMeta: { sceneFormatVersion: '1.0' }
    })
    // bypass the schema's 500-node cap by casting — the guard itself is under
    // test, not the schema
    const overBudget = {
      ...doc,
      objectTree: Array.from({ length: 2500 }, (_, i) => ({ id: `n${i}` }))
    }
    const issues = checkResourceBudget(overBudget as never)
    expect(issues.some((i) => i.code === 'resource-over-budget')).toBe(true)
  })

  it('flags triangle over-budget from inline primitives', () => {
    const doc = parseSceneDocument({
      documentMeta: { sceneFormatVersion: '1.0' },
      geometry3D: [
        // 128×256 torus = 65,536 tris; 8 of them = 524,288 > 500k cap
        ...Array.from({ length: 2 }, (_, i) => ({
          id: `t${i}`,
          kind: 'torus',
          radius: 2,
          tube: 0.4,
          radialSegments: 128,
          tubularSegments: 256
        }))
      ]
    })
    // 2 toruses × 65,536 = 131,072 tris — under cap. Use more to exceed.
    const big = parseSceneDocument({
      documentMeta: { sceneFormatVersion: '1.0' },
      geometry3D: Array.from({ length: 10 }, (_, i) => ({
        id: `t${i}`,
        kind: 'torus',
        radius: 2,
        tube: 0.4,
        radialSegments: 128,
        tubularSegments: 256
      }))
    })
    const issues = checkResourceBudget(big)
    expect(issues.some((i) => i.code === 'resource-over-budget')).toBe(true)
  })

  it('counts NESTED objectTree nodes recursively', () => {
    const doc = parseSceneDocument({
      documentMeta: { sceneFormatVersion: '1.0' },
      objectTree: [
        { id: 'a', children: [{ id: 'b', children: [{ id: 'c' }] }] }
      ]
    })
    const issues = checkResourceBudget(doc) // 3 nodes, under cap
    expect(issues).toEqual([])
  })

  it('flags URL in geometry2D text content', () => {
    const doc = parseSceneDocument({
      documentMeta: { sceneFormatVersion: '1.0' },
      geometry2D: [{ id: 't', shape: 'text', x: 0, y: 0, text: 'see https://evil.example/x' }]
    })
    const issues = checkUrlWhitelist(doc)
    expect(issues.some((i) => i.code === 'url-not-whitelisted')).toBe(true)
  })

  it('flags protocol-relative URL', () => {
    const doc = parseSceneDocument({
      documentMeta: { sceneFormatVersion: '1.0' },
      mediaRefs: [
        { id: 'm', blobHash: 'a'.repeat(64), purpose: 'video', label: '//evil.example/x' }
      ]
    })
    const issues = checkUrlWhitelist(doc)
    expect(issues.some((i) => i.code === 'url-not-whitelisted')).toBe(true)
  })

  it('flags script-like formula tex', () => {
    const doc = parseSceneDocument({
      documentMeta: { sceneFormatVersion: '1.0' },
      fontsAndFormulas: {
        fonts: [],
        formulas: [{ id: 'f', tex: 'eval(alert(1))' }]
      }
    })
    const issues = assertZeroScript(doc)
    expect(issues.some((i) => i.code === 'script-like-string')).toBe(true)
  })

  it('passes clean formula tex', () => {
    const doc = parseSceneDocument({
      documentMeta: { sceneFormatVersion: '1.0' },
      fontsAndFormulas: {
        fonts: [],
        formulas: [{ id: 'f', tex: 'E = mc^2' }]
      }
    })
    expect(assertZeroScript(doc)).toEqual([])
  })

  it('flags editorMetadata containing window/document access', () => {
    const doc = parseSceneDocument({
      documentMeta: { sceneFormatVersion: '1.0' },
      editorMetadata: { widget: 'window.fetch("/x")' }
    })
    const issues = assertZeroScript(doc)
    expect(issues.some((i) => i.code === 'script-like-string')).toBe(true)
  })
})