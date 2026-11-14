import { isProfileTab, isReportsTab, isWalletTab } from './profile-routes'

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

describe('isReportsTab', () => {
  it('is true on the Reports tab itself only, whose header is the Transactions tab’s', () => {
    expect(isReportsTab('/reports')).toBe(true)
    expect(isReportsTab('/reports?x=1')).toBe(true)
    expect(isReportsTab('/reports/category/c1')).toBe(false)
    expect(isReportsTab('/transactions')).toBe(false)
  })
})
