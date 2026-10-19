import { Service, signal } from '@angular/core'

interface PendingSignIn {
  email: string
  returnUrl: string
  /** Epoch ms when "send a new code" unlocks (the API's 60 s cooldown). */
  resendAt: number
}

const EMPTY: PendingSignIn = { email: '', returnUrl: '/', resendAt: 0 }
const RESEND_COOLDOWN_MS = 60_000

/**
 * The sign-in in progress, between the email and the code screens. Kept in sessionStorage, so
 * switching to the mail app (which can reload a PWA on iOS) doesn't lose it. Holds no secret.
 */
@Service()
export class AuthFlowStore {
  private readonly STORAGE_KEY = 'tpn-sign-in'

  pending = signal<PendingSignIn>(this.read())

  start(email: string, returnUrl: string): void {
    this.save({ email, returnUrl, resendAt: Date.now() + RESEND_COOLDOWN_MS })
  }

  resent(): void {
    this.save({ ...this.pending(), resendAt: Date.now() + RESEND_COOLDOWN_MS })
  }

  /** A `429` told us how long to wait. */
  waitUntil(epochMs: number): void {
    this.save({ ...this.pending(), resendAt: epochMs })
  }

  clear(): void {
    this.save(EMPTY)
  }

  private save(value: PendingSignIn): void {
    this.pending.set(value)
    try {
      if (value.email) {
        sessionStorage.setItem(this.STORAGE_KEY, JSON.stringify(value))
      } else {
        sessionStorage.removeItem(this.STORAGE_KEY)
      }
    } catch {
      // Storage can be blocked (private mode); the flow still works until a reload.
    }
  }

  private read(): PendingSignIn {
    try {
      const saved: unknown = JSON.parse(sessionStorage.getItem(this.STORAGE_KEY) ?? 'null')
      if (typeof saved === 'object' && saved !== null && 'email' in saved) {
        return { ...EMPTY, ...(saved as Partial<PendingSignIn>) }
      }
    } catch {
      // Fall through to an empty flow.
    }
    return EMPTY
  }
}
