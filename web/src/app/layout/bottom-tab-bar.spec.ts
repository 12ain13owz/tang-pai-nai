import { signal } from '@angular/core'
import { TestBed } from '@angular/core/testing'
import { provideRouter, Router } from '@angular/router'
import { TranslocoTestingModule } from '@jsverse/transloco'
import th from '@/core/i18n/th.json'
import { ProfileService } from '@/core/profile'
import { TransactionService } from '@/core/transaction'
import { WalletService } from '@/core/wallet'
import { BottomTabBar } from './bottom-tab-bar'

describe('BottomTabBar', () => {
  const hasWallet = signal(false)
  const current = signal<{ id: string } | null>(null)
  const open = vi.fn()

  const render = () => {
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
        { provide: WalletService, useValue: { hasWallet } },
        { provide: ProfileService, useValue: { current } },
        { provide: TransactionService, useValue: { open } },
      ],
    })
    const fixture = TestBed.createComponent(BottomTabBar)
    fixture.detectChanges()
    return fixture
  }
  const plus = (element: HTMLElement) =>
    element.querySelector<HTMLButtonElement>(`button[aria-label="${th.nav.add}"]`)

  beforeEach(() => {
    open.mockClear()
  })

  it('sends ➕ to the Transactions tab while there is no profile or wallet (wallet rule 12)', () => {
    hasWallet.set(false)
    current.set({ id: 'p1' })
    const fixture = render()
    const navigate = vi.spyOn(TestBed.inject(Router), 'navigate').mockResolvedValue(true)
    plus(fixture.nativeElement as HTMLElement)?.click()
    expect(navigate).toHaveBeenCalledWith(['/transactions'])
    expect(open).not.toHaveBeenCalled()
  })

  it('opens the transaction form once the profile has a wallet', () => {
    hasWallet.set(true)
    current.set({ id: 'p1' })
    const fixture = render()
    plus(fixture.nativeElement as HTMLElement)?.click()
    expect(open).toHaveBeenCalledWith({ mode: 'create' })
  })

  it('marks the active tab by colour and weight only, with no pill behind the icon', () => {
    const fixture = render()
    const tab = (fixture.nativeElement as HTMLElement).querySelector('a[href="/wallets"]')
    expect(tab?.className).toContain('[&.active]:text-brand')
    expect(tab?.innerHTML).not.toContain('bg-muted')
  })

  it('puts a dot on the Account tab while invitations to me wait (sharing.md)', () => {
    const fixture = render()
    const element = fixture.nativeElement as HTMLElement
    expect(element.querySelector('[data-testid="account-dot"]')).toBeNull()
    fixture.componentRef.setInput('accountDot', true)
    fixture.detectChanges()
    const dot = element.querySelector('[data-testid="account-dot"]')
    expect(dot?.closest('a')?.getAttribute('href')).toBe('/account')
    expect(element.textContent).toContain(th.sharing.invitesPending)
  })
})
