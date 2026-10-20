import { exportJWK, generateKeyPair, SignJWT } from 'jose'
import { createHash, randomBytes } from 'node:crypto'
import { createServer } from 'node:http'
import type { IncomingMessage, ServerResponse } from 'node:http'

/**
 * A local stand-in for Google's OpenID Connect provider, for dev and manual tests only (auth spec
 * rule 14, ROADMAP "Local-first"). It never runs in the app. Point the API at it with
 *
 *   GOOGLE_CLIENT_ID="dev-client" GOOGLE_CLIENT_SECRET="dev-secret"
 *   GOOGLE_ISSUER="http://localhost:4400"
 *
 * The authorize page lets you pick the Google account (sub, email, email_verified, name, picture)
 * and a scenario that breaks the ID token in one way, so every check of the callback can be tried.
 * `POST /authorize` takes the same fields, so curl can skip the page.
 */

const PORT = Number(process.env.OIDC_PORT ?? 4400)
const ISSUER = `http://localhost:${PORT}`
const CLIENT_ID = process.env.OIDC_CLIENT_ID ?? 'dev-client'
const CLIENT_SECRET = process.env.OIDC_CLIENT_SECRET ?? 'dev-secret'
const CODE_TTL_MS = 60_000
const KEY_ID = 'dev-oidc-1'

const SCENARIOS = {
  ok: 'Valid ID token',
  wrong_aud: 'aud is another client',
  wrong_issuer: 'iss is another issuer',
  expired: 'exp one hour ago',
  wrong_nonce: 'nonce does not match',
  bad_signature: 'signed with a key not in the JWKS',
} as const
type Scenario = keyof typeof SCENARIOS

interface PendingCode {
  clientId: string
  redirectUri: string
  codeChallenge: string
  nonce: string
  scenario: Scenario
  claims: { sub: string; email: string; email_verified: boolean; name?: string; picture?: string }
  expiresAt: number
}

const signingKey = await generateKeyPair('RS256')
const strangerKey = await generateKeyPair('RS256')
const publicJwk = {
  ...(await exportJWK(signingKey.publicKey)),
  kid: KEY_ID,
  alg: 'RS256',
  use: 'sig',
}
const codes = new Map<string, PendingCode>()

const escapeHtml = (value: string) =>
  value.replace(/[&<>"']/g, (char) => `&#${char.charCodeAt(0)};`)

const send = (res: ServerResponse, status: number, body: string, type = 'application/json') => {
  res.writeHead(status, { 'content-type': type, 'cache-control': 'no-store' })
  res.end(body)
}
const json = (res: ServerResponse, status: number, body: unknown) =>
  send(res, status, JSON.stringify(body))
const redirect = (res: ServerResponse, location: string) => {
  res.writeHead(302, { location })
  res.end()
}

const readForm = async (req: IncomingMessage): Promise<URLSearchParams> => {
  const chunks: Buffer[] = []
  for await (const chunk of req) {
    chunks.push(chunk as Buffer)
  }
  return new URLSearchParams(Buffer.concat(chunks).toString('utf8'))
}

const isScenario = (value: string): value is Scenario => Object.hasOwn(SCENARIOS, value)

/** Checks the authorization request the API built; `null` when it's fine. */
const authorizeProblem = (params: URLSearchParams): string | null => {
  if (params.get('client_id') !== CLIENT_ID) {
    return 'unknown client_id'
  }
  if (params.get('response_type') !== 'code') {
    return 'response_type must be code'
  }
  if (params.get('code_challenge_method') !== 'S256' || !params.get('code_challenge')) {
    return 'PKCE S256 required'
  }
  if (!params.get('redirect_uri') || !params.get('state') || !params.get('nonce')) {
    return 'redirect_uri, state and nonce are required'
  }
  return null
}

const authorizePage = (params: URLSearchParams) => {
  const hidden = ['client_id', 'redirect_uri', 'state', 'nonce', 'code_challenge']
    .map(
      (key) => `<input type="hidden" name="${key}" value="${escapeHtml(params.get(key) ?? '')}">`
    )
    .join('')
  const options = Object.entries(SCENARIOS)
    .map(([value, label]) => `<option value="${value}">${value}: ${label}</option>`)
    .join('')
  return `<!doctype html><html lang="en"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1"><title>Dev OIDC</title>
<style>body{font-family:system-ui,sans-serif;max-width:420px;margin:24px auto;padding:0 16px}
label{display:block;margin:12px 0 4px}input,select{width:100%;padding:8px;box-sizing:border-box}
.row{display:flex;gap:8px;margin-top:20px}button{flex:1;padding:12px}
.check{display:flex;gap:8px;align-items:center}.check input{width:auto}</style></head><body>
<h1>Dev OIDC (stand-in for Google)</h1>
<p>Scopes: ${escapeHtml(params.get('scope') ?? '')} · prompt: ${escapeHtml(params.get('prompt') ?? '')}</p>
<form method="post" action="/authorize">${hidden}
<label for="sub">sub</label><input id="sub" name="sub" value="google-sub-1" required>
<label for="email">email</label><input id="email" name="email" value="someone@gmail.com">
<label class="check"><input type="checkbox" name="email_verified" value="true" checked> email_verified</label>
<label for="name">name</label><input id="name" name="name" value="Somchai Jaidee">
<label for="picture">picture</label><input id="picture" name="picture" value="https://lh3.googleusercontent.com/a/dev-picture">
<label for="scenario">scenario</label><select id="scenario" name="scenario">${options}</select>
<div class="row"><button type="submit" name="decision" value="deny">Cancel</button>
<button type="submit" name="decision" value="allow">Continue</button></div>
</form></body></html>`
}

const approve = async (req: IncomingMessage, res: ServerResponse) => {
  const form = await readForm(req)
  const problem = authorizeProblem(
    new URLSearchParams({
      ...Object.fromEntries(form),
      response_type: 'code',
      code_challenge_method: 'S256',
    })
  )
  if (problem) {
    send(res, 400, problem, 'text/plain')
    return
  }
  const back = new URL(form.get('redirect_uri') ?? '')
  back.searchParams.set('state', form.get('state') ?? '')
  if (form.get('decision') === 'deny') {
    back.searchParams.set('error', 'access_denied')
    redirect(res, back.toString())
    return
  }
  const scenario = form.get('scenario') ?? 'ok'
  const code = randomBytes(24).toString('base64url')
  codes.set(code, {
    clientId: CLIENT_ID,
    redirectUri: form.get('redirect_uri') ?? '',
    codeChallenge: form.get('code_challenge') ?? '',
    nonce: form.get('nonce') ?? '',
    scenario: isScenario(scenario) ? scenario : 'ok',
    claims: {
      sub: form.get('sub') || 'google-sub-1',
      email: form.get('email') ?? '',
      email_verified: form.get('email_verified') === 'true',
      name: form.get('name') || undefined,
      picture: form.get('picture') || undefined,
    },
    expiresAt: Date.now() + CODE_TTL_MS,
  })
  back.searchParams.set('code', code)
  redirect(res, back.toString())
}

const idTokenFor = async (pending: PendingCode): Promise<string> => {
  const { scenario } = pending
  const now = Math.floor(Date.now() / 1000)
  const issuedAt = scenario === 'expired' ? now - 7200 : now
  return new SignJWT({
    ...pending.claims,
    nonce: scenario === 'wrong_nonce' ? 'not-the-nonce' : pending.nonce,
    azp: CLIENT_ID,
  })
    .setProtectedHeader({ alg: 'RS256', kid: KEY_ID, typ: 'JWT' })
    .setIssuer(scenario === 'wrong_issuer' ? 'https://evil.example' : ISSUER)
    .setAudience(scenario === 'wrong_aud' ? 'another-client' : pending.clientId)
    .setSubject(pending.claims.sub)
    .setIssuedAt(issuedAt)
    .setExpirationTime(issuedAt + 3600)
    .sign(scenario === 'bad_signature' ? strangerKey.privateKey : signingKey.privateKey)
}

const token = async (req: IncomingMessage, res: ServerResponse) => {
  const form = await readForm(req)
  const code = form.get('code') ?? ''
  const pending = codes.get(code)
  codes.delete(code) // single use
  if (
    form.get('grant_type') !== 'authorization_code' ||
    !pending ||
    pending.expiresAt < Date.now()
  ) {
    json(res, 400, { error: 'invalid_grant' })
    return
  }
  if (form.get('client_id') !== CLIENT_ID || form.get('client_secret') !== CLIENT_SECRET) {
    json(res, 401, { error: 'invalid_client' })
    return
  }
  const challenge = createHash('sha256')
    .update(form.get('code_verifier') ?? '')
    .digest('base64url')
  if (form.get('redirect_uri') !== pending.redirectUri || challenge !== pending.codeChallenge) {
    json(res, 400, { error: 'invalid_grant', error_description: 'redirect_uri or PKCE mismatch' })
    return
  }
  json(res, 200, {
    access_token: randomBytes(24).toString('base64url'),
    token_type: 'Bearer',
    expires_in: 3600,
    scope: 'openid email profile',
    id_token: await idTokenFor(pending),
  })
}

const server = createServer((req, res) => {
  const url = new URL(req.url ?? '/', ISSUER)
  console.log(`[dev-oidc] ${req.method} ${url.pathname}`)
  const handle = async () => {
    if (req.method === 'GET' && url.pathname === '/.well-known/openid-configuration') {
      json(res, 200, {
        issuer: ISSUER,
        authorization_endpoint: `${ISSUER}/authorize`,
        token_endpoint: `${ISSUER}/token`,
        jwks_uri: `${ISSUER}/jwks`,
        response_types_supported: ['code'],
        subject_types_supported: ['public'],
        id_token_signing_alg_values_supported: ['RS256'],
        code_challenge_methods_supported: ['S256'],
      })
    } else if (req.method === 'GET' && url.pathname === '/jwks') {
      json(res, 200, { keys: [publicJwk] })
    } else if (req.method === 'GET' && url.pathname === '/authorize') {
      const problem = authorizeProblem(url.searchParams)
      if (problem) {
        send(res, 400, problem, 'text/plain')
        return
      }
      send(res, 200, authorizePage(url.searchParams), 'text/html; charset=utf-8')
    } else if (req.method === 'POST' && url.pathname === '/authorize') {
      await approve(req, res)
    } else if (req.method === 'POST' && url.pathname === '/token') {
      await token(req, res)
    } else {
      json(res, 404, { error: 'not_found' })
    }
  }
  handle().catch((error: unknown) => {
    console.error('[dev-oidc]', error)
    json(res, 500, { error: 'server_error' })
  })
})

server.listen(PORT, () => {
  console.log(`[dev-oidc] issuer ${ISSUER} · client ${CLIENT_ID} / ${CLIENT_SECRET}`)
})
