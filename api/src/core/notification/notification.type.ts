import type { NotificationChannel } from '@/shared/types'

export interface EmailMessage {
  to: string
  subject: string
  text: string
  html?: string
}

export interface SmsMessage {
  /** E.164, e.g. `+66812345678`. Callers normalise before sending. */
  to: string
  text: string
}

/** Port every email adapter implements. */
export interface EmailProvider {
  readonly name: string
  send(message: EmailMessage): Promise<void>
  close?(): Promise<void>
}

/** Port every SMS adapter implements. */
export interface SmsProvider {
  readonly name: string
  send(message: SmsMessage): Promise<void>
  close?(): Promise<void>
}

export type Notification =
  | ({ channel: NotificationChannel.EMAIL } & EmailMessage)
  | ({ channel: NotificationChannel.SMS } & SmsMessage)

/** Writes a block of text somewhere a developer can read it (stdout by default). */
export type ConsoleWriter = (text: string) => void
