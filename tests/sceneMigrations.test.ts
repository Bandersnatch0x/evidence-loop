import { describe, expect, it } from 'vitest'
import { migrateToLatest } from '../server/demonstration/sceneMigrations'
import { isVersionSupported } from '../server/demonstration/sceneDocumentSchema'

const currentDoc = {
  documentMeta: { sceneFormatVersion: '1.0' }
}

describe('scene version migration (N-2 forward-only)', () => {
  it('returns current-format doc as-is (deep-cloned, not same reference)', () => {
    const r = migrateToLatest(currentDoc)
    expect(r.ok).toBe(true)
    if (r.ok) {
      expect(r.migratedFrom).toBe('1.0')
      expect(r.document.documentMeta.sceneFormatVersion).toBe('1.0')
      expect(r.document).not.toBe(currentDoc) // deep clone, caller-safe
    }
  })

  it('floor gate: current + future pass isVersionSupported, older refused', () => {
    expect(isVersionSupported('1.0')).toBe(true)
    expect(isVersionSupported('0.9')).toBe(false)
    // isVersionSupported is the FLOOR gate only; future versions pass it and
    // are then refused by migrateToLatest/parseSceneDocument (upper bound).
    expect(isVersionSupported('2.0')).toBe(true)
  })

  it('refuses a future version with a clear message', () => {
    const r = migrateToLatest({ documentMeta: { sceneFormatVersion: '2.0' } })
    expect(r.ok).toBe(false)
    if (!r.ok) expect(r.error).toContain('newer')
  })

  it('refuses version older than the floor with explicit message', () => {
    const r = migrateToLatest({ documentMeta: { sceneFormatVersion: '0.8' } })
    expect(r.ok).toBe(false)
    if (!r.ok) expect(r.error).toContain('N-2')
  })

  it('refuses a document without sceneFormatVersion', () => {
    const r = migrateToLatest({ documentMeta: {} })
    expect(r.ok).toBe(false)
    if (!r.ok) expect(r.error).toContain('sceneFormatVersion')
  })

  it('refuses null-ish raw input gracefully', () => {
    const r = migrateToLatest(null)
    expect(r.ok).toBe(false)
  })
})