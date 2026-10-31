import { Component, signal, viewChild } from '@angular/core'
import { TestBed } from '@angular/core/testing'
import type { ComponentFixture } from '@angular/core/testing'
import { PinPad } from './pin-pad'

@Component({
  imports: [PinPad],
  template: `
    <app-pin-pad
      filledLabel="filled"
      deleteLabel="delete"
      [disabled]="disabled()"
      (completed)="pins.push($event)"
    />
  `,
})
class Host {
  pad = viewChild.required(PinPad)
  disabled = signal(false)
  pins: string[] = []
}

describe('PinPad', () => {
  let fixture: ComponentFixture<Host>

  const key = (name: string) =>
    [...(fixture.nativeElement as HTMLElement).querySelectorAll('button')].find(
      (button) => button.textContent.trim() === name || button.getAttribute('aria-label') === name
    ) as HTMLButtonElement
  const press = (digits: string) => {
    for (const digit of digits) {
      key(digit).click()
    }
    fixture.detectChanges()
  }
  const filledDots = () =>
    (fixture.nativeElement as HTMLElement).querySelectorAll('span.bg-foreground').length

  beforeEach(() => {
    fixture = TestBed.createComponent(Host)
    fixture.detectChanges()
  })

  it('emits the PIN on the sixth digit and fills a dot per digit', () => {
    press('12345')
    expect(filledDots()).toBe(5)
    expect(fixture.componentInstance.pins).toEqual([])

    press('6')
    expect(fixture.componentInstance.pins).toEqual(['123456'])
    press('7')
    expect(fixture.componentInstance.pins).toEqual(['123456'])
  })

  it('deletes the last digit, and starts over after clear()', () => {
    press('12')
    key('delete').click()
    fixture.detectChanges()
    expect(fixture.componentInstance.pad().length()).toBe(1)

    fixture.componentInstance.pad().clear()
    fixture.detectChanges()
    expect(filledDots()).toBe(0)
  })

  it('takes digits and Backspace from a hardware keyboard', () => {
    for (const k of ['9', '8', 'Backspace', '7']) {
      document.dispatchEvent(new KeyboardEvent('keydown', { key: k }))
    }
    expect(fixture.componentInstance.pad().length()).toBe(2)
    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'a' }))
    expect(fixture.componentInstance.pad().length()).toBe(2)
  })

  it('ignores presses while disabled', () => {
    fixture.componentInstance.disabled.set(true)
    fixture.detectChanges()
    expect(key('1').disabled).toBe(true)
    document.dispatchEvent(new KeyboardEvent('keydown', { key: '1' }))
    expect(fixture.componentInstance.pad().length()).toBe(0)
  })
})
