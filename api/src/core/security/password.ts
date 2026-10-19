import { hash, verify } from '@node-rs/argon2'

// Argon2id at the OWASP baseline (auth spec rule 10). Raise these and stored hashes are upgraded
// on the next successful sign-in (`passwordNeedsRehash`).
const ARGON2ID = 2 // `Algorithm.Argon2id`; the package's const enum can't be imported under tsx
export const PASSWORD_HASH_OPTIONS = {
  algorithm: ARGON2ID,
  memoryCost: 19 * 1024, // KiB
  timeCost: 2,
  parallelism: 1,
} as const

/** Argon2id PHC string (`$argon2id$v=19$m=…,t=…,p=…$salt$hash`). */
export const hashPassword = async (password: string): Promise<string> =>
  hash(password, PASSWORD_HASH_OPTIONS)

/** `false` for a wrong password and for a hash that can't be parsed. */
export const verifyPassword = async (passwordHash: string, password: string): Promise<boolean> =>
  verify(passwordHash, password).catch(() => false)

const { memoryCost, timeCost, parallelism } = PASSWORD_HASH_OPTIONS
const CURRENT_PREFIX = `$argon2id$v=19$m=${memoryCost},t=${timeCost},p=${parallelism}$`

/** `true` when the stored hash used other parameters than today's (rule 10). */
export const passwordNeedsRehash = (passwordHash: string): boolean =>
  !passwordHash.startsWith(CURRENT_PREFIX)

// A well-formed hash with today's parameters that no password matches (all-zero salt and
// digest). Checking against it costs the same as a real check, with no hashing at start-up.
const DUMMY_HASH = `${CURRENT_PREFIX}${'A'.repeat(22)}$${'A'.repeat(43)}`

/**
 * Spends the same time as a real check when there is no hash to check against (unknown email or
 * no password set), so timing doesn't tell the cases apart (rule 12). Always `false`.
 */
export const verifyDummyPassword = async (password: string): Promise<false> => {
  await verifyPassword(DUMMY_HASH, password)
  return false
}
