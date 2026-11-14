# Environment variables

Every setting both apps read, what it is for and where its value comes from. The validated list
is the code: `api/src/core/config/env/env.schema.ts` (the API refuses to start on a wrong or
missing value) and `web/middleware.js`.

Never commit a `.env.*` file with real values (they are gitignored), and never paste a secret in a
chat, an issue or a commit.

## Environments

Three sets of values, never sharing a key or a database. Two branches: `develop` → staging,
`main` → production.

| Set            | Runs                                                   | Values in                                             | Services                                                       |
| -------------- | ------------------------------------------------------ | ----------------------------------------------------- | -------------------------------------------------------------- |
| **dev**        | `npm run dev`, Docker `dev` (`:8080`)                  | `api/.env.dev`                                        | SQLite file, mail in the log, Turnstile **test keys** (a mock) |
| **staging**    | Vercel Preview (`develop`), Docker `staging` (`:8081`) | `api/.env.staging` → imported into Vercel **Preview** | its own Turso database, Resend key and Turnstile widget        |
| **production** | Vercel Production (`main`)                             | Vercel **Production** only (no file on the PC)        | its own Turso database, Resend key and Turnstile widget        |

- `npm run setup-env` makes `.env.dev` and `.env.staging` from `api/.env.example`, and adds to
  existing ones any variable they lack.
- **Staging is tried on the PC first**: fill `api/.env.staging`, run
  `docker compose --profile staging up --build` (this PC's code against staging's real Turso,
  Resend and Turnstile; compose only swaps the addresses to `localhost:8081`), then import the same
  file into Vercel (API project → Settings → Environment Variables → Import .env, environment
  Preview, branch `develop`). Starting the profile **migrates the staging database**.
- The staging Turnstile widget lists two hostnames: the web's `develop` URL and `localhost`.
- Production's values are typed or imported into Vercel straight from a password manager; they
  never sit in a file in the repo folder.

## 1. What to get before a deploy

The values that come from outside the repo. Make a **separate one for staging and for
production**; never share them. Development needs none of them.

