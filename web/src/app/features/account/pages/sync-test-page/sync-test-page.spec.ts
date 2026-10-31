import { signal } from '@angular/core'
import { TestBed } from '@angular/core/testing'
import type { ComponentFixture } from '@angular/core/testing'
import { ActivatedRoute, convertToParamMap, provideRouter } from '@angular/router'
import type { ParamMap } from '@angular/router'
import { BehaviorSubject } from 'rxjs'
import { TranslocoTestingModule } from '@jsverse/transloco'
import { toastState } from '@spartan-ng/brain/sonner'
import th from '@/core/i18n/th.json'
import { NetworkStatusService } from '@/core/network'
import {
  countOps,
  findOp,
  getRow,
  listOps,
  OfflineService,
  putRow,
  queueWrite,
  SyncService,
} from '@/core/offline'
import type { LocalDatabase } from '@/core/offline'
import { openTestDatabase } from '@/core/offline/testing-db'
import { SyncTestPage } from './sync-test-page'

describe('SyncTestPage', () => {
  let fixture: ComponentFixture<SyncTestPage>
  let db: LocalDatabase
  let query: BehaviorSubject<ParamMap>
  const changes = signal(0)
  const trusted = signal(true)

  const offline = {
    isOpen: signal(true),
    isTrusted: trusted,
    changes,
    db: () => db,
    write: <T>(work: (database: LocalDatabase) => T): T => {
      const result = db.transaction(work)
      changes.update((n) => n + 1)
      return result
    },
  }
  const sync = {
    rejectedOp: (opId: string) => findOp(db, opId),
  }

  const page = () => fixture.nativeElement as HTMLElement
  const titles = () =>
    [...page().querySelectorAll('ul li span.truncate')].map((el) => el.textContent.trim())
  const type = (label: string, value: string) => {
    const field = [...page().querySelectorAll('label')].find(
      (el) => el.textContent.trim() === label
    )
    const input = field?.parentElement?.querySelector('input') as HTMLInputElement
    input.value = value
    input.dispatchEvent(new Event('input'))
  }
  const submit = async () => {
    page().querySelector('form')?.dispatchEvent(new Event('submit'))
    await Promise.resolve()
    fixture.detectChanges()
  }
  const add = async (title: string, amount: string) => {
    type(th.syncTest.title, title)
    type(th.syncTest.amount, amount)
    await submit()
  }

  beforeEach(async () => {
    db = await openTestDatabase()
    trusted.set(true)
    query = new BehaviorSubject(convertToParamMap({}))
    toastState.toasts().forEach((toast) => toastState.dismiss(toast.id))
    TestBed.configureTestingModule({
      imports: [
        TranslocoTestingModule.forRoot({
          langs: { th },
          translocoConfig: { availableLangs: ['th'], defaultLang: 'th' },
          preloadLangs: true,
        }),
      ],
      providers: [
        provideRouter([]),
        {
          provide: ActivatedRoute,
          useValue: { queryParamMap: query, snapshot: { queryParamMap: convertToParamMap({}) } },
        },
        { provide: OfflineService, useValue: offline },
        { provide: SyncService, useValue: sync },
      ],
    })
    fixture = TestBed.createComponent(SyncTestPage)
    fixture.detectChanges()
  })

  afterEach(() => db.close())

  it('adds an item to the local database and the outbox, in satang, shown as waiting', async () => {
    await add('กาแฟ', '65.5')
    expect(titles()).toEqual(['กาแฟ'])
    expect(page().textContent).toContain('฿65.50')
    expect(page().textContent).toContain(th.syncTest.pending)
    expect(listOps(db, 'pending')).toMatchObject([
      { op: 'upsert', row: { title: 'กาแฟ', amount: 6550 } },
    ])
  })

  it('refuses an amount with more than 2 decimals', async () => {
    await add('กาแฟ', '1.234')
    expect(page().textContent).toContain(th.syncTest.amountInvalid)
    expect(countOps(db, 'pending')).toBe(0)
  })

  it('edits an item on top of the synced row, keeping its baseSeq', async () => {
    putRow(db, 'sync_probes', {
      id: 'p1',
      title: 'ชา',
      amount: 4000,
      createdAt: 1,
      updatedAt: 1,
      deletedAt: null,
      changeSeq: 9,
    })
    changes.update((n) => n + 1)
    fixture.detectChanges()
    ;(page().querySelector(`button[aria-label="แก้ไข ชา"]`) as HTMLButtonElement).click()
    fixture.detectChanges()
    type(th.syncTest.title, 'ชาเขียว')
    await submit()
    expect(titles()).toEqual(['ชาเขียว'])
    expect(listOps(db, 'pending')).toMatchObject([
      { rowId: 'p1', baseSeq: 9, row: { amount: 4000, createdAt: 1 } },
    ])
  })

  it('deletes with undo: a tombstone, then the row back, as one op', async () => {
    await add('กาแฟ', '10')
    ;(page().querySelector(`button[aria-label="ลบ กาแฟ"]`) as HTMLButtonElement).click()
    fixture.detectChanges()
    expect(titles()).toEqual([])
    expect(listOps(db, 'pending')).toMatchObject([{ op: 'delete' }])

    const [deleted] = toastState.toasts()
    const action = deleted.action as { onClick: (event: MouseEvent) => void }
    action.onClick(new MouseEvent('click'))
    fixture.detectChanges()
    expect(titles()).toEqual(['กาแฟ'])
    expect(listOps(db, 'pending')).toMatchObject([{ op: 'upsert', row: { deletedAt: null } }])
  })

  it('fixes a rejected op: its refused values in the form, then a new op replaces it', async () => {
    offline.write((tx) =>
      queueWrite(tx, 'sync_probes', 'upsert', {
        id: 'p1',
        title: 'ชา',
        amount: 4000,
        createdAt: 1,
        updatedAt: 1,
        deletedAt: null,
      })
    )
    const [op] = listOps(db, 'pending')
    db.exec(`UPDATE outbox SET status = 'rejected' WHERE op_id = ?`, [op.opId])
    db.exec(`DELETE FROM sync_probes`) // the server never had it
    query.next(convertToParamMap({ fix: op.opId }))
    fixture.detectChanges()
    expect(page().textContent).toContain(th.syncTest.fixing)
    type(th.syncTest.title, 'ชาเขียว')
    await submit()
    expect(countOps(db, 'rejected')).toBe(0)
    expect(listOps(db, 'pending')).toMatchObject([
      { rowId: 'p1', row: { title: 'ชาเขียว', amount: 4000 } },
    ])
    expect(getRow(db, 'sync_probes', 'p1')).toMatchObject({ title: 'ชาเขียว' })
  })

  it('blocks writes on an untrusted device while offline (rule 1)', () => {
    trusted.set(false)
    TestBed.inject(NetworkStatusService).isOnline.set(false)
    fixture.detectChanges()
    expect(page().textContent).toContain(th.syncTest.offlineUntrusted)
    expect((page().querySelector('button[type=submit]') as HTMLButtonElement).disabled).toBe(true)
    TestBed.inject(NetworkStatusService).isOnline.set(true)
  })

  it('lists the active currencies pulled from the server', () => {
    putRow(db, 'currencies', {
      code: 'THB',
      minorUnit: 2,
      isActive: true,
      sortOrder: 0,
      createdAt: 1,
      updatedAt: 1,
      changeSeq: 1,
    })
    putRow(db, 'currencies', {
      code: 'JPY',
      minorUnit: 0,
      isActive: false,
      sortOrder: 3,
      createdAt: 1,
      updatedAt: 1,
      changeSeq: 4,
    })
    changes.update((n) => n + 1)
    fixture.detectChanges()
    expect(page().textContent).toContain('THB · 2')
    expect(page().textContent).not.toContain('JPY')
  })
})
