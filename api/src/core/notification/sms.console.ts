import { formatConsoleBlock, stdoutWriter } from './console-writer'
import type { ConsoleWriter, SmsProvider } from './notification.type'

interface ConsoleSmsDeps {
  write?: ConsoleWriter
}

/** Dev provider: prints the SMS instead of sending it. No account or API key needed. */
export const createConsoleSmsProvider = ({
  write = stdoutWriter,
}: ConsoleSmsDeps = {}): SmsProvider => ({
  name: 'console',
  send: async ({ to, text }) => {
    write(formatConsoleBlock('📱 SMS (console provider, not sent)', [['To', to]], text))
    return Promise.resolve()
  },
})