| What                   | Where to get it                                                          | Becomes                                                 | Needed?                   |
| ---------------------- | ------------------------------------------------------------------------ | ------------------------------------------------------- | ------------------------- |
| Turso database + token | `turso db create …`, `turso db show … --url`, `turso db tokens create …` | `DATABASE_URL`, `DATABASE_AUTH_TOKEN`                   | yes                       |
| Resend API key         | resend.com → API keys ("Sending access"), after verifying the domain     | `SMTP_URL` = `smtps://resend:<key>@smtp.resend.com:465` | yes (sign-in mails)       |
| Cloudflare Turnstile   | Cloudflare dashboard → Turnstile → Add widget (hostname = the web's)     | `TURNSTILE_SITE_KEY`, `TURNSTILE_SECRET_KEY`            | recommended (bot check)   |
| Google OAuth client    | Google Cloud console → Credentials → OAuth client ID (Web application)   | `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET`              | optional (Google sign-in) |
| Random secrets         | `openssl rand -base64 48`, a new one each                                | `JWT_SECRET`, `OTP_PEPPER`, `CRON_SECRET`               | yes                       |

SMS has no provider yet: `SMS_PROVIDER=disabled` hides phone sign-in. Step-by-step setup of each
service: [deploy.md](deploy.md).

## 2. API (`api/`)

**Required** = the API won't start without it in production. "Secret" = keep it out of logs,
chats and commits.

### App and logs

| Name                   | Required | Default | What                                                                          |
| ---------------------- | -------- | ------- | ----------------------------------------------------------------------------- |
| `NODE_ENV`             | yes      | —       | `development` or `production` (staging too: it bars the console providers)    |
| `PORT`                 | no       | `3000`  | local runs only; Vercel sets none                                             |
| `BASE_URL`             | yes      | —       | this API's URL, only logged                                                   |
| `CORS_ORIGINS`         | no       | empty   | comma-separated; not needed in production (same origin through `/api`)        |
| `LOG_LEVEL_CONSOLE`    | yes      | —       | `debug` locally, `info` deployed (`http` briefly to check `TRUST_PROXY_HOPS`) |
| `LOG_LEVEL_FILE`       | yes      | —       | `info`                                                                        |
| `LOG_LEVEL_ERROR_FILE` | yes      | —       | `error`                                                                       |
| `LOG_FILE_ENABLED`     | no       | `true`  | `false` on Vercel (read-only filesystem)                                      |
| `LOG_SILENT`           | no       | `false` | tests and scripts only                                                        |
| `SHUTDOWN_TIMEOUT_MS`  | no       | `10000` | graceful shutdown deadline                                                    |

### Database

| Name                  | Required | Default                | What                             |
| --------------------- | -------- | ---------------------- | -------------------------------- |
| `DATABASE_URL`        | no       | `file:./data/local.db` | Turso `libsql://…` when deployed |
| `DATABASE_AUTH_TOKEN` | deployed | unset                  | **secret**, Turso token          |

### Mail and SMS

| Name             | Required  | Default                             | What                                                                       |
| ---------------- | --------- | ----------------------------------- | -------------------------------------------------------------------------- |
| `EMAIL_PROVIDER` | no        | `console`                           | `console` prints mails (dev only); `smtp` when deployed                    |
| `SMTP_URL`       | with smtp | unset                               | **secret** (holds the Resend key); locally Mailpit `smtp://localhost:1025` |
| `EMAIL_FROM`     | no        | `Tang Pai Nai <no-reply@localhost>` | an address on the verified domain                                          |
| `SMS_PROVIDER`   | no        | `console`                           | `console` (dev only) or `disabled`                                         |

### Sign-in and security ([auth.md](features/auth.md))

| Name                    | Required | Default                          | What                                                                    |
| ----------------------- | -------- | -------------------------------- | ----------------------------------------------------------------------- |
| `WEB_ORIGIN`            | yes      | `http://localhost:4200`          | the web's URL: builds magic links, the only `Origin` cookie routes take |
| `TRUST_PROXY_HOPS`      | no       | `1`                              | proxies in front of the API, so rate limits see the client's IP         |
| `JWT_SECRET`            | yes      | —                                | **secret**, ≥ 32 characters                                             |
| `OTP_PEPPER`            | yes      | —                                | **secret**, ≥ 32 characters                                             |
| `SIGNUP_ENABLED`        | no       | `true`                           | `false` closes sign-up; existing users still sign in                    |
| `EMAIL_DAILY_LIMIT`     | no       | `100`                            | global cap on sign-in mails per day                                     |
| `SMS_DAILY_LIMIT`       | no       | `100`                            | global cap on SMS per day                                               |
| `PASSWORD_BREACH_CHECK` | no       | `hibp`                           | `hibp` or `off`                                                         |
| `HIBP_API_URL`          | no       | `https://api.pwnedpasswords.com` | a local stand-in when testing                                           |
| `GOOGLE_CLIENT_ID`      | no       | unset                            | Google sign-in; both or neither (off: the button is hidden)             |
| `GOOGLE_CLIENT_SECRET`  | no       | unset                            | **secret**                                                              |
| `GOOGLE_ISSUER`         | no       | `https://accounts.google.com`    | `http://localhost:4400` with `npm run dev:oidc`                         |
| `TURNSTILE_SITE_KEY`    | no       | unset                            | bot check (rule 32); both or neither (off: no check). Public            |
| `TURNSTILE_SECRET_KEY`  | no       | unset                            | **secret**                                                              |
| `CRON_SECRET`           | deployed | unset                            | **secret**, ≥ 32 characters; unset, the cleanup routes answer 404       |

Locally, Cloudflare's Turnstile **test keys** work on any host: site `1x00000000000000000000AA`
with secret `1x0000000000000000000000000000000AA` (always passes) or
`2x0000000000000000000000000000000AA` (always fails).

## 3. Web (`web/`)

The web has no build-time settings (no API URL in an environment file, no keys: the Turnstile
site key comes from `GET /api/auth/providers`).

| Name                         | Where                          | What                                                                       |
| ---------------------------- | ------------------------------ | -------------------------------------------------------------------------- |
| `API_ORIGIN`                 | Vercel (web project)           | the API's URL for that environment; `web/middleware.js` sends `/api` there |
| `TUNNEL_NAME`, `TUNNEL_HOST` | `web/.env.tunnel` (local only) | `npm run dev` through a named Cloudflare tunnel; see `.env.tunnel.example` |
