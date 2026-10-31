import { signal } from '@angular/core'
import { TestBed } from '@angular/core/testing'
import { provideRouter, Router } from '@angular/router'
import { AuthService, AuthStore } from '@/core/auth'
import type { AuthUser } from '@/core/auth'
import { DeviceStorageService } from '@/core/pwa'
import {
  LOCK_AFTER_MS,
  OfflineService,
  OPEN_LOCAL_DATABASE,
  VAULT_STORAGE,
} from './offline.service'
import type { LocalDatabase } from './local-database'
import type { Sealed } from './vault-crypto'
import type { VaultMeta, VaultStorage } from './vault-storage'

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

/** The vault in memory instead of IndexedDB. */
const memoryVault = () => {
  const store: { meta: VaultMeta | null; snapshot: Sealed | null } = { meta: null, snapshot: null }
  const vault = {
    store,
    readMeta: vi.fn(async () => Promise.resolve(store.meta)),
    readSnapshot: vi.fn(async () => Promise.resolve(store.snapshot)),
    writeMeta: vi.fn(async (meta: VaultMeta) => {
      store.meta = meta
      return Promise.resolve()
    }),
    writeSnapshot: vi.fn(async (snapshot: Sealed) => {
      store.snapshot = snapshot
      return Promise.resolve()
    }),
    create: vi.fn(async (meta: VaultMeta, snapshot: Sealed) => {
      store.meta = meta
      store.snapshot = snapshot
      return Promise.resolve()
    }),
    wipe: vi.fn(async () => {
      store.meta = null
      store.snapshot = null
      return Promise.resolve()
    }),
  }
  return vault satisfies VaultStorage & { store: unknown }
}

/** A key/value stand-in for SQLite (jsdom can't load the wasm): it exports its rows as JSON. */
const openFakeDatabase = async (snapshot?: Uint8Array<ArrayBuffer>): Promise<LocalDatabase> => {
  const rows = new Map<string, string>(
    snapshot ? (JSON.parse(new TextDecoder().decode(snapshot)) as [string, string][]) : []
  )
  const db = {
    rows,
    export: () => new TextEncoder().encode(JSON.stringify([...rows])),
    transaction: <T>(work: (database: LocalDatabase) => T): T => work(db as never),
    exec: (_sql: string, bind?: readonly (string | number | null)[]) => {
      for (let i = 0; bind && i < bind.length; i += 2) {
        rows.set(String(bind[i]), String(bind[i + 1]))
      }
    },
    selectValue: (_sql: string, bind?: readonly (string | number | null)[]) =>
      rows.get(String(bind?.[0])) ?? null,
    close: vi.fn(),
  }
  return Promise.resolve(db as unknown as LocalDatabase)
}

const PIN = '123456'

