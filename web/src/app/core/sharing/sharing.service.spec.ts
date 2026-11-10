import { HttpErrorResponse } from '@angular/common/http'
import { TestBed } from '@angular/core/testing'
import { toastState } from '@spartan-ng/brain/sonner'
import { AuthStore } from '@/core/auth'
import type { AuthUser } from '@/core/auth'
import { ProfileService } from '@/core/profile'
import { TransactionService } from '@/core/transaction'
import { envelope, NO_ONE, NOTHING, setUpSharing } from './sharing-testing'
import { SharingService } from './sharing.service'
import type { ShareGroup, SharedProfileRows, SharedWithMe } from './sharing.type'

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

  it("adds the members' names for the owner's rows (sharing rule 15)", async () => {
    TestBed.tick()
    setup.http.expectOne('/api/sharing/with-me').flush(envelope(NOTHING))
    const owner = service.loadOwner('p1')
    setup.http.expectOne('/api/sharing/profiles/p1').flush(
      envelope({
        ...NO_ONE,
        members: [
          {
            userId: 'm1',
            displayName: 'Mom',
            email: 'm@x',
            role: 'editor',
            walletIds: [],
            addedAt: 1,
          },
        ],
      })
    )
    await owner
    expect(TestBed.inject(TransactionService).people().get('m1')).toBe('Mom')
  })
})

