import { z } from 'zod'
import type { SyncValidation } from '@/core/sync'
import { ERRORS } from '@/shared/constants'
import { isCalendarDay, isEntryDay } from '@/shared/utils'
import { DEBT_LIMITS, DEBT_MESSAGE, DebtCountAs, DebtDirection, DebtEntryKind } from './debt.const'

const epochMs = z.number().int().nonnegative()

const note = z
  .string({ error: ERRORS.invalidType('Note', 'string') })
  .trim()
  .max(DEBT_LIMITS.NOTE_MAX, ERRORS.maxLength('Note', DEBT_LIMITS.NOTE_MAX))
  .default('')

const syncTimes = {
  createdAt: epochMs,
  updatedAt: epochMs,
  deletedAt: epochMs.nullable().default(null),
}

/** Debt rule 2: a real date from 2000-01-01 (a mortgage may be due decades ahead). */
const isDueDay = (value: string) => isCalendarDay(value) && value >= DEBT_LIMITS.DUE_FROM

// A pushed debt (debt rules 1–2). Server columns (`changeSeq`, `updatedBy`, `userId`) are
// ignored if sent.
const debtRow = z
  .object({
    id: z.uuid({ error: ERRORS.invalidField('id') }),
    profileId: z.uuid({ error: ERRORS.invalidField('profileId') }),
    direction: z.enum(Object.values(DebtDirection), { error: ERRORS.invalidField('direction') }),
    person: z
      .string({ error: ERRORS.requiredField('Person') })
      .trim()
      .min(1, ERRORS.requiredField('Person'))
      .max(DEBT_LIMITS.PERSON_MAX, ERRORS.maxLength('Person', DEBT_LIMITS.PERSON_MAX)),
    note,
    currencyCode: z
      .string({ error: ERRORS.invalidField('currencyCode') })
      .regex(/^[A-Z]{3}$/, ERRORS.invalidField('currencyCode')),
    countAs: z.enum(Object.values(DebtCountAs), { error: ERRORS.invalidField('countAs') }),
    categoryId: z
      .uuid({ error: ERRORS.invalidField('categoryId') })
      .nullable()
      .default(null),
    dueOn: z
      .string({ error: DEBT_MESSAGE.DUE_DAY })
      .refine(isDueDay, DEBT_MESSAGE.DUE_DAY)
      .nullable()
      .default(null),
    ...syncTimes,
  })
  .superRefine((value, ctx) => {
    const issue = (message: string) => ctx.addIssue({ code: 'custom', message })
    if (value.direction === DebtDirection.LENT && value.countAs !== DebtCountAs.SPENT) {
      issue(DEBT_MESSAGE.COUNT_AS_LENT)
    }
    if ((value.countAs === DebtCountAs.REPAID) !== (value.categoryId !== null)) {
      issue(DEBT_MESSAGE.CATEGORY_FIELD)
    }
  })

// A pushed debt entry (debt rule 6).
const entryRow = z.object({
  id: z.uuid({ error: ERRORS.invalidField('id') }),
  profileId: z.uuid({ error: ERRORS.invalidField('profileId') }),
  debtId: z.uuid({ error: ERRORS.invalidField('debtId') }),
  kind: z.enum(Object.values(DebtEntryKind), { error: ERRORS.invalidField('kind') }),
  walletId: z
    .uuid({ error: ERRORS.invalidField('walletId') })
    .nullable()
    .default(null),
  amount: z
    .number({ error: ERRORS.invalidType('Amount', 'integer') })
    .int(ERRORS.invalidType('Amount', 'integer'))
    .min(1, ERRORS.invalidField('amount'))
    .max(DEBT_LIMITS.AMOUNT_MAX, ERRORS.invalidField('amount')),
  occurredOn: z
    .string({ error: ERRORS.requiredField('Date') })
    .refine(isEntryDay, ERRORS.invalidField('occurredOn')),
  note,
  /** The recurring rule it is an occurrence of (debt rule 13); null otherwise. */
  recurringId: z
    .uuid({ error: ERRORS.invalidField('recurringId') })
    .nullable()
    .default(null),
  ...syncTimes,
})

export const validateDebt = (input: unknown): SyncValidation => {
  const result = debtRow.safeParse(input)
  if (!result.success) {
    return { ok: false, message: result.error.issues.map((issue) => issue.message).join(', ') }
  }
  return { ok: true, row: result.data }
}

export const validateDebtEntry = (input: unknown): SyncValidation => {
  const result = entryRow.safeParse(input)
  if (!result.success) {
    return { ok: false, message: result.error.issues.map((issue) => issue.message).join(', ') }
  }
  return { ok: true, row: result.data }
}
