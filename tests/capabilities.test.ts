import { describe, expect, it } from 'vitest'
import { negotiateCapabilities, type DeviceCapability } from '../server/demonstration/capabilities'
import { parseSceneDocument } from '../server/demonstration/sceneDocumentSchema'

const baseDoc = {
  documentMeta: { sceneFormatVersion: '1.0' },
  runtimeVersion: { sceneFormatVersion: '1.0', capabilities: [] }
}

const highDevice: DeviceCapability = {
  webgl: 'webgl2',
  tier: 'high',
  prefersReducedMotion: false,
  maxTextureSize: 16384
}

const lowDevice: DeviceCapability = {
  webgl: 'webgl1',
  tier: 'low',
  prefersReducedMotion: false,
  maxTextureSize: 4096
}

describe('capability negotiation', () => {
  it('full for high-tier device when no capabilities needed', () => {
    const doc = parseSceneDocument(baseDoc)
    expect(negotiateCapabilities(doc, highDevice)).toBe('full')
  })

  it('full when all capabilities are met', () => {
    const doc = parseSceneDocument({
      ...baseDoc,
      runtimeVersion: { sceneFormatVersion: '1.0', capabilities: ['webgl2', 'particles'] }
    })
    expect(negotiateCapabilities(doc, highDevice)).toBe('full')
  })

  it('refuse when device has no WebGL and doc requires 3D', () => {
    const doc = parseSceneDocument({
      ...baseDoc,
      runtimeVersion: { sceneFormatVersion: '1.0', capabilities: ['model3d-skinning'] }
    })
    expect(negotiateCapabilities(doc, { ...highDevice, webgl: 'none' })).toBe('refuse')
  })

  it('refuse when doc requires webgpu but device only has webgl', () => {
    const doc = parseSceneDocument({
      ...baseDoc,
      runtimeVersion: { sceneFormatVersion: '1.0', capabilities: ['webgpu'] }
    })
    expect(negotiateCapabilities(doc, { ...highDevice, webgl: 'webgl1' })).toBe('refuse')
  })

  it('refuse video on low-tier device', () => {
    const doc = parseSceneDocument({
      ...baseDoc,
      runtimeVersion: { sceneFormatVersion: '1.0', capabilities: ['video'] }
    })
    expect(negotiateCapabilities(doc, lowDevice)).toBe('refuse')
  })

  it('refuse model3d-skinning on webgl1', () => {
    const doc = parseSceneDocument({
      ...baseDoc,
      runtimeVersion: { sceneFormatVersion: '1.0', capabilities: ['model3d-skinning'] }
    })
    expect(negotiateCapabilities(doc, { ...highDevice, webgl: 'webgl1' })).toBe('refuse')
  })

  it('static-alternative when prefers-reduced-motion', () => {
    const doc = parseSceneDocument(baseDoc)
    expect(negotiateCapabilities(doc, { ...highDevice, prefersReducedMotion: true })).toBe('static-alternative')
  })

  it('refuse when doc requires webgl2 but device has webgl1', () => {
    const doc = parseSceneDocument({
      ...baseDoc,
      runtimeVersion: { sceneFormatVersion: '1.0', capabilities: ['webgl2'] }
    })
    expect(negotiateCapabilities(doc, { ...highDevice, webgl: 'webgl1' })).toBe('refuse')
  })

  it('refuse when doc requires webgl1 but device has no WebGL', () => {
    const doc = parseSceneDocument({
      ...baseDoc,
      runtimeVersion: { sceneFormatVersion: '1.0', capabilities: ['webgl1'] }
    })
    expect(negotiateCapabilities(doc, { ...highDevice, webgl: 'none' })).toBe('refuse')
  })

  it('full when doc requires webgl2 and device has webgl2', () => {
    const doc = parseSceneDocument({
      ...baseDoc,
      runtimeVersion: { sceneFormatVersion: '1.0', capabilities: ['webgl2'] }
    })
    expect(negotiateCapabilities(doc, highDevice)).toBe('full')
  })

  it('simplified for medium-tier device with 3D capabilities', () => {
    const doc = parseSceneDocument({
      ...baseDoc,
      runtimeVersion: { sceneFormatVersion: '1.0', capabilities: ['model3d-skinning'] }
    })
    expect(negotiateCapabilities(doc, { ...highDevice, tier: 'medium' })).toBe('simplified')
  })
})