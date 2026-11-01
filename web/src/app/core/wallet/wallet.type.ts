/** A wallet as the device stores it (docs/features/wallet.md → Data model). */
export interface Wallet {
  id: string
  profileId: string
  name: string
  /** ISO 4217, e.g. `THB`. */
  currencyCode: string
  /** Minor units of `currencyCode`, may be negative. */
  initialBalance: number
  /** A lucide or `tpn` icon name, e.g. `lucideWallet`. */
  icon: string
  /** `#rrggbb`. */
  color: string
  excludeFromTotal: boolean
  isArchived: boolean
  sortOrder: number
  createdAt: number
  updatedAt: number
  deletedAt: number | null
  /** Null until the server has seen the row. */
  changeSeq: number | null
}

/** What the wallet form edits. */
export interface WalletValues {
  name: string
  icon: string
  color: string
  currencyCode: string
  /** Minor units. */
  initialBalance: number
  excludeFromTotal: boolean
}

/** Which wallet sheet is open: create, edit one, or "fix" a rejected op's refused values. */
export type WalletSheetState =
  | { mode: 'create' }
  | { mode: 'edit'; id: string }
  | { mode: 'fix'; opId: string; id: string; profileId: string; values: WalletValues }

/** A currency the device pulled (docs/features/currency.md). */
export interface Currency {
  code: string
  minorUnit: number
  isActive: boolean
  sortOrder: number
}

/** One line of the total (wallet rule 7): never added across currencies. */
export interface CurrencyTotal {
  currencyCode: string
  minorUnit: number
  /** Minor units. */
  amount: number
}

/** Why a wallet can't come back from the archive (wallet rule 3). */
export type UnarchiveRefusal = 'nameTaken' | 'limit'

export const WALLET_TABLE = 'wallets'

export const WALLET_LIMITS = {
  NAME_MAX: 50,
  /** Non-archived wallets per profile (wallet rule 3). */
  PER_PROFILE: 20,
  /** ±10¹⁵ minor units (wallet rule 5). */
  BALANCE_MAX: 1_000_000_000_000_000,
} as const

/** A new wallet's currency when only one is active (wallet rule 4). */
export const DEFAULT_CURRENCY = 'THB'
