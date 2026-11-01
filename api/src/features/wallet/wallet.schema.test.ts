import { describe, expect, it } from 'vitest'
import { validateWallet } from './wallet.schema'

const valid = {
  id: '0199a000-0000-7000-8000-000000000101',
  profileId: '0199a000-0000-7000-8000-000000000001',
  name: '  เงินสด ',
  currencyCode: 'THB',
  initialBalance: -150050,
  icon: 'tpnBankColumns',
  color: '#16a34a',
  excludeFromTotal: false,
  isArchived: false,
  sortOrder: 0,
  createdAt: 1000,
  updatedAt: 1000,
}

describe('validateWallet', () => {
  it('accepts a wallet, trims the name and defaults deletedAt to null', () => {
    expect(validateWallet(valid)).toEqual({
      ok: true,
      row: { ...valid, name: 'เงินสด', deletedAt: null },
    })
  })

  it('ignores server columns a device sends', () => {
    const result = validateWallet({ ...valid, changeSeq: 99, updatedBy: 'x', userId: 'y' })
    expect(result.ok && Object.keys(result.row).sort()).toEqual([
      'color',
      'createdAt',
      'currencyCode',
      'deletedAt',
      'excludeFromTotal',
      'icon',
      'id',
      'initialBalance',
      'isArchived',
      'name',
      'profileId',
      'sortOrder',
      'updatedAt',
    ])
  })

  it('accepts the limits: a 50-character name, ±10¹⁵ minor units, a lucide icon, a tombstone', () => {
    for (const change of [
      { name: 'x'.repeat(50) },
      { initialBalance: 1_000_000_000_000_000 },
      { initialBalance: -1_000_000_000_000_000 },
      { icon: 'lucideWallet' },
      { deletedAt: 2000 },
    ]) {
      expect(validateWallet({ ...valid, ...change }).ok).toBe(true)
    }
  })

  it.each([
    ['an empty name', { name: '   ' }, 'Name is required'],
    ['a name over 50 characters', { name: 'x'.repeat(51) }, 'Name must be at most 50'],
    ['a profile id that is not a UUID', { profileId: 'abc' }, 'Invalid profileId format'],
    ['a lowercase currency', { currencyCode: 'thb' }, 'Invalid currencyCode format'],
    ['a fractional balance', { initialBalance: 1.5 }, 'Initial balance must be of type integer'],
    ['a balance over 10¹⁵', { initialBalance: 1_000_000_000_000_001 }, 'Invalid initialBalance'],
    ['a balance under -10¹⁵', { initialBalance: -1_000_000_000_000_001 }, 'Invalid initialBalance'],
    ['an icon of another library', { icon: 'faWallet' }, 'Invalid icon format'],
    ['an icon name over 40 characters', { icon: `tpn${'A'.repeat(38)}` }, 'Invalid icon format'],
    ['an uppercase colour', { color: '#16A34A' }, 'Invalid color format'],
    ['a flag that is not a boolean', { excludeFromTotal: 'yes' }, 'Exclude from total must be'],
    ['a missing archive flag', { isArchived: undefined }, 'Is archived must be of type boolean'],
    ['a negative sort order', { sortOrder: -1 }, 'Invalid sortOrder format'],
    ['an id that is not a UUID', { id: 'abc' }, 'Invalid id format'],
  ])('refuses %s', (_name, change, message) => {
    const result = validateWallet({ ...valid, ...change })
    expect(result.ok).toBe(false)
    expect(!result.ok && result.message).toContain(message)
  })
})
