import { isProfileTab } from './profile-routes'

describe('isProfileTab', () => {
  it('is true on the tabs that show a profile, their child pages and queries', () => {
    for (const url of ['/transactions', '/transactions/new', '/wallets', '/reports?x=1']) {
      expect(isProfileTab(url)).toBe(true)
    }
  })

  it('is false elsewhere, including look-alike paths', () => {
    for (const url of ['/account', '/account/profiles', '/auth/lock', '/walletsx', '/']) {
      expect(isProfileTab(url)).toBe(false)
    }
  })
})
