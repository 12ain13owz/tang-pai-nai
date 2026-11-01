import { isProfileTab, isWalletTab, parentOf } from './profile-routes'

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

describe('isWalletTab', () => {
  it('is true on the tabs that need a wallet (wallet rule 12)', () => {
    for (const url of ['/transactions', '/transactions/new', '/wallets', '/wallets?x=1']) {
      expect(isWalletTab(url)).toBe(true)
    }
  })

  it('is false on Reports, Account and look-alike paths', () => {
    for (const url of ['/reports', '/account', '/walletsx', '/']) {
      expect(isWalletTab(url)).toBe(false)
    }
  })
})

describe('parentOf', () => {
  it('goes back to the Account tab from a page inside it (owner A1 in #7)', () => {
    for (const url of ['/account/categories', '/account/profiles?fix=o1', '/account/security#x']) {
      expect(parentOf(url)).toBe('/account')
    }
  })

  it('has no parent on a tab itself or elsewhere', () => {
    for (const url of ['/account', '/account?x=1', '/wallets', '/accounts/x', '/']) {
      expect(parentOf(url)).toBeNull()
    }
  })
})
