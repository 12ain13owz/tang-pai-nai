import type { Sealed, WrappedKey } from './vault-crypto'

/**
 * What the lock screen needs before the PIN, kept in clear (offline-sync → Data model → Device).
 * Nothing in it is user data except the name the lock screen greets.
 */
export interface VaultMeta {
  userId: string
  displayName: string
  key: WrappedKey
  /** Wrong PINs in a row (rule 3); a right one resets it. */
  failedAttempts: number
}

const DB_NAME = 'tpn-vault'
const STORE = 'vault'
const META = 'meta'
const SNAPSHOT = 'snapshot'

const request = async <T>(req: IDBRequest<T>): Promise<T> =>
  new Promise((resolve, reject) => {
    req.onsuccess = () => resolve(req.result)
    req.onerror = () => reject(req.error ?? new Error('IndexedDB request failed'))
  })

const open = async (): Promise<IDBDatabase> => {
  const req = indexedDB.open(DB_NAME, 1)
  req.onupgradeneeded = () => req.result.createObjectStore(STORE)
  return request(req)
}

const run = async <T>(
  mode: IDBTransactionMode,
  work: (store: IDBObjectStore) => IDBRequest<T> | undefined
): Promise<T | undefined> => {
  const db = await open()
  try {
    const tx = db.transaction(STORE, mode)
    const req = work(tx.objectStore(STORE))
    const done = new Promise<void>((resolve, reject) => {
      tx.oncomplete = () => resolve()
      tx.onerror = () => reject(tx.error ?? new Error('IndexedDB transaction failed'))
      tx.onabort = () => reject(tx.error ?? new Error('IndexedDB transaction aborted'))
    })
    const result = req ? await request(req) : undefined
    await done
    return result
  } finally {
    db.close()
  }
}

/** The vault in IndexedDB: the clear-text meta and the one encrypted snapshot. */
export const vaultStorage = {
  async readMeta(): Promise<VaultMeta | null> {
    return ((await run('readonly', (store) => store.get(META))) as VaultMeta | undefined) ?? null
  },

  async readSnapshot(): Promise<Sealed | null> {
    return ((await run('readonly', (store) => store.get(SNAPSHOT))) as Sealed | undefined) ?? null
  },

  async writeMeta(meta: VaultMeta): Promise<void> {
    await run('readwrite', (store) => store.put(meta, META))
  },

  async writeSnapshot(snapshot: Sealed): Promise<void> {
    await run('readwrite', (store) => store.put(snapshot, SNAPSHOT))
  },

  /** Meta and snapshot in one transaction, so a new vault is never half written. */
  async create(meta: VaultMeta, snapshot: Sealed): Promise<void> {
    await run('readwrite', (store) => {
      store.put(meta, META)
      return store.put(snapshot, SNAPSHOT)
    })
  },

  /** Deletes the whole database (rules 3 and 7). */
  async wipe(): Promise<void> {
    await new Promise<void>((resolve, reject) => {
      const req = indexedDB.deleteDatabase(DB_NAME)
      req.onsuccess = () => resolve()
      req.onerror = () => reject(req.error ?? new Error('IndexedDB delete failed'))
      // Another tab still has it open: it closes after each call, so this only waits briefly.
      req.onblocked = () => undefined
    })
  },
}

export type VaultStorage = typeof vaultStorage
