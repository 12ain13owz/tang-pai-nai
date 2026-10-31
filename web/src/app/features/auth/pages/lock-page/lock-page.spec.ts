import { Component, computed, signal } from '@angular/core'
import { TestBed } from '@angular/core/testing'
import type { ComponentFixture } from '@angular/core/testing'
import { provideRouter, Router } from '@angular/router'
import { TranslocoTestingModule } from '@jsverse/transloco'
import { toastState } from '@spartan-ng/brain/sonner'
import { AuthService } from '@/core/auth'
import th from '@/core/i18n/th.json'
import { OfflineService } from '@/core/offline'
import type { PinCheck } from '@/core/offline'
import type { VaultMeta } from '@/core/offline/vault-storage'
import { LockPage } from './lock-page'

@Component({ template: '' })
class Blank {}

const fakeOffline = () => {
  const meta = signal({ displayName: 'mom', failedAttempts: 0 } as VaultMeta)
  return {
    meta,
    attemptsLeft: computed(() => 5 - meta().failedAttempts),
    answer: 'ok' as PinCheck,
    unlock: vi.fn(async (_pin: string): Promise<PinCheck> => Promise.resolve(fake.answer)),
    wipe: vi.fn(async () => Promise.resolve()),
  }
}
let fake: ReturnType<typeof fakeOffline>

describe('LockPage', () => {
  let fixture: ComponentFixture<LockPage>
  const signOutOrLater = vi.fn(async () => Promise.resolve())

  const text = () => (fixture.nativeElement as HTMLElement).textContent
  const button = (name: string) =>
    [...(fixture.nativeElement as HTMLElement).querySelectorAll('button')].find(
      (b) => b.textContent.trim() === name
    ) as HTMLButtonElement
  const enter = async (pin: string) => {
    for (const digit of pin) {
      button(digit).click()
    }
    await fixture.whenStable()
    fixture.detectChanges()
  }

  beforeEach(async () => {
    vi.clearAllMocks()
    toastState.toasts().forEach((toast) => toastState.dismiss(toast.id))
    fake = fakeOffline()
    TestBed.configureTestingModule({
      imports: [
        TranslocoTestingModule.forRoot({
          langs: { th },
          translocoConfig: { availableLangs: ['th'], defaultLang: 'th' },
          preloadLangs: true,
        }),
      ],
      providers: [
        provideRouter([{ path: '**', component: Blank }]),
        { provide: OfflineService, useValue: fake },
        { provide: AuthService, useValue: { signOutOrLater } },
      ],
    })
    await TestBed.inject(Router).navigateByUrl('/auth/lock?returnUrl=%2Fwallets')
    fixture = TestBed.createComponent(LockPage)
    fixture.detectChanges()
  })

  it('greets the user and unlocks back to where they were', async () => {
    expect(text()).toContain(th.lock.hello.replace('{{name}}', 'mom'))
    const navigate = vi.spyOn(TestBed.inject(Router), 'navigateByUrl')

    await enter('123456')
    expect(fake.unlock).toHaveBeenCalledWith('123456')
    expect(navigate).toHaveBeenCalledWith('/wallets', { replaceUrl: true })
  })

  it('says a PIN was wrong, and warns from the 3rd wrong one in a row (rule 3)', async () => {
    fake.answer = 'wrong'
    await enter('000000')
    expect(text()).toContain(th.lock.wrong)
    expect(text()).not.toContain(th.lock.warning.slice(0, 8))

    fake.meta.set({ displayName: 'mom', failedAttempts: 3 } as VaultMeta)
    fixture.detectChanges()
    expect(text()).toContain(th.lock.warning.replace('{{count}}', '2'))
  })

  it('goes to sign-in with a notice once the 5th wrong PIN wiped the device', async () => {
    fake.answer = 'wiped'
    const navigate = vi.spyOn(TestBed.inject(Router), 'navigateByUrl')

    await enter('000000')
    expect(navigate).toHaveBeenCalledWith('/auth/sign-in', { replaceUrl: true })
    expect(toastState.toasts().map((toast) => toast.title)).toEqual([th.lock.wiped])
  })

  it('asks before signing out for a forgotten PIN, then wipes and signs out', async () => {
    button(th.lock.forgot).click()
    fixture.detectChanges()
    expect(text()).toContain(th.lock.signOutConfirmText)
    expect(fake.wipe).not.toHaveBeenCalled()

    button(th.lock.signOut).click()
    await fixture.whenStable()
    expect(fake.wipe).toHaveBeenCalledTimes(1)
    expect(signOutOrLater).toHaveBeenCalledTimes(1)
  })
})
