// Values for EMAIL_PROVIDER / SMS_PROVIDER. Adding a provider = a new value here + an adapter in
// core/notification/<channel>.<provider>.ts + an entry in provider.registry.ts (see api/AGENTS.md §2).
export enum EmailProviderName {
  CONSOLE = 'console',
  SMTP = 'smtp',
}

export enum SmsProviderName {
  CONSOLE = 'console',
  DISABLED = 'disabled',
}

export enum NotificationChannel {
  EMAIL = 'email',
  SMS = 'sms',
}
