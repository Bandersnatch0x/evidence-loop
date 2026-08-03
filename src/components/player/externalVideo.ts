/**
 * player/externalVideo — external video ref resolution (spec §6.1 #3, §6.6).
 * Pure helpers kept separate from components for fast refresh. Only the
 * allowlisted official player domains (YouTube/Vimeo) are ever embeds; the
 * player never requests arbitrary URLs.
 */

const YOUTUBE_EMBED = 'https://www.youtube-nocookie.com/embed/'
const VIMEO_EMBED = 'https://player.vimeo.com/video/'

/** Resolve an external video ref to its official embed URL (whitelist). */
export function embedUrl(
  provider: string | undefined,
  providerVideoId: string | undefined
): string | null {
  if (!provider || !providerVideoId) return null
  if (provider === 'youtube') return `${YOUTUBE_EMBED}${encodeURIComponent(providerVideoId)}`
  if (provider === 'vimeo') return `${VIMEO_EMBED}${encodeURIComponent(providerVideoId)}`
  return null
}

/** True when the external ref is playable (health not terminal). */
export function isPlayableHealth(health: string | undefined): boolean {
  if (!health) return true
  return !['unavailable', 'private', 'embed_forbidden'].includes(health)
}
