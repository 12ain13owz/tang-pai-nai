import { computed, Service, signal } from '@angular/core'
import type { AuthSession, AuthStatus, AuthUser, SessionEnd } from './auth.type'

/**
 * Who is signed in. The access token lives **in memory only** (never in storage), so a reload
 * starts signed out until the silent refresh at start brings it back (auth spec → Interactions).
 */
@Service()
export class AuthStore {
  accessToken = signal<string | null>(null)
  user = signal<AuthUser | null>(null)
  status = signal<AuthStatus>('unknown')
  isSignedIn = computed(() => this.status() === 'signedIn')
  /** Why the last session ended, when the API said (offline-sync rule 7 wipes on `revoked`). */
  endedBy = signal<SessionEnd | null>(null)
  /** Set by a sign-in (not a refresh) until the trust step has run (offline-sync rule 1). */
  freshSignIn = signal(false)
  /**
   * A trusted device unlocked with its PIN: an expired session keeps the app on its local data
   * instead of sending the user to sign-in (offline-sync rule 7). Set by `OfflineService`.
   */
  keepsLocalSession = signal(false)

  setSession(session: AuthSession, isSignIn = false): void {
    this.accessToken.set(session.accessToken)
    this.user.set(session.user)
    this.status.set('signedIn')
    this.endedBy.set(null)
    if (isSignIn) {
      this.freshSignIn.set(true)
    }
  }

  clear(endedBy: SessionEnd | null = null): void {
    this.accessToken.set(null)
    this.user.set(null)
    this.status.set('signedOut')
    this.endedBy.set(endedBy)
    this.freshSignIn.set(false)
  }
}
