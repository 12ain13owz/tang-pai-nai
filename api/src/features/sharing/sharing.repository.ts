import type {
  CategoryRef,
  Entry,
  Invite,
  MemberRow,
  NewInvite,
  ShareRole,
  ShareRow,
  UserRef,
  WalletRef,
} from './sharing.entity'

/**
 * Port: what the sharing service needs from storage (docs/features/sharing.md). Reads other
 * features' tables through `@/core/database/schema`. Missing rows answer `null` / `[]`.
 */
export interface SharingRepository {
  transaction<T>(work: (repo: SharingRepository) => Promise<T>): Promise<T>

  findUser(id: string): Promise<UserRef | null>
  findUserByEmail(email: string): Promise<UserRef | null>
  /** The live profile `profileId` when `userId` owns it. */
  ownsProfile(userId: string, profileId: string): Promise<boolean>
  /** Live wallets of a profile (archived too), in the owner's order. */
  profileWallets(profileId: string): Promise<WalletRef[]>
  /** Live, open wallets among `ids` (on live profiles). */
  openWallets(ids: string[]): Promise<WalletRef[]>

  /** `wallet_members` rows on the live wallets of a profile. */
  membersOf(profileId: string): Promise<MemberRow[]>
  /** Replaces `userId`'s rows on the profile's wallets with `walletIds` (none = removed). */
  setMembership(
    profileId: string,
    userId: string,
    role: ShareRole,
    walletIds: string[],
    at: number
  ): Promise<void>
  /** Wallets shared with `userId` that are live, open and on a live profile. */
  sharesOf(userId: string): Promise<ShareRow[]>
  /** `userId`'s role on a wallet visible to them (rule 8), with the wallet. */
  shareOf(userId: string, walletId: string): Promise<ShareRow | null>

  invitesOf(profileId: string, now: number): Promise<Invite[]>
  invitesTo(email: string, now: number): Promise<Invite[]>
  findInvite(id: string, now: number): Promise<Invite | null>
  findInviteTo(profileId: string, email: string, now: number): Promise<Invite | null>
  createInvite(invite: NewInvite): Promise<Invite>
  markSent(id: string, at: number): Promise<void>
  deleteInvite(id: string): Promise<void>
  deleteExpiredInvites(now: number): Promise<void>

  /** Balances of live wallets: initial + transactions ± transfers ± debt entries. */
  balances(walletIds: string[]): Promise<Map<string, number>>
  categoriesOf(profileId: string): Promise<CategoryRef[]>
  /** The wallet's entries from `from` to `to` (inclusive, `null` = no end), newest first. */
  entries(walletId: string, from: string, to: string | null, limit: number): Promise<Entry[]>
  /** The wallet's oldest entry day. */
  firstDay(walletId: string): Promise<string | null>

  /** Counts one hit in a fixed window (`rate_limit_buckets`). */
  hitRateLimit(
    key: string,
    windowMs: number,
    at: number
  ): Promise<{ count: number; windowStart: number }>
}
