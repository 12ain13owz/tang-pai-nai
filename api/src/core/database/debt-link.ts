import { eq } from 'drizzle-orm'
import { debts } from './schema/debt'
import { wallets } from './schema/wallet'
import type { Executor } from './client'

/**
 * Checks a row's `debtId` (docs/features/debt.md rules 8 and 13): the transaction, recurring
 * rule and debt entry handlers all read it, so it lives here rather than in one feature.
 */
export type DebtLink =
  /** The owner's live debt of the same profile, in the wallet's currency. */
  | { status: 'ok' }
  /** No live debt of this owner (deleted, never synced, someone else's). */
  | { status: 'gone' }
  | { status: 'otherProfile' }
  | { status: 'otherCurrency' }

export const findDebt = async (executor: Executor, id: string) =>
  (
    await executor
      .select({
        userId: debts.userId,
        profileId: debts.profileId,
        currencyCode: debts.currencyCode,
        countAs: debts.countAs,
        deletedAt: debts.deletedAt,
      })
      .from(debts)
      .where(eq(debts.id, id))
  ).at(0)

/** Whether `debtId` may be linked from a row of `profileId` paid from `walletId` (or none). */
export const checkDebtLink = async (
  executor: Executor,
  userId: string,
  debtId: string,
  profileId: string,
  walletId: string | null
): Promise<DebtLink> => {
  const debt = await findDebt(executor, debtId)
  if (!debt || debt.userId !== userId || debt.deletedAt !== null) {
    return { status: 'gone' }
  }
  if (debt.profileId !== profileId) {
    return { status: 'otherProfile' }
  }
  if (walletId !== null) {
    const wallet = (
      await executor
        .select({ currencyCode: wallets.currencyCode })
        .from(wallets)
        .where(eq(wallets.id, walletId))
    ).at(0)
    if (wallet && wallet.currencyCode !== debt.currencyCode) {
      return { status: 'otherCurrency' }
    }
  }
  return { status: 'ok' }
}
