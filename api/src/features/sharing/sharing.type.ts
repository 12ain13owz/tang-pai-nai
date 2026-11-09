import type { CategoryRef, Entry, ShareRole } from './sharing.entity'

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
    role: ShareRole
    owner: { id: string; displayName: string; email: string }
    wallets: SharedWalletView[]
  }[]
}

/** GET /sharing/wallets/:walletId */
export interface SharedWallet {
  wallet: SharedWalletView & { firstOn: string | null }
  role: ShareRole
  owner: { displayName: string; email: string }
  categories: CategoryRef[]
}

/** GET /sharing/wallets/:walletId/entries */
export interface SharedEntries {
  entries: Entry[]
  truncated: boolean
}
