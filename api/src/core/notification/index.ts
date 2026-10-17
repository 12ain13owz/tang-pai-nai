import { env } from '@/core/config'
import { onShutdown } from '@/core/server'
import { createNotifier } from './notifier'
import { createEmailProvider, createSmsProvider } from './provider.registry'

export const notifier = createNotifier({
  email: createEmailProvider(env),
  sms: createSmsProvider(env),
})
onShutdown(notifier.close)

export { createNotifier } from './notifier'
export type { Notifier, NotifierDeps } from './notifier'
export type * from './notification.type'
