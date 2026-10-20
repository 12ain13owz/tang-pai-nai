import { DOCUMENT, inject, Service } from '@angular/core'
import { ApiClient, isUnreachable, toApiError } from '@/core/api'
import { skipAuthRefresh } from './auth.context'
import { AuthStore } from './auth.store'
import type { AuthProviders, AuthSession, AuthStatus, AuthUser } from './auth.type'

/** Shared by every tab, so two tabs never rotate the same refresh token at once. */
const REFRESH_LOCK = 'tpn-auth-refresh'

const NO_PROVIDERS: AuthProviders = { google: false }

/** Where "Continue with Google" sends the browser (the API, through the `/api` rewrite). */
export const googleStartUrl = (returnUrl: string): string =>
  returnUrl === '/'
    ? '/api/auth/google/start'
    : `/api/auth/google/start?returnUrl=${encodeURIComponent(returnUrl)}`

/** The auth endpoints (docs/features/auth.md, parts 4.1–4.3) and the session they produce. */
@Service()
export class AuthService {
  private api = inject(ApiClient)
  private authStore = inject(AuthStore)
  private window = inject(DOCUMENT).defaultView
  private locks = this.window?.navigator.locks

  private refreshing: Promise<void> | null = null
  private restoring: Promise<AuthStatus> | null = null
  private providersRequest: Promise<AuthProviders> | null = null

  /**
   * Which extra ways to sign in are on (`GET /auth/providers`), asked once per app start. When
   * the API can't be reached everything extra counts as off, and the next call asks again.
   */
  async providers(): Promise<AuthProviders> {
    this.providersRequest ??= this.api
      .get<AuthProviders>('/auth/providers', { context: skipAuthRefresh() })
      .then((response) => response.data ?? NO_PROVIDERS)
      .catch(() => {
        this.providersRequest = null
        return NO_PROVIDERS
      })
    return this.providersRequest
  }

  /**
   * Rule 14: leaves the app for Google. It's a full-page navigation, not an API call: the API
   * answers with redirects and comes back to `/auth/callback`.
   */
  startGoogle(returnUrl: string): void {
    this.window?.location.assign(googleStartUrl(returnUrl))
  }

  async startEmail(email: string, lang: string): Promise<void> {
    await this.api.post('/auth/email/start', { email, lang }, { context: skipAuthRefresh() })
  }

  async verifyCode(email: string, code: string): Promise<void> {
    await this.verify({ email, code })
  }

  async verifyLink(token: string): Promise<void> {
    await this.verify({ token })
  }

  /** Rule 12: email + password → a session, like a verified code. */
  async signInWithPassword(email: string, password: string): Promise<void> {
    const response = await this.api.post<AuthSession>(
      '/auth/password/sign-in',
      { email, password },
      { context: skipAuthRefresh() }
    )
    if (response.data) {
      this.authStore.setSession(response.data)
    }
  }

  /**
   * Rule 13: set or change the password. Needs recent auth: a fresh sign-in, `currentPassword`,
   * or a step-up code first (`403 REAUTH_REQUIRED` otherwise). The API signs out other devices.
   */
  async setPassword(newPassword: string, currentPassword?: string): Promise<void> {
    const body = currentPassword === undefined ? { newPassword } : { newPassword, currentPassword }
    const response = await this.api.put<AuthUser>('/auth/password', body)
    if (response.data) {
      this.authStore.user.set(response.data)
    }
  }

  /** Rule 13: remove the password, under the same recent-auth rule. */
  async removePassword(currentPassword?: string): Promise<void> {
    const body = currentPassword === undefined ? {} : { currentPassword }
    const response = await this.api.delete<AuthUser>('/auth/password', body)
    if (response.data) {
      this.authStore.user.set(response.data)
    }
  }

  /** Mails a step-up code to the signed-in user's own email. */
  async startReauth(lang: string): Promise<void> {
    await this.api.post('/auth/reauth/start', { lang })
  }

  /** A right step-up code counts as a fresh credential check for this session. */
  async verifyReauth(code: string): Promise<void> {
    await this.api.post('/auth/reauth/verify', { code })
  }

  /**
   * Rotates the refresh cookie for a new access token. Calls in flight share one request, and a
   * Web Lock queues other tabs behind it: the browser updates the cookie before the next tab sends
   * it, so the server never sees one token twice (which it treats as theft).
   */
  async refresh(): Promise<void> {
    this.refreshing ??= this.runRefresh().finally(() => {
      this.refreshing = null
    })
    return this.refreshing
  }

  /** The start-up check: one silent refresh, answered from memory once it's settled. */
  async restore(): Promise<AuthStatus> {
    const status = this.authStore.status()
    if (status === 'signedIn' || status === 'signedOut') {
      return status
    }
    this.restoring ??= this.refresh()
      .then(() => this.authStore.status())
      .catch(() => this.authStore.status())
      .finally(() => {
        this.restoring = null
      })
    return this.restoring
  }

  /** Re-reads the signed-in user (`GET /auth/me`, an ordinary authenticated call). */
  async loadMe(): Promise<void> {
    const response = await this.api.get<AuthUser>('/auth/me')
    if (response.data) {
      this.authStore.user.set(response.data)
    }
  }

  async signOut(): Promise<void> {
    await this.api.post('/auth/sign-out', {}, { context: skipAuthRefresh() })
    this.authStore.clear()
  }

  private async verify(body: { email: string; code: string } | { token: string }): Promise<void> {
    const response = await this.api.post<AuthSession>('/auth/email/verify', body, {
      context: skipAuthRefresh(),
    })
    if (response.data) {
      this.authStore.setSession(response.data)
    }
  }

  private async runRefresh(): Promise<void> {
    const request = async () =>
      this.api.post<AuthSession>('/auth/refresh', {}, { context: skipAuthRefresh() })
    try {
      const response = this.locks
        ? await this.locks.request(REFRESH_LOCK, request)
        : await request()
      if (response.data) {
        this.authStore.setSession(response.data)
      }
    } catch (error) {
      if (isUnreachable(toApiError(error))) {
        // Keep whatever we had: the session may still be fine once the network is back.
        if (!this.authStore.isSignedIn()) {
          this.authStore.status.set('unreachable')
        }
      } else {
        this.authStore.clear()
      }
      throw error
    }
  }
}
