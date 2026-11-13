import { Component, signal } from '@angular/core'
import { TestBed } from '@angular/core/testing'
import { Slide } from './slide'

@Component({
  imports: [Slide],
  template: `<div class="area" [appSlide]="place()"></div>`,
})
class Host {
  place = signal(1)
}

describe('Slide', () => {
  const setup = (reduced = false) => {
    const fixture = TestBed.createComponent(Host)
    const element = (fixture.nativeElement as HTMLElement).querySelector<HTMLElement>('.area')!
    const animate = vi.fn(() => ({ cancel: vi.fn() }) as unknown as Animation)
    element.animate = animate
    const view = element.ownerDocument.defaultView!
    view.matchMedia = vi.fn(() => ({ matches: reduced }) as MediaQueryList)
    fixture.detectChanges()
    const go = (place: number) => {
      fixture.componentInstance.place.set(place)
      fixture.detectChanges()
    }
    return { animate, go }
  }

  afterEach(() => {
    Reflect.deleteProperty(window, 'matchMedia')
  })

  it('plays nothing for the first place', () => {
    const { animate } = setup()
    expect(animate).not.toHaveBeenCalled()
  })

  it('enters from the right for a later place and from the left for an earlier one', () => {
    const { animate, go } = setup()
    go(2)
    expect(animate).toHaveBeenLastCalledWith(
      [{ opacity: 0, transform: 'translateX(48px)' }, expect.objectContaining({ opacity: 1 })],
      expect.objectContaining({ duration: 220 })
    )
    go(0)
    expect(animate).toHaveBeenLastCalledWith(
      [{ opacity: 0, transform: 'translateX(-48px)' }, expect.objectContaining({ opacity: 1 })],
      expect.anything()
    )
  })

  it('plays nothing for the same place or one outside the row', () => {
    const { animate, go } = setup()
    go(1)
    go(-1)
    go(0)
    expect(animate).not.toHaveBeenCalled()
  })

  it('only fades under reduced motion', () => {
    const { animate, go } = setup(true)
    go(2)
    expect(animate).toHaveBeenLastCalledWith([{ opacity: 0 }, { opacity: 1 }], expect.anything())
  })
})
