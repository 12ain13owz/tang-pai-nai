import { signal } from '@angular/core'
import { TestBed } from '@angular/core/testing'
import { provideRouter, Router } from '@angular/router'
import type { ActivatedRouteSnapshot, RouterStateSnapshot } from '@angular/router'
import { AuthService, AuthStore } from '@/core/auth'
import type { AuthStatus, AuthUser } from '@/core/auth'
import { lockGuard, otherTabGuard, shellGuard, trustGuard } from './offline.guard'
import { OfflineService } from './offline.service'
import type { OfflineState } from './offline.service'
import type { VaultMeta } from './vault-storage'

const user = (id = 'u1'): AuthUser => ({
  id,
  email: `${id}@example.com`,
  displayName: 'mom',
  avatarUrl: null,
  timezone: 'Asia/Bangkok',
  hasPassword: false,
  phone: null,
  identities: [],
})

const meta = (userId = 'u1') => ({ userId }) as VaultMeta

describe('offline guards', () => {
  let authStore: AuthStore
  let status: AuthStatus
  const offline = {
    meta: null as VaultMeta | null,
    state: signal<OfflineState>('none'),
    tabFree: true,
    ready: vi.fn(async () => Promise.resolve(offline.meta)),
    wipe: vi.fn(async () => {
      offline.meta = null
      return Promise.resolve()
    }),
    claimTab: vi.fn(async () => Promise.resolve(offline.tabFree)),
    // As the real one: nobody signed in (an expired session) is not someone else.
    belongsToSomeoneElse: () => {
      const signedIn = authStore.user()
      return offline.meta !== null && signedIn !== null && offline.meta.userId !== signedIn.id
    },
  }

  const run = async (guard: typeof shellGuard, url = '/wallets') => {
    const result = await TestBed.runInInjectionContext(async () =>
      guard({} as ActivatedRouteSnapshot, { url } as RouterStateSnapshot)
    )
    return result instanceof Object && 'root' in result
      ? TestBed.inject(Router).serializeUrl(result)
      : result
  }

  beforeEach(() => {
    vi.clearAllMocks()
    status = 'signedIn'
    offline.meta = null
    offline.state.set('none')
    offline.tabFree = true
    TestBed.configureTestingModule({
      providers: [
        provideRouter([]),
        { provide: OfflineService, useValue: offline },
        { provide: AuthService, useValue: { restore: async () => Promise.resolve(status) } },
      ],
    })
    authStore = TestBed.inject(AuthStore)
    authStore.setSession({ accessToken: 't', expiresIn: 600, user: user() })
  })

  describe('shellGuard on an untrusted device', () => {
    it('lets a signed-in user in', async () => {
      expect(await run(shellGuard)).toBe(true)
    })

    it('sends a fresh sign-in to the trust step first (rule 1)', async () => {
      authStore.freshSignIn.set(true)
      expect(await run(shellGuard)).toBe('/auth/trust?returnUrl=%2Fwallets')
    })

    it('sends someone signed out to sign-in', async () => {
      status = 'signedOut'
      expect(await run(shellGuard)).toBe('/auth/sign-in?returnUrl=%2Fwallets')
    })
  })

  describe('shellGuard on a trusted device', () => {
    beforeEach(() => {
      offline.meta = meta()
      offline.state.set('locked')
    })

    it('asks for the PIN while locked (rule 2)', async () => {
      expect(await run(shellGuard)).toBe('/auth/lock?returnUrl=%2Fwallets')
    })

    it('opens once unlocked, even offline or with an expired session (rule 7)', async () => {
      offline.state.set('unlocked')
      expect(await run(shellGuard)).toBe(true)
      status = 'unreachable'
      expect(await run(shellGuard)).toBe(true)
      status = 'signedOut'
      authStore.clear('expired')
      expect(await run(shellGuard)).toBe(true)
      expect(offline.wipe).not.toHaveBeenCalled()
    })

    it('skips the trust step for the same user signing in again', async () => {
      offline.state.set('unlocked')
      authStore.freshSignIn.set(true)
      expect(await run(shellGuard)).toBe(true)
      expect(authStore.freshSignIn()).toBe(false)
    })

    it('wipes first when the session was revoked (rule 7)', async () => {
      status = 'signedOut'
      authStore.clear('revoked')
      expect(await run(shellGuard)).toBe('/auth/sign-in?returnUrl=%2Fwallets')
      expect(offline.wipe).toHaveBeenCalledTimes(1)
    })

    it('wipes first when someone else signed in, then asks them to trust (rule 7)', async () => {
      authStore.setSession({ accessToken: 't', expiresIn: 600, user: user('u2') }, true)
      expect(await run(shellGuard)).toBe('/auth/trust?returnUrl=%2Fwallets')
      expect(offline.wipe).toHaveBeenCalledTimes(1)
    })

    it('says the app is open in another tab (rule 2)', async () => {
      offline.tabFree = false
      expect(await run(shellGuard)).toBe('/auth/tab?returnUrl=%2Fwallets')
    })
  })

  it('opens the trust step only on an untrusted device', async () => {
    expect(await run(trustGuard)).toBe(true)
    offline.meta = meta()
    expect(await run(trustGuard)).toBe('/')
  })

  it('opens the lock screen only while a trusted device is locked', async () => {
    expect(await run(lockGuard)).toBe('/')
    offline.meta = meta()
    offline.state.set('locked')
    expect(await run(lockGuard)).toBe(true)
    offline.state.set('unlocked')
    expect(await run(lockGuard)).toBe('/')
  })

  it('opens "another tab" only while another tab holds the app', async () => {
    expect(await run(otherTabGuard)).toBe('/')
    offline.state.set('elsewhere')
    expect(await run(otherTabGuard)).toBe(true)
  })
})
