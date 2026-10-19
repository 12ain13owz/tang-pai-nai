import { computed, Service, signal } from '@angular/core'
import type { AuthSession, AuthStatus, AuthUser } from './auth.type'

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

  setSession(session: AuthSession): void {
    this.accessToken.set(session.accessToken)
    this.user.set(session.user)
    this.status.set('signedIn')
  }

  clear(): void {
    this.accessToken.set(null)
    this.user.set(null)
    this.status.set('signedOut')
  }
}
