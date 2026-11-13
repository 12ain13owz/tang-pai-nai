import { signal } from '@angular/core'
import { TestBed } from '@angular/core/testing'
import { provideRouter, Router } from '@angular/router'
import type { ActivatedRouteSnapshot, RouterStateSnapshot } from '@angular/router'
import { AuthService, AuthStore } from '@/core/auth'
import type { AuthStatus, AuthUser } from '@/core/auth'
import { lockGuard, otherTabGuard, shellGuard } from './offline.guard'
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
    pin: true,
    hasPin: () => offline.pin,
    opens: true,
    open: vi.fn(async () => {
      if (offline.opens) {
        offline.state.set('unlocked')
      }
      return Promise.resolve(offline.opens)
    }),
    ready: vi.fn(async () => Promise.resolve(offline.meta)),
    wipe: vi.fn(async () => {
      offline.meta = null
      return Promise.resolve()
    }),
    claimTab: vi.fn(async () => Promise.resolve(offline.tabFree)),
    isOpen: () => offline.state() === 'unlocked',
    enable: vi.fn(async () => {
      offline.state.set('unlocked')
      return Promise.resolve()
    }),
    openInMemory: vi.fn(async () => Promise.resolve()),
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
    offline.pin = true
    offline.opens = true
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

  describe('shellGuard with no local data yet', () => {
    it('makes the local database for a signed-in user, with no PIN (rule 1)', async () => {
      expect(await run(shellGuard)).toBe(true)
      expect(offline.enable).toHaveBeenCalledWith()
      expect(offline.openInMemory).not.toHaveBeenCalled()
    })

    it('works in memory when browser storage refuses the local database', async () => {
      vi.spyOn(console, 'error').mockImplementation(() => undefined)
      offline.enable.mockRejectedValueOnce(new Error('blocked'))
      expect(await run(shellGuard)).toBe(true)
      expect(offline.openInMemory).toHaveBeenCalledOnce()
    })

    it('sends someone signed out to sign-in', async () => {
      status = 'signedOut'
      expect(await run(shellGuard)).toBe('/auth/sign-in?returnUrl=%2Fwallets')
      expect(offline.enable).not.toHaveBeenCalled()
    })
  })

  describe('shellGuard with local data', () => {
    beforeEach(() => {
      offline.meta = meta()
      offline.state.set('locked')
    })

    it('asks for the PIN while locked (rule 2)', async () => {
      expect(await run(shellGuard)).toBe('/auth/lock?returnUrl=%2Fwallets')
    })

    it('opens once unlocked, even offline or with the server down (rule 7)', async () => {
      offline.state.set('unlocked')
      expect(await run(shellGuard)).toBe(true)
      status = 'unreachable'
      expect(await run(shellGuard)).toBe(true)
      expect(offline.wipe).not.toHaveBeenCalled()
      expect(offline.enable).not.toHaveBeenCalled()
    })

    it('sends an expired session to sign-in once the server said so, the data kept (rule 7)', async () => {
      offline.state.set('unlocked')
      status = 'signedOut'
      authStore.clear('expired')
      expect(await run(shellGuard)).toBe('/auth/sign-in?returnUrl=%2Fwallets')
      expect(offline.wipe).not.toHaveBeenCalled()
    })

    it('wipes first when the session was revoked (rule 7)', async () => {
      status = 'signedOut'
      authStore.clear('revoked')
      expect(await run(shellGuard)).toBe('/auth/sign-in?returnUrl=%2Fwallets')
      expect(offline.wipe).toHaveBeenCalledTimes(1)
    })

    it('wipes first when someone else signed in, then makes theirs (rule 7)', async () => {
      authStore.setSession({ accessToken: 't', expiresIn: 600, user: user('u2') })
      expect(await run(shellGuard)).toBe(true)
      expect(offline.wipe).toHaveBeenCalledTimes(1)
      expect(offline.enable).toHaveBeenCalledOnce()
    })

    it('says the app is open in another tab (rule 2)', async () => {
      offline.tabFree = false
      expect(await run(shellGuard)).toBe('/auth/tab?returnUrl=%2Fwallets')
    })

    it('opens at once with the PIN off, even offline (rule 2)', async () => {
      offline.pin = false
      status = 'unreachable'
      expect(await run(shellGuard)).toBe(true)
      expect(offline.open).toHaveBeenCalledOnce()
      expect(offline.wipe).not.toHaveBeenCalled()
    })

    it('starts afresh when the PIN is off but the vault cannot be opened', async () => {
      offline.pin = false
      offline.opens = false
      expect(await run(shellGuard)).toBe(true)
      expect(offline.wipe).toHaveBeenCalledOnce()
      expect(offline.enable).toHaveBeenCalledOnce()
    })
  })

  it('opens the lock screen only while a device with a PIN is locked', async () => {
    expect(await run(lockGuard)).toBe('/')
    offline.meta = meta()
    offline.state.set('locked')
    expect(await run(lockGuard)).toBe(true)
    offline.state.set('unlocked')
    expect(await run(lockGuard)).toBe('/')
    offline.state.set('locked')
    offline.pin = false
    expect(await run(lockGuard)).toBe('/')
  })

  it('opens "another tab" only while another tab holds the app', async () => {
    expect(await run(otherTabGuard)).toBe('/')
    offline.state.set('elsewhere')
    expect(await run(otherTabGuard)).toBe(true)
  })
})
