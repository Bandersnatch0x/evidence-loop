/**
 * Scanner seam — antivirus gate on uploaded media (spec §5.5, research §5).
 *
 * Decision (subagent, brief-scan-decision): ship clamd with v1 single-node
 * deployment. ClamAV reachable → INSTREAM scan; unreachable → queue the session
 * back (fail_closed, NOT rejected — retries later). A scan result that is not
 * `clean` blocks any asset from reaching `ready`; the payload stays quarantined
 * and never publishes.
 *
 * Implementations follow the repo's minimal seam style (BlobStore.ts):
 * interface + thin impls + factory. No third-party scanning lib — clamd's
 * INSTREAM protocol is a raw TCP exchange exercised here.
 */
import { connect } from 'node:net'
import { pipeline } from 'node:stream/promises'
import { Transform } from 'node:stream'

export type ScanStatus = 'clean' | 'infected' | 'fail_closed'

export interface ScanResult {
  status: ScanStatus
  /** ClamAV virus signature when infected. */
  signature?: string
  reason?: string
}

/**
 * Consume the payload stream (so MediaProcessor can re-hash via one pass) and
 * answer whether the payload is clean. Scanners must drain the stream either
 * way — the caller chains hashing through the scanner.
 */
export interface Scanner {
  scan(stream: NodeJS.ReadableStream, byteSize: number): Promise<ScanResult>
}

/** Default when no scanner is configured — never fails open. */
export class FailClosedScanner implements Scanner {
  constructor(private readonly reason = 'clamd not configured') {}

  async scan(_stream: NodeJS.ReadableStream, _byteSize: number): Promise<ScanResult> {
    void _byteSize
    // Drain the stream so the caller's hash pass is not stalled by backpressure
    // (scanner contract: always consume the payload).
    await drainStream(_stream)
    return { status: 'fail_closed', reason: this.reason }
  }
}

/**
 * Dev-test scanner, gated by the factory: only reachable when
 * NODE_ENV !== 'production' AND MEDIA_DISABLE_SCAN=1. Drains the stream so the
 * caller's hash pass still runs; returns clean for everything.
 */
export class DevPassThroughScanner implements Scanner {
  async scan(stream: NodeJS.ReadableStream, _byteSize: number): Promise<ScanResult> {
    await drainStream(stream)
    void _byteSize
    return { status: 'clean' }
  }
}

/**
 * Real scanner over clamd's INSTREAM protocol: `zINSTREAM\0`, then one chunk
 * per length-prefixed frame (max 64KiB), closed with an empty frame
 * `\0\0\0\0`. Reply is `stream: OK` or `stream: <signature> FOUND`.
 */
export class ClamAVScanner implements Scanner {
  constructor(
    private readonly host: string,
    private readonly port: number
  ) {}

  async scan(stream: NodeJS.ReadableStream, _byteSize: number): Promise<ScanResult> {
    void _byteSize
    const socket = connect(this.port, this.host)
    socket.setTimeout(30_000)

    const reply = await new Promise<string>((resolve, reject) => {
      let buf = ''
      socket.on('connect', () => socket.write('zINSTREAM\0'))
      socket.on('data', (chunk) => {
        buf += chunk.toString('utf8')
        // clamd terminates an INSTREAM reply with a NUL byte and KEEPS the
        // connection open — resolve on the terminator, then close the socket
        // so the connection does not linger.
        if (buf.includes('\0')) {
          socket.destroy()
          resolve(buf)
        }
      })
      socket.on('error', (err) => {
        void err
        reject(new Error(`clamd unreachable at ${this.host}:${this.port}`))
      })
      socket.on('timeout', () => {
        socket.destroy()
        reject(new Error('clamd scan timeout'))
      })

      const encoder = new Transform({
        transform(frame, _enc, cb) {
          // clamd INSTREAM frame: 4-byte little-endian length + payload.
          const chunk = Buffer.isBuffer(frame) ? frame : Buffer.from(frame)
          if (chunk.length === 0) return cb()
          const size = Buffer.alloc(4)
          size.writeUInt32LE(chunk.length)
          cb(null, Buffer.concat([size, chunk]))
        },
        flush(cb) {
          cb(null, Buffer.alloc(4)) // terminal empty frame
        }
      })

      pipeline(stream, encoder, socket).catch((err: unknown) => {
        reject(err instanceof Error ? err : new Error(String(err)))
      })
    })

    if (reply.includes('FOUND')) {
      const m = reply.match(/:?\s*([^\s:]+)\s+FOUND/)
      return { status: 'infected', signature: m?.[1] }
    }
    if (reply.includes(': OK') || reply.includes('OK')) return { status: 'clean' }
    return { status: 'fail_closed', reason: `unexpected clamd reply: ${reply.trim()}` }
  }
}

async function drainStream(stream: NodeJS.ReadableStream): Promise<void> {
  for await (const chunk of stream) {
    void chunk
    // Consumed so the caller's single-pass hash sees all bytes.
  }
}

export type ScannerEnv = {
  NODE_ENV?: string
  MEDIA_DISABLE_SCAN?: string
  MEDIA_CLAMD_HOST?: string
  MEDIA_CLAMD_PORT?: string
}

/** Factory with the prod-fails-closed invariant (decision above). */
export function createScanner(env: ScannerEnv): Scanner {
  const isProd = env.NODE_ENV === 'production'
  if (isProd) {
    const host = env.MEDIA_CLAMD_HOST
    const portRaw = env.MEDIA_CLAMD_PORT ?? '3310'
    if (host) {
      return new ClamAVScanner(host, Number(portRaw) || 3310)
    }
    // Prod without clamd config: explicit fail-closed, never silent bypass.
    return new FailClosedScanner('MEDIA_CLAMD_HOST not configured in production')
  }
  if (env.MEDIA_DISABLE_SCAN === '1') {
    return new DevPassThroughScanner()
  }
  return new FailClosedScanner()
}
/** Convenience dev/test scanner instance (non-prod only). */
export function devScanner(): Scanner {
  return new DevPassThroughScanner()
}
