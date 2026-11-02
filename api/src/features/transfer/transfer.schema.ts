import { z } from 'zod'
import type { SyncValidation } from '@/core/sync'
import { ERRORS } from '@/shared/constants'
import { isEntryDay } from '@/shared/utils'
import { TRANSFER_LIMITS, TRANSFER_MESSAGE } from './transfer.const'

const epochMs = z.number().int().nonnegative()

// A pushed transfer row (transfer rules 1, 3, 4). Server columns (`changeSeq`, `updatedBy`,
// `userId`) are ignored if sent.
const row = z
  .object({
    id: z.uuid({ error: ERRORS.invalidField('id') }),
    profileId: z.uuid({ error: ERRORS.invalidField('profileId') }),
    fromWalletId: z.uuid({ error: ERRORS.invalidField('fromWalletId') }),
    toWalletId: z.uuid({ error: ERRORS.invalidField('toWalletId') }),
    amount: z
      .number({ error: ERRORS.invalidType('Amount', 'integer') })
      .int(ERRORS.invalidType('Amount', 'integer'))
      .min(1, ERRORS.invalidField('amount'))
      .max(TRANSFER_LIMITS.AMOUNT_MAX, ERRORS.invalidField('amount')),
    occurredOn: z
      .string({ error: ERRORS.requiredField('Date') })
      .refine(isEntryDay, ERRORS.invalidField('occurredOn')),
    note: z
      .string({ error: ERRORS.invalidType('Note', 'string') })
      .trim()
      .max(TRANSFER_LIMITS.NOTE_MAX, ERRORS.maxLength('Note', TRANSFER_LIMITS.NOTE_MAX))
      .default(''),
    createdAt: epochMs,
    updatedAt: epochMs,
    deletedAt: epochMs.nullable().default(null),
  })
  .refine((value) => value.fromWalletId !== value.toWalletId, TRANSFER_MESSAGE.SAME_WALLET)

export const validateTransfer = (input: unknown): SyncValidation => {
  const result = row.safeParse(input)
  if (!result.success) {
    return { ok: false, message: result.error.issues.map((issue) => issue.message).join(', ') }
  }
  return { ok: true, row: result.data }
}
