import { signal } from '@angular/core'
import { TestBed } from '@angular/core/testing'
import type { ComponentFixture } from '@angular/core/testing'
import { TranslocoTestingModule } from '@jsverse/transloco'
import { toastState } from '@spartan-ng/brain/sonner'
import { AuthStore } from '@/core/auth'
import type { AuthUser } from '@/core/auth'
import { CategoryService } from '@/core/category'
import th from '@/core/i18n/th.json'
import { NetworkStatusService } from '@/core/network'
import { findOp, listOps, OfflineService, putRow, queueWrite, SyncService } from '@/core/offline'
import type { LocalDatabase } from '@/core/offline'
import { openTestDatabase } from '@/core/offline/testing-db'
import { CategorySheet } from './category-sheet'

describe('CategorySheet', () => {
  let fixture: ComponentFixture<CategorySheet>
  let db: LocalDatabase
  let categories: CategoryService
  const changes = signal(0)
  const trusted = signal(true)
  const online = signal(true)

  const offline = {
    isOpen: signal(true),
    isTrusted: trusted,
    meta: signal(null),
    changes,
    db: () => db,
    write: <T>(work: (database: LocalDatabase) => T): T => {
      const result = db.transaction(work)
      changes.update((n) => n + 1)
      return result
    },
  }
  const sync = {
    canSync: signal(false),
    isSyncing: signal(false),
    lastSyncedAt: signal<number | null>(1),
    rejectedOp: (opId: string) => findOp(db, opId),
  }

  const body = () => document.body
  const text = () => body().textContent
  /** A button by its text, or by its aria-label for an icon button. */
  const button = (label: string) =>
    [...body().querySelectorAll('button')].find(
      (b) => b.textContent.trim() === label || b.getAttribute('aria-label') === label
    )
  /** The input a (screen-reader) label names. */
  const input = (label: string) => {
    const id = [...body().querySelectorAll('label')].find(
      (l) => l.textContent.trim() === label
    )?.htmlFor
    return body().querySelector(`input[id="${id}"]`) as HTMLInputElement
  }
  const type = async (label: string, value: string) => {
    const field = input(label)
    field.value = value
    field.dispatchEvent(new Event('input'))
    field.dispatchEvent(new Event('blur'))
    await settle()
  }
  const settle = async () => {
    fixture.detectChanges()
    await fixture.whenStable()
    fixture.detectChanges()
  }
  const click = async (label: string) => {
    button(label)?.click()
    await settle()
  }
  const submit = async () => {
    body().querySelector('form')?.dispatchEvent(new Event('submit'))
    await settle()
  }
  const radio = async (label: string) => {
    ;(body().querySelector(`input[aria-label="${label}"]`) as HTMLInputElement).click()
    await settle()
  }
  const category = (id: string, extra: object = {}) => {
    putRow(db, 'categories', {
      id,
      profileId: 'p1',
      type: 'expense',
      parentId: null,
      name: id,
      icon: 'lucideShapes',
      color: '#475569',
      isArchived: false,
      sortOrder: 0,
      createdAt: 1,
      updatedAt: 1,
      deletedAt: null,
      changeSeq: 5,
      updatedBy: 'u1',
      ...extra,
    })
    changes.update((n) => n + 1)
  }
  /** The segmented type control's radio by its text. */
  const typeRadio = (label: string) =>
    [...body().querySelectorAll('label')]
      .find((l) => l.textContent.trim() === label)
      ?.querySelector('input') as HTMLInputElement
  /** The form's "parent category" row. */
  const parentRow = () =>
    [...body().querySelectorAll('button')].find((b) => b.textContent.includes(th.categories.parent))
  const toastTitles = () => toastState.toasts().map((toast) => toast.title)

  beforeEach(async () => {
    db = await openTestDatabase()
    localStorage.clear()
    trusted.set(true)
    online.set(true)
    toastState.toasts().forEach((toast) => toastState.dismiss(toast.id))
    putRow(db, 'profiles', {
      id: 'p1',
      name: 'Home',
      icon: 'lucideHouse',
      color: '#15803d',
      sortOrder: 0,
      createdAt: 1,
      updatedAt: 1,
      deletedAt: null,
      changeSeq: 1,
      updatedBy: 'u1',
    })
    TestBed.configureTestingModule({
      imports: [
        TranslocoTestingModule.forRoot({
          langs: { th },
          translocoConfig: { availableLangs: ['th'], defaultLang: 'th' },
          preloadLangs: true,
        }),
      ],
      providers: [
        { provide: OfflineService, useValue: offline },
        { provide: SyncService, useValue: sync },
        { provide: NetworkStatusService, useValue: { isOnline: online } },
      ],
    })
    TestBed.inject(AuthStore).user.set({ id: 'u1' } as AuthUser)
    categories = TestBed.inject(CategoryService)
    fixture = TestBed.createComponent(CategorySheet)
    changes.update((n) => n + 1)
    await settle()
  })

  afterEach(() => {
    fixture.destroy()
    db.close()
  })

  it('creates a sub-category: name, icon and colour from their view, a parent from its view', async () => {
    category('Food')
    category('Salary', { type: 'income' })
    categories.open({ mode: 'create', type: 'expense', parentId: null })
    await settle()
    expect(text()).toContain(th.categories.createHeading)
    expect(text()).toContain(th.categories.parentNone)
    await type(th.categories.name, '  ชานมไข่มุก ')
    await click(th.categories.changeIcon)
    expect(text()).toContain(th.categories.iconHeading)
    await radio('สีที่ 5')
    await radio(th.icons.tpnBubbleTea)
    expect(input(th.categories.name).value).toBe('  ชานมไข่มุก ')
    parentRow()?.click()
    await settle()
    // Only top-level categories of the same type.
    expect(body().querySelectorAll('[role="option"]')).toHaveLength(2)
    expect(text()).not.toContain('Salary')
    ;([...body().querySelectorAll('[role="option"]')].at(1) as HTMLElement).click()
    await settle()
    expect(text()).toContain(th.categories.typeFollowsParent)
    expect(typeRadio(th.categories.income).disabled).toBe(true)
    await submit()
    expect(categories.childrenOf('Food')).toMatchObject([
      { name: 'ชานมไข่มุก', icon: 'tpnBubbleTea', color: '#a16207', type: 'expense' },
    ])
    expect(categories.sheet()).toBeNull()
    expect(toastTitles()).toEqual([th.categories.created])
  })

  it('starts in the tab it was opened from, and another type drops the parent', async () => {
    category('Food')
    categories.open({ mode: 'create', type: 'income', parentId: null })
    await settle()
    expect(typeRadio(th.categories.income).checked).toBe(true)
    await type(th.categories.name, 'โบนัส')
    await submit()
    expect(categories.tree('income').map((node) => node.category)).toMatchObject([
      { name: 'โบนัส', type: 'income', parentId: null, icon: 'lucideShapes', color: '#475569' },
    ])
  })

  it('refuses an empty name and one an open sibling holds, in place (rule 2)', async () => {
    category('Food')
    category('Coffee', { parentId: 'Food' })
    categories.open({ mode: 'create', type: 'expense', parentId: null })
    await settle()
    await submit()
    expect(text()).toContain(th.categories.nameRequired)
    await type(th.categories.name, 'food')
    expect(text()).toContain(th.categories.nameTaken)
    // The same name under a parent is free.
    await type(th.categories.name, 'Coffee')
    expect(text()).not.toContain(th.categories.nameTaken)
    expect(categories.categories()).toHaveLength(2)
  })

  it('keeps a parent with children top-level and of its type, and offers no delete', async () => {
    category('Home')
    category('Rent', { parentId: 'Home' })
    categories.open({ mode: 'edit', id: 'Home' })
    await settle()
    expect(text()).toContain(th.categories.typeLocked)
    expect(typeRadio(th.categories.income).disabled).toBe(true)
    expect(parentRow()?.disabled).toBe(true)
    expect(text()).toContain('มีหมวดหมู่ย่อย 1 รายการ')
    expect(button(th.categories.delete)?.disabled).toBe(true)
  })

  it('archives a parent and its children from the header, and undoes it from the toast', async () => {
    category('Home')
    category('Rent', { parentId: 'Home' })
    categories.open({ mode: 'edit', id: 'Home' })
    await settle()
    await click(th.categories.archive)
    expect(categories.sheet()).toBeNull()
    expect(toastTitles()).toEqual(['เก็บ “Home” และหมวดหมู่ย่อย 1 รายการถาวรแล้ว'])
    expect(categories.tree('expense', true)).toHaveLength(1)
    const [toast] = toastState.toasts()
    const action = toast.action as { label: string; onClick: () => void }
    expect(action.label).toBe(th.categories.undo)
    action.onClick()
    expect(categories.tree('expense').map((node) => node.children.length)).toEqual([1])
  })

  it('says why an archived child cannot come back while its parent is archived', async () => {
    category('Home', { isArchived: true })
    category('Rent', { parentId: 'Home', isArchived: true })
    categories.open({ mode: 'edit', id: 'Rent' })
    await settle()
    await click(th.categories.unarchive)
    expect(text()).toContain(th.categories.unarchiveParentArchived)
    expect(categories.byId('Rent')?.isArchived).toBe(true)
  })

  it('deletes only after the confirm view, which can go back', async () => {
    category('Tea')
    categories.open({ mode: 'edit', id: 'Tea' })
    await settle()
    await click(th.categories.delete)
    expect(text()).toContain('ลบหมวดหมู่ “Tea” ใช่ไหม')
    await click(th.sheet.back)
    expect(categories.byId('Tea')).not.toBeNull()
    await click(th.categories.delete)
    await click(th.categories.deleteConfirm)
    expect(categories.byId('Tea')).toBeNull()
    expect(toastTitles()).toEqual(['ลบหมวดหมู่ “Tea” แล้ว'])
  })

  it('asks before throwing away unsaved input, and can go back to it', async () => {
    categories.open({ mode: 'create', type: 'expense', parentId: null })
    await settle()
    await type(th.categories.name, 'Tea')
    await click(th.sheet.close)
    expect(text()).toContain(th.categories.discardHeading)
    await click(th.categories.keepEditing)
    expect(input(th.categories.name).value).toBe('Tea')
    await click(th.sheet.close)
    await click(th.categories.discard)
    expect(categories.sheet()).toBeNull()
    expect(categories.categories()).toHaveLength(0)
  })

  it('opens a fix with the refused values and their error, and saves it in place of the op', async () => {
    category('Food')
    category('Coffee', { parentId: 'Food' })
    offline.write((tx) =>
      queueWrite(tx, 'categories', 'upsert', {
        id: 'c9',
        profileId: 'p1',
        type: 'expense',
        parentId: 'Food',
        name: 'Coffee',
        icon: 'lucideCoffee',
        color: '#a16207',
        isArchived: false,
        sortOrder: 1,
        createdAt: 1,
        updatedAt: 1,
        deletedAt: null,
      })
    )
    const [op] = listOps(db, 'pending')
    db.exec(`UPDATE outbox SET status = 'rejected' WHERE op_id = ?`, [op.opId])
    db.exec(`DELETE FROM categories WHERE id = 'c9'`)
    changes.update((n) => n + 1)
    categories.openFix(op.opId)
    await settle()
    expect(text()).toContain(th.categories.fixHeading)
    expect(text()).toContain(th.categories.nameTaken)
    await type(th.categories.name, 'Coffee 2')
    await submit()
    expect(findOp(db, op.opId)).toBeNull()
    expect(categories.childrenOf('Food').map((c) => c.name)).toEqual(['Coffee', 'Coffee 2'])
  })

  it('says an untrusted device must be online, and blocks saving', async () => {
    trusted.set(false)
    online.set(false)
    categories.open({ mode: 'create', type: 'expense', parentId: null })
    await settle()
    expect(text()).toContain(th.categories.needsOnline)
    expect(button(th.categories.save)?.disabled).toBe(true)
  })
})
