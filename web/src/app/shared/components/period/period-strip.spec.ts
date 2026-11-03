import { Component, signal } from '@angular/core'
import { TestBed } from '@angular/core/testing'
import { PeriodStrip } from './period-strip'
import { Swipe } from './swipe'
import type { PeriodChip } from './period-strip'

@Component({
  imports: [PeriodStrip, Swipe],
  template: `
    <app-period-strip
      label="ช่วงเวลา"
      [chips]="chips"
      [selected]="selected()"
      (chosen)="selected.set($event)"
    />
    <div class="area" appSwipe (swiped)="swiped.push($event)"></div>
  `,
})
class Host {
  chips: PeriodChip[] = [
    { id: -1, label: 'เดือนที่แล้ว' },
    { id: 0, label: 'เดือนนี้' },
    { id: 'future', label: 'อนาคต' },
  ]
  selected = signal<number | string>(0)
  swiped: number[] = []
}

/** A pointer event with a type (jsdom has no PointerEvent constructor). */
const pointer = (type: string, pointerType: string, x: number, y: number) => {
  const event = new MouseEvent(type, { clientX: x, clientY: y, bubbles: true })
  Object.defineProperty(event, 'pointerType', { value: pointerType })
  return event
}

describe('PeriodStrip and Swipe', () => {
  const setup = () => {
    const fixture = TestBed.createComponent(Host)
    fixture.detectChanges()
    const element = fixture.nativeElement as HTMLElement
    return { fixture, element, host: fixture.componentInstance }
  }

  it('marks the chosen chip and emits the one tapped', () => {
    const { fixture, element, host } = setup()
    const tabs = [...element.querySelectorAll<HTMLElement>('[role="tab"]')]
    expect(element.querySelector('[role="tablist"]')?.getAttribute('aria-label')).toBe('ช่วงเวลา')
    expect(tabs.map((tab) => tab.getAttribute('aria-selected'))).toEqual(['false', 'true', 'false'])
    tabs[2].click()
    fixture.detectChanges()
    expect(host.selected()).toBe('future')
    expect(tabs[2].getAttribute('aria-selected')).toBe('true')
  })

  it('turns a sideways touch swipe into the next (+1) or previous (−1) period', () => {
    const { element, host } = setup()
    const area = element.querySelector<HTMLElement>('.area')
    const swipe = (pointerType: string, dx: number, dy: number) => {
      area?.dispatchEvent(pointer('pointerdown', pointerType, 200, 300))
      area?.dispatchEvent(pointer('pointerup', pointerType, 200 + dx, 300 + dy))
    }
    swipe('touch', -100, 5)
    swipe('touch', 90, -10)
    // Not a swipe: a mouse drag, a short move, a scroll.
    swipe('mouse', -100, 0)
    swipe('touch', -40, 0)
    swipe('touch', -100, 80)
    expect(host.swiped).toEqual([1, -1])
  })
})
