/**
 * The encryption of the local database (offline-sync rule 4), on WebCrypto only:
 * - a random AES-GCM 256 **data key** encrypts the snapshot, a fresh 12-byte IV per save;
 * - the data key is stored only **wrapped** (AES-KW) by a key derived from the PIN with
 *   PBKDF2-SHA256 and a random salt. A wrong PIN makes the unwrap fail, so no PIN hash is stored.
 */

export const PBKDF2_ITERATIONS = 600_000

const IV_BYTES = 12
const SALT_BYTES = 16
/** Binds every snapshot to this format, so bytes from anywhere else never decrypt. */
const SNAPSHOT_AAD = new TextEncoder().encode('tpn-vault-v1')

export interface WrappedKey {
  salt: Uint8Array<ArrayBuffer>
  iterations: number
  wrapped: ArrayBuffer
}

export interface Sealed {
  iv: Uint8Array<ArrayBuffer>
  data: ArrayBuffer
}

const pinKey = async (pin: string, salt: BufferSource, iterations: number): Promise<CryptoKey> => {
  const base = await crypto.subtle.importKey(
    'raw',
    new TextEncoder().encode(pin),
    'PBKDF2',
    false,
    ['deriveKey']
  )
  return crypto.subtle.deriveKey(
    { name: 'PBKDF2', hash: 'SHA-256', salt, iterations },
    base,
    { name: 'AES-KW', length: 256 },
    false,
    ['wrapKey', 'unwrapKey']
  )
}

/** A new data key. Extractable only so it can be wrapped; it never leaves memory unwrapped. */
export const createDataKey = async (): Promise<CryptoKey> =>
  crypto.subtle.generateKey({ name: 'AES-GCM', length: 256 }, true, ['encrypt', 'decrypt'])

export const wrapDataKey = async (
  dataKey: CryptoKey,
  pin: string,
  iterations = PBKDF2_ITERATIONS
): Promise<WrappedKey> => {
  const salt = crypto.getRandomValues(new Uint8Array(SALT_BYTES))
  const wrapped = await crypto.subtle.wrapKey(
    'raw',
    dataKey,
    await pinKey(pin, salt, iterations),
    'AES-KW'
  )
  return { salt, iterations, wrapped }
}

/** The data key, or `null` when the PIN is wrong. */
export const unwrapDataKey = async (key: WrappedKey, pin: string): Promise<CryptoKey | null> => {
  const kek = await pinKey(pin, key.salt, key.iterations)
  try {
    return await crypto.subtle.unwrapKey('raw', key.wrapped, kek, 'AES-KW', 'AES-GCM', true, [
      'encrypt',
      'decrypt',
    ])
  } catch {
    return null
  }
}

export const seal = async (dataKey: CryptoKey, bytes: Uint8Array<ArrayBuffer>): Promise<Sealed> => {
  const iv = crypto.getRandomValues(new Uint8Array(IV_BYTES))
  const data = await crypto.subtle.encrypt(
    { name: 'AES-GCM', iv, additionalData: SNAPSHOT_AAD },
    dataKey,
    bytes
  )
  return { iv, data }
}

export const unseal = async (
  dataKey: CryptoKey,
  sealed: Sealed
): Promise<Uint8Array<ArrayBuffer>> =>
  new Uint8Array(
    await crypto.subtle.decrypt(
      { name: 'AES-GCM', iv: sealed.iv, additionalData: SNAPSHOT_AAD },
      dataKey,
      sealed.data
    )
  )
