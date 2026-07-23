import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { isMultimodalEnabled as isMultimodalEnabledClient } from '../src/config/features'
import { isMultimodalEnabled as isMultimodalEnabledServer } from '../server/config/features'

describe('feature flag: MULTIMODAL_ENABLED (frontend)', () => {
  afterEach(() => {
    vi.unstubAllEnvs()
  })

  it('is true when VITE_MULTIMODAL_ENABLED === "true"', () => {
    vi.stubEnv('VITE_MULTIMODAL_ENABLED', 'true')
    expect(isMultimodalEnabledClient()).toBe(true)
  })

  it('is false when the env var is unset', () => {
    vi.stubEnv('VITE_MULTIMODAL_ENABLED', '')
    expect(isMultimodalEnabledClient()).toBe(false)
  })

  it('is false when VITE_MULTIMODAL_ENABLED === "false"', () => {
    vi.stubEnv('VITE_MULTIMODAL_ENABLED', 'false')
    expect(isMultimodalEnabledClient()).toBe(false)
  })
})

describe('feature flag: MULTIMODAL_ENABLED (server)', () => {
  const originalValue = process.env.MULTIMODAL_ENABLED

  beforeEach(() => {
    delete process.env.MULTIMODAL_ENABLED
  })

  afterEach(() => {
    if (originalValue === undefined) {
      delete process.env.MULTIMODAL_ENABLED
    } else {
      process.env.MULTIMODAL_ENABLED = originalValue
    }
  })

  it('is true when MULTIMODAL_ENABLED === "true"', () => {
    process.env.MULTIMODAL_ENABLED = 'true'
    expect(isMultimodalEnabledServer()).toBe(true)
  })

  it('is false when MULTIMODAL_ENABLED is unset', () => {
    expect(isMultimodalEnabledServer()).toBe(false)
  })

  it('is false when MULTIMODAL_ENABLED === "false"', () => {
    process.env.MULTIMODAL_ENABLED = 'false'
    expect(isMultimodalEnabledServer()).toBe(false)
  })
})
