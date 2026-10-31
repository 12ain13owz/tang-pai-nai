import { env } from '@/core/config'
import { onShutdown } from '@/core/server'
import { createDatabase } from './client'

export const { client, db } = createDatabase(env)
onShutdown(async () => {
  client.close()
  return Promise.resolve()
})

export { epochMs, id, syncColumns, timestamps } from './columns'
export type { Database, Executor } from './client'
