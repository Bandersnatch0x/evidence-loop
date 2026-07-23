/**
 * Browser-local voice conversation history with a hard 24h TTL (ADR-0005 §7).
 *
 * - Stores transcript + reply text only (never raw audio).
 * - Every row carries `expiresAt = createdAt + 24h`.
 * - Call `purgeExpiredVoiceHistory` on app start and `beforeunload`.
 */

export const VOICE_HISTORY_DB_NAME = 'evidence-loop-voice'
export const VOICE_HISTORY_STORE = 'conversations'
export const VOICE_HISTORY_DB_VERSION = 1
/** 24 hours in milliseconds. */
export const VOICE_HISTORY_TTL_MS = 24 * 60 * 60 * 1000

export interface VoiceHistoryEntry {
  id: string
  transcript: string
  reply: string
  createdAt: number
  expiresAt: number
}

function openDatabase(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    if (typeof indexedDB === 'undefined') {
      reject(new Error('IndexedDB is not available in this environment'))
      return
    }
    const request = indexedDB.open(VOICE_HISTORY_DB_NAME, VOICE_HISTORY_DB_VERSION)
    request.onerror = () => {
      reject(request.error ?? new Error('Failed to open voice history database'))
    }
    request.onsuccess = () => {
      resolve(request.result)
    }
    request.onupgradeneeded = () => {
      const db = request.result
      if (!db.objectStoreNames.contains(VOICE_HISTORY_STORE)) {
        const store = db.createObjectStore(VOICE_HISTORY_STORE, { keyPath: 'id' })
        store.createIndex('expiresAt', 'expiresAt', { unique: false })
      }
    }
  })
}

function requestToPromise<T>(request: IDBRequest<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    request.onsuccess = () => resolve(request.result)
    request.onerror = () => {
      reject(request.error ?? new Error('IndexedDB request failed'))
    }
  })
}

/**
 * Register completion handlers immediately after creating the transaction
 * (before awaiting any request) so auto-commit cannot race past the handler.
 */
function transactionDone(tx: IDBTransaction): Promise<void> {
  return new Promise((resolve, reject) => {
    tx.oncomplete = () => resolve()
    tx.onerror = () => {
      reject(tx.error ?? new Error('IndexedDB transaction failed'))
    }
    tx.onabort = () => {
      reject(tx.error ?? new Error('IndexedDB transaction aborted'))
    }
  })
}

/** Persist one conversation turn with a 24h expiry. No-ops when IDB is missing. */
export async function saveVoiceHistoryEntry(
  entry: Omit<VoiceHistoryEntry, 'id' | 'createdAt' | 'expiresAt'> & {
    id?: string
    createdAt?: number
  }
): Promise<VoiceHistoryEntry | undefined> {
  if (typeof indexedDB === 'undefined') return undefined

  const createdAt = entry.createdAt ?? Date.now()
  const record: VoiceHistoryEntry = {
    id: entry.id ?? `voice_${String(createdAt)}_${Math.random().toString(36).slice(2, 10)}`,
    transcript: entry.transcript,
    reply: entry.reply,
    createdAt,
    expiresAt: createdAt + VOICE_HISTORY_TTL_MS
  }

  const db = await openDatabase()
  try {
    const tx = db.transaction(VOICE_HISTORY_STORE, 'readwrite')
    const done = transactionDone(tx)
    tx.objectStore(VOICE_HISTORY_STORE).put(record)
    await done
    return record
  } finally {
    db.close()
  }
}

/** Return all non-expired entries (does not mutate the store). */
export async function listVoiceHistory(
  now: number = Date.now()
): Promise<VoiceHistoryEntry[]> {
  if (typeof indexedDB === 'undefined') return []

  const db = await openDatabase()
  try {
    const tx = db.transaction(VOICE_HISTORY_STORE, 'readonly')
    const done = transactionDone(tx)
    const all = await requestToPromise(
      tx.objectStore(VOICE_HISTORY_STORE).getAll() as IDBRequest<VoiceHistoryEntry[]>
    )
    await done
    return all.filter((entry) => entry.expiresAt > now)
  } finally {
    db.close()
  }
}

/**
 * Delete every entry whose `expiresAt` is at or before `now`.
 * Returns the number of removed rows.
 *
 * Two transactions on purpose: awaiting `getAll` can auto-commit a live
 * readwrite txn in real browsers, so deletes run in a separate write txn.
 */
export async function purgeExpiredVoiceHistory(
  now: number = Date.now()
): Promise<number> {
  if (typeof indexedDB === 'undefined') return 0

  const db = await openDatabase()
  try {
    const readTx = db.transaction(VOICE_HISTORY_STORE, 'readonly')
    const readDone = transactionDone(readTx)
    const all = await requestToPromise(
      readTx.objectStore(VOICE_HISTORY_STORE).getAll() as IDBRequest<
        VoiceHistoryEntry[]
      >
    )
    await readDone

    const expiredIds = all
      .filter((entry) => entry.expiresAt <= now)
      .map((entry) => entry.id)
    if (expiredIds.length === 0) return 0

    const writeTx = db.transaction(VOICE_HISTORY_STORE, 'readwrite')
    const writeDone = transactionDone(writeTx)
    const writeStore = writeTx.objectStore(VOICE_HISTORY_STORE)
    for (const id of expiredIds) {
      writeStore.delete(id)
    }
    await writeDone
    return expiredIds.length
  } finally {
    db.close()
  }
}

/** Test helper: wipe the entire object store. */
export async function clearVoiceHistoryForTest(): Promise<void> {
  if (typeof indexedDB === 'undefined') return
  const db = await openDatabase()
  try {
    const tx = db.transaction(VOICE_HISTORY_STORE, 'readwrite')
    const done = transactionDone(tx)
    tx.objectStore(VOICE_HISTORY_STORE).clear()
    await done
  } finally {
    db.close()
  }
}
