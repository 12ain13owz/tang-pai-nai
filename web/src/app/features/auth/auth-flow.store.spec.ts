import { TestBed } from '@angular/core/testing'
import { AuthFlowStore } from './auth-flow.store'

describe('AuthFlowStore', () => {
  beforeEach(() => sessionStorage.clear())

  it('keeps the pending email across a reload, with a 60 s resend lock', () => {
    const before = Date.now()
    TestBed.inject(AuthFlowStore).start('mom@example.com', '/wallets')

    TestBed.resetTestingModule()
    const pending = TestBed.inject(AuthFlowStore).pending()

    expect(pending).toMatchObject({ email: 'mom@example.com', returnUrl: '/wallets' })
    expect(pending.resendAt - before).toBeGreaterThanOrEqual(60_000)
  })

  it('forgets everything on clear', () => {
    const store = TestBed.inject(AuthFlowStore)
    store.start('mom@example.com', '/')

    store.clear()

    expect(store.pending().email).toBe('')
    expect(sessionStorage.getItem('tpn-sign-in')).toBeNull()
  })
})
