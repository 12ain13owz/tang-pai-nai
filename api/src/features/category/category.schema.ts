import { z } from 'zod'
import type { SyncValidation } from '@/core/sync'
import { ERRORS } from '@/shared/constants'
import { CATEGORY_LIMITS, CATEGORY_PATTERN, CATEGORY_TYPES } from './category.const'

const epochMs = z.number().int().nonnegative()

// A pushed category row (category rules 2, 9). Server columns (`changeSeq`, `updatedBy`,
// `userId`) are ignored if sent.
const row = z
  .object({
    id: z.uuid({ error: ERRORS.invalidField('id') }),
    profileId: z.uuid({ error: ERRORS.invalidField('profileId') }),
    type: z.enum(CATEGORY_TYPES, { error: ERRORS.invalidField('type') }),
    parentId: z
      .uuid({ error: ERRORS.invalidField('parentId') })
      .nullable()
      .default(null),
    name: z
      .string({ error: ERRORS.requiredField('Name') })
      .trim()
      .min(1, ERRORS.requiredField('Name'))
      .max(CATEGORY_LIMITS.NAME_MAX, ERRORS.maxLength('Name', CATEGORY_LIMITS.NAME_MAX)),
    icon: z
      .string({ error: ERRORS.requiredField('Icon') })
      .max(CATEGORY_LIMITS.ICON_MAX, ERRORS.invalidField('icon'))
      .regex(CATEGORY_PATTERN.ICON, ERRORS.invalidField('icon')),
    color: z
      .string({ error: ERRORS.requiredField('Color') })
      .regex(CATEGORY_PATTERN.COLOR, ERRORS.invalidField('color')),
    isArchived: z.boolean({ error: ERRORS.invalidType('Is archived', 'boolean') }),
    sortOrder: z
      .number({ error: ERRORS.invalidType('Sort order', 'integer') })
      .int(ERRORS.invalidType('Sort order', 'integer'))
      .min(0, ERRORS.invalidField('sortOrder'))
      .max(CATEGORY_LIMITS.SORT_ORDER_MAX, ERRORS.invalidField('sortOrder')),
    createdAt: epochMs,
    updatedAt: epochMs,
    deletedAt: epochMs.nullable().default(null),
  })
  .refine((value) => value.parentId !== value.id, {
    message: ERRORS.invalidField('parentId'),
  })

export const validateCategory = (input: unknown): SyncValidation => {
  const result = row.safeParse(input)
  if (!result.success) {
    return { ok: false, message: result.error.issues.map((issue) => issue.message).join(', ') }
  }
  return { ok: true, row: result.data }
}
