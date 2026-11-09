import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { AppError } from '@/core/error'
import { SHARING_LIMITS } from './sharing.const'
import { EMAIL, ID, setUpSharing } from './sharing.fixture'

let setup: Awaited<ReturnType<typeof setUpSharing>>

beforeEach(async () => {
  setup = await setUpSharing()
})

afterEach(() => {
  setup.close()
})

/** The `code` (or status) a call failed with. */
const failure = async (work: Promise<unknown>) => {
  try {
    await work
  } catch (error) {
    if (error instanceof AppError) {
      return error.code ?? error.status
    }
    throw error
  }
  throw new Error('expected a failure')
}

const inviteBob = async (walletIds: string[] = [ID.home, ID.cash], role = 'editor' as const) =>
  setup.service.invite(ID.alice, ID.pa, { email: EMAIL.bob, role, walletIds }, 'th')

describe('invite', () => {
  it('creates a pending invite for the open wallets and mails the invitee once', async () => {
    const invite = await inviteBob()
    expect(invite).toMatchObject({
      email: EMAIL.bob,
      role: 'editor',
      walletIds: [ID.home, ID.cash],
    })
    expect(invite.expiresAt - invite.createdAt).toBe(SHARING_LIMITS.INVITE_TTL_MS)
    expect(setup.sent).toHaveLength(1)
    expect(setup.sent[0].to).toBe(EMAIL.bob)
    expect(setup.sent[0].text).toContain('Home, Cash')
    expect(setup.sent[0].text).toContain('/auth/sign-in?email=bob%40example.com')
  })

  it('refuses yourself, a member, a second pending invite and closed wallets', async () => {
    const own = setup.service.invite(
      ID.alice,
      ID.pa,
      { email: EMAIL.alice, role: 'viewer', walletIds: [ID.home] },
      'th'
    )
    expect(await failure(own)).toBe('SHARE_SELF')
    expect(await failure(inviteBob([ID.old]))).toBe('SHARE_WALLETS_INVALID')
    expect(await failure(inviteBob([ID.gone]))).toBe('SHARE_WALLETS_INVALID')
    expect(await failure(inviteBob([ID.bobs]))).toBe('SHARE_WALLETS_INVALID')
    await inviteBob()
    expect(await failure(inviteBob())).toBe('SHARE_INVITE_PENDING')
    const invite = (await setup.service.withMe(ID.bob)).invites[0]
    await setup.service.accept(ID.bob, invite.id)
    expect(await failure(inviteBob())).toBe('SHARE_ALREADY_MEMBER')
    expect(setup.sent).toHaveLength(1)
  })

  it('answers 404 for a profile the caller does not own', async () => {
    const other = setup.service.invite(
      ID.bob,
      ID.pa,
      { email: EMAIL.carol, role: 'viewer', walletIds: [ID.home] },
      'th'
    )
    expect(await failure(other)).toBe(404)
  })

  it('counts members and pending invites together against the limit of 10 people', async () => {
    for (let i = 0; i < SHARING_LIMITS.PEOPLE_PER_PROFILE; i++) {
      await setup.service.invite(
        ID.alice,
        ID.pa,
        { email: `p${i}@example.com`, role: 'viewer', walletIds: [ID.home] },
        'th'
      )
    }
    expect(await failure(inviteBob())).toBe('SHARE_MEMBER_LIMIT')
  })

  it('lets an expired invite go and invites again', async () => {
    await inviteBob()
    setup.clock.now += SHARING_LIMITS.INVITE_TTL_MS
    expect((await setup.service.withMe(ID.bob)).invites).toEqual([])
    await expect(inviteBob()).resolves.toMatchObject({ email: EMAIL.bob })
  })
})

