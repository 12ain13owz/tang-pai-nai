import { z } from 'zod'
import type { SyncValidation } from '@/core/sync'
import { ERRORS } from '@/shared/constants'
import { TRANSACTION_LIMITS, TRANSACTION_PATTERN } from './transaction.const'

const epochMs = z.number().int().nonnegative()
const DAY_MS = 86_400_000

/** A real calendar date (`2026-02-30` is not). */
const isRealDate = (value: string) => {
  const date = new Date(`${value}T00:00:00Z`)
  return !Number.isNaN(date.getTime()) && date.toISOString().slice(0, 10) === value
}

/** Rule 4: from 2000-01-01 to a year (and a day) after the server's today. */
const inRange = (value: string) =>
  value >= TRANSACTION_LIMITS.FIRST_DAY &&
  value <= new Date(Date.now() + TRANSACTION_LIMITS.FUTURE_DAYS * DAY_MS).toISOString().slice(0, 10)

// A pushed transaction row (transaction rules 3, 4, 6). Server columns (`changeSeq`,
// `updatedBy`, `userId`) are ignored if sent.
const row = z.object({
  id: z.uuid({ error: ERRORS.invalidField('id') }),
  profileId: z.uuid({ error: ERRORS.invalidField('profileId') }),
  walletId: z.uuid({ error: ERRORS.invalidField('walletId') }),
  categoryId: z.uuid({ error: ERRORS.invalidField('categoryId') }),
  amount: z
    .number({ error: ERRORS.invalidType('Amount', 'integer') })
    .int(ERRORS.invalidType('Amount', 'integer'))
    .min(1, ERRORS.invalidField('amount'))
    .max(TRANSACTION_LIMITS.AMOUNT_MAX, ERRORS.invalidField('amount')),
  occurredOn: z
    .string({ error: ERRORS.requiredField('Date') })
    .refine(
      (value) => TRANSACTION_PATTERN.DATE.test(value) && isRealDate(value) && inRange(value),
      ERRORS.invalidField('occurredOn')
    ),
  note: z
    .string({ error: ERRORS.invalidType('Note', 'string') })
    .trim()
    .max(TRANSACTION_LIMITS.NOTE_MAX, ERRORS.maxLength('Note', TRANSACTION_LIMITS.NOTE_MAX))
    .default(''),
  excludeFromReport: z
    .boolean({ error: ERRORS.invalidType('Exclude from report', 'boolean') })
    .default(false),
  createdAt: epochMs,
  updatedAt: epochMs,
  deletedAt: epochMs.nullable().default(null),
})

export const validateTransaction = (input: unknown): SyncValidation => {
  const result = row.safeParse(input)
  if (!result.success) {
    return { ok: false, message: result.error.issues.map((issue) => issue.message).join(', ') }
  }
  return { ok: true, row: result.data }
}
