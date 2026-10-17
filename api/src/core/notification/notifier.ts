import { wrapUnexpected } from '@/core/error'
import { logger } from '@/core/logger'
import { LOG } from '@/shared/constants'
import { NotificationChannel } from '@/shared/types'
import { NOTIFICATION_MESSAGE } from './notification.const'
import type { EmailProvider, Notification, SmsProvider } from './notification.type'

export interface NotifierDeps {
  email: EmailProvider
  sms: SmsProvider
}

/**
 * One entry point for every outgoing message. Callers pick the channel; which provider delivers
 * it is config (EMAIL_PROVIDER / SMS_PROVIDER), so features never import an adapter.
 */
export const createNotifier = ({ email, sms }: NotifierDeps) => {
  const providerFor = (channel: NotificationChannel) =>
    channel === NotificationChannel.EMAIL ? email : sms

  const send = async (notification: Notification): Promise<void> => {
    const { channel } = notification
    const provider = providerFor(channel).name

    // Never log `to` content beyond the channel/provider, nor the message body: it may hold codes.
    await wrapUnexpected(
      async () =>
        notification.channel === NotificationChannel.EMAIL
          ? email.send(notification)
          : sms.send(notification),
      {
        operation: 'notifier.send',
        message: NOTIFICATION_MESSAGE.SEND_FAILED,
        metadata: { channel, provider },
      }
    )
    logger.info(LOG.NOTIFICATION.sent(channel, provider))
  }

  const close = async (): Promise<void> => {
    await Promise.all([email.close?.(), sms.close?.()])
  }

  return { send, close }
}

export type Notifier = ReturnType<typeof createNotifier>
