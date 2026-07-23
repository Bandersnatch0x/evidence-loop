/**
 * @vitest-environment jsdom
 *
 * Minimal in-memory IndexedDB shim for ADR-0005 §7 24h TTL history tests.
 * Completes transactions on the next macrotask so request handlers register first.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import {
  clearVoiceHistoryForTest,
  listVoiceHistory,
  purgeExpiredVoiceHistory,
  saveVoiceHistoryEntry,
  VOICE_HISTORY_STORE,
  VOICE_HISTORY_TTL_MS
} from '../src/lib/voiceHistoryStore'

type Row = Record<string, unknown>

function installFakeIndexedDB(): void {
  const data = new Map<string, Row>()

  class Request<T> {
    public result: T | undefined
    public error: DOMException | null = null
    public onsuccess: ((ev: Event) => void) | null = null
    public onerror: ((ev: Event) => void) | null = null
    public onupgradeneeded: ((ev: IDBVersionChangeEvent) => void) | null = null

    public succeed(value: T): void {
      this.result = value
      // Prefer macrotask so callers can assign onsuccess first.
      setTimeout(() => {
        this.onsuccess?.(new Event('success'))
      }, 0)
    }
  }

  class ObjectStore {
    public put(value: Row): Request<IDBValidKey> {
      const id = String(value.id)
      data.set(id, { ...value })
      const req = new Request<IDBValidKey>()
      req.succeed(id)
      return req
    }

    public getAll(): Request<Row[]> {
      const req = new Request<Row[]>()
      req.succeed([...data.values()].map((row) => ({ ...row })))
      return req
    }

    public delete(key: IDBValidKey): Request<undefined> {
      const id = typeof key === 'string' || typeof key === 'number'
        ? String(key)
        : JSON.stringify(key)
      data.delete(id)
      const req = new Request<undefined>()
      req.succeed(undefined)
      return req
    }

    public clear(): Request<undefined> {
      data.clear()
      const req = new Request<undefined>()
      req.succeed(undefined)
      return req
    }

    public createIndex(): unknown {
      return {}
    }
  }

  class Transaction {
    public error: DOMException | null = null
    public oncomplete: ((ev: Event) => void) | null = null
    public onerror: ((ev: Event) => void) | null = null
    public onabort: ((ev: Event) => void) | null = null

    public constructor() {
      // Fire after request success macrotasks so oncomplete is already assigned.
      setTimeout(() => {
        this.oncomplete?.(new Event('complete'))
      }, 0)
    }

    public objectStore(): ObjectStore {
      return new ObjectStore()
    }
  }

  class Database {
    public objectStoreNames = {
      contains: (name: string) => name === VOICE_HISTORY_STORE
    }

    public createObjectStore(): ObjectStore {
      return new ObjectStore()
    }

    public transaction(): Transaction {
      return new Transaction()
    }

    public close(): void {
      // no-op
    }
  }

  const open = (): Request<Database> => {
    const req = new Request<Database>()
    const db = new Database()
    setTimeout(() => {
      req.result = db
      req.onupgradeneeded?.(
        { target: req } as unknown as IDBVersionChangeEvent
      )
      req.succeed(db)
    }, 0)
    return req
  }

  vi.stubGlobal('indexedDB', { open })
}

describe('voiceHistoryStore 24h TTL', () => {
  beforeEach(() => {
    installFakeIndexedDB()
  })

  afterEach(async () => {
    try {
      await clearVoiceHistoryForTest()
    } catch {
      // ignore cleanup errors from a broken fake
    }
    vi.unstubAllGlobals()
    vi.restoreAllMocks()
  })

  it('stores each turn with expiresAt = createdAt + 24h', async () => {
    const now = 1_700_000_000_000
    vi.spyOn(Date, 'now').mockReturnValue(now)

    const saved = await saveVoiceHistoryEntry({
      transcript: '哪里错了？',
      reply: '看空列表边界。'
    })

    expect(saved).toBeDefined()
    if (saved === undefined) throw new Error('expected saved entry')
    expect(saved.createdAt).toBe(now)
    expect(saved.expiresAt).toBe(now + VOICE_HISTORY_TTL_MS)
    expect(saved.transcript).toBe('哪里错了？')
  })

  it('purges expired entries and keeps live ones', async () => {
    const t0 = 1_700_000_000_000
    await saveVoiceHistoryEntry({
      id: 'old',
      transcript: '过期提问',
      reply: '旧回复',
      createdAt: t0
    })
    await saveVoiceHistoryEntry({
      id: 'fresh',
      transcript: '新提问',
      reply: '新回复',
      createdAt: t0 + VOICE_HISTORY_TTL_MS - 1_000
    })

    const removed = await purgeExpiredVoiceHistory(t0 + VOICE_HISTORY_TTL_MS + 1)
    expect(removed).toBe(1)

    const remaining = await listVoiceHistory(t0 + VOICE_HISTORY_TTL_MS + 1)
    expect(remaining).toHaveLength(1)
    expect(remaining[0]?.id).toBe('fresh')
  })
})
