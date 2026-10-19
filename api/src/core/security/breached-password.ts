import { createHash } from 'node:crypto'

export interface BreachedPasswordCheckerOptions {
  /** e.g. `https://api.pwnedpasswords.com`; a local stand-in in tests. */
  baseUrl: string
  timeoutMs: number
}

/**
 * `true` = seen in a breach, `false` = not seen, `null` = couldn't tell (service down, slow,
 * unexpected answer). The caller decides what `null` means; auth fails open (rule 11).
 */
export type BreachedPasswordChecker = (password: string) => Promise<boolean | null>

/**
 * HIBP Pwned Passwords range API (k-anonymity): only the first 5 hex chars of the SHA-1 leave the
 * process, and `Add-Padding` hides the real size of the answer.
 */
export const createPwnedPasswordsChecker =
  ({ baseUrl, timeoutMs }: BreachedPasswordCheckerOptions): BreachedPasswordChecker =>
  async (password) => {
    const digest = createHash('sha1').update(password).digest('hex').toUpperCase()
    const prefix = digest.slice(0, 5)
    const suffix = digest.slice(5)
    try {
      const response = await fetch(`${baseUrl.replace(/\/$/, '')}/range/${prefix}`, {
        headers: { 'Add-Padding': 'true' },
        signal: AbortSignal.timeout(timeoutMs),
      })
      if (!response.ok) {
        return null
      }
      const body = await response.text()
      // Lines are `SUFFIX:COUNT`; padding lines have a count of 0.
      return body.split('\n').some((line) => {
        const [lineSuffix, count] = line.trim().split(':')
        return lineSuffix === suffix && Number(count) > 0
      })
    } catch {
      return null
    }
  }

/** `PASSWORD_BREACH_CHECK=off`: nothing is ever reported as breached. */
export const skipBreachCheck: BreachedPasswordChecker = async () => false