describe('SharingService › a shared profile in use (sharing rules 9–16)', () => {
  let setup: Awaited<ReturnType<typeof setUpSharing>>
  let service: SharingService
  let profileService: ProfileService

  const group: ShareGroup = {
    profileId: 'pz',
    profile: { id: 'pz', name: 'Family', icon: 'lucideHouse', color: '#b45309' },
    role: 'editor',
    owner: { id: 'z', displayName: 'Dad', email: 'd@x' },
    wallets: [],
  }
  const tx = (id: string, changeSeq: number, extra: Record<string, unknown> = {}) => ({
    id,
    profileId: 'pz',
    walletId: 'zh',
    categoryId: 'zc',
    amount: 100,
    occurredOn: '2026-11-09',
    note: id,
    excludeFromReport: false,
    recurringId: null,
    debtId: null,
    eventId: null,
    addedBy: null,
    createdAt: 1,
    updatedAt: 1,
    deletedAt: null,
    changeSeq,
    updatedBy: 'z',
    ...extra,
  })
  const page = (
    rows: Record<string, unknown>[],
    cursor: number,
    hasMore = false
  ): SharedProfileRows => {
    const columns = Object.keys(rows.at(0) ?? {})
    return {
      profile: group.profile,
      role: 'editor',
      owner: group.owner,
      people: [
        { id: 'z', displayName: 'Dad' },
        { id: 'u1', displayName: 'Mom' },
      ],
      wallets: [
        {
          id: 'zh',
          profileId: 'pz',
          name: 'Home',
          currencyCode: 'THB',
          initialBalance: 5000,
          icon: 'lucideHouse',
          color: '#1d4ed8',
          excludeFromTotal: false,
          isArchived: false,
          sortOrder: 0,
          hiddenCategoryIds: [],
          createdAt: 1,
          updatedAt: 1,
          deletedAt: null,
          changeSeq: 1,
          updatedBy: 'z',
        },
      ],
      categories: [
        {
          id: 'zc',
          profileId: 'pz',
          type: 'expense',
          parentId: null,
          name: 'Food',
          icon: 'lucideUtensils',
          color: '#c2410c',
          isArchived: false,
          sortOrder: 0,
          mergedIntoId: null,
          createdAt: 1,
          updatedAt: 1,
          deletedAt: null,
          changeSeq: 1,
          updatedBy: 'z',
        },
      ],
      transactions: { columns, rows: rows.map((row) => columns.map((column) => row[column])) },
      cursor,
      hasMore,
    }
  }
  const rowsUrl = (since: number) => `/api/sharing/with-me/pz/rows?since=${since}&limit=5000`
  const count = (sql: string) => Number(setup.db.selectValue(sql))

  /** Opens `pz` with two pages of rows. */
  const openIt = async () => {
    const opened = service.openShared(group)
    expect(profileService.shared()?.status).toBe('loading')
    setup.http.expectOne(rowsUrl(0)).flush(envelope(page([tx('t1', 2)], 2, true)))
    await settle()
    setup.http.expectOne(rowsUrl(2)).flush(envelope(page([tx('t2', 3, { addedBy: 'u1' })], 3)))
    await opened
    TestBed.tick()
    // Back online with it in use: what changed meanwhile is read once more.
    setup.http.match(rowsUrl(3)).forEach((req) => req.flush(envelope(page([], 3))))
    await settle()
  }

  beforeEach(async () => {
    toastState.dismiss()
    setup = await setUpSharing()
    service = TestBed.inject(SharingService)
    profileService = TestBed.inject(ProfileService)
    TestBed.tick()
    setup.http.expectOne('/api/sharing/with-me').flush(envelope(NOTHING))
  })

  afterEach(() => {
    toastState.dismiss()
    setup.http.verify()
  })

  it('puts its rows in the TEMP tables and makes it the current profile', async () => {
    await openIt()
    expect(profileService.shared()).toMatchObject({ role: 'editor', status: 'ready' })
    expect(profileService.current()?.name).toBe('Family')
    expect(setup.sharedActive()).toBe(true)
    expect(setup.db.selectObjects('SELECT id FROM transactions ORDER BY id')).toEqual([
      { id: 't1' },
      { id: 't2' },
    ])
    expect(count('SELECT count(*) FROM wallets')).toBe(1)
    expect(TestBed.inject(TransactionService).people().get('u1')).toBe('Mom')
    // Own rows stay where they were (main), out of sight.
    expect(count(`SELECT count(*) FROM main.wallets WHERE profile_id = 'p1'`)).toBe(3)

    profileService.select('p1')
    expect(profileService.shared()).toBeNull()
    expect(setup.sharedActive()).toBe(false)
    expect(count('SELECT count(*) FROM wallets')).toBe(3)
  })

  it("pushes an editor's write at once (rule 11)", async () => {
    await openIt()
    TestBed.inject(TransactionService).save(null, {
      walletId: 'zh',
      categoryId: 'zc',
      amount: 250,
      occurredOn: '2026-11-09',
      note: 'noodles',
      excludeFromReport: false,
    })
    TestBed.tick()
    await settle()
    expect(setup.sync.pushes).toBe(1)
    expect(count('SELECT count(*) FROM outbox')).toBe(0)
    expect(count(`SELECT count(*) FROM transactions WHERE note = 'noodles'`)).toBe(1)
  })

  it('reloads with a toast when the server answers STALE (rule 13)', async () => {
    await openIt()
    setup.sync.answer = (db) =>
      db.exec(`UPDATE outbox SET status = 'rejected', code = 'STALE' WHERE status = 'pending'`)
    const transactions = TestBed.inject(TransactionService)
    transactions.save('t1', {
      walletId: 'zh',
      categoryId: 'zc',
      amount: 999,
      occurredOn: '2026-11-09',
      note: 't1',
      excludeFromReport: false,
    })
    TestBed.tick()
    await settle()
    setup.http.expectOne(rowsUrl(3)).flush(envelope(page([tx('t1', 4, { amount: 700 })], 4)))
    await settle()
    expect(toastState.toasts().map((item) => item.title)).toContain(
      'รายการนี้เพิ่งถูกแก้ไข โหลดข้อมูลใหม่แล้ว'
    )
    expect(count('SELECT count(*) FROM outbox')).toBe(0)
    expect(count(`SELECT amount FROM transactions WHERE id = 't1'`)).toBe(700)
  })

  it('tells a removed member and goes back to an own profile (rule 16)', async () => {
    await openIt()
    setup.sync.answer = (db) =>
      db.exec(`UPDATE outbox SET status = 'rejected', code = 'NOT_SHARED' WHERE status = 'pending'`)
    TestBed.inject(TransactionService).remove('t1')
    TestBed.tick()
    await settle()
    expect(toastState.toasts().map((item) => item.title)).toContain(
      'คุณไม่ได้เป็นสมาชิกของกระเป๋านี้แล้ว'
    )
    expect(profileService.shared()).toBeNull()
    expect(setup.sharedActive()).toBe(false)
    setup.http.expectOne('/api/sharing/with-me').flush(envelope(NOTHING))
  })

  it('goes back to an own profile when a read answers 404', async () => {
    await openIt()
    const read = service.refreshShared()
    setup.http
      .expectOne(rowsUrl(3))
      .flush({ message: 'x' }, { status: 404, statusText: 'Not Found' })
    await read
    expect(profileService.shared()).toBeNull()
    setup.http.expectOne('/api/sharing/with-me').flush(envelope(NOTHING))
  })

  it('stays on the own profile, with a toast, when opening fails', async () => {
    const opened = service.openShared(group)
    setup.http.expectOne(rowsUrl(0)).flush(null, { status: 0, statusText: 'Unknown Error' })
    await opened
    expect(profileService.shared()).toBeNull()
    expect(setup.sharedActive()).toBe(false)
    expect(toastState.toasts()).toHaveLength(1)
  })
})
