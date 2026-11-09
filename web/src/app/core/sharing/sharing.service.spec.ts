import { HttpErrorResponse } from '@angular/common/http'
import { TestBed } from '@angular/core/testing'
import { AuthStore } from '@/core/auth'
import type { AuthUser } from '@/core/auth'
import { envelope, NO_ONE, NOTHING, setUpSharing } from './sharing-testing'
import { SharingService } from './sharing.service'
import type { SharedWithMe } from './sharing.type'

const withInvite: SharedWithMe = {
  invites: [
    {
      id: 'i1',
      role: 'viewer',
      owner: { displayName: 'Alice', email: 'a@example.com' },
      wallets: [{ id: 'w1', name: 'Home' }],
      expiresAt: 1,
    },
  ],
  shares: [],
}

/** Lets resolved HTTP calls reach the service. */
const settle = async () => new Promise((resolve) => setTimeout(resolve))

describe('SharingService', () => {
  let setup: Awaited<ReturnType<typeof setUpSharing>>
  let service: SharingService

  beforeEach(async () => {
    setup = await setUpSharing()
    service = TestBed.inject(SharingService)
  })

  afterEach(() => {
    setup.http.verify()
  })

  it('reads what is shared with me once signed in and online, and counts invites', async () => {
    TestBed.tick()
    setup.http.expectOne('/api/sharing/with-me').flush(envelope(withInvite))
    await settle()
    TestBed.tick()
    expect(service.inviteCount()).toBe(1)
    TestBed.tick()
    setup.http.expectNone('/api/sharing/with-me')
  })

  it('waits for the network, then reads (rule 10)', () => {
    setup.network.isOnline.set(false)
    TestBed.tick()
    setup.http.expectNone('/api/sharing/with-me')
    expect(service.canCall()).toBe(false)
    setup.network.isOnline.set(true)
    TestBed.tick()
    setup.http.expectOne('/api/sharing/with-me').flush(envelope(NOTHING))
  })

  it('forgets everything when the signed-in user changes (memory only, rule 15)', async () => {
    TestBed.tick()
    setup.http.expectOne('/api/sharing/with-me').flush(envelope(withInvite))
    await settle()
    const owner = service.loadOwner('p1')
    setup.http.expectOne('/api/sharing/profiles/p1').flush(envelope(NO_ONE))
    await owner
    TestBed.inject(AuthStore).user.set({ id: 'u2' } as AuthUser)
    TestBed.tick()
    expect(service.owner('p1')).toBeNull()
    expect(service.inviteCount()).toBe(0)
    setup.http.expectOne('/api/sharing/with-me').flush(envelope(NOTHING))
  })

  it('caches entries per wallet and range, with `to` left out for the future', async () => {
    TestBed.tick()
    setup.http.expectOne('/api/sharing/with-me').flush(envelope(NOTHING))
    const future = service.loadEntries('w1', '2026-12-01', null)
    setup.http
      .expectOne('/api/sharing/wallets/w1/entries?from=2026-12-01')
      .flush(envelope({ entries: [], truncated: false }))
    await future
    expect(service.entries('w1', '2026-12-01', null)).toEqual({ entries: [], truncated: false })
    expect(service.entries('w1', '2026-11-01', '2026-11-30')).toBeNull()
  })

  it('sends the UI language with an invite and reads the profile again', async () => {
    TestBed.tick()
    setup.http.expectOne('/api/sharing/with-me').flush(envelope(NOTHING))
    const sent = service.invite(
      'p1',
      { email: 'b@example.com', role: 'editor', walletIds: ['home'] },
      'en'
    )
    const req = setup.http.expectOne('/api/sharing/profiles/p1/invites')
    expect(req.request.body).toEqual({
      email: 'b@example.com',
      role: 'editor',
      walletIds: ['home'],
      lang: 'en',
    })
    req.flush(envelope({ id: 'i1' }))
    await settle()
    setup.http.expectOne('/api/sharing/profiles/p1').flush(envelope(NO_ONE))
    await sent
    expect(service.owner('p1')).toEqual(NO_ONE)
  })

  it('turns a failure into a translation key', () => {
    TestBed.tick()
    setup.http.expectOne('/api/sharing/with-me').flush(envelope(NOTHING))
    const answered = (status: number, code?: string) =>
      new HttpErrorResponse({ status, error: code ? { message: 'x', code } : null })
    expect(service.failure(answered(409, 'SHARE_INVITE_PENDING'))).toBe(
      'sharing.error.SHARE_INVITE_PENDING'
    )
    expect(service.failure(answered(409, 'SOMETHING_ELSE'))).toBe('sharing.error.generic')
    expect(service.failure(answered(0))).toBe('sharing.needsOnline')
  })
})
