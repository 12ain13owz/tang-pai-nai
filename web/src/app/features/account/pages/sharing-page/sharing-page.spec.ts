import { TestBed } from '@angular/core/testing'
import type { ComponentFixture } from '@angular/core/testing'
import { toastState } from '@spartan-ng/brain/sonner'
import th from '@/core/i18n/th.json'
import type { OwnerSharing, SharedWithMe } from '@/core/sharing'
import { envelope, NOTHING, setUpSharing } from '@/core/sharing/sharing-testing'
import { SharingPage } from './sharing-page'

const owner: OwnerSharing = {
  members: [
    {
      userId: 'bob',
      displayName: 'Bob',
      email: 'bob@example.com',
      role: 'viewer',
      walletIds: ['home'],
      addedAt: 1,
    },
  ],
  invites: [
    {
      id: 'i9',
      email: 'carol@example.com',
      role: 'editor',
      walletIds: ['home', 'cash'],
      createdAt: 1,
      expiresAt: Date.UTC(2026, 10, 23),
      lastSentAt: 1,
    },
  ],
  unsharedWalletIds: ['cash'],
}

const withMe: SharedWithMe = {
  invites: [
    {
      id: 'i1',
      role: 'editor',
      owner: { displayName: 'Alice', email: 'alice@example.com' },
      wallets: [{ id: 'w1', name: 'กองทุนเที่ยว' }],
      expiresAt: Date.UTC(2026, 10, 20),
    },
  ],
  shares: [
    {
      profileId: 'pz',
      profile: { id: 'pz', name: 'งานบ้าน', icon: 'lucideHouse', color: '#000' },
      role: 'viewer',
      owner: { id: 'z', displayName: 'Zed', email: 'zed@example.com' },
      wallets: [
        {
          id: 'w2',
          name: 'ออม',
          icon: 'lucideWallet',
          color: '#000',
          currencyCode: 'THB',
          balance: 1,
        },
      ],
    },
  ],
}

describe('SharingPage', () => {
  let setup: Awaited<ReturnType<typeof setUpSharing>>
  let fixture: ComponentFixture<SharingPage>
  const body = () => document.body
  const text = () => body().textContent
  const button = (label: string) =>
    [...body().querySelectorAll<HTMLButtonElement>('button')]
      .filter((b) => b.textContent.trim() === label)
      .at(-1)
  const settle = async () => {
    for (let i = 0; i < 3; i++) {
      TestBed.tick()
      await fixture.whenStable()
      await new Promise((resolve) => setTimeout(resolve))
    }
    fixture.detectChanges()
  }
  /** Answers every pending read of what is shared. */
  const answer = (mine: SharedWithMe = withMe, profile: OwnerSharing = owner) => {
    setup.http.match('/api/sharing/with-me').forEach((req) => req.flush(envelope(mine)))
    setup.http.match('/api/sharing/profiles/p1').forEach((req) => req.flush(envelope(profile)))
  }

  beforeEach(async () => {
    toastState.dismiss()
    setup = await setUpSharing()
    fixture = TestBed.createComponent(SharingPage)
    fixture.detectChanges()
    await settle()
  })

  afterEach(() => {
    toastState.dismiss()
    fixture.destroy()
  })

  it('shows invites to me, the profile’s members, pending invites, unshared wallets and what I get', async () => {
    answer()
    await settle()
    expect(text()).toContain('Alice เชิญคุณเป็นผู้แก้ไขของกระเป๋า')
    expect(text()).toContain('กองทุนเที่ยว')
    expect(text()).toContain('สมาชิก (1)')
    expect(text()).toContain('Bob')
    expect(text()).toContain('bob@example.com · 1 กระเป๋า')
    expect(text()).toContain('รอตอบรับ (1)')
    expect(text()).toContain('carol@example.com')
    expect(text()).toContain('“เงินสด” ยังไม่ได้แชร์กับใคร')
    expect(text()).toContain('Zed')
    expect(text()).toContain('ออม')
  })

  it('accepts an invitation and reads again (rule 6)', async () => {
    answer()
    await settle()
    button(th.sharing.accept)?.click()
    setup.http.expectOne('/api/sharing/invites/i1/accept').flush(envelope())
    await settle()
    answer({ ...withMe, invites: [] })
    await settle()
    expect(toastState.toasts().map((toast) => toast.title)).toContain(th.sharing.accepted)
    expect(text()).not.toContain('กองทุนเที่ยว')
  })

  it('invites with every open wallet switched on (rule 2)', async () => {
    answer(NOTHING, { members: [], invites: [], unsharedWalletIds: ['home', 'cash'] })
    await settle()
    expect(text()).toContain(th.sharing.membersEmpty)
    button(th.sharing.invite)?.click()
    await settle()
    expect(text()).toContain('กระเป๋าที่แชร์ (2/2)')
    const email = body().querySelector<HTMLInputElement>('hlm-drawer-content input[type="email"]')
    if (!email) {
      throw new Error('no email field')
    }
    email.value = 'dan@example.com'
    email.dispatchEvent(new Event('input'))
    await settle()
    button(th.sharing.send)?.click()
    const req = setup.http.expectOne('/api/sharing/profiles/p1/invites')
    expect(req.request.body).toEqual({
      email: 'dan@example.com',
      role: 'editor',
      walletIds: ['home', 'cash'],
      lang: 'th',
    })
    req.flush(envelope({ id: 'i2' }))
    await settle()
    answer(NOTHING)
    await settle()
    expect(toastState.toasts().map((toast) => toast.title)).toContain(th.sharing.sent)
  })

  it('says it needs the network and keeps invite off while offline (rule 10)', async () => {
    answer()
    await settle()
    setup.network.isOnline.set(false)
    await settle()
    expect(text()).toContain(th.sharing.needsOnline)
    expect(button(th.sharing.invite)?.disabled).toBe(true)
    expect(button(th.sharing.accept)?.disabled).toBe(true)
  })
})
