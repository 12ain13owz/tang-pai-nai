import { RouterTestingHarness } from '@angular/router/testing'
import { toastState } from '@spartan-ng/brain/sonner'
import { setUpDebts } from '@/core/debt/debt-testing'
import type { LocalDatabase } from '@/core/offline'
import { toDay } from '@/shared/utils'
import { ExportPage } from './export-page'

describe('ExportPage (docs/features/export.md rules 1–4)', () => {
  let db: LocalDatabase
  let harness: RouterTestingHarness
  let saved: Blob[]
  let names: string[]

  const body = () => document.body
  const text = () => body().textContent.replace(/\s+/g, ' ')
  const settle = async () => {
    harness.detectChanges()
    await harness.fixture.whenStable()
    harness.detectChanges()
  }
  const button = (pattern: RegExp) =>
    [...body().querySelectorAll('button')].filter((b) => pattern.test(b.textContent)).at(-1)
  const radio = (name: string, index: number) =>
    body().querySelectorAll<HTMLInputElement>(`input[name="${name}"]`)[index]
  const tick = async (label: string) => {
    const row = [...body().querySelectorAll('hlm-drawer-content label')].find((item) =>
      item.textContent.trim().startsWith(label)
    )
    expect(row, label).toBeDefined()
    row?.querySelector('input')?.click()
    await settle()
  }

  beforeEach(async () => {
    toastState.dismiss()
    localStorage.clear()
    saved = []
    names = []
    URL.createObjectURL = (blob: Blob | MediaSource) => {
      saved.push(blob as Blob)
      return 'blob:test'
    }
    URL.revokeObjectURL = () => undefined
    vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(function (
      this: HTMLAnchorElement
    ) {
      names.push(this.download)
    })
    const setup = await setUpDebts('2026-11-09', [{ path: 'export', component: ExportPage }])
    db = setup.db
    setup.transaction('t1', { occurredOn: '2026-10-05' })
    setup.transaction('t2', { occurredOn: '2026-11-01', categoryId: 'gift', walletId: 'cash' })
    setup.pulled('transfers', {
      id: 'r1',
      profileId: 'p1',
      fromWalletId: 'bank',
      toWalletId: 'cash',
      amount: 100000,
      occurredOn: '2026-10-03',
      note: '',
      recurringId: null,
    })
    harness = await RouterTestingHarness.create()
    await harness.navigateByUrl('/export')
    await settle()
  })

  afterEach(() => {
    vi.restoreAllMocks()
    toastState.dismiss()
    db.close()
  })

  it('starts on everything, with the data span and a live count', () => {
    expect(text()).toContain('ธุรกรรมของโปรไฟล์ ครอบครัว')
    expect(text()).toContain('03/10/2026 – 01/11/2026')
    expect(text()).toContain('2 ใบ รวมที่เก็บถาวรแล้ว')
    expect(button(/ส่งออก 4 รายการ/)).toBeDefined()
  })

  it('counts only the chosen categories and turns transfers off (rule 2)', async () => {
    radio('export-categories', 1).click()
    await settle()
    expect(text()).toContain('เลือกหมวด')
    const income = [...body().querySelectorAll<HTMLButtonElement>('[role="tab"]')].find((tab) =>
      tab.textContent.includes('รายรับ')
    )
    income?.click()
    await settle()
    await tick('gift')
    button(/^\s*เสร็จ\s*$/)?.click()
    await settle()
    expect(text()).toContain('1 หมวด · รายรับ')
    expect(text()).toContain('เลือกบางหมวดแล้ว การโอนและยืม-คืนไม่มีหมวด')
    expect(button(/ส่งออก 1 รายการ/)).toBeDefined()
  })

  it('goes back to "all" when the picker closes with nothing chosen', async () => {
    radio('export-wallets', 1).click()
    await settle()
    const close = [...body().querySelectorAll<HTMLButtonElement>('hlm-drawer-content button')].find(
      (b) => b.getAttribute('aria-label') === 'ปิด'
    )
    close?.click()
    await settle()
    expect(radio('export-wallets', 0).checked).toBe(true)
  })

  it('downloads the file on a computer and says how many rows it holds (rule 3)', async () => {
    button(/ส่งออก 4 รายการ/)?.click()
    await new Promise((resolve) => setTimeout(resolve))
    await settle()
    // The file is named after the device's date, not the page's fixed one.
    expect(names).toEqual([`tangpainai-${toDay()}.csv`])
    const csv = await saved[0].text()
    expect(csv.split('\r\n')).toHaveLength(6)
    expect(toastState.toasts().map((toast) => toast.title)).toEqual(['ส่งออก 4 รายการแล้ว'])
  })

  it('narrows the dates to a custom range', async () => {
    radio('export-dates', 1).click()
    await settle()
    const range = [...body().querySelectorAll('button')].find((b) =>
      b.textContent.includes('03/10/2026 – 01/11/2026')
    )
    expect(range).toBeDefined()
    range?.click()
    await settle()
    const [from, to] = body().querySelectorAll<HTMLInputElement>(
      'hlm-drawer-content input[type="date"]'
    )
    from.value = '2026-10-04'
    from.dispatchEvent(new Event('input'))
    to.value = '2026-10-31'
    to.dispatchEvent(new Event('input'))
    body().querySelector('hlm-drawer-content form')?.dispatchEvent(new Event('submit'))
    await settle()
    expect(button(/ส่งออก 1 รายการ/)).toBeDefined()
  })
})
