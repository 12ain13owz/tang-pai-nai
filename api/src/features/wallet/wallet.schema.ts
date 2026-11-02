import { z } from 'zod'
import type { SyncValidation } from '@/core/sync'
import { ERRORS } from '@/shared/constants'
import { WALLET_LIMITS, WALLET_PATTERN } from './wallet.const'

const epochMs = z.number().int().nonnegative()
const flag = (field: string) => z.boolean({ error: ERRORS.invalidType(field, 'boolean') })

// A pushed wallet row (wallet rules 2–5, 8; category rule 13). Server columns (`changeSeq`, `updatedBy`, `userId`)
// are ignored if sent.
const row = z.object({
  id: z.uuid({ error: ERRORS.invalidField('id') }),
  profileId: z.uuid({ error: ERRORS.invalidField('profileId') }),
  name: z
    .string({ error: ERRORS.requiredField('Name') })
    .trim()
    .min(1, ERRORS.requiredField('Name'))
    .max(WALLET_LIMITS.NAME_MAX, ERRORS.maxLength('Name', WALLET_LIMITS.NAME_MAX)),
  currencyCode: z
    .string({ error: ERRORS.requiredField('Currency') })
    .regex(WALLET_PATTERN.CURRENCY, ERRORS.invalidField('currencyCode')),
  initialBalance: z
    .number({ error: ERRORS.invalidType('Initial balance', 'integer') })
    .int(ERRORS.invalidType('Initial balance', 'integer'))
    .min(-WALLET_LIMITS.BALANCE_MAX, ERRORS.invalidField('initialBalance'))
    .max(WALLET_LIMITS.BALANCE_MAX, ERRORS.invalidField('initialBalance')),
  icon: z
    .string({ error: ERRORS.requiredField('Icon') })
    .max(WALLET_LIMITS.ICON_MAX, ERRORS.invalidField('icon'))
    .regex(WALLET_PATTERN.ICON, ERRORS.invalidField('icon')),
  color: z
    .string({ error: ERRORS.requiredField('Color') })
    .regex(WALLET_PATTERN.COLOR, ERRORS.invalidField('color')),
  excludeFromTotal: flag('Exclude from total'),
  isArchived: flag('Is archived'),
  sortOrder: z
    .number({ error: ERRORS.invalidType('Sort order', 'integer') })
    .int(ERRORS.invalidType('Sort order', 'integer'))
    .min(0, ERRORS.invalidField('sortOrder'))
    .max(WALLET_LIMITS.SORT_ORDER_MAX, ERRORS.invalidField('sortOrder')),
  // Category rule 13: only the shape. Unknown ids (deleted, another profile's) are the device's
  // to ignore. A push without the field (a device from before 7.2) means none hidden.
  hiddenCategoryIds: z
    .array(z.uuid({ error: ERRORS.invalidField('hiddenCategoryIds') }), {
      error: ERRORS.invalidField('hiddenCategoryIds'),
    })
    .max(WALLET_LIMITS.HIDDEN_CATEGORIES_MAX, ERRORS.invalidField('hiddenCategoryIds'))
    .default([]),
  createdAt: epochMs,
  updatedAt: epochMs,
  deletedAt: epochMs.nullable().default(null),
})

export const validateWallet = (input: unknown): SyncValidation => {
  const result = row.safeParse(input)
  if (!result.success) {
    return { ok: false, message: result.error.issues.map((issue) => issue.message).join(', ') }
  }
  return { ok: true, row: result.data }
}
