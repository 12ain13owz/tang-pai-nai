import { computed, signal } from '@angular/core'
import { TestBed } from '@angular/core/testing'
import type { ComponentFixture } from '@angular/core/testing'
import { Router } from '@angular/router'
import { TranslocoTestingModule } from '@jsverse/transloco'
import { AuthStore } from '@/core/auth'
import th from '@/core/i18n/th.json'
import { NetworkStatusService } from '@/core/network'
import { SyncService } from '@/core/offline'
import type { OutboxOp, SyncNotice } from '@/core/offline'
import { ProfileService } from '@/core/profile'
import { WalletService } from '@/core/wallet'
import { SyncSheet } from './sync-sheet'

const rejectedOp: OutboxOp = {
  seq: 1,
  opId: 'op-1',
  table: 'profiles',
  rowId: 'p1',
  op: 'upsert',
  row: { id: 'p1', name: 'ชา' },
  baseSeq: null,
  createdAt: 1,
  status: 'rejected',
  code: 'CONFLICT',
  error: 'A profile with this name already exists',
}

const notice: SyncNotice = {
  id: 'h1',
  table: 'profiles',
  rowId: 'p2',
  previous: { id: 'p2', name: 'กาแฟเย็น' },
  createdAt: 1,
}

describe('SyncSheet', () => {
  let fixture: ComponentFixture<SyncSheet>
  const sync = {
    lastSyncedAt: signal<number | null>(null),
    pendingCount: signal(0),
    rejected: signal<OutboxOp[]>([]),
    notices: signal<SyncNotice[]>([]),
    canSync: signal(true),
    isSyncing: signal(false),
    sync: vi.fn(async () => Promise.resolve()),
    discard: vi.fn(),
    dismissNotice: vi.fn(),
  }
  const wallets = { openFix: vi.fn() }
  /** Child ops grouped under a refused profile create, by the profile op's id. */
  const children = signal<Record<string, OutboxOp[]>>({})
  const profiles = {
    rejectedItems: computed(() => {
      const grouped = new Set(
        Object.values(children())
          .flat()
          .map((op) => op.opId)
      )
      return sync
        .rejected()
        .filter((op) => !grouped.has(op.opId))
        .map((op) => ({ op, children: children()[op.opId] ?? [] }))
    }),
    discardRefused: vi.fn(),
  }

  const text = () => document.body.textContent
  const button = (label: string) =>
    [...document.body.querySelectorAll('button')].find((b) => b.textContent.trim() === label)

  const open = async () => {
    fixture = TestBed.createComponent(SyncSheet)
    fixture.componentRef.setInput('open', true)
    fixture.detectChanges()
    await fixture.whenStable()
    fixture.detectChanges()
  }

  beforeEach(() => {
    vi.clearAllMocks()
    sync.rejected.set([])
    children.set({})
    sync.notices.set([])
    sync.pendingCount.set(0)
    TestBed.configureTestingModule({
      imports: [
        TranslocoTestingModule.forRoot({
          langs: { th },
          translocoConfig: { availableLangs: ['th'], defaultLang: 'th' },
          preloadLangs: true,
        }),
      ],
      providers: [
        { provide: SyncService, useValue: sync },
        { provide: WalletService, useValue: wallets },
        { provide: ProfileService, useValue: profiles },
      ],
    })
    TestBed.inject(AuthStore).status.set('signedIn')
  })

  afterEach(() => fixture.destroy())

  it('shows that nothing is waiting, and syncs on demand', async () => {
    await open()
    expect(text()).toContain(th.sync.neverSynced)
    expect(text()).toContain(th.sync.allSynced)
    button(th.sync.syncNow)?.click()
    expect(sync.sync).toHaveBeenCalledOnce()
  })

  it("lists a rejected op by its translated reason, not the server's English", async () => {
    sync.rejected.set([rejectedOp])
    await open()
    expect(text()).toContain(th.sync.rejectedHeading)
    expect(text()).toContain('ชา')
    expect(text()).toContain(th.sync.codeCONFLICT)
    expect(text()).not.toContain('already exists')
    button(th.sync.discard)?.click()
    // A profile op is discarded with any child rows refused with it (category rule 12).
    expect(profiles.discardRefused).toHaveBeenCalledWith('op-1')
  })

  it('discards any other rejected op on its own', async () => {
    sync.rejected.set([{ ...rejectedOp, table: 'categories', row: { id: 'c1', name: 'กาแฟ' } }])
    await open()
    expect(text()).toContain(th.sync.tablecategories)
    button(th.sync.discard)?.click()
    expect(sync.discard).toHaveBeenCalledWith('op-1')
  })

  it("lists a refused profile's refused categories and wallet under it, once (category rule 12)", async () => {
    const child = (opId: string, table: string): OutboxOp => ({
      ...rejectedOp,
      opId,
      table,
      rowId: opId,
      row: { id: opId, name: opId, profileId: 'p1' },
    })
    const kids = [child('c1', 'categories'), child('c2', 'categories'), child('w1', 'wallets')]
    sync.rejected.set([rejectedOp, ...kids])
    children.set({ 'op-1': kids })
    await open()
    expect(text()).toContain('พร้อมหมวดหมู่ 2 รายการ และกระเป๋าเงิน 1 ใบที่บันทึกไม่สำเร็จด้วย')
    expect(text()).not.toContain('c1')
    expect(
      [...document.body.querySelectorAll('button')].filter(
        (b) => b.textContent.trim() === th.sync.fix
      )
    ).toHaveLength(1)
  })

  it('opens the fix form for a rejected op', async () => {
    sync.rejected.set([rejectedOp])
    await open()
    const navigate = vi.spyOn(TestBed.inject(Router), 'navigate').mockResolvedValue(true)
    button(th.sync.fix)?.click()
    expect(navigate).toHaveBeenCalledWith(['/account/profiles'], { queryParams: { fix: 'op-1' } })
  })

  it('opens the wallet sheet on the Wallets tab to fix a rejected wallet', async () => {
    sync.rejected.set([{ ...rejectedOp, table: 'wallets', row: { id: 'w1', name: 'บัตร' } }])
    await open()
    const navigate = vi.spyOn(TestBed.inject(Router), 'navigate').mockResolvedValue(true)
    expect(text()).toContain(th.sync.tablewallets)
    button(th.sync.fix)?.click()
    expect(navigate).toHaveBeenCalledWith(['/wallets'])
    await fixture.whenStable()
    expect(wallets.openFix).toHaveBeenCalledWith('op-1')
  })

  it('lists a conflict notice with the replaced values, and dismisses it', async () => {
    sync.notices.set([notice])
    await open()
    expect(text()).toContain(th.sync.noticesHeading)
    expect(text()).toContain('กาแฟเย็น')
    button(th.sync.dismiss)?.click()
    expect(sync.dismissNotice).toHaveBeenCalledWith('h1')
  })

  it('says why it cannot sync offline, and disables the button', async () => {
    TestBed.inject(NetworkStatusService).isOnline.set(false)
    sync.canSync.set(false)
    await open()
    expect(text()).toContain(th.sync.needsOnline)
    expect(button(th.sync.syncNow)?.disabled).toBe(true)
    sync.canSync.set(true)
    TestBed.inject(NetworkStatusService).isOnline.set(true)
  })
})