describe('OfflineService', () => {
  let service: OfflineService
  let vault: ReturnType<typeof memoryVault>
  let authStore: AuthStore
  const authService = { signOutOrLater: vi.fn(async () => Promise.resolve()), refresh: vi.fn() }
  const persist = vi.fn(async () => Promise.resolve(true))

  const setUp = () => {
    vault = memoryVault()
    TestBed.configureTestingModule({
      providers: [
        provideRouter([]),
        { provide: VAULT_STORAGE, useValue: vault },
        { provide: OPEN_LOCAL_DATABASE, useValue: openFakeDatabase },
        { provide: AuthService, useValue: authService },
        {
          provide: DeviceStorageService,
          useValue: { isInstalled: signal(true), isPersisted: signal(null), persist },
        },
      ],
    })
    authStore = TestBed.inject(AuthStore)
    authStore.setSession({ accessToken: 't', expiresIn: 600, user: user() })
    service = TestBed.inject(OfflineService)
  }

  /** A trusted device holding one row, locked again. */
  const trustedAndLocked = async () => {
    await service.enable(PIN)
    service.write((db) => db.exec('INSERT', ['note', 'ข้าวมันไก่']))
    await service.save()
    await service.lock()
  }

  beforeEach(() => {
    vi.clearAllMocks()
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  it('reads an empty vault as an untrusted device', async () => {
    setUp()
    expect(await service.ready()).toBeNull()
    expect(service.state()).toBe('none')
    expect(service.isTrusted()).toBe(false)
  })

  it('trusts the device: wraps a new key with the PIN and saves an encrypted database', async () => {
    setUp()
    await service.enable(PIN)

    const { meta, snapshot } = vault.store
    expect(meta).toMatchObject({ userId: 'u1', displayName: 'mom', failedAttempts: 0 })
    expect(meta?.key.iterations).toBe(600_000)
    expect(new TextDecoder().decode(snapshot?.data)).not.toContain('userId')
    expect(service.state()).toBe('unlocked')
    expect(authStore.keepsLocalSession()).toBe(true)
    expect(service.db().selectValue('SELECT', ['userId'])).toBe('u1')
    expect(persist).toHaveBeenCalled()
  })

  it('opens an untrusted device in memory only: nothing reaches the vault (rule 1)', async () => {
    setUp()
    await service.ready()
    await service.openUntrusted()
    expect(service.isOpen()).toBe(true)
    expect(service.state()).toBe('none')
    expect(service.db().selectValue('SELECT', ['userId'])).toBe('u1')
    expect(service.syncMeta('deviceId')).toMatch(/^[0-9a-f-]{36}$/)
    service.write((db) => db.exec('INSERT', ['note', 'x']))
    await service.save()
    expect(vault.store).toEqual({ meta: null, snapshot: null })
    await service.openUntrusted() // a second call keeps the same database
    expect(service.db().selectValue('SELECT', ['note'])).toBe('x')
  })

  it('counts local writes, so screens re-read the database (rule 8)', async () => {
    setUp()
    await service.enable(PIN)
    const before = service.changes()
    service.write((db) => db.exec('INSERT', ['note', 'x']))
    expect(service.changes()).toBe(before + 1)
  })

  it('replaces the in-memory copy when the device becomes trusted, and closes it on wipe', async () => {
    setUp()
    await service.ready()
    await service.openUntrusted()
    service.write((db) => db.exec('INSERT', ['note', 'memory only']))
    await service.enable(PIN)
    expect(service.db().selectValue('SELECT', ['note'])).toBeNull()
    expect(service.isOpen()).toBe(true)
    await service.wipe()
    expect(service.isOpen()).toBe(false)
  })

  it('forgets every current-profile choice on wipe, and nothing else (profile rule 6)', async () => {
    setUp()
    await service.enable(PIN)
    localStorage.setItem('tpn-profile:u1', 'p1')
    sessionStorage.setItem('tpn-profile:u2', 'p2')
    localStorage.setItem('tpn-theme', 'dark')
    await service.wipe()
    expect(localStorage.getItem('tpn-profile:u1')).toBeNull()
    expect(sessionStorage.getItem('tpn-profile:u2')).toBeNull()
    expect(localStorage.getItem('tpn-theme')).toBe('dark')
    localStorage.clear()
  })

  it('locks: the key and the database leave memory until the PIN unlocks them again', async () => {
    setUp()
    await trustedAndLocked()

    expect(service.state()).toBe('locked')
    expect(authStore.keepsLocalSession()).toBe(false)
    expect(() => service.db()).toThrow()

    expect(await service.unlock(PIN)).toBe('ok')
    expect(service.state()).toBe('unlocked')
    expect(service.db().selectValue('SELECT', ['note'])).toBe('ข้าวมันไก่')
  })

  it('counts wrong PINs, and a right one resets the count (rule 3)', async () => {
    setUp()
    await trustedAndLocked()

    expect(await service.unlock('000000')).toBe('wrong')
    expect(await service.unlock('000000')).toBe('wrong')
    expect(vault.store.meta?.failedAttempts).toBe(2)
    expect(service.attemptsLeft()).toBe(3)

    expect(await service.unlock(PIN)).toBe('ok')
    expect(vault.store.meta?.failedAttempts).toBe(0)
  })

  it('wipes the device and signs out on the 5th wrong PIN in a row (rule 3)', async () => {
    setUp()
    await trustedAndLocked()

    for (let i = 0; i < 4; i++) {
      expect(await service.unlock('000000')).toBe('wrong')
    }
    expect(await service.unlock('000000')).toBe('wiped')

    expect(vault.wipe).toHaveBeenCalled()
    expect(vault.store.meta).toBeNull()
    expect(service.state()).toBe('none')
    expect(authService.signOutOrLater).toHaveBeenCalledTimes(1)
  })

  it('changes the PIN: the old one stops working, the data stays (rule 4)', async () => {
    setUp()
    await service.enable(PIN)
    service.write((db) => db.exec('INSERT', ['note', 'rent']))

    expect(await service.verifyPin('999999')).toBe('wrong')
    expect(await service.verifyPin(PIN)).toBe('ok')
    await service.changePin('654321')
    await service.lock()

    expect(await service.unlock(PIN)).toBe('wrong')
    expect(await service.unlock('654321')).toBe('ok')
    expect(service.db().selectValue('SELECT', ['note'])).toBe('rent')
  })

  it('saves calls made during a save once more, not once each', async () => {
    setUp()
    await service.enable(PIN)
    vault.writeSnapshot.mockClear()

    await Promise.all([service.save(), service.save(), service.save()])
    expect(vault.writeSnapshot).toHaveBeenCalledTimes(2)
  })

  it('wipes and goes to sign-in when the session was revoked (rule 7)', async () => {
    setUp()
    const navigate = vi.spyOn(TestBed.inject(Router), 'navigateByUrl').mockResolvedValue(true)
    await service.enable(PIN)

    authStore.clear('revoked')
    TestBed.tick()
    await vi.waitFor(() =>
      expect(navigate).toHaveBeenCalledWith('/auth/sign-in', { replaceUrl: true })
    )
    expect(vault.store.meta).toBeNull()
  })

  it('keeps the data when the session only expired (rule 7)', async () => {
    setUp()
    await service.enable(PIN)

    authStore.clear('expired')
    TestBed.tick()
    expect(vault.store.meta).not.toBeNull()
    expect(service.state()).toBe('unlocked')
  })

  it('knows when someone else signed in on a trusted device', async () => {
    setUp()
    await service.enable(PIN)
    expect(service.belongsToSomeoneElse()).toBe(false)

    authStore.setSession({ accessToken: 't', expiresIn: 600, user: user('u2') })
    expect(service.belongsToSomeoneElse()).toBe(true)
  })

  it('locks after 5 minutes without a tap or key press (rule 2)', async () => {
    vi.useFakeTimers({ toFake: ['setInterval', 'Date'] })
    setUp()
    const navigate = vi.spyOn(TestBed.inject(Router), 'navigate').mockResolvedValue(true)
    await service.enable(PIN)

    await vi.advanceTimersByTimeAsync(LOCK_AFTER_MS - 60_000)
    document.dispatchEvent(new Event('pointerdown'))
    await vi.advanceTimersByTimeAsync(LOCK_AFTER_MS - 30_000)
    expect(service.state()).toBe('unlocked')

    await vi.advanceTimersByTimeAsync(60_000)
    await vi.waitFor(() => expect(service.state()).toBe('locked'))
    expect(navigate).toHaveBeenCalledWith(['/auth/lock'], { queryParams: { returnUrl: undefined } })
  })
})
