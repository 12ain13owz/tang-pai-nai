import { Component, inject } from '@angular/core'
import { TestBed } from '@angular/core/testing'
import { NonNullableFormBuilder } from '@angular/forms'
import { ToggleListField } from './toggle-list-field'
import type { ToggleListItem } from './toggle-list-field'

const item = (id: string): ToggleListItem => ({
  id,
  label: id,
  icon: 'lucideWallet',
  color: '#2563eb',
  fallback: 'lucideWallet',
})

@Component({
  imports: [ToggleListField],
  template: `<app-toggle-list-field [control]="control" label="Wallets" [items]="items" />`,
})
class Host {
  control = inject(NonNullableFormBuilder).control<string[]>(['b'])
  items = [item('a'), item('b')]
}

describe('ToggleListField', () => {
  const setup = async () => {
    const fixture = TestBed.createComponent(Host)
    await fixture.whenStable()
    const element = fixture.nativeElement as HTMLElement
    const checked = () =>
      [...element.querySelectorAll('[role="switch"]')].map((row) =>
        row.getAttribute('aria-checked')
      )
    return { fixture, element, checked }
  }

  it('shows the ids in the control as off', async () => {
    const { checked } = await setup()
    expect(checked()).toEqual(['true', 'false'])
  })

  it('toggles a row when it is tapped', async () => {
    const { fixture, element, checked } = await setup()
    ;(element.querySelector('[role="switch"]') as HTMLElement).click()
    await fixture.whenStable()
    expect(checked()).toEqual(['false', 'false'])
    expect(fixture.componentInstance.control.value).toEqual(['b', 'a'])
  })

  // The share sheet's "เลือกทั้งหมด" / "ล้างที่เลือก" sets the control from outside.
  it('follows a value set from outside', async () => {
    const { fixture, checked } = await setup()
    fixture.componentInstance.control.setValue(['a', 'b'])
    await fixture.whenStable()
    expect(checked()).toEqual(['false', 'false'])
    fixture.componentInstance.control.setValue([])
    await fixture.whenStable()
    expect(checked()).toEqual(['true', 'true'])
  })
})
