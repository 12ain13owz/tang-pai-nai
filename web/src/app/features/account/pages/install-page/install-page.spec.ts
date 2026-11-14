import { signal } from '@angular/core'
import { TestBed } from '@angular/core/testing'
import { TranslocoTestingModule } from '@jsverse/transloco'
import th from '@/core/i18n/th.json'
import { DeviceStorageService } from '@/core/pwa'
import type { InstallPlatform } from '@/core/pwa'
import { InstallPage } from './install-page'

describe('InstallPage', () => {
  const setup = async (
    options: { installed?: boolean; canPrompt?: boolean; platform?: InstallPlatform } = {}
  ) => {
    const device = {
      isInstalled: signal(options.installed ?? false),
      justInstalled: signal(false),
      canPrompt: signal(options.canPrompt ?? false),
      platform: options.platform ?? 'ios',
      promptInstall: vi.fn(async () => Promise.resolve(false)),
    }
    TestBed.configureTestingModule({
      imports: [
        TranslocoTestingModule.forRoot({
          langs: { th },
          translocoConfig: { availableLangs: ['th'], defaultLang: 'th' },
        }),
      ],
      providers: [{ provide: DeviceStorageService, useValue: device }],
    })
    const fixture = TestBed.createComponent(InstallPage)
    await fixture.whenStable()
    const page = fixture.nativeElement as HTMLElement
    const settle = async () => {
      await fixture.whenStable()
    }
    const steps = () => [...page.querySelectorAll('ol li')].map((li) => li.textContent.trim())
    return { device, page, settle, steps }
  }

  it('only says so once the app is installed (rule 1)', async () => {
    const { page, steps } = await setup({ installed: true })
    expect(page.textContent).toContain(th.install.doneHeading)
    expect(page.textContent).toContain(th.install.doneText)
    expect(steps()).toEqual([])
  })

  it("starts on the phone's own steps and switches platform (rule 3)", async () => {
    const { page, settle, steps } = await setup({ platform: 'ios' })
    expect(steps()).toEqual([
      `1${th.install.ios1}`,
      `2${th.install.ios2}`,
      `3${th.install.ios3}`,
      `4${th.install.ios4}`,
    ])
    expect(page.textContent).toContain(th.install.iosNote)
    // No install offer from the browser: no button.
    expect(page.textContent).not.toContain(th.install.button)
    const android = [...page.querySelectorAll('label')].find(
      (label) => label.textContent.trim() === th.install.android
    )
    android?.click()
    await settle()
    expect(steps()[1]).toBe(`2${th.install.android2}`)
    expect(page.textContent).toContain(th.install.androidNote)
  })

  it("offers one-tap install where the browser does, and says so when it's dismissed (rule 2)", async () => {
    const { device, page, settle } = await setup({ canPrompt: true, platform: 'android' })
    const button = [...page.querySelectorAll('button')].find((item) =>
      item.textContent.includes(th.install.button)
    )
    button?.click()
    await settle()
    expect(device.promptInstall).toHaveBeenCalledOnce()
    expect(page.textContent).toContain(th.install.dismissed)
  })
})
