import { z } from 'zod'
import type { SyncValidation } from '@/core/sync'
import { ERRORS } from '@/shared/constants'
import { isCalendarDay, isEntryDay } from '@/shared/utils'
import { EVENT_LIMITS, EVENT_MESSAGE, EVENT_PATTERN } from './event.const'

const epochMs = z.number().int().nonnegative()

// A pushed event (event rules 1–2). Server columns (`changeSeq`, `updatedBy`, `userId`) are
// ignored if sent.
const row = z
  .object({
    id: z.uuid({ error: ERRORS.invalidField('id') }),
    profileId: z.uuid({ error: ERRORS.invalidField('profileId') }),
    name: z
      .string({ error: ERRORS.requiredField('Name') })
      .trim()
      .min(1, ERRORS.requiredField('Name'))
      .max(EVENT_LIMITS.NAME_MAX, ERRORS.maxLength('Name', EVENT_LIMITS.NAME_MAX)),
    icon: z
      .string({ error: ERRORS.invalidField('icon') })
      .max(EVENT_LIMITS.ICON_MAX, ERRORS.invalidField('icon'))
      .regex(EVENT_PATTERN.ICON, ERRORS.invalidField('icon')),
    color: z
      .string({ error: ERRORS.invalidField('color') })
      .regex(EVENT_PATTERN.COLOR, ERRORS.invalidField('color')),
    startOn: z
      .string({ error: ERRORS.requiredField('Start date') })
      .refine(isEntryDay, ERRORS.invalidField('startOn')),
    endOn: z
      .string({ error: ERRORS.invalidField('endOn') })
      .refine(isCalendarDay, ERRORS.invalidField('endOn'))
      .nullable()
      .default(null),
    isClosed: z.boolean({ error: ERRORS.invalidType('Closed', 'boolean') }).default(false),
    createdAt: epochMs,
    updatedAt: epochMs,
    deletedAt: epochMs.nullable().default(null),
  })
  .refine((value) => value.endOn === null || value.endOn >= value.startOn, {
    message: EVENT_MESSAGE.END_BEFORE_START,
  })

export const validateEvent = (input: unknown): SyncValidation => {
  const result = row.safeParse(input)
  if (!result.success) {
    return { ok: false, message: result.error.issues.map((issue) => issue.message).join(', ') }
  }
  return { ok: true, row: result.data }
}
