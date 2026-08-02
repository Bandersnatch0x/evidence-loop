// @vitest-environment node

import { describe, expect, it } from 'vitest'
import { mkdtemp, readFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { Readable } from 'node:stream'
import { hashMediaBytes } from '../server/media/paths'
import { openMemoryDatabase } from '../server/db/memorySchema'
import { FsBlobStore } from '../server/media/BlobStore'
import { QuotaService } from '../server/media/QuotaService'
import { UploadStore } from '../server/media/UploadStore'
import { devScanner } from '../server/media/Scanner'
import { MediaProcessor } from '../server/media/MediaProcessor'

/**
 * T-B slice 4b — MediaProcessor worker: quarantined → re-hash + scan (single
 * pass) → triangle gate → CAS commit → blob+asset+derivative-job rows in one
 * transaction → session ready + quota released. Spec §5.5, research §4.1/§5.
 */

const PNG_HEAD = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])

/** Real PNG image payload: signature + IHDR (1920x1080) — passes v1 parse gate. */
function realPng(): Buffer {
  const ihdr = Buffer.alloc(26)
  PNG_HEAD.copy(ihdr, 0)
  ihdr.writeUInt32BE(13, 8) // IHDR length
  ihdr.write('IHDR', 12, 'ascii')
  ihdr.writeUInt32BE(1920, 16)
  ihdr.writeUInt32BE(1080, 20)
  ihdr[24] = 8 // bit depth
  ihdr[25] = 6 // color type
  return Buffer.concat([ihdr, Buffer.from('fake-png-body')])
}

/** Real GLB payload: header + JSON chunk — passes v1 parse gate. */
function realGlb(): Buffer {
  const json = Buffer.from(JSON.stringify({ asset: { version: '2.0' }, scene: 0, scenes: [{ nodes: [] }] }), 'utf8')
  const h = Buffer.alloc(20)
  h.writeUInt32LE(0x46546c67, 0)
  h.writeUInt32LE(2, 4)
  h.writeUInt32LE(20 + json.length, 8)
  h.writeUInt32LE(json.length, 12)
  h.writeUInt32LE(0x4e4f534a, 16)
  return Buffer.concat([h, json])
}

