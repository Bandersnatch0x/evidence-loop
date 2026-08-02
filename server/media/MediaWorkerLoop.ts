/**
 * MediaWorkerLoop — background processor for uploads that were quarantined but
 * not processed inline (e.g. server restarts, fail_closed retries).
 *
 * v1 semantics (spec §5.5 / decision-scan A): a session that hit a scanner
 * fail_closed stays quarantined and is retried by the worker on the next tick
 * with a minimum backoff. Runs alongside the inline PATCH-completion path.
 */
import type { UploadStore } from './UploadStore'
import type { MediaProcessor } from './MediaProcessor'

const MIN_BACKOFF_MS = 5_000

export class MediaWorkerLoop {
  private timer: ReturnType<typeof setInterval> | null = null
  private lastAttempt = new Map<string, number>()

  constructor(
    private readonly uploads: UploadStore,
    private readonly processor: MediaProcessor,
    private readonly intervalMs: number = 2_000
  ) {}

  start(): void {
    if (this.timer) return
    this.timer = setInterval(() => {
      void this.tick()
    }, this.intervalMs)
    this.timer.unref?.()
  }

  stop(): void {
    if (this.timer) {
      clearInterval(this.timer)
      this.timer = null
    }
  }

  private async tick(): Promise<void> {
    const quarantined = this.uploads.listByState('quarantined')
    const now = Date.now()
    for (const session of quarantined) {
      const last = this.lastAttempt.get(session.id) ?? 0
      if (now - last < MIN_BACKOFF_MS) continue
      this.lastAttempt.set(session.id, now)
      try {
        await this.processor.processUpload(session.id)
      } catch (err) {
        // Worker must never crash the loop; surface for observability.
        console.error(`media worker failed for ${session.id}:`, err)
      }
    }
  }
}