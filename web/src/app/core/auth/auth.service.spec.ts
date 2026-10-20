import { provideHttpClient } from '@angular/common/http'
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing'
import { TestBed } from '@angular/core/testing'
import { AuthService, googleStartUrl } from './auth.service'
import { AuthStore } from './auth.store'
import type { AuthSession } from './auth.type'

const session = (accessToken = 'access-1'): AuthSession => ({
  accessToken,
  expiresIn: 600,
  user: {
    id: 'u1',
    email: 'mom@example.com',
    displayName: 'mom',
    avatarUrl: null,
    timezone: 'Asia/Bangkok',
    hasPassword: false,
    identities: [],
  },
})

const envelope = (data?: unknown) => ({ message: 'ok', timestamp: '', data })

describe('AuthService', () => {
  let service: AuthService
  let store: AuthStore
  let http: HttpTestingController

  beforeEach(() => {
    TestBed.configureTestingModule({
      providers: [provideHttpClient(), provideHttpClientTesting()],
    })
    service = TestBed.inject(AuthService)
    store = TestBed.inject(AuthStore)
    http = TestBed.inject(HttpTestingController)
  })

  afterEach(() => http.verify())

  it('starts the email flow with the UI language', async () => {
    const done = service.startEmail('mom@example.com', 'en')

    const req = http.expectOne('/api/auth/email/start')
    expect(req.request.body).toEqual({ email: 'mom@example.com', lang: 'en' })
    req.flush(envelope(), { status: 202, statusText: 'Accepted' })
    await done
  })

  it('keeps the session in memory after verifying a code', async () => {
    const done = service.verifyCode('mom@example.com', '123456')

    http.expectOne('/api/auth/email/verify').flush(envelope(session()))
    await done
    expect(store.status()).toBe('signedIn')
    expect(store.accessToken()).toBe('access-1')
    expect(localStorage.length + sessionStorage.length).toBe(0)
  })

  it('shares one refresh request between concurrent callers', async () => {
    const first = service.refresh()
    const second = service.refresh()

    http.expectOne('/api/auth/refresh').flush(envelope(session('access-2')))
    await Promise.all([first, second])
    expect(store.accessToken()).toBe('access-2')
  })

  it('signs out locally when the refresh is refused', async () => {
    store.setSession(session())
    const done = service.refresh()

    http
      .expectOne('/api/auth/refresh')
      .flush({ message: 'revoked', code: 'SESSION_REVOKED' }, { status: 401, statusText: 'No' })
    await expect(done).rejects.toBeTruthy()
    expect(store.status()).toBe('signedOut')
    expect(store.accessToken()).toBeNull()
  })

  it('marks the status unreachable when the API cannot be reached', async () => {
    const done = service.refresh()

    http.expectOne('/api/auth/refresh').error(new ProgressEvent('error'))
    await expect(done).rejects.toBeTruthy()
    expect(store.status()).toBe('unreachable')
  })

  it('keeps a signed-in session when a refresh fails for lack of network', async () => {
    store.setSession(session())
    const done = service.refresh()

    http.expectOne('/api/auth/refresh').error(new ProgressEvent('error'))
    await expect(done).rejects.toBeTruthy()
    expect(store.status()).toBe('signedIn')
  })

  it('restores once, then answers from memory', async () => {
    const restored = service.restore()
    http.expectOne('/api/auth/refresh').flush(envelope(session()))

    await expect(restored).resolves.toBe('signedIn')
    await expect(service.restore()).resolves.toBe('signedIn')
  })

  it('restores to signedOut without a valid cookie, and does not ask again', async () => {
    const restored = service.restore()
    http.expectOne('/api/auth/refresh').flush({ message: 'x' }, { status: 401, statusText: 'No' })

    await expect(restored).resolves.toBe('signedOut')
    await expect(service.restore()).resolves.toBe('signedOut')
  })

  it('clears the session on sign-out', async () => {
    store.setSession(session())
    const done = service.signOut()

    http.expectOne('/api/auth/sign-out').flush(envelope())
    await done
    expect(store.status()).toBe('signedOut')
    expect(store.user()).toBeNull()
  })

  it('refreshes the profile from /auth/me', async () => {
    store.setSession(session())
    const done = service.loadMe()

    http.expectOne('/api/auth/me').flush(envelope({ ...session().user, displayName: 'Mom' }))
    await done
    expect(store.user()?.displayName).toBe('Mom')
  })

  it('signs in with a password like a verified code', async () => {
    const done = service.signInWithPassword('mom@example.com', 'Gr33n Mango Tree')

    const req = http.expectOne('/api/auth/password/sign-in')
    expect(req.request.body).toEqual({ email: 'mom@example.com', password: 'Gr33n Mango Tree' })
    req.flush(envelope(session('access-pw')))
    await done
    expect(store.status()).toBe('signedIn')
    expect(store.accessToken()).toBe('access-pw')
  })

  it('sends the current password only when given, and keeps the returned user', async () => {
    store.setSession(session())
    const first = service.setPassword('Blue.Sky.2026', 'th')
    const set = http.expectOne('/api/auth/password')
    expect(set.request.method).toBe('PUT')
    expect(set.request.body).toEqual({ newPassword: 'Blue.Sky.2026', lang: 'th' })
    set.flush(envelope({ ...session().user, hasPassword: true }))
    await first
    expect(store.user()?.hasPassword).toBe(true)

    const second = service.setPassword('Blue.Sky.2027', 'en', 'Blue.Sky.2026')
    const change = http.expectOne('/api/auth/password')
    expect(change.request.body).toEqual({
      newPassword: 'Blue.Sky.2027',
      lang: 'en',
      currentPassword: 'Blue.Sky.2026',
    })
    change.flush(envelope({ ...session().user, hasPassword: true }))
    await second
  })

  it('removes the password with a DELETE that may carry the current password', async () => {
    store.setSession({ ...session(), user: { ...session().user, hasPassword: true } })
    const done = service.removePassword('th', 'Blue.Sky.2026')

    const req = http.expectOne('/api/auth/password')
    expect(req.request.method).toBe('DELETE')
    expect(req.request.body).toEqual({ lang: 'th', currentPassword: 'Blue.Sky.2026' })
    req.flush(envelope(session().user))
    await done
    expect(store.user()?.hasPassword).toBe(false)
  })

  it('asks for and confirms a step-up code', async () => {
    const start = service.startReauth('en')
    const startReq = http.expectOne('/api/auth/reauth/start')
    expect(startReq.request.body).toEqual({ lang: 'en' })
    startReq.flush(envelope(), { status: 202, statusText: 'Accepted' })
    await start

    const verify = service.verifyReauth('123456')
    const verifyReq = http.expectOne('/api/auth/reauth/verify')
    expect(verifyReq.request.body).toEqual({ code: '123456' })
    verifyReq.flush(envelope())
    await verify
  })

  it('asks the API once which providers are on', async () => {
    const first = service.providers()
    const second = service.providers()
    http.expectOne('/api/auth/providers').flush(envelope({ google: true }))

    await expect(first).resolves.toEqual({ google: true })
    await expect(second).resolves.toEqual({ google: true })
    await expect(service.providers()).resolves.toEqual({ google: true })
  })

  it('counts Google as off when the API cannot be reached, and asks again next time', async () => {
    const offline = service.providers()
    http.expectOne('/api/auth/providers').error(new ProgressEvent('error'))
    await expect(offline).resolves.toEqual({ google: false })

    const online = service.providers()
    http.expectOne('/api/auth/providers').flush(envelope({ google: true }))
    await expect(online).resolves.toEqual({ google: true })
  })
})

describe('googleStartUrl', () => {
  it('goes through the /api rewrite and carries an in-app return path', () => {
    expect(googleStartUrl('/')).toBe('/api/auth/google/start')
    expect(googleStartUrl('/account?tab=1')).toBe(
      '/api/auth/google/start?returnUrl=%2Faccount%3Ftab%3D1'
    )
  })
})
