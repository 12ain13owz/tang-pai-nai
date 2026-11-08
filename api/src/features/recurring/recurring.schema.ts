import { z } from 'zod'
import type { SyncValidation } from '@/core/sync'
import { ERRORS } from '@/shared/constants'
import { isCalendarDay, isEntryDay } from '@/shared/utils'
import {
  RECURRING_LIMITS,
  RECURRING_MESSAGE,
  RecurringFrequency,
  RecurringKind,
} from './recurring.const'

const epochMs = z.number().int().nonnegative()
const day = (field: string) =>
  z.string({ error: ERRORS.invalidField(field) }).refine(isCalendarDay, ERRORS.invalidField(field))

// A pushed recurring rule (recurring rules 1–3). Server columns (`changeSeq`, `updatedBy`,
// `userId`) are ignored if sent.
const row = z
  .object({
    id: z.uuid({ error: ERRORS.invalidField('id') }),
    profileId: z.uuid({ error: ERRORS.invalidField('profileId') }),
    kind: z.enum(Object.values(RecurringKind), { error: ERRORS.invalidField('kind') }),
    walletId: z.uuid({ error: ERRORS.invalidField('walletId') }),
    categoryId: z
      .uuid({ error: ERRORS.invalidField('categoryId') })
      .nullable()
      .default(null),
    toWalletId: z
      .uuid({ error: ERRORS.invalidField('toWalletId') })
      .nullable()
      .default(null),
    amount: z
      .number({ error: ERRORS.invalidType('Amount', 'integer') })
      .int(ERRORS.invalidType('Amount', 'integer'))
      .min(1, ERRORS.invalidField('amount'))
      .max(RECURRING_LIMITS.AMOUNT_MAX, ERRORS.invalidField('amount')),
    note: z
      .string({ error: ERRORS.invalidType('Note', 'string') })
      .trim()
      .max(RECURRING_LIMITS.NOTE_MAX, ERRORS.maxLength('Note', RECURRING_LIMITS.NOTE_MAX))
      .default(''),
    excludeFromReport: z
      .boolean({ error: ERRORS.invalidType('Exclude from report', 'boolean') })
      .default(false),
    startOn: z
      .string({ error: ERRORS.requiredField('Start date') })
      .refine(isEntryDay, ERRORS.invalidField('startOn')),
    frequency: z.enum(Object.values(RecurringFrequency), {
      error: ERRORS.invalidField('frequency'),
    }),
    interval: z
      .number({ error: ERRORS.invalidType('Interval', 'integer') })
      .int(ERRORS.invalidType('Interval', 'integer'))
      .min(1, ERRORS.invalidField('interval'))
      .max(RECURRING_LIMITS.INTERVAL_MAX, ERRORS.invalidField('interval')),
    endOn: day('endOn').nullable().default(null),
    endCount: z
      .number({ error: ERRORS.invalidType('End count', 'integer') })
      .int(ERRORS.invalidType('End count', 'integer'))
      .min(1, ERRORS.invalidField('endCount'))
      .max(RECURRING_LIMITS.COUNT_MAX, ERRORS.invalidField('endCount'))
      .nullable()
      .default(null),
    confirm: z.boolean({ error: ERRORS.invalidType('Confirm', 'boolean') }).default(false),
    nextOn: day('nextOn').nullable(),
    isPaused: z.boolean({ error: ERRORS.invalidType('Paused', 'boolean') }).default(false),
    createdAt: epochMs,
    updatedAt: epochMs,
    deletedAt: epochMs.nullable().default(null),
  })
  .superRefine((value, ctx) => {
    const issue = (message: string) => ctx.addIssue({ code: 'custom', message })
    const transfer = value.kind === RecurringKind.TRANSFER
    if (transfer ? !value.toWalletId || value.categoryId : !value.categoryId || value.toWalletId) {
      issue(RECURRING_MESSAGE.KIND_FIELDS)
    }
    if (transfer && value.toWalletId === value.walletId) {
      issue(RECURRING_MESSAGE.SAME_WALLET)
    }
    if (value.endOn !== null && value.endCount !== null) {
      issue(RECURRING_MESSAGE.END_BOTH)
    }
    if (value.endOn !== null && value.endOn < value.startOn) {
      issue(RECURRING_MESSAGE.END_BEFORE_START)
    }
    if (value.nextOn !== null && value.nextOn < value.startOn) {
      issue(RECURRING_MESSAGE.NEXT_BEFORE_START)
    }
  })
  // A transfer is never in a report, so the switch means nothing for it.
  .transform((value) =>
    value.kind === RecurringKind.TRANSFER ? { ...value, excludeFromReport: false } : value
  )

export const validateRecurringRule = (input: unknown): SyncValidation => {
  const result = row.safeParse(input)
  if (!result.success) {
    return { ok: false, message: result.error.issues.map((issue) => issue.message).join(', ') }
  }
  return { ok: true, row: result.data }
}