describe('resend', () => {
  it('waits out the cooldown, then mails again', async () => {
    const invite = await inviteBob()
    expect(await failure(setup.service.resend(ID.alice, invite.id, 'en'))).toBe(
      'SHARE_RESEND_COOLDOWN'
    )
    setup.clock.now += SHARING_LIMITS.RESEND_COOLDOWN_MS
    await setup.service.resend(ID.alice, invite.id, 'en')
    expect(setup.sent).toHaveLength(2)
    expect(setup.sent[1].subject).toContain('shared wallets with you')
  })

  it('stops at 10 sends a day per owner', async () => {
    const invite = await inviteBob()
    for (let i = 1; i < SHARING_LIMITS.SENDS_PER_DAY; i++) {
      setup.clock.now += SHARING_LIMITS.RESEND_COOLDOWN_MS
      await setup.service.resend(ID.alice, invite.id, 'th')
    }
    setup.clock.now += SHARING_LIMITS.RESEND_COOLDOWN_MS
    expect(await failure(setup.service.resend(ID.alice, invite.id, 'th'))).toBe('SHARE_DAILY_LIMIT')
  })

  it("is the owner's only: someone else gets 404", async () => {
    const invite = await inviteBob()
    expect(await failure(setup.service.resend(ID.bob, invite.id, 'th'))).toBe(404)
    expect(await failure(setup.service.cancel(ID.bob, invite.id))).toBe(404)
  })
})

describe('withMe / accept / decline', () => {
  it('shows invites only to the verified email, with the owner and wallet names', async () => {
    await setup.service.invite(
      ID.alice,
      ID.pa,
      { email: EMAIL.carol, role: 'viewer', walletIds: [ID.home] },
      'th'
    )
    expect((await setup.service.withMe(ID.carol)).invites).toEqual([])
    const invite = await inviteBob()
    const mine = await setup.service.withMe(ID.bob)
    expect(mine.invites).toEqual([
      {
        id: invite.id,
        role: 'editor',
        owner: { displayName: 'Alice', email: EMAIL.alice },
        wallets: [
          { id: ID.home, name: 'Home' },
          { id: ID.cash, name: 'Cash' },
        ],
        expiresAt: invite.expiresAt,
      },
    ])
    expect(await failure(setup.service.accept(ID.carol, invite.id))).toBe(404)
  })

  it('accepts into membership with balances computed like the app', async () => {
    const invite = await inviteBob()
    await setup.service.accept(ID.bob, invite.id)
    const mine = await setup.service.withMe(ID.bob)
    expect(mine.invites).toEqual([])
    expect(mine.shares).toEqual([
      {
        profileId: ID.pa,
        role: 'editor',
        owner: { id: ID.alice, displayName: 'Alice', email: EMAIL.alice },
        wallets: [
          expect.objectContaining({
            id: ID.home,
            balance: 100_000 + 50_000 - 4_200 - 10_000 + 3_000,
          }),
          expect.objectContaining({ id: ID.cash, balance: 110_000 }),
        ],
      },
    ])
  })

  it('refuses an invite whose wallets are all gone, and deletes it', async () => {
    const invite = await inviteBob([ID.cash])
    await setup.db.run(`UPDATE wallets SET is_archived = 1 WHERE id = '${ID.cash}'`)
    expect(await failure(setup.service.accept(ID.bob, invite.id))).toBe('SHARE_INVITE_EMPTY')
    expect(await failure(setup.service.decline(ID.bob, invite.id))).toBe(404)
  })

  it('declines without joining', async () => {
    const invite = await inviteBob()
    await setup.service.decline(ID.bob, invite.id)
    expect(await setup.service.withMe(ID.bob)).toEqual({ invites: [], shares: [] })
    expect((await setup.service.ofProfile(ID.alice, ID.pa)).invites).toEqual([])
  })
})

