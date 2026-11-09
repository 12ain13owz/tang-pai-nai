import type { ProfileRef, RowData, ShareRole } from './sharing.entity'

// Response `data` shapes (docs/features/sharing.md → Endpoints).

export interface SharingMember {
  userId: string
  displayName: string
  email: string
  role: ShareRole
  walletIds: string[]
  addedAt: number
}

export interface SharingInvite {
  id: string
  email: string
  role: ShareRole
  walletIds: string[]
  createdAt: number
  expiresAt: number
  lastSentAt: number
}

/** GET /sharing/profiles/:profileId */
export interface OwnerSharing {
  members: SharingMember[]
  invites: SharingInvite[]
  /** Open wallets of the profile shared with nobody (rule 2). */
  unsharedWalletIds: string[]
}

export interface SharedWalletView {
  id: string
  name: string
  icon: string
  color: string
  currencyCode: string
  balance: number
}

/** GET /sharing/with-me */
export interface SharedWithMe {
  invites: {
    id: string
    role: ShareRole
    owner: { displayName: string; email: string }
    wallets: { id: string; name: string }[]
    expiresAt: number
  }[]
  shares: {
    profileId: string
    profile: ProfileRef
    role: ShareRole
    owner: { id: string; displayName: string; email: string }
    wallets: SharedWalletView[]
  }[]
}

/** GET /sharing/with-me/:profileId/rows (rule 9) */
export interface SharedProfileRows {
  profile: ProfileRef
  role: ShareRole
  owner: { id: string; displayName: string; email: string }
  /** The owner and the profile's members: the names behind `addedBy`. */
  people: { id: string; displayName: string }[]
  /** The shared wallets, transfers and debt entries folded into `initialBalance`. */
  wallets: RowData[]
  /** The owner's live categories of the profile (archived too). */
  categories: RowData[]
  /** The wallets' transactions with `changeSeq > since`, tombstones included, in order. */
  transactions: RowData[]
  cursor: number
  hasMore: boolean
}