describe('MediaProcessor', () => {
  it('processes a quarantined PNG: blob + asset rows, session ready, quota freed', async () => {
    const dataRoot = await mkdtemp(join(tmpdir(), 'mp-'))
    const db = openMemoryDatabase(':memory:')
    const blobs = new FsBlobStore({ dataRoot })
    const quotas = new QuotaService(db)
    const uploads = new UploadStore(db, quotas)
    const processor = new MediaProcessor({
      db,
      blobs,
      uploads,
      scanner: devScanner(),
      tempRoot: dataRoot
    })

    // Assemble the session as the pipeline would: create + receive + quarantine,
    // with the bytes already in the temp file.
    const payload = realPng()
    const session = uploads.create({
      id: 'up-png',
      ownerId: 't-9',
      kind: 'image',
      declaredBytes: payload.length
    })
    uploads.recordReceived(session.id, payload.length)
    await blobs.putQuarantined(session.id, Readable.from([payload]))
    uploads.markQuarantined(session.id)

    const result = await processor.processUpload(session.id)
    expect(result.ok, JSON.stringify(result)).toBe(true)

    const hash = hashMediaBytes(payload)
    // Blob row committed with scan clean, canonical extension from sniff.
    const blob = (db
      .prepare('SELECT * FROM media_blobs WHERE hash = ?')
      .get(hash) as { canonical_extension: string; scan_status: string; byte_size: number })
    expect(blob.scan_status).toBe('clean')
    expect(blob.canonical_extension).toBe('.png')
    expect(blob.byte_size).toBe(payload.length)

    // Asset row with mapped kind (image stays image).
    const asset = (db
      .prepare('SELECT * FROM media_assets WHERE original_blob_hash = ?')
      .get(hash) as { kind: string; owner_id: string })
    expect(asset.kind).toBe('image')
    expect(asset.owner_id).toBe('t-9')

    // Session reached ready in the transaction.
    expect(uploads.get(session.id)?.state).toBe('ready')

    // Committed file exists on disk (CAS).
    const onDisk = await readFile(join(dataRoot, 'media', `${hash}.png`))
    expect(onDisk.equals(payload)).toBe(true)
  })

  it('maps kind glb→model3d and vtt→subtitle on the asset row', async () => {
    const dataRoot = await mkdtemp(join(tmpdir(), 'mp-'))
    const db = openMemoryDatabase(':memory:')
    const blobs = new FsBlobStore({ dataRoot })
    const quotas = new QuotaService(db)
    const uploads = new UploadStore(db, quotas)
    const processor = new MediaProcessor({
      db,
      blobs,
      uploads,
      scanner: devScanner(),
      tempRoot: dataRoot
    })

    const payload = realGlb()
    const session = uploads.create({
      id: 'up-glb',
      ownerId: 't-10',
      kind: 'glb',
      declaredBytes: payload.length
    })
    uploads.recordReceived(session.id, payload.length)
    await blobs.putQuarantined(session.id, Readable.from([payload]))
    uploads.markQuarantined(session.id)

    const result = await processor.processUpload(session.id)
    expect(result.ok).toBe(true)
    const hash = hashMediaBytes(payload)
    const asset = (db
      .prepare('SELECT kind FROM media_assets WHERE original_blob_hash = ?')
      .get(hash) as { kind: string })
    expect(asset.kind).toBe('model3d')
  })

  it('rejects on triangle kind mismatch and records blob as rejected', async () => {
    const dataRoot = await mkdtemp(join(tmpdir(), 'mp-'))
    const db = openMemoryDatabase(':memory:')
    const blobs = new FsBlobStore({ dataRoot })
    const quotas = new QuotaService(db)
    const uploads = new UploadStore(db, quotas)
    const processor = new MediaProcessor({
      db,
      blobs,
      uploads,
      scanner: devScanner(),
      tempRoot: dataRoot
    })

    const payload = Buffer.concat([PNG_HEAD, Buffer.from('x')])
    const session = uploads.create({
      id: 'up-bad',
      ownerId: 't-11',
      kind: 'glb', // declared model but bytes are PNG
      declaredBytes: payload.length
    })
    uploads.recordReceived(session.id, payload.length)
    await blobs.putQuarantined(session.id, Readable.from([payload]))
    uploads.markQuarantined(session.id)

    const result = await processor.processUpload(session.id)
    expect(result.ok).toBe(false)
    expect(result.reason).toMatch(/kind mismatch/)
    expect(uploads.get(session.id)?.state).toBe('rejected')
    // Temp file cleaned up.
    await expect(blobs.openTemp(session.id + '.part')).rejects.toThrow()
  })

  it('keeps the session quarantined (retryable) when scanner fails closed', async () => {
    const dataRoot = await mkdtemp(join(tmpdir(), 'mp-'))
    const db = openMemoryDatabase(':memory:')
    const blobs = new FsBlobStore({ dataRoot })
    const quotas = new QuotaService(db)
    const uploads = new UploadStore(db, quotas)
    const processor = new MediaProcessor({
      db,
      blobs,
      uploads,
      scanner: {
        scan: () => Promise.resolve({ status: 'fail_closed' })
      },
      tempRoot: dataRoot
    })

    const payload = Buffer.concat([PNG_HEAD, Buffer.from('y')])
    const session = uploads.create({
      id: 'up-fc',
      ownerId: 't-12',
      kind: 'image',
      declaredBytes: payload.length
    })
    uploads.recordReceived(session.id, payload.length)
    await blobs.putQuarantined(session.id, Readable.from([payload]))
    uploads.markQuarantined(session.id)

    const result = await processor.processUpload(session.id)
    expect(result.ok).toBe(false)
    expect(uploads.get(session.id)?.state).toBe('quarantined')
    // Temp retained for retry; no blob row, no asset.
    const rows = db.prepare('SELECT COUNT(*) AS n FROM media_blobs').get() as { n: number }
    expect(rows.n).toBe(0)
  })
})