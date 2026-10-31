import { Component, signal } from '@angular/core'
import { TestBed } from '@angular/core/testing'
import type { ComponentFixture } from '@angular/core/testing'
import { provideRouter, Router } from '@angular/router'
import { TranslocoTestingModule } from '@jsverse/transloco'
import { AuthStore } from '@/core/auth'
import th from '@/core/i18n/th.json'
import { OfflineService } from '@/core/offline'
import { DeviceStorageService } from '@/core/pwa'
import { TrustPage } from './trust-page'

@Component({ template: '' })
class Blank {}

describe('TrustPage', () => {
  let fixture: ComponentFixture<TrustPage>
  const enable = vi.fn(async (_pin: string) => Promise.resolve())
  const installed = signal(false)

  const text = () => (fixture.nativeElement as HTMLElement).textContent
  const button = (name: string) =>
    [...(fixture.nativeElement as HTMLElement).querySelectorAll('button')].find(
      (b) => b.textContent.trim() === name
    ) as HTMLButtonElement
  const enter = (pin: string) => {
    for (const digit of pin) {
      button(digit).click()
    }
    fixture.detectChanges()
  }
  const open = async () => {
    await TestBed.inject(Router).navigateByUrl('/auth/trust?returnUrl=%2Freports')
    TestBed.inject(AuthStore).freshSignIn.set(true)
    fixture = TestBed.createComponent(TrustPage)
    fixture.detectChanges()
  }

  beforeEach(() => {
    vi.clearAllMocks()
    installed.set(false)
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
        { provide: OfflineService, useValue: { enable } },
        {
          provide: DeviceStorageService,
          useValue: { isInstalled: installed, isPersisted: signal(null) },
        },
      ],
    })
  })

  it('starts off in a browser tab and on in the installed app (rule 1)', async () => {
    await open()
    expect(fixture.componentInstance.form.controls.offline.value).toBe(false)
    expect(text()).toContain(th.trust.offHint)

    installed.set(true)
    await open()
    expect(fixture.componentInstance.form.controls.offline.value).toBe(true)
    expect(text()).toContain(th.trust.onHint)
  })

  it('continues online only without a PIN when left off', async () => {
    await open()
    const navigate = vi.spyOn(TestBed.inject(Router), 'navigateByUrl')

    button(th.trust.continue).click()
    await fixture.whenStable()
    expect(enable).not.toHaveBeenCalled()
    expect(navigate).toHaveBeenCalledWith('/reports', { replaceUrl: true })
    expect(TestBed.inject(AuthStore).freshSignIn()).toBe(false)
  })

  it('trusts the device with the PIN typed twice, then goes on', async () => {
    await open()
    fixture.componentInstance.form.controls.offline.setValue(true)
    const navigate = vi.spyOn(TestBed.inject(Router), 'navigateByUrl')

    button(th.trust.continue).click()
    fixture.detectChanges()
    expect(text()).toContain(th.pin.newHeading)
    enter('135790')
    enter('135790')
    await fixture.whenStable()

    expect(enable).toHaveBeenCalledWith('135790')
    await vi.waitFor(() =>
      expect(navigate).toHaveBeenCalledWith('/reports', { replaceUrl: true })
    )
  })

  it('says so and asks for the PIN again when trusting fails', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => undefined)
    enable.mockRejectedValueOnce(new Error('quota'))
    await open()
    fixture.componentInstance.form.controls.offline.setValue(true)
    button(th.trust.continue).click()
    fixture.detectChanges()

    enter('135790')
    enter('135790')
    await fixture.whenStable()
    fixture.detectChanges()
    expect(text()).toContain(th.trust.failed)
    expect(text()).toContain(th.pin.newHeading)
  })
})
