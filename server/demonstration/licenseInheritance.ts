/**
 * License inheritance — shared policy (spec decision 08, T-D).
 *
 * A derived work's license must be NO STRICTER than the source unless ALL
 * source content was removed. Used by DemonstrationService.submit (enforce at
 * publish) and DerivationService (expose the primitive).
 */

export class LicenseError extends Error {
  public constructor(message: string) {
    super(message)
    this.name = 'LicenseError'
  }
}

/** License tiers: index 0 = most permissive. */
export const LICENSE_TIERS = ['CC0', 'CC-BY-4.0', 'CC-BY-SA-4.0', 'CC-BY-NC-4.0', 'CC-BY-NC-SA-4.0', 'proprietary']

/**
 * Assert the target license is allowed for a work derived from a source with
 * the given license. `sourceContentRemoved` = derived work no longer includes
 * any of the source's blobs (then any license is allowed).
 */
export function assertLicenseAllowed(
  sourceLicense: string,
  targetLicense: string,
  sourceContentRemoved: boolean
): void {
  if (sourceContentRemoved) return
  const srcIdx = LICENSE_TIERS.indexOf(sourceLicense)
  const tgtIdx = LICENSE_TIERS.indexOf(targetLicense)
  if (srcIdx === -1 || tgtIdx === -1) {
    throw new LicenseError(`unknown license: ${sourceLicense} / ${targetLicense}`)
  }
  if (tgtIdx > srcIdx) {
    throw new LicenseError(
      `license ${targetLicense} is stricter than source ${sourceLicense}; remove source content or choose a permissive license`
    )
  }
}