import { createHash } from 'node:crypto'
import { createServer } from 'node:http'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { createPwnedPasswordsChecker, skipBreachCheck } from './breached-password'
import type { AddressInfo } from 'node:net'

const BREACHED = 'Password123!'
const sha1 = (value: string) => createHash('sha1').update(value).digest('hex').toUpperCase()

interface SeenRequest {
  url: string
  padding: string | undefined
}

// A local stand-in for the HIBP range API: `/range/<prefix>` lists the breached suffixes that
// start with it, plus a padding line (count 0) like `Add-Padding` adds; `/broken` fails and
// `/slow` never answers in time.
const seen: SeenRequest[] = []
const server = createServer((req, res) => {
  const url = req.url ?? ''
  seen.push({ url, padding: req.headers['add-padding'] as string | undefined })
  if (url.startsWith('/broken/')) {
    res.statusCode = 503
    res.end()
    return
  }
  if (url.startsWith('/slow/')) {
    setTimeout(() => res.end(''), 1000)
    return
  }
  const prefix = url.split('/').pop() ?? ''
  const digest = sha1(BREACHED)
  const lines = digest.startsWith(prefix) ? [`${digest.slice(5)}:42`] : []
  lines.push(`${sha1('only padding').slice(5)}:0`)
  res.end(lines.join('\r\n'))
})

let base = ''
beforeAll(async () => {
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve))
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`
})
afterAll(async () => {
  server.closeAllConnections()
  await new Promise((resolve) => server.close(resolve))
})

describe('createPwnedPasswordsChecker', () => {
  it('reports a password whose hash suffix is listed with a count', async () => {
    const check = createPwnedPasswordsChecker({ baseUrl: base, timeoutMs: 500 })

    expect(await check(BREACHED)).toBe(true)
    expect(await check('Gr33n Mango Tree')).toBe(false)
  })

  it('sends only the first 5 hex characters of the SHA-1, with Add-Padding', async () => {
    seen.length = 0
    await createPwnedPasswordsChecker({ baseUrl: `${base}/`, timeoutMs: 500 })(BREACHED)

    expect(seen).toEqual([{ url: `/range/${sha1(BREACHED).slice(0, 5)}`, padding: 'true' }])
  })

  it('ignores padding lines (count 0)', async () => {
    const check = createPwnedPasswordsChecker({ baseUrl: base, timeoutMs: 500 })

    expect(await check('only padding')).toBe(false)
  })

  it.each([
    ['answers with an error status', '/broken'],
    ['is slower than the timeout', '/slow'],
  ])('answers null when the service %s', async (_case, path) => {
    const check = createPwnedPasswordsChecker({ baseUrl: `${base}${path}`, timeoutMs: 100 })

    expect(await check(BREACHED)).toBeNull()
  })

  it('answers null when the service is unreachable', async () => {
    const check = createPwnedPasswordsChecker({ baseUrl: 'http://127.0.0.1:1', timeoutMs: 500 })

    expect(await check(BREACHED)).toBeNull()
  })
})

describe('skipBreachCheck', () => {
  it('never reports a breach', async () => {
    expect(await skipBreachCheck(BREACHED)).toBe(false)
  })
})
