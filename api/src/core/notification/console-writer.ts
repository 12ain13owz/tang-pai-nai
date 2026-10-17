import type { ConsoleWriter } from './notification.type'

// Dev-only providers print straight to stdout, not through the logger, so log files never hold
// OTP codes or magic links (auth spec rule 18).
export const stdoutWriter: ConsoleWriter = (text) => {
  process.stdout.write(`${text}\n`)
}

export const formatConsoleBlock = (title: string, headers: [string, string][], body: string) => {
  const rule = '─'.repeat(60)
  const headerLines = headers.map(([key, value]) => `${key}: ${value}`)
  return [rule, title, ...headerLines, '', body, rule].join('\n')
}
