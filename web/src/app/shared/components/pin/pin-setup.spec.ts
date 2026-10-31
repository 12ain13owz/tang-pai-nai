import { TestBed } from '@angular/core/testing'
import type { ComponentFixture } from '@angular/core/testing'
import { TranslocoTestingModule } from '@jsverse/transloco'
import th from '@/core/i18n/th.json'
import { PinSetup } from './pin-setup'

describe('PinSetup', () => {
  let fixture: ComponentFixture<PinSetup>
  let chosen: string[]

  const text = () => (fixture.nativeElement as HTMLElement).textContent
  const press = (digits: string) => {
    const buttons = [...(fixture.nativeElement as HTMLElement).querySelectorAll('button')]
    for (const digit of digits) {
      buttons.find((button) => button.textContent.trim() === digit)?.click()
    }
    fixture.detectChanges()
  }

  beforeEach(() => {
    TestBed.configureTestingModule({
      imports: [
        TranslocoTestingModule.forRoot({
          langs: { th },
          translocoConfig: { availableLangs: ['th'], defaultLang: 'th' },
          preloadLangs: true,
        }),
      ],
    })
    fixture = TestBed.createComponent(PinSetup)
    chosen = []
    fixture.componentInstance.chosen.subscribe((pin) => chosen.push(pin))
    fixture.detectChanges()
  })

  it('asks for the PIN twice and emits it once both match', () => {
    expect(text()).toContain(th.pin.newHeading)
    press('246810')
    expect(text()).toContain(th.pin.confirmHeading)
    expect(chosen).toEqual([])

    press('246810')
    expect(chosen).toEqual(['246810'])
  })

  it('starts over with one error line when the second entry differs', () => {
    press('246810')
    press('246811')

    expect(chosen).toEqual([])
    expect(text()).toContain(th.pin.mismatch)
    expect(text()).toContain(th.pin.newHeading)

    press('111111')
    expect(text()).not.toContain(th.pin.mismatch)
  })

  it('uses the heading it is given for the first step', () => {
    fixture.componentRef.setInput('newHeading', 'pin.changeHeading')
    fixture.detectChanges()
    expect(text()).toContain(th.pin.changeHeading)
  })
})