describe('owner view and members', () => {
  const join = async () => {
    const invite = await inviteBob()
    await setup.service.accept(ID.bob, invite.id)
  }

  it('lists people with one role, open wallets only, and the wallets shared with nobody', async () => {
    expect(await setup.service.ofProfile(ID.alice, ID.pa)).toEqual({
      members: [],
      invites: [],
      unsharedWalletIds: [ID.home, ID.cash],
    })
    await setup.service.invite(
      ID.alice,
      ID.pa,
      { email: EMAIL.carol, role: 'viewer', walletIds: [ID.home] },
      'th'
    )
    await join()
    await setup.service.updateMember(ID.alice, ID.pa, ID.bob, {
      role: 'viewer',
      walletIds: [ID.home],
    })
    const view = await setup.service.ofProfile(ID.alice, ID.pa)
    expect(view.members).toEqual([
      expect.objectContaining({ userId: ID.bob, role: 'viewer', walletIds: [ID.home] }),
    ])
    expect(view.invites.map((invite) => invite.email)).toEqual([EMAIL.carol])
    expect(view.unsharedWalletIds).toEqual([ID.cash])
    expect(await failure(setup.service.ofProfile(ID.bob, ID.pa))).toBe(404)
  })

  it('removes a member with an empty set, by remove, or when they leave', async () => {
    await join()
    await setup.service.updateMember(ID.alice, ID.pa, ID.bob, { role: 'editor', walletIds: [] })
    expect((await setup.service.withMe(ID.bob)).shares).toEqual([])
    expect(
      await failure(
        setup.service.updateMember(ID.alice, ID.pa, ID.bob, {
          role: 'editor',
          walletIds: [ID.home],
        })
      )
    ).toBe(404)

    await join()
    await setup.service.removeMember(ID.alice, ID.pa, ID.bob)
    expect((await setup.service.withMe(ID.bob)).shares).toEqual([])

    await join()
    await setup.service.leave(ID.bob, ID.pa)
    expect((await setup.service.ofProfile(ID.alice, ID.pa)).members).toEqual([])
  })
})

describe('wallet / entries', () => {
  beforeEach(async () => {
    const invite = await inviteBob()
    await setup.service.accept(ID.bob, invite.id)
  })

  it("reads the wallet, its balance, the owner's categories and its first day", async () => {
    const shared = await setup.service.wallet(ID.bob, ID.home)
    expect(shared.wallet).toMatchObject({ id: ID.home, balance: 138_800, firstOn: '2026-10-01' })
    expect(shared.role).toBe('editor')
    expect(shared.owner).toEqual({ displayName: 'Alice', email: EMAIL.alice })
    expect(shared.categories.map((category) => category.id).sort()).toEqual(
      [ID.food, ID.pay].sort()
    )
  })

  it('lists signed entries newest first, without the other wallet or the debt', async () => {
    const page = await setup.service.entries(ID.bob, ID.home, '2026-11-01', '2026-11-30')
    expect(page).toEqual({
      truncated: false,
      entries: [
        expect.objectContaining({
          id: 't2',
          kind: 'transaction',
          amount: -4_200,
          categoryId: ID.food,
          note: 'lunch',
        }),
        expect.objectContaining({ id: 'de1', kind: 'debt', amount: 3_000, categoryId: null }),
        expect.objectContaining({ id: 'tr1', kind: 'transfer', amount: -10_000, categoryId: null }),
      ],
    })
    const cash = await setup.service.entries(ID.bob, ID.cash, '2026-11-01', null)
    expect(cash.entries).toEqual([expect.objectContaining({ id: 'tr1', amount: 10_000 })])
  })

  it('answers 404 for a wallet not shared, archived later, or after leaving', async () => {
    expect(await failure(setup.service.wallet(ID.bob, ID.bobs))).toBe(404)
    expect(await failure(setup.service.wallet(ID.carol, ID.home))).toBe(404)
    await setup.db.run(`UPDATE wallets SET is_archived = 1 WHERE id = '${ID.cash}'`)
    expect(await failure(setup.service.entries(ID.bob, ID.cash, '2026-11-01', null))).toBe(404)
    await setup.service.leave(ID.bob, ID.pa)
    expect(await failure(setup.service.wallet(ID.bob, ID.home))).toBe(404)
  })
})
