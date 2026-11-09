export const DEBT_LIMITS = {
  /** 10¹⁵ minor units (transaction rule 3). */
  AMOUNT_MAX: 1_000_000_000_000_000,
  PERSON_MAX: 50,
  NOTE_MAX: 500,
  /** Open debts per profile (debt rule 1). */
  OPEN_PER_PROFILE: 100,
  /** The earliest due date (debt rule 2). */
  DUE_FROM: '2000-01-01',
} as const

export const DebtDirection = {
  BORROWED: 'borrowed',
  LENT: 'lent',
} as const

export const DebtCountAs = {
  SPENT: 'spent',
  REPAID: 'repaid',
} as const

export const DebtEntryKind = {
  PRINCIPAL: 'principal',
  REPAYMENT: 'repayment',
} as const

export const DEBT_MESSAGE = {
  PROFILE_GONE: 'The profile does not exist or was deleted',
  PROFILE_FIXED: 'A debt cannot move to another profile',
  FIXED: 'A debt’s direction, way of counting and currency cannot change',
  CURRENCY_INACTIVE: 'The currency is not active',
  CATEGORY_GONE: 'The category does not exist or was deleted',
  CATEGORY_NOT_EXPENSE:
    'The instalments’ category must be an expense category of the debt’s profile',
  LIMIT: 'A profile holds at most 100 open debts',
  COUNT_AS_LENT: 'A lent debt is always counted when spent',
  CATEGORY_FIELD: 'A debt counted when repaid needs a category, any other none',
  DUE_DAY: 'Invalid field: dueOn',
} as const

export const DEBT_ENTRY_MESSAGE = {
  PROFILE_GONE: 'The profile does not exist or was deleted',
  PROFILE_FIXED: 'A debt entry cannot move to another profile',
  DEBT_GONE: 'The debt does not exist or was deleted',
  DEBT_FIXED: 'A debt entry cannot move to another debt',
  WALLET_GONE: 'The wallet does not exist or was deleted',
  OTHER_PROFILE: 'The debt and the wallet must belong to the entry’s profile',
  OTHER_CURRENCY: 'The wallet must have the debt’s currency',
  NO_WALLET: 'Only a debt counted when repaid has entries without a wallet',
} as const

/** A transaction's or a recurring rule's `debtId` (debt rules 8, 13). */
export const DEBT_LINK_MESSAGE = {
  OTHER_PROFILE: 'The debt must belong to the same profile',
  OTHER_CURRENCY: 'The wallet must have the debt’s currency',
} as const
