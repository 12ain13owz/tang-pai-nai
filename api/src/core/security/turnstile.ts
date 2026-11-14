export interface TurnstileVerifierOptions {
  secretKey: string
  timeoutMs: number
  /** Cloudflare's siteverify endpoint; a local stand-in in tests. */
  verifyUrl?: string
}

/**
 * `true` = Cloudflare vouches for the token, `false` = it doesn't (missing, forged, expired or
 * already used), `null` = couldn't tell (Cloudflare down, slow, or an internal error). The caller
 * decides what `null` means; auth fails open (rule 32).
 */
export type HumanVerifier = (token: string, remoteIp?: string) => Promise<boolean | null>

export const TURNSTILE_VERIFY_URL = 'https://challenges.cloudflare.com/turnstile/v0/siteverify'

/** Tokens are at most 2048 characters (Cloudflare's docs); anything longer is refused unseen. */
const MAX_TOKEN_LENGTH = 2048

interface SiteverifyAnswer {
  success?: unknown
  'error-codes'?: unknown
}

/** Cloudflare Turnstile's server-side check. Each token is valid once, for 300 s. */
export const createTurnstileVerifier =
  ({
    secretKey,
    timeoutMs,
    verifyUrl = TURNSTILE_VERIFY_URL,
  }: TurnstileVerifierOptions): HumanVerifier =>
  async (token, remoteIp) => {
    if (!token || token.length > MAX_TOKEN_LENGTH) {
      return false
    }
    const body = new URLSearchParams({ secret: secretKey, response: token })
    if (remoteIp) {
      body.set('remoteip', remoteIp)
    }
    try {
      const response = await fetch(verifyUrl, {
        method: 'POST',
        body,
        signal: AbortSignal.timeout(timeoutMs),
      })
      if (!response.ok) {
        return null
      }
      const answer = (await response.json()) as SiteverifyAnswer
      if (answer.success === true) {
        return true
      }
      // Cloudflare's own failure, not the visitor's: don't hold it against them.
      const codes = Array.isArray(answer['error-codes']) ? answer['error-codes'] : []
      return codes.includes('internal-error') ? null : false
    } catch {
      return null
    }
  }
