/**
 * BlobStore contract (research §3.2) + FsBlobStore v1 implementation.
 *
 * Content-addressed storage seam: the domain stores `storageKey` (relative
 * `media/<sha256>.<ext>` per paths.ts) and never touches the filesystem
 * layout. Production swaps FsBlobStore for an S3BlobStore without changing
 * business code (ticket 03).
 *
 * Upload lifecycle: bytes land in a quarantined temp file
 * (`data/uploads/<uploadId>.part`) → verified/hashed/parsed → atomic
 * `commitByHash` into `data/media/<hash>.<ext>`. Blobs are immutable; a
 * commit is only valid once per hash (CAS write, fail-closed on collision).
 */
import { createWriteStream, readdirSync } from 'node:fs'
import { mkdir, rename, stat, unlink } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import { pipeline } from 'node:stream/promises'
import { createReadStream } from 'node:fs'
import {
  assertMediaPathSafe,
  mediaAbsolutePath,
  mediaRelativePath
} from './paths'

export interface TempObject {
  /** Key into the quarantined temp area (upload session id based). */
  tempKey: string
  /** Absolute path of the temp file. */
  absolutePath: string
  /** Bytes accepted so far (server-counted, not client-declared). */
  receivedBytes: number
}

export interface StoredBlob {
  hash: string
  /** Relative `media/<hash>.<ext>` per paths.ts contract. */
  storageKey: string
  byteSize: number
}

export interface BlobStat {
  hash: string
  storageKey: string
  byteSize: number
}

export interface ByteRange {
  start: number
  end?: number
}

export interface BlobStore {
  /** Stream upload bytes into a quarantined temp file under the given key. */
  putQuarantined(uploadId: string, source: NodeJS.ReadableStream): Promise<TempObject>
  /**
   * Append a chunk to an existing quarantined temp file (tus PATCH). Returns
   * bytes written. Creates the file when absent.
   */
  appendQuarantined(uploadId: string, source: NodeJS.ReadableStream): Promise<number>
  /** Open a quarantined temp file for verification reads. */
  openTemp(tempKey: string): Promise<NodeJS.ReadableStream>
  /** Atomic CAS commit: temp → data/media/<hash>.<ext>. */
  commitByHash(
    tempKey: string,
    hash: string,
    extension: string
  ): Promise<StoredBlob>
  /** Open a committed blob, optionally byte-ranged. */
  open(hash: string, range?: ByteRange): Promise<NodeJS.ReadableStream>
  stat(hash: string): Promise<BlobStat | null>
  delete(hash: string): Promise<void>
  /** Remove a quarantined temp file (cancel / expiry / failure). */
  discardTemp(tempKey: string): Promise<void>
}

export interface FsBlobStoreOptions {
  /** Project data root (e.g. `data/`); media lives under `data/media/`. */
  dataRoot: string
}

/**
 * v1 blob store on the local filesystem. Layout:
 *   data/uploads/<uploadId>.part      — quarantined temp
 *   data/media/<sha256>.<ext>         — immutable CAS blobs (paths.ts)
 */
export class FsBlobStore implements BlobStore {
  private readonly dataRoot: string
  private readonly mediaDir: string
  private readonly uploadsDir: string

  constructor(options: FsBlobStoreOptions) {
    this.dataRoot = options.dataRoot
    this.mediaDir = join(this.dataRoot, 'media')
    this.uploadsDir = join(this.dataRoot, 'uploads')
  }

  async putQuarantined(
    uploadId: string,
    source: NodeJS.ReadableStream
  ): Promise<TempObject> {
    await mkdir(this.uploadsDir, { recursive: true })
    const absolutePath = join(this.uploadsDir, `${sanitizeKey(uploadId)}.part`)
    const sink = createWriteStream(absolutePath, { flags: 'w' })
    let receivedBytes = 0
    source.on('data', (chunk: Buffer | string) => {
      receivedBytes += Buffer.byteLength(chunk)
    })
    await pipeline(source, sink)
    return { tempKey: `${uploadId}.part`, absolutePath, receivedBytes }
  }

