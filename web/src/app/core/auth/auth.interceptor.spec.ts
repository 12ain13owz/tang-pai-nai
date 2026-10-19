import { HttpClient, provideHttpClient, withInterceptors } from '@angular/common/http'
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing'
import { TestBed } from '@angular/core/testing'
import { provideRouter, Router } from '@angular/router'
import { firstValueFrom } from 'rxjs'
import { skipAuthRefresh } from './auth.context'
import { authInterceptor } from './auth.interceptor'
import { AuthStore } from './auth.store'

const user = {
  id: 'u1',
  email: 'mom@example.com',
  displayName: 'mom',
  avatarUrl: null,
  timezone: 'Asia/Bangkok',
  hasPassword: false,
}
const refreshed = {
  message: 'ok',
  timestamp: '',
  data: { accessToken: 'new', expiresIn: 600, user },
}
const unauthorized = { status: 401, statusText: 'Unauthorized' }

// Lets the refresh promise settle and the retried request reach the testing backend.
const settle = async () => new Promise((resolve) => setTimeout(resolve))

describe('authInterceptor', () => {
  let client: HttpClient
  let http: HttpTestingController
  let store: AuthStore

  beforeEach(() => {
    TestBed.configureTestingModule({
      providers: [
        provideHttpClient(withInterceptors([authInterceptor])),
        provideHttpClientTesting(),
        provideRouter([]),
      ],
    })
    client = TestBed.inject(HttpClient)
    http = TestBed.inject(HttpTestingController)
    store = TestBed.inject(AuthStore)
    store.setSession({ accessToken: 'old', expiresIn: 600, user })
  })

  afterEach(() => http.verify())

  it('adds the bearer token to /api calls only', async () => {
    const api = firstValueFrom(client.get('/api/wallets'))
    const other = firstValueFrom(client.get('/assets/x.json'))

    const apiReq = http.expectOne('/api/wallets')
    const otherReq = http.expectOne('/assets/x.json')
    expect(apiReq.request.headers.get('Authorization')).toBe('Bearer old')
    expect(otherReq.request.headers.has('Authorization')).toBe(false)
    apiReq.flush({})
    otherReq.flush({})
    await Promise.all([api, other])
  })

  it('refreshes once on a 401 and retries with the new token', async () => {
    const result = firstValueFrom(client.get<{ ok: boolean }>('/api/wallets'))

    http.expectOne('/api/wallets').flush({}, unauthorized)
    http.expectOne('/api/auth/refresh').flush(refreshed)
    await settle()
    const retry = http.expectOne('/api/wallets')
    expect(retry.request.headers.get('Authorization')).toBe('Bearer new')
    retry.flush({ ok: true })

    await expect(result).resolves.toEqual({ ok: true })
  })

  it('goes to sign-in, remembering the page, when the refresh fails too', async () => {
    const router = TestBed.inject(Router)
    const navigate = vi.spyOn(router, 'navigate').mockResolvedValue(true)
    const result = firstValueFrom(client.get('/api/wallets'))

    http.expectOne('/api/wallets').flush({}, unauthorized)
    http.expectOne('/api/auth/refresh').flush({ code: 'SESSION_REVOKED' }, unauthorized)

    await expect(result).rejects.toMatchObject({ status: 401 })
    expect(navigate).toHaveBeenCalledWith(['/auth/sign-in'], { queryParams: { returnUrl: '/' } })
    expect(store.status()).toBe('signedOut')
  })

  it('leaves a request marked skipAuthRefresh alone on a 401', async () => {
    const result = firstValueFrom(
      client.post('/api/auth/sign-out', {}, { context: skipAuthRefresh() })
    )

    http.expectOne('/api/auth/sign-out').flush({}, unauthorized)

    await expect(result).rejects.toMatchObject({ status: 401 })
    http.expectNone('/api/auth/refresh')
  })

  it('passes other errors straight through', async () => {
    const result = firstValueFrom(client.get('/api/wallets'))

    http.expectOne('/api/wallets').flush({}, { status: 500, statusText: 'Boom' })

    await expect(result).rejects.toMatchObject({ status: 500 })
    http.expectNone('/api/auth/refresh')
  })
})
