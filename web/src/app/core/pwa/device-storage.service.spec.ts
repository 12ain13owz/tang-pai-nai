import { TestBed } from '@angular/core/testing'
import { DeviceStorageService } from './device-storage.service'

/** A `beforeinstallprompt` event as Chrome sends it, answering with `outcome`. */
const installEvent = (outcome: 'accepted' | 'dismissed') =>
  Object.assign(new Event('beforeinstallprompt', { cancelable: true }), {
    prompt: vi.fn(async () => Promise.resolve()),
    userChoice: Promise.resolve({ outcome }),
  })

describe('DeviceStorageService (install.md)', () => {
  const setup = (agent = 'Mozilla/5.0 (Linux; Android 14)', touchPoints = 5) => {
    // jsdom has neither `matchMedia` nor a storage manager.
    window.matchMedia = vi.fn(() => ({
      matches: false,
      addEventListener: vi.fn(),
    })) as unknown as typeof window.matchMedia
    Object.defineProperty(navigator, 'storage', {
      configurable: true,
      value: { persisted: async () => Promise.resolve(false) },
    })
    vi.spyOn(navigator, 'userAgent', 'get').mockReturnValue(agent)
    Object.defineProperty(navigator, 'maxTouchPoints', { configurable: true, value: touchPoints })
    return TestBed.inject(DeviceStorageService)
  }

  afterEach(() => {
    Reflect.deleteProperty(window, 'matchMedia')
    Reflect.deleteProperty(navigator, 'storage')
    Reflect.deleteProperty(navigator, 'maxTouchPoints')
    vi.restoreAllMocks()
  })

  it('keeps the install offer for its button and uses it once (rule 2)', async () => {
    const service = setup()
    expect(service.canPrompt()).toBe(false)
    const event = installEvent('accepted')
    window.dispatchEvent(event)
    // The browser's own mini bar is held back.
    expect(event.defaultPrevented).toBe(true)
    expect(service.canPrompt()).toBe(true)
    expect(await service.promptInstall()).toBe(true)
    expect(event.prompt).toHaveBeenCalledOnce()
    expect(service.canPrompt()).toBe(false)
    expect(await service.promptInstall()).toBe(false)
  })

  it('answers false when the person dismisses the dialog', async () => {
    const service = setup()
    window.dispatchEvent(installEvent('dismissed'))
    expect(await service.promptInstall()).toBe(false)
  })

  it('knows it was installed from this tab', () => {
    const service = setup()
    window.dispatchEvent(installEvent('accepted'))
    window.dispatchEvent(new Event('appinstalled'))
    expect(service.justInstalled()).toBe(true)
    expect(service.canPrompt()).toBe(false)
  })

  it('picks the steps for the platform; iPadOS counts as iPhone (rule 3)', () => {
    expect(setup().platform).toBe('android')
    TestBed.resetTestingModule()
    expect(setup('Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X)').platform).toBe('ios')
    TestBed.resetTestingModule()
    expect(setup('Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7)', 5).platform).toBe('ios')
    TestBed.resetTestingModule()
    expect(setup('Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7)', 0).platform).toBe('android')
  })
})
