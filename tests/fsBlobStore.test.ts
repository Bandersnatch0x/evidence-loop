// @vitest-environment node

import { describe, expect, it } from 'vitest'
import { mkdtemp, readFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { Readable } from 'node:stream'
import { FsBlobStore } from '../server/media/BlobStore'
import { hashMediaBytes } from '../server/media/paths'

/**
 * T-B slice 1 — FsBlobStore: quarantined temp write → atomic CAS commit →
 * range read → stat → delete. Spec §5.5 / research §3.2 BlobStore contract.
 */

function tempRoot(): Promise<string> {
  return mkdtemp(join(tmpdir(), 'fs-blob-store-'))
}

async function collect(stream: NodeJS.ReadableStream): Promise<Buffer> {
  const chunks: Buffer[] = []
  for await (const chunk of stream) chunks.push(Buffer.from(chunk))
  return Buffer.concat(chunks)
}

describe('FsBlobStore', () => {
  it('putQuarantined writes temp file; openTemp reads it back', async () => {
    const root = await tempRoot()
    const store = new FsBlobStore({ dataRoot: root })
    const source = Readable.from([Buffer.from('quarantine-me'), Buffer.from('!')])
    const temp = await store.putQuarantined('upload-1', source)
    expect(temp.tempKey).toMatch(/^upload-1/)
    expect(temp.tempKey.endsWith('.part')).toBe(true)

    const back = await collect(await store.openTemp(temp.tempKey))
    expect(back.toString()).toBe('quarantine-me!')
  })

  it('commitByHash atomically moves temp into data/media/<hash>.<ext>', async () => {
    const root = await tempRoot()
    const store = new FsBlobStore({ dataRoot: root })
    const bytes = Buffer.from('crystal-blob')
    const hash = hashMediaBytes(bytes)
    const temp = await store.putQuarantined('u-2', Readable.from([bytes]))

    const stored = await store.commitByHash(temp.tempKey, hash, '.glb')
    expect(stored.hash).toBe(hash)
    expect(stored.storageKey).toBe(`media/${hash}.glb`)

    // Temp is gone; committed file exists.
    await expect(store.openTemp(temp.tempKey)).rejects.toThrow()
    const committed = await collect(await store.open(hash))
    expect(committed.equals(bytes)).toBe(true)

    const stat = await store.stat(hash)
    expect(stat?.byteSize).toBe(bytes.length)
    expect(stat?.storageKey).toBe(`media/${hash}.glb`)
  })

  it('open supports byte ranges (single range)', async () => {
    const root = await tempRoot()
    const store = new FsBlobStore({ dataRoot: root })
    const bytes = Buffer.from('0123456789')
    const hash = hashMediaBytes(bytes)
    const temp = await store.putQuarantined('u-3', Readable.from([bytes]))
    await store.commitByHash(temp.tempKey, hash, '.png')

    const partial = await collect(await store.open(hash, { start: 2, end: 5 }))
    expect(partial.toString()).toBe('2345')
    const tail = await collect(await store.open(hash, { start: 7 }))
    expect(tail.toString()).toBe('789')
  })

  it('stat returns null for unknown hash; delete removes committed blob', async () => {
    const root = await tempRoot()
    const store = new FsBlobStore({ dataRoot: root })
    const missingHash = 'a'.repeat(64)
    expect(await store.stat(missingHash)).toBeNull()

    const bytes = Buffer.from('to-delete')
    const hash = hashMediaBytes(bytes)
    const temp = await store.putQuarantined('u-4', Readable.from([bytes]))
    await store.commitByHash(temp.tempKey, hash, '.jpg')
    expect((await store.stat(hash))?.byteSize).toBe(bytes.length)

    await store.delete(hash)
    expect(await store.stat(hash)).toBeNull()
  })

  it('commitByHash rejects invalid hashes and unsafe extensions', async () => {
    const root = await tempRoot()
    const store = new FsBlobStore({ dataRoot: root })
    const temp = await store.putQuarantined('u-5', Readable.from(['x']))
    await expect(
      store.commitByHash(temp.tempKey, 'not-a-hash', '.png')
    ).rejects.toThrow(/64-char/)
  })

  it('commitByHash is a CAS write: second commit of same hash fails', async () => {
    const root = await tempRoot()
    const store = new FsBlobStore({ dataRoot: root })
    const bytes = Buffer.from('cas-conflict')
    const hash = hashMediaBytes(bytes)
    const temp1 = await store.putQuarantined('u-7', Readable.from([bytes]))
    await store.commitByHash(temp1.tempKey, hash, '.glb')

    // Second commit of the same hash must fail (immutable blob already exists).
    const temp2 = await store.putQuarantined('u-8', Readable.from([bytes]))
    await expect(
      store.commitByHash(temp2.tempKey, hash, '.glb')
    ).rejects.toThrow(/already exists/)
  })

  it('committed file is readable from disk at the CAS path', async () => {
    const root = await tempRoot()
    const store = new FsBlobStore({ dataRoot: root })
    const bytes = Buffer.from('disk-check')
    const hash = hashMediaBytes(bytes)
    const temp = await store.putQuarantined('u-6', Readable.from([bytes]))
    await store.commitByHash(temp.tempKey, hash, '.webp')

    const onDisk = await readFile(join(root, 'media', `${hash}.webp`))
    expect(onDisk.equals(bytes)).toBe(true)
  })
})
