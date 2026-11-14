# Deploy (#17): Vercel + Turso + Resend

The steps the owner takes in each service's dashboard. The code side is in the repo:
`api/vercel.json` + `api/api/index.js` (the API as one Vercel function, daily cleanups by Vercel
Cron) and `web/vercel.json` + `web/middleware.js` (the static PWA, `/api/*` sent to the API).

**Two environments.** Staging is the `develop` branch, production is `main`. Each Vercel project
has the matching environments: _Preview_ (scoped to `develop`) and _Production_. Each one has its
own Turso database and its own secrets. Never share a database or a secret between them.

Never paste a key or a secret in a chat, an issue or a commit. They go in the Vercel dashboard
only. What each variable means and which keys to get first: [env.md](env.md).

## 1. GitHub

- Settings → General: default branch **`develop`**.
- Settings → Branches: protect `develop` and `main` (pull request + the `api` / `web` checks).

## 2. Turso (one database per environment)

```bash
turso db create tang-pai-nai-staging
turso db show tang-pai-nai-staging --url      # DATABASE_URL (libsql://…)
turso db tokens create tang-pai-nai-staging   # DATABASE_AUTH_TOKEN
```

Same for `tang-pai-nai-prod`. Apply the migrations from your PC, in `api/`, before the first
deploy and again whenever a merge adds a file to `api/drizzle/`:

```bash
DATABASE_URL="libsql://…" DATABASE_AUTH_TOKEN="…" npm run db:migrate
```

The currencies come with the migrations; there is nothing to seed. Deploys never migrate by
themselves (a pull request's preview must not change the staging database).

## 3. Resend (sign-in emails)

- Add and verify your domain (DNS records), then create an API key with "Sending access".
- `SMTP_URL` = `smtps://resend:<API key>@smtp.resend.com:465`, `EMAIL_FROM` = an address on
  that domain, e.g. `Tang Pai Nai <no-reply@your-domain>`.
- Until a domain is verified, Resend only delivers to the account owner's own address.

## 3b. Cloudflare Turnstile (bot check on sign-in, auth rule 32)

- Cloudflare dashboard → Turnstile → Add widget, **one per environment** (staging, production).
  Hostnames: the web's host for that environment (e.g. `<project>-git-develop-<team>.vercel.app`
  for staging, plus `localhost` so the Docker `staging` profile works; your own domain for
  production). Widget mode **Managed**. No DNS change and no
  Cloudflare proxy (orange cloud) is needed: keep the web's DNS record **DNS only**, Vercel
  serves it.
- Each widget gives a **site key** (public) → `TURNSTILE_SITE_KEY` and a **secret key** →
  `TURNSTILE_SECRET_KEY`, both on the API project (step 4). The web reads the site key from
  `GET /api/auth/providers`; it has no setting of its own.
- Leave both unset and the check is off. Development uses Cloudflare's test keys (see
  [env.md](env.md)); never put them on staging or production, where they would let every bot in.

## 4. Vercel: the API project

- New project from this repo, **Root Directory `api`**, Framework Preset _Other_ (build, output and
  the rewrite come from `api/vercel.json`).
- Settings → Deployment Protection: **off for this project**. The web's middleware calls it from
  the server side and can't pass Vercel's login; the API has its own auth.
- Environment variables (Production and Preview, each with its own values). **Preview** =
  import `api/.env.staging` (Settings → Environment Variables → Import .env, branch `develop`)
  once it works with `docker compose --profile staging` ([env.md](env.md) → Environments).
  **Production**: type or import them from your password manager; they never sit in a file in
  the repo folder.

| Name                                                            | Value                                                                |
| --------------------------------------------------------------- | -------------------------------------------------------------------- |
| `NODE_ENV`                                                      | `production` (staging too: it bars the console mail / SMS providers) |
| `BASE_URL`                                                      | this API's URL (only logged)                                         |
| `LOG_LEVEL_CONSOLE` / `LOG_LEVEL_FILE` / `LOG_LEVEL_ERROR_FILE` | `info` / `info` / `error`                                            |
| `LOG_FILE_ENABLED`                                              | `false`                                                              |
| `DATABASE_URL`, `DATABASE_AUTH_TOKEN`                           | from step 2                                                          |
| `EMAIL_PROVIDER`, `SMTP_URL`, `EMAIL_FROM`                      | `smtp` and step 3                                                    |
| `SMS_PROVIDER`                                                  | `disabled` (phone sign-in hidden) until an SMS provider is chosen    |
| `WEB_ORIGIN`                                                    | the web's URL for that environment (see step 6)                      |
| `TRUST_PROXY_HOPS`                                              | `1` to start; check it in step 7                                     |
| `JWT_SECRET`, `OTP_PEPPER`, `CRON_SECRET`                       | each `openssl rand -base64 48`, new for every environment            |
| `SIGNUP_ENABLED`                                                | `true` while the family signs up, then `false`                       |
| `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET`                      | optional: leave unset and the Google button is hidden                |
| `TURNSTILE_SITE_KEY`, `TURNSTILE_SECRET_KEY`                    | step 3b; both or neither (unset: no bot check)                       |

Vercel Cron calls `GET /auth/cleanup` and `GET /sync/cleanup` every day (02:17 and 02:47 Thai
time) with `CRON_SECRET`, on **production only**. On staging run them by hand when needed:
`curl -H "Authorization: Bearer <CRON_SECRET>" https://<staging API>/auth/cleanup`.

## 5. Vercel: the web project

- New project from this repo, **Root Directory `web`**, Framework Preset _Other_ (settings come
  from `web/vercel.json`).
- Environment variable `API_ORIGIN`: Production = the API's production URL, Preview = the API's
  `develop` URL (step 6). No trailing path.
- Deployment Protection may stay on for previews: you are signed in to Vercel; family testers
  need it off.

## 6. Staging URLs

Each project gives the `develop` branch a stable URL, shown under the deployment's Domains:
`<project>-git-develop-<team>.vercel.app`. Use those (or your own domains) for the API's
Preview `WEB_ORIGIN` and the web's Preview `API_ORIGIN`. The API accepts the refresh cookie only
from `WEB_ORIGIN`, so a pull request's own preview URL can't stay signed in: test sign-in on the
`develop` URL.

## 7. First check on staging

1. `https://<web>/api/health` answers `Operation successful` (the middleware reaches the API).
2. Sign in with your email: the code arrives from Resend; set the PIN, create a profile and a
   wallet, add a transaction, reload: the data comes back after the PIN. With Turnstile on,
   `https://<web>/api/auth/providers` shows `botCheckSiteKey`, and the sign-in shows no
   "bot check failed" line.
3. Set the API's Preview `LOG_LEVEL_CONSOLE` to `http` and redeploy: each request line in the
   Vercel logs ends with the IP the API sees. It must be your phone's public IP, not a Vercel
   address; if it isn't, raise `TRUST_PROXY_HOPS` by one and redeploy (rate limits count per
   IP). Then set `LOG_LEVEL_CONSOLE` back to `info`.
4. Install the PWA on the phone (Add to Home Screen) and open it offline once.

Then merge `develop` into `main` and repeat 1–4 on production.
