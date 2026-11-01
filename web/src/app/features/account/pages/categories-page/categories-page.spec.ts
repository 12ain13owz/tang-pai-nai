import { signal } from '@angular/core'
import { TestBed } from '@angular/core/testing'
import type { ComponentFixture } from '@angular/core/testing'
import { ActivatedRoute, convertToParamMap, provideRouter, Router } from '@angular/router'
import type { ParamMap } from '@angular/router'
import { BehaviorSubject } from 'rxjs'
import { TranslocoTestingModule } from '@jsverse/transloco'
import { CategoryService } from '@/core/category'
import type { Category, CategoryNode, CategoryType } from '@/core/category'
import th from '@/core/i18n/th.json'
import { ProfileService } from '@/core/profile'
import { CategoriesPage } from './categories-page'

const category = (id: string, extra: Partial<Category> = {}): Category => ({
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
  changeSeq: 1,
  ...extra,
})

describe('CategoriesPage', () => {
  let fixture: ComponentFixture<CategoriesPage>
  let query: BehaviorSubject<ParamMap>
  let navigate: ReturnType<typeof vi.spyOn>
  const all = signal<Category[]>([])
  const nodes = (type: CategoryType, archived: boolean): CategoryNode[] =>
    all()
      .filter((c) => c.type === type && c.parentId === null && c.isArchived === archived)
      .map((c) => ({
        category: c,
        children: all().filter((k) => k.parentId === c.id && k.isArchived === archived),
      }))
  const categories = {
    tree: (type: CategoryType, archived = false) => nodes(type, archived),
    archivedChildren: (type: CategoryType) =>
      all().filter(
        (c) =>
          c.type === type && c.isArchived && all().some((p) => p.id === c.parentId && !p.isArchived)
      ),
    openCount: (type: CategoryType) => all().filter((c) => c.type === type && !c.isArchived).length,
    byId: (id: string) => all().find((c) => c.id === id) ?? null,
    pendingIds: signal(new Set<string>()),
    canWrite: signal(true),
    atLimit: signal(false),
    open: vi.fn(),
    openFix: vi.fn(),
    moveTo: vi.fn(),
  }
  const profiles = {
    current: signal({ id: 'p1', name: 'ส่วนตัว', icon: 'lucideUser', color: '#2563eb' }),
    switchSheet: signal(false),
  }

  const page = () => fixture.nativeElement as HTMLElement
  const button = (label: string) =>
    [...page().querySelectorAll('button')].find(
      (b) => b.textContent.trim() === label || b.getAttribute('aria-label') === label
    )
  const rows = () =>
    [...page().querySelectorAll('button[aria-label^="แก้ไข "]')].map((b) =>
      b.getAttribute('aria-label')?.slice('แก้ไข '.length)
    )
  const settle = async () => {
    fixture.detectChanges()
    await fixture.whenStable()
    fixture.detectChanges()
  }

  beforeEach(async () => {
    vi.clearAllMocks()
    all.set([
      category('Food'),
      category('Coffee', { parentId: 'Food' }),
      category('Tea', { parentId: 'Food', sortOrder: 1 }),
      category('Home', { sortOrder: 1 }),
      category('Rent', { parentId: 'Home', isArchived: true }),
      category('Old', { sortOrder: 2, isArchived: true }),
      category('OldKid', { parentId: 'Old', isArchived: true }),
      category('Salary', { type: 'income' }),
    ])
    categories.pendingIds.set(new Set(['Tea']))
    categories.atLimit.set(false)
    categories.canWrite.set(true)
    query = new BehaviorSubject(convertToParamMap({}))
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
        { provide: CategoryService, useValue: categories },
        { provide: ProfileService, useValue: profiles },
        { provide: ActivatedRoute, useValue: { queryParamMap: query } },
      ],
    })
    navigate = vi.spyOn(TestBed.inject(Router), 'navigate').mockResolvedValue(true)
    fixture = TestBed.createComponent(CategoriesPage)
    await settle()
  })

  it("lists the expense tree first, with each tab's open count and pending rows marked", () => {
    const tabs = [...page().querySelectorAll('[role="tab"]')].map((t) => t.textContent.trim())
    expect(tabs).toEqual(['รายจ่าย (4)', 'รายรับ (1)'])
    expect(rows()).toEqual(['Food', 'Coffee', 'Tea', 'Home'])
    expect(page().textContent).toContain(th.categories.pending)
  })

  it('switches to the income tab and adds in the tab shown', async () => {
    button('รายรับ (1)')?.click()
    await settle()
    expect(rows()).toEqual(['Salary'])
    button(th.categories.add)?.click()
    expect(categories.open).toHaveBeenCalledWith({ mode: 'create', type: 'income', parentId: null })
  })

  it('opens a category in the sheet when its row is tapped', () => {
    button('แก้ไข Coffee')?.click()
    expect(categories.open).toHaveBeenCalledWith({ mode: 'edit', id: 'Coffee' })
  })

  it('folds the archived ones: archived parents with their children, then lone archived children', async () => {
    expect(page().textContent).toContain('เก็บถาวร (3)')
    button('เก็บถาวร (3)')?.click()
    await settle()
    expect(rows()).toEqual(['Food', 'Coffee', 'Tea', 'Home', 'Old', 'OldKid', 'Rent'])
    expect(page().textContent).toContain('ใต้ Home')
    expect(page().textContent).not.toContain('ใต้ Old')
  })

  it('opens the profile switch sheet from the profile on top', () => {
    button('เปลี่ยนโปรไฟล์ ตอนนี้ ส่วนตัว')?.click()
    expect(profiles.switchSheet()).toBe(true)
  })

  it('moves a parent or a child among its siblings with the arrow keys in order mode', async () => {
    button(th.categories.order)?.click()
    await settle()
    const handle = (name: string) =>
      page().querySelector(`button[aria-label^="ย้าย ${name} "]`) as HTMLButtonElement
    handle('Home').dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowUp' }))
    expect(categories.moveTo).toHaveBeenCalledWith('Home', 0)
    handle('Tea').dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowUp' }))
    expect(categories.moveTo).toHaveBeenCalledWith('Tea', 0)
    expect(page().textContent).toContain(th.categories.orderHint)
    expect(button(th.categories.add)).toBeUndefined()
  })

  it('says an untrusted device must be online, and blocks adding', async () => {
    categories.canWrite.set(false)
    await settle()
    expect(page().textContent).toContain(th.categories.needsOnline)
    expect(button(th.categories.add)?.disabled).toBe(true)
  })

  it('says why "add" is gone at 200 open categories', async () => {
    categories.atLimit.set(true)
    await settle()
    expect(button(th.categories.add)).toBeUndefined()
    expect(page().textContent).toContain(th.categories.limit)
  })

  it('opens the fix of a rejected op from the sync sheet, then clears the query', () => {
    query.next(convertToParamMap({ fix: 'o1' }))
    expect(categories.openFix).toHaveBeenCalledWith('o1')
    expect(navigate).toHaveBeenCalledWith([], { queryParams: {}, replaceUrl: true })
  })
})
