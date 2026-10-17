import nodemailer from 'nodemailer'
import type { EmailProvider } from './notification.type'

interface SmtpEmailDeps {
  from: string
  /** e.g. `smtp://localhost:1025` (Mailpit) or `smtps://user:pass@smtp.example.com:465`. */
  url: string
}

/**
 * Sends through any SMTP server via Nodemailer: a local catcher (Mailpit) in dev, or a hosted
 * provider's SMTP endpoint (Resend, SES, Brevo, Gmail, …) later, with only env changes.
 */
export const createSmtpEmailProvider = ({ from, url }: SmtpEmailDeps): EmailProvider => {
  const transport = nodemailer.createTransport(url)

  return {
    name: 'smtp',
    send: async ({ to, subject, text, html }) => {
      await transport.sendMail({ from, to, subject, text, html })
    },
    close: async () => {
      transport.close()
      return Promise.resolve()
    },
  }
}
