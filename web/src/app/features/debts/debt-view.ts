import type { DebtItem } from '@/core/debt'
import type { Translate } from '@/core/recurring'
import { shortDate } from '@/core/recurring'
import type { Wallet, WalletService } from '@/core/wallet'
import { walletPickItem } from '@/shared/components/wallet-pick'
import type { WalletPickItem } from '@/shared/components/wallet-pick'
import { formatAmount, formatMoney } from '@/shared/utils'

/** A debt as its list row says it (debt → Web screens, mock-up frames 2 and 10). */
export interface DebtRow {
  item: DebtItem
  /** The note (or how it was closed). */
  sub: string
  /** "คืนแล้ว 4,000.00 จาก 10,000.00" (no symbol, like the list's amounts). */
  progress: string
  left: string
  /** The bar's filled share, 0–100. */
  share: number
  /** "ครบ 31 ธ.ค." / "เลย 10 มิ.ย." / "คืนครบ" / "ยกหนี้". */
  when: string
}

export const debtRow = (item: DebtItem, t: Translate, locale: string): DebtRow => {
  const { debt } = item
  const money = (minor: number) => formatAmount(minor, item.minorUnit, locale)
  const progress =
    debt.countAs === 'repaid'
      ? t('debts.instalmentsPaid', { count: item.instalments, paid: money(item.paid) })
      : t(`debts.paidOf.${debt.direction}`, { paid: money(item.paid), total: money(item.total) })
  const closedOn = item.lastOn ? shortDate(item.lastOn, locale) : ''
  const sub = item.closed
    ? t(item.forgiven ? 'debts.closedForgiven' : 'debts.closedPaid', { date: closedOn })
    : debt.note
  let when = ''
  if (item.left < 0) {
    when = t('debts.overpaid')
  } else if (debt.dueOn) {
    when = t(item.overdue ? 'debts.overdueOn' : 'debts.dueShort', {
      date: shortDate(debt.dueOn, locale, false),
    })
  }
  return {
    item,
    sub,
    progress: item.closed ? '' : progress,
    left: formatMoney(
      item.closed ? item.total : Math.abs(item.left),
      debt.currencyCode,
      item.minorUnit,
      locale
    ),
    share: item.total > 0 ? Math.min(100, Math.round((100 * item.paid) / item.total)) : 0,
    when,
  }
}

/** The debt sheets' wallet picker rows: balance, and the note of a wallet left out. */
export const walletPickItems = (
  wallets: readonly Wallet[],
  walletService: WalletService,
  locale: string,
  t: Translate
): WalletPickItem[] =>
  wallets.map((wallet) =>
    walletPickItem(wallet, {
      balance: walletService.balance(wallet),
      minorUnit: walletService.minorUnit(wallet.currencyCode),
      locale,
      excluded: t('wallets.excluded'),
    })
  )
