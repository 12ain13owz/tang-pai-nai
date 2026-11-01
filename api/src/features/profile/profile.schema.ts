import { z } from 'zod'
import type { SyncValidation } from '@/core/sync'
import { ERRORS } from '@/shared/constants'
import { PROFILE_LIMITS, PROFILE_PATTERN } from './profile.const'

const epochMs = z.number().int().nonnegative()

// A pushed profile row (profile rules 2–3). Server columns (`changeSeq`, `updatedBy`, `userId`)
// are ignored if sent.
const row = z.object({
  id: z.uuid({ error: ERRORS.invalidField('id') }),
  name: z
    .string({ error: ERRORS.requiredField('Name') })
    .trim()
    .min(1, ERRORS.requiredField('Name'))
    .max(PROFILE_LIMITS.NAME_MAX, ERRORS.maxLength('Name', PROFILE_LIMITS.NAME_MAX)),
  icon: z
    .string({ error: ERRORS.requiredField('Icon') })
    .max(PROFILE_LIMITS.ICON_MAX, ERRORS.invalidField('icon'))
    .regex(PROFILE_PATTERN.ICON, ERRORS.invalidField('icon')),
  color: z
    .string({ error: ERRORS.requiredField('Color') })
    .regex(PROFILE_PATTERN.COLOR, ERRORS.invalidField('color')),
  sortOrder: z
    .number({ error: ERRORS.invalidType('Sort order', 'integer') })
    .int(ERRORS.invalidType('Sort order', 'integer'))
    .min(0, ERRORS.invalidField('sortOrder'))
    .max(PROFILE_LIMITS.SORT_ORDER_MAX, ERRORS.invalidField('sortOrder')),
  createdAt: epochMs,
  updatedAt: epochMs,
  deletedAt: epochMs.nullable().default(null),
})

export const validateProfile = (input: unknown): SyncValidation => {
  const result = row.safeParse(input)
  if (!result.success) {
    return { ok: false, message: result.error.issues.map((issue) => issue.message).join(', ') }
  }
  return { ok: true, row: result.data }
}
