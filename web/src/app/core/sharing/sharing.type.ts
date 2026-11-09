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
  profile: { id: string; name: string; icon: string; color: string }
  role: ShareRole
  owner: { id: string; displayName: string; email: string }
  wallets: SharedWalletView[]
}

export interface SharedWithMe {
  invites: InviteToMe[]
  shares: ShareGroup[]
}

/** `GET /sharing/with-me/:profileId/rows` (sharing rule 9): rows as `/sync/pull` sends them. */
export interface SharedProfileRows {
  profile: { id: string; name: string; icon: string; color: string }
  role: ShareRole
  owner: { id: string; displayName: string; email: string }
  people: { id: string; displayName: string }[]
  wallets: Record<string, unknown>[]
  categories: Record<string, unknown>[]
  /** One array per row, in `columns`' order. */
  transactions: { columns: string[]; rows: unknown[][] }
  cursor: number
  hasMore: boolean
}

/** What a sharing call failed with, for the UI: a translation key. */
export type SharingFailure = string
