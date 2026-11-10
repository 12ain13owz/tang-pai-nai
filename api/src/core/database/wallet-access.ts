import { and, eq } from 'drizzle-orm'
import { profiles } from './schema/profile'
import { walletMembers, wallets } from './schema/wallet'
import type { Executor } from './client'

/**
 * Who may write rows of a wallet (docs/features/sharing.md rules 8, 11–13). Sync reads it for an
 * editor's push; it reads the sharing tables, which no other feature may import, so it lives
 * here (like `debt-link`).
 */
export type WalletAccess = {
  ownerId: string
  /** `owner`, the member's role on a wallet they may see, or null (not shared with them). */
  role: 'owner' | 'editor' | 'viewer' | null
}

/** The wallet's owner and the caller's role on it; null when the wallet doesn't exist. */
export const walletAccess = async (
  executor: Executor,
  userId: string,
  walletId: string
): Promise<WalletAccess | null> => {
  const wallet = (
    await executor
      .select({
        ownerId: wallets.userId,
        deletedAt: wallets.deletedAt,
        isArchived: wallets.isArchived,
        profileDeletedAt: profiles.deletedAt,
      })
      .from(wallets)
      .leftJoin(profiles, eq(profiles.id, wallets.profileId))
      .where(eq(wallets.id, walletId))
  ).at(0)
  if (!wallet) {
    return null
  }
  if (wallet.ownerId === userId) {
    return { ownerId: wallet.ownerId, role: 'owner' }
  }
  // A member sees (and writes) a wallet while it is live, open and on a live profile (rule 8).
  const visible =
    wallet.deletedAt === null && !wallet.isArchived && wallet.profileDeletedAt === null
  const member = visible
    ? (
        await executor
          .select({ role: walletMembers.role })
          .from(walletMembers)
          .where(and(eq(walletMembers.walletId, walletId), eq(walletMembers.userId, userId)))
      ).at(0)
    : undefined
  return { ownerId: wallet.ownerId, role: member?.role ?? null }
}
