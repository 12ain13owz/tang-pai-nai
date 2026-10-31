import { z } from 'zod'
import { ERRORS } from '@/shared/constants'
import { SYNC_LIMITS } from './sync.const'

const deviceId = z.uuid({ error: ERRORS.invalidField('deviceId') })

const pullQuery = z.object({
  since: z.coerce.number().int().min(0).default(0),
  limit: z.coerce.number().int().min(1).max(SYNC_LIMITS.PULL_MAX).default(SYNC_LIMITS.PULL_DEFAULT),
  deviceId,
})

// The row itself is checked by its table's handler (the feature's own rules, rule 10).
const op = z.object({
  opId: z.uuid({ error: ERRORS.invalidField('opId') }),
  table: z.string().min(1).max(64),
  op: z.enum(['upsert', 'delete']),
  row: z.looseObject({ id: z.string().min(1).max(64) }),
  baseSeq: z.number().int().min(0).nullable(),
})

const pushBody = z.object({
  deviceId,
  ops: z.array(op).min(1).max(SYNC_LIMITS.MAX_OPS),
})

export const syncSchema = {
  pull: { query: pullQuery },
  push: { body: pushBody },
} as const

export type SyncPullQuery = z.infer<typeof pullQuery>
export type SyncPushBody = z.infer<typeof pushBody>
