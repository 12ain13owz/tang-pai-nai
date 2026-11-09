// Mirrors the API's `/sharing` responses (docs/features/sharing.md → Endpoints).

export type ShareRole = 'editor' | 'viewer'

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

/** The owner's view of one profile. */
export interface OwnerSharing {
  members: SharingMember[]
  invites: SharingInvite[]
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

export interface InviteToMe {
  id: string
  role: ShareRole
  owner: { displayName: string; email: string }
  wallets: { id: string; name: string }[]
  expiresAt: number
}

export interface ShareGroup {
  profileId: string
  role: ShareRole
  owner: { id: string; displayName: string; email: string }
  wallets: SharedWalletView[]
}

export interface SharedWithMe {
  invites: InviteToMe[]
  shares: ShareGroup[]
}

export interface SharedCategory {
  id: string
  type: 'income' | 'expense'
  parentId: string | null
  name: string
  icon: string
  color: string
  isArchived: boolean
  sortOrder: number
}

export interface SharedWallet {
  wallet: SharedWalletView & { firstOn: string | null }
  role: ShareRole
  owner: { displayName: string; email: string }
  categories: SharedCategory[]
}

/** One money movement, `amount` signed for the wallet (sharing rule 9). */
export interface SharedEntry {
  id: string
  kind: 'transaction' | 'transfer' | 'debt'
  occurredOn: string
  amount: number
  categoryId: string | null
  note: string
  excludeFromReport: boolean
}

export interface SharedEntries {
  entries: SharedEntry[]
  truncated: boolean
}

/** What a sharing call failed with, for the UI: a translation key. */
export type SharingFailure = string
