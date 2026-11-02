import { TestBed } from '@angular/core/testing'
import { QUICK_AMOUNTS, QuickAmountsService } from './quick-amounts'

describe('QuickAmountsService', () => {
  beforeEach(() => localStorage.clear())

  it('is on by default with the Thai banknotes', () => {
    expect(TestBed.inject(QuickAmountsService).enabled()).toBe(true)
    expect(QUICK_AMOUNTS).toEqual([20, 50, 100, 500, 1000])
  })

  it('keeps the choice on the device', () => {
    TestBed.inject(QuickAmountsService).setEnabled(false)
    expect(localStorage.getItem('tpn-quick-amounts')).toBe('off')
    TestBed.resetTestingModule()
    expect(TestBed.inject(QuickAmountsService).enabled()).toBe(false)
  })
})
