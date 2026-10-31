import { z } from 'zod'
import type { SyncValidation } from '@/core/sync'
import { ERRORS } from '@/shared/constants'
import { SYNC_PROBE_LIMITS } from './sync-probe.const'

const epochMs = z.number().int().nonnegative()

// A pushed probe row. Server columns (`changeSeq`, `updatedBy`) are ignored if sent.
const row = z.object({
  id: z.uuid({ error: ERRORS.invalidField('id') }),
  title: z
    .string({ error: ERRORS.requiredField('Title') })
    .trim()
    .min(1, ERRORS.requiredField('Title'))
    .max(SYNC_PROBE_LIMITS.TITLE_MAX, ERRORS.maxLength('Title', SYNC_PROBE_LIMITS.TITLE_MAX)),
  amount: z
    .number({ error: ERRORS.invalidType('Amount', 'integer') })
    .int(ERRORS.invalidType('Amount', 'integer'))
    .min(0, ERRORS.invalidField('amount'))
    .max(SYNC_PROBE_LIMITS.AMOUNT_MAX, ERRORS.invalidField('amount')),
  createdAt: epochMs,
  updatedAt: epochMs,
  deletedAt: epochMs.nullable().default(null),
})

export const validateSyncProbe = (input: unknown): SyncValidation => {
  const result = row.safeParse(input)
  if (!result.success) {
    return { ok: false, message: result.error.issues.map((issue) => issue.message).join(', ') }
  }
  return { ok: true, row: result.data }
}
