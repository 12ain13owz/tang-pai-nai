import { Component, signal } from '@angular/core'
import { TestBed } from '@angular/core/testing'
import { FadeIn } from './fade-in'

@Component({
  imports: [FadeIn],
  template: `<div class="area" [appFadeIn]="key()"></div>`,
})
class Host {
  key = signal('transactions')
}

describe('FadeIn', () => {
  const setup = () => {
    const fixture = TestBed.createComponent(Host)
    const element = (fixture.nativeElement as HTMLElement).querySelector<HTMLElement>('.area')!
    const animate = vi.fn(() => ({ cancel: vi.fn() }) as unknown as Animation)
    element.animate = animate
    fixture.detectChanges()
    const go = (key: string) => {
      fixture.componentInstance.key.set(key)
      fixture.detectChanges()
    }
    return { animate, go }
  }

  it('plays nothing for the first key or the same one again', () => {
    const { animate, go } = setup()
    go('transactions')
    expect(animate).not.toHaveBeenCalled()
  })

  afterEach(() => {
    Reflect.deleteProperty(window, 'matchMedia')
  })

  it('fades in with a small rise for a new key', () => {
    const { animate, go } = setup()
    go('wallets')
    expect(animate).toHaveBeenCalledWith(
      [
        { opacity: 0, transform: 'translateY(8px)' },
        { opacity: 1, transform: 'translateY(0)' },
      ],
      expect.objectContaining({ duration: 250 })
    )
  })

  it('only fades under reduced motion', () => {
    const { animate, go } = setup()
    window.matchMedia = vi.fn(() => ({ matches: true }) as MediaQueryList)
    go('wallets')
    expect(animate).toHaveBeenCalledWith([{ opacity: 0 }, { opacity: 1 }], expect.anything())
  })
})
