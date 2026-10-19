import { createHash, createHmac, randomBytes, randomInt, timingSafeEqual } from 'node:crypto'

// Building blocks for secrets that are only ever stored as hashes (auth spec rule 18).

/** URL-safe random token: 32 bytes → 43 base64url characters (magic links, refresh tokens). */
export const randomToken = (bytes = 32): string => randomBytes(bytes).toString('base64url')

/** Uniformly random numeric code, zero-padded (`crypto.randomInt`, no modulo bias). */
export const randomCode = (digits = 6): string =>
  randomInt(0, 10 ** digits)
    .toString()
    .padStart(digits, '0')

/** SHA-256 hex. Fine for high-entropy values (random tokens), never for a short code. */
export const sha256 = (value: string): string => createHash('sha256').update(value).digest('hex')

/**
 * HMAC-SHA256 hex with a server secret. Short codes are hashed with this, because a plain hash of
 * a 6-digit code is reversed offline in a moment.
 */
export const createKeyedHasher =
  (secret: string) =>
  (value: string): string =>
    createHmac('sha256', secret).update(value).digest('hex')

/** Constant-time comparison of two hex digests. */
export const safeEqualHex = (a: string, b: string): boolean => {
  const left = Buffer.from(a, 'hex')
  const right = Buffer.from(b, 'hex')
  return left.length === right.length && timingSafeEqual(left, right)
}
