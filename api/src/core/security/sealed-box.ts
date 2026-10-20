import { EncryptJWT, errors, jwtDecrypt } from 'jose'
import { hkdfSync } from 'node:crypto'
import type { JWTPayload } from 'jose'

/**
 * Short-lived state the server hands to the browser and reads back (e.g. the Google sign-in
 * round trip, auth spec rule 14): an encrypted, authenticated JWE (`dir` + `A256GCM`), so the
 * browser can neither read nor change it. The key is derived from `secret` and `purpose`, so one
 * secret serves several boxes that can't open each other's contents.
 */
export const createSealedBox = (secret: string, purpose: string) => {
  const key = new Uint8Array(hkdfSync('sha256', secret, '', `tang-pai-nai:${purpose}`, 32))

  const seal = async (payload: JWTPayload, ttlSeconds: number): Promise<string> =>
    new EncryptJWT(payload)
      .setProtectedHeader({ alg: 'dir', enc: 'A256GCM' })
      .setIssuedAt()
      .setExpirationTime(`${ttlSeconds}s`)
      .encrypt(key)

  /** The payload, or `null` when the value is malformed, tampered with or expired. */
  const open = async (sealed: string): Promise<JWTPayload | null> => {
    try {
      const { payload } = await jwtDecrypt(sealed, key, {
        keyManagementAlgorithms: ['dir'],
        contentEncryptionAlgorithms: ['A256GCM'],
      })
      return payload
    } catch (error) {
      if (error instanceof errors.JOSEError) {
        return null
      }
      throw error
    }
  }

  return { seal, open }
}

export type SealedBox = ReturnType<typeof createSealedBox>