  async appendQuarantined(
    uploadId: string,
    source: NodeJS.ReadableStream
  ): Promise<number> {
    await mkdir(this.uploadsDir, { recursive: true })
    const absolutePath = join(this.uploadsDir, `${sanitizeKey(uploadId)}.part`)
    const sink = createWriteStream(absolutePath, { flags: 'a' })
    let written = 0
    source.on('data', (chunk: Buffer | string) => {
      written += Buffer.byteLength(chunk)
    })
    await pipeline(source, sink)
    return written
  }

  async openTemp(tempKey: string): Promise<NodeJS.ReadableStream> {
    const absolutePath = join(this.uploadsDir, sanitizeKey(tempKey))
    await stat(absolutePath)
    return createReadStream(absolutePath)
  }

  async commitByHash(
    tempKey: string,
    hash: string,
    extension: string
  ): Promise<StoredBlob> {
    // Validate + resolve target under data/media (throws on traversal/format).
    const relative = mediaRelativePath(hash, extension)
    const target = assertMediaPathSafe(this.dataRoot, relative)
    await mkdir(dirname(target), { recursive: true })

    const source = join(this.uploadsDir, sanitizeKey(tempKey))
    const sourceStat = await stat(source)
    // CAS write: refuse to overwrite an existing blob (immutable content
    // addressing). Explicit exists-check keeps semantics identical across
    // platforms (POSIX rename overwrites silently; Windows throws EEXIST).
    try {
      await stat(target)
      throw new Error(`Media blob already exists: ${hash}`)
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code !== 'ENOENT') {
        throw err
      }
    }
    // Atomic move into the CAS location.
    await rename(source, target)
    return {
      hash,
      storageKey: relative.replace(/\\/g, '/'),
      byteSize: sourceStat.size
    }
  }

  async open(hash: string, range?: ByteRange): Promise<NodeJS.ReadableStream> {
    const absolutePath = this.absoluteFor(hash)
    const info = await stat(absolutePath)
    if (!range) return createReadStream(absolutePath)
    const start = Math.max(0, range.start)
    const end =
      range.end === undefined ? info.size - 1 : Math.min(range.end, info.size - 1)
    return createReadStream(absolutePath, { start, end })
  }

  async stat(hash: string): Promise<BlobStat | null> {
    try {
      const absolutePath = this.absoluteFor(hash)
      const info = await stat(absolutePath)
      const ext = extFromName(absolutePath)
      const relative = mediaRelativePath(hash, ext)
      return { hash, storageKey: relative.replace(/\\/g, '/'), byteSize: info.size }
    } catch {
      return null
    }
  }

  async delete(hash: string): Promise<void> {
    const absolutePath = this.absoluteFor(hash)
    await unlink(absolutePath)
  }

  async discardTemp(tempKey: string): Promise<void> {
    const absolutePath = join(this.uploadsDir, sanitizeKey(tempKey))
    try {
      await unlink(absolutePath)
    } catch {
      // Already gone — fine.
    }
  }

  /** Absolute path for a committed blob, resolving extension from disk. */
  private absoluteFor(hash: string): string {
    // Locate the committed file by hash prefix in the media dir. The CAS
    // layout is `media/<sha256>.<ext>`; extension is recovered from disk
    // because the store contract addresses blobs by hash only.
    const dir = this.mediaDir
    const entries = readdirSync(dir)
    const match = entries.find((entry) => entry.startsWith(hash + '.'))
    return match ? join(dir, match) : mediaAbsolutePath(this.dataRoot, hash, '.bin')
  }
}

function sanitizeKey(key: string): string {
  // Upload ids / temp keys are server-generated (UUID) - never user input.
  if (!/^[a-zA-Z0-9._-]+$/.test(key)) {
    throw new Error(`Unsafe temp key: ${key}`)
  }
  return key
}

/** Pull the extension off a committed filename (e.g. `<hash>.glb` -> `.glb`). */
function extFromName(absolutePath: string): string {
  const base = absolutePath.split(/[\\/]/).pop() ?? ''
  const dot = base.lastIndexOf('.')
  return dot >= 0 ? base.slice(dot) : '.bin'
}
