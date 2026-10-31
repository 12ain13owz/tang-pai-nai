import { Component, computed, signal } from '@angular/core'
import { TestBed } from '@angular/core/testing'
import type { ComponentFixture } from '@angular/core/testing'
import { provideRouter, Router } from '@angular/router'
import { TranslocoTestingModule } from '@jsverse/transloco'
import { toastState } from '@spartan-ng/brain/sonner'
import th from '@/core/i18n/th.json'
import { OfflineService } from '@/core/offline'
import type { PinCheck } from '@/core/offline'
import { PinPage } from './pin-page'

@Component({ template: '' })
class Blank {}

describe('PinPage', () => {
  let fixture: ComponentFixture<PinPage>
  const offline = {
    isTrusted: signal(false),
    meta: signal(null),
    attemptsLeft: computed(() => 5),
    check: 'ok' as PinCheck,
    enable: vi.fn(async (_pin: string) => Promise.resolve()),
    verifyPin: vi.fn(async (_pin: string): Promise<PinCheck> => Promise.resolve(offline.check)),
    changePin: vi.fn(async (_pin: string) => Promise.resolve()),
  }

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
  const open = (trusted: boolean) => {
    offline.isTrusted.set(trusted)
    fixture = TestBed.createComponent(PinPage)
    fixture.detectChanges()
  }

  beforeEach(() => {
    vi.clearAllMocks()
    offline.check = 'ok'
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
        provideRouter([{ path: '**', component: Blank }]),
        { provide: OfflineService, useValue: offline },
      ],
    })
  })

  it('turns offline on with a new PIN on an untrusted device', async () => {
    open(false)
    const navigate = vi.spyOn(TestBed.inject(Router), 'navigateByUrl')
    expect(text()).toContain(th.pin.newHeading)

    await enter('112233')
    await enter('112233')
    expect(offline.enable).toHaveBeenCalledWith('112233')
    expect(toastState.toasts().map((toast) => toast.title)).toEqual([th.pin.offlineOn])
    expect(navigate).toHaveBeenCalledWith('/account/security')
  })

  it('asks for the current PIN first and says at once when it is wrong', async () => {
    open(true)
    expect(text()).toContain(th.pin.currentHeading)

    offline.check = 'wrong'
    await enter('999999')
    expect(offline.verifyPin).toHaveBeenCalledWith('999999')
    expect(text()).toContain(th.lock.wrong)
    expect(text()).toContain(th.pin.currentHeading)
  })

  it('changes the PIN once the current one is right', async () => {
    open(true)
    const navigate = vi.spyOn(TestBed.inject(Router), 'navigateByUrl')

    await enter('123456')
    expect(text()).toContain(th.pin.changeHeading)
    await enter('654321')
    await enter('654321')

    expect(offline.changePin).toHaveBeenCalledWith('654321')
    expect(offline.enable).not.toHaveBeenCalled()
    expect(toastState.toasts().map((toast) => toast.title)).toEqual([th.pin.changed])
    expect(navigate).toHaveBeenCalledWith('/account/security')
  })

  it('goes to sign-in when the 5th wrong current PIN wiped the device', async () => {
    open(true)
    const navigate = vi.spyOn(TestBed.inject(Router), 'navigateByUrl')

    offline.check = 'wiped'
    await enter('999999')
    expect(navigate).toHaveBeenCalledWith('/auth/sign-in', { replaceUrl: true })
    expect(toastState.toasts().map((toast) => toast.title)).toEqual([th.lock.wiped])
  })
})
