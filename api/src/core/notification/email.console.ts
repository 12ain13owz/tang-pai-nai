import { formatConsoleBlock, stdoutWriter } from './console-writer'
import type { ConsoleWriter, EmailProvider } from './notification.type'

interface ConsoleEmailDeps {
  from: string
  write?: ConsoleWriter
}

/** Dev provider: prints the mail instead of sending it. No account or API key needed. */
export const createConsoleEmailProvider = ({
  from,
  write = stdoutWriter,
}: ConsoleEmailDeps): EmailProvider => ({
  name: 'console',
  send: async ({ to, subject, text }) => {
    write(
      formatConsoleBlock(
        '📧 Email (console provider, not sent)',
        [
          ['From', from],
          ['To', to],
          ['Subject', subject],
        ],
        text
      )
    )
    return Promise.resolve()
  },
})
