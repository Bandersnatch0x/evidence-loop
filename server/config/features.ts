/**
 * Backend feature flag: multimodal (voice + visual pointing) module.
 *
 * See ADR-0005 Section 8 — when disabled, `/api/multimodal/*` routes
 * respond with 503 so the pre-Phase-1 scoring loop stays untouched.
 *
 * Default: disabled. Only `"true"` (string) turns it on.
 */

export function isMultimodalEnabled(): boolean {
  return process.env.MULTIMODAL_ENABLED === 'true'
}
