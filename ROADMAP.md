# Tang Pai Nai — Roadmap

Single source of truth for **what is built, what is next, and which decisions are already locked**.
Read this first, before `AGENTS.md`, when picking up work or planning a feature.

> **For AI assistants:** this file tells you _what_ to build and _in what order_. _How_ to write code
> lives in each app's `AGENTS.md` (`api/AGENTS.md`, `web/AGENTS.md`). If this file disagrees with the code, the code wins — fix this file
> in the same change. Never re-open a decision listed under [Locked decisions](#locked-decisions)
> without the user asking; propose, don't assume.

---

## Product

**Tang Pai Nai (เงินไปไหน, "where did the money go?")** is a personal income / expense tracker. Its
reference app is **Money Lover**, which the owner uses today; we keep what works there and drop the
rest. It's for the owner and their family only: no public sign-up, no SEO, no monetisation. It feels
like a native mobile app (installable PWA with a bottom tab bar).

## Repo layout

One git repo, two independent apps side by side. There's no monorepo tool: each folder has its own
`package.json`, `node_modules` and lint config, and is deployed as its own Vercel project (Root
Directory = `api` / `web`).

| Path             | What                                   | Stack                                                       |
| ---------------- | -------------------------------------- | ----------------------------------------------------------- |
| `api/`           | REST API                               | Express 5 + TypeScript, Drizzle ORM, SQLite (Turso in prod) |
| `web/`           | Mobile-first PWA                       | Angular 22 (zoneless, signals), Tailwind v4, spartan/ui     |
| `docs/features/` | Feature specs, shared by both apps     | Markdown                                                    |
| `ROADMAP.md`     | This file                              |                                                             |
| `.github/`       | CI per app (path-filtered), automation | GitHub Actions                                              |

There's no shared code package. The API contract is the API's OpenAPI spec plus `docs/features/`,
and the web app mirrors the types it needs in `<feature>.type.ts`. Because both apps live in one
repo, one PR can change spec, API and web together.

---

## How we build a feature

**Vertical slices, one feature at a time.** Finish a feature end-to-end before starting the next:

0. **Feature doc**. Write or refine `docs/features/<feature>.md` (template in that folder's
   `README.md`), agree on it, and commit it on its own (`docs(<feature>): ...`). It is the shared spec
   for API and web.
1. **API**. Drizzle schema + migration + seed, then the feature (entity → repository port → service →
   Drizzle adapter → schema/controller/routes), following `AGENTS.md` §6 and §8.
2. **Web**. Screens under `src/app/features/<feature>/`, following the web repo's `AGENTS.md`.
3. **Update this file**. Move the feature to ✅ and note any new decision or deferred item.

Small, separate commits per step. Each PR gets a Vercel preview URL, so check it on a phone before
merging.

---

## Status

| #   | Feature / phase            | API | Web | Notes                                                                                                     |
| --- | -------------------------- | --- | --- | --------------------------------------------------------------------------------------------------------- |
| 0   | Starter repos              | ✅  | ✅  | API from `node-express-ts-starter`; Angular 22 + Tailwind + shared lint                                   |
| 1   | **Local dev workflow**     | ⬜  | ⬜  | **← next.** run both apps in the sandbox, `/api` dev proxy, dev mailer (Nodemailer), no API keys          |
| 2   | Database foundation        | ⬜  | —   | Drizzle + `@libsql/client`; local file DB, Turso in prod; migrations, seed                                |
| 3   | App shell                  | —   | ⬜  | spartan/ui + shared form fields done; still: PWA (`@angular/pwa`), bottom tab bar, dark mode, empty pages |
| 4   | Auth                       | ⬜  | ⬜  | email OTP / magic link (default), optional password, Google, phone OTP. [spec](docs/features/auth.md)     |
| 5   | Currency                   | ⬜  | ⬜  | master table, THB default. [spec](docs/features/currency.md)                                              |
| 6   | Wallet                     | ⬜  | ⬜  | per-user accounts with a currency + balance. [spec](docs/features/wallet.md)                              |
| 7   | Category                   | ⬜  | ⬜  | income/expense, 1 level of sub-categories, default set seeded per user. [spec](docs/features/category.md) |
| 8   | Transaction                | ⬜  | ⬜  | the core: add/edit/delete, list by day/month, ➕ button. [spec](docs/features/transaction.md)             |
| 9   | Transfer between wallets   | ⬜  | ⬜  | two linked entries, excluded from income/expense totals                                                   |
| 10  | Reports                    | ⬜  | ⬜  | month summary, by-category breakdown, month-to-month trend                                                |
| 11  | Budget                     | ⬜  | ⬜  | per category (or total) per period, progress + over-budget warning                                        |
| 12  | Recurring transactions     | ⬜  | ⬜  | rules + Vercel Cron to materialise due entries                                                            |
| 13  | Debt / loan                | ⬜  | ⬜  | "lent to / borrowed from" with repayments                                                                 |
| 14  | Event / trip               | ⬜  | ⬜  | tag transactions to a trip, see its total (useful when travelling)                                        |
| 15  | Search, filter, CSV export | ⬜  | ⬜  |                                                                                                           |
| 16  | Family sharing             | ⬜  | ⬜  | shared wallets between family members — design TBD (see backlog)                                          |
| 17  | Deploy (Vercel)            | ⬜  | ⬜  | **deferred** until the owner asks. Vercel ×2, `/api` rewrite, previews, real mail provider, API keys      |

✅ done · ⬜ not started · — not applicable

Each row gets its `docs/features/<feature>.md` before work starts. Rows 0–8 are the MVP. After #8 the
app can replace Money Lover for daily use. Until #17, everything runs **locally only** (see locked
decision "Local-first").

---

## Next up: Local dev workflow (#1)

Goal: every feature can be built **and tested** inside a Claude Code sandbox (or the owner's PC),
with no deploy and no third-party API keys.

1. **API**: `cd api && npm run setup-env && npm run dev` serves `http://localhost:3000`. `.env.dev`
   holds only local values. Secrets the app itself needs (JWT secret, `OTP_PEPPER`, …) are random
   values generated by `setup-env`, not keys from an outside service.
2. **Web**: ✅ `cd web && npm start` serves `http://localhost:4200`. `web/proxy.conf.json` forwards
   `/api/*` to `http://localhost:3000` and strips the `/api` prefix (`/api/health` → `/health`), the
   same mapping the prod rewrite will use. The browser sees one origin in dev as in prod, so the web
   calls relative `/api/...` URLs (no `apiUrl` in an environment file) and the auth cookie behaves
   the same. Node: Angular CLI needs `^22.22.3 || >=24.15`; the repo pins **24** in `.nvmrc` (same
   as CI).
3. **Database**: local SQLite file `api/data/local.db` (gitignored), set up in #2.
4. **Notifications**: ✅ `core/notification` (see `api/AGENTS.md` §2). One `notifier`, two channels
   (email, SMS), provider chosen by env:
   - `EMAIL_PROVIDER=console` (default) prints mail (to, subject, text with the code and link) to
     **stdout**, not through the app logger, so log files never hold codes (auth rule 18).
     `EMAIL_PROVIDER=smtp` + `SMTP_URL` sends via **Nodemailer** (e.g. a local Mailpit at
     `smtp://localhost:1025`, no API key).
   - `SMS_PROVIDER=console` (default) prints the SMS; `disabled` makes sends fail with `503`.
   - `console` providers are refused when `NODE_ENV=production`.
5. **Features that need an outside key stay off** until their env vars are set: Google sign-in is
   disabled without `GOOGLE_CLIENT_ID` / `GOOGLE_CLIENT_SECRET` (the endpoints return `404`, the web
   hides the button). Scheduled jobs (auth cleanup, recurring #12) run as npm scripts locally
   instead of Vercel Cron.
6. **Testing a feature**: unit/integration tests (`npm test`) plus a real run in the sandbox: start
   both apps, exercise the API with `curl`, and check screens with Playwright (Chromium is
   pre-installed in Claude Code cloud sessions).
7. **Done when**: both apps start with one command each, `GET http://localhost:4200/api/health`
   answers through the proxy, and a test mail shows up on stdout.

## Later: Deploy (#17)

Deferred: do this only when the owner asks. Kept here so the work is ready to pick up.

1. **GitHub**: ✅ repo pushed with `main` + `develop`. Still to do:
   - Set **`develop` as the default branch** (Settings → General), so Claude sessions and new PRs
     start from it.
   - Protect `develop` and `main` (PR + green CI required). CI already exists:
     `.github/workflows/api.yml` and `web.yml`, each running only when its folder changes.
   - Vercel: production deploys from `main`, previews from `develop` and PR branches.
2. **API on Vercel**
   - Add a Vercel entry for Express (export the app from `createApp()`; `main.ts`'s `listen` stays for
     local dev). Check that `@/` aliases resolve in the Vercel build (build with `tsc` + `tsc-alias`
     and point Vercel at `dist/`, or bundle).
   - **Logger:** file transports can't run on Vercel (read-only filesystem). Add an env flag (e.g.
     `LOG_FILE_ENABLED`, default `true`, `false` on Vercel) so prod logs go to the console, which
     Vercel collects.
   - The `docs` feature reads `src/features/docs/spec/` at runtime, so include it in the function
     bundle (`includeFiles`) or bundle the spec at build time.
   - `express-rate-limit`'s in-memory store resets per instance. Keep it as a coarse global guard;
     security-critical limits (auth) are DB-backed (see auth spec).
   - Graceful shutdown hooks don't run on serverless. That's harmless, but don't rely on them there.
3. **Web on Vercel**: static Angular build + SPA fallback + **rewrite `/api/:path*` → API project**
   (see locked decision "Same origin via rewrite"). Dev: `proxy.conf.json` to `localhost:3000`.
4. **Claude Code GitHub Action** on the repo, so `@claude` in an issue or PR opens or updates a PR.
   Claude Code on the web/mobile app also works, because one session sees the whole repo.
5. **Preview deploys** per PR on both Vercel projects (both point at this repo, Root Directory
   `api` / `web`). Set each project's "Ignored Build Step" to skip builds when its folder didn't
   change (`git diff --quiet HEAD^ HEAD ./`). The web preview's `/api` points at the API's preview
   or staging URL.
6. **Mail/SMS in prod**: pick providers (see backlog) and plug them in behind `core/notification`,
   as SMTP settings or as a new adapter in `provider.registry.ts`.

## Then: Database foundation (#2)

- `drizzle-orm` + `@libsql/client` + `drizzle-kit`. `DATABASE_URL` = `file:./data/local.db` in dev,
  `libsql://…turso.io` + `DATABASE_AUTH_TOKEN` in prod.
- `src/core/database/` exports the client. `onShutdown` closes it locally.
- Schema lives in `src/core/database/schema/<feature>.ts` (one file per feature). Migrations are
  generated by drizzle-kit and committed.
- Seed script for dev data.
- Delete the starter's `todo` reference feature once the first real layered feature exists, and
  point `AGENTS.md` at that feature instead (see `AGENTS.md` §9).

---

## Locked decisions

Agreed with the user. Do not re-propose alternatives unless asked.

**Architecture**

- **One repo, two folders** (`api/`, `web/`), each deployed as its own Vercel project. This is
  simple on purpose: no monorepo tool (no Nx, no npm workspaces) and no shared package. One repo
  means one Claude Code session (from a phone) sees the specs and both apps at once.
- **API pattern = `node-express-ts-starter`**: feature folders, Clean Architecture inside a feature,
  factories with deps objects, `createResponse` envelope, domain errors. See `api/AGENTS.md`.
- **Database = SQLite**, via **Drizzle ORM** + `@libsql/client`: a local file in dev, **Turso** in prod.
- **Web = Angular**, client-side only (no SSR/SEO needed for a private app). **UI = Tailwind v4 +
  spartan/ui**, shipped as an installable **PWA** (not Ionic, not Capacitor). It behaves like a
  mobile app: bottom tab bar, bottom sheets, safe areas.
- **Same origin via rewrite.** The web project rewrites `/api/*` to the API project, so the browser
  only ever talks to the web origin. That keeps the refresh cookie first-party. `*.vercel.app` is on
  the Public Suffix List, so two `*.vercel.app` projects are cross-site to each other, and a
  `SameSite` cookie set by the API's own domain would not be sent. No CORS is needed in prod.
- **Local-first.** Until Deploy (#17), both apps run only locally (sandbox or the owner's PC). No
  feature may require a third-party API key to run or test; anything that needs one is off when its
  env vars are missing.
- **Notifications = pluggable providers** behind `core/notification`: one `notifier`, email + SMS
  channels, provider picked by env (`EMAIL_PROVIDER`, `SMS_PROVIDER`). Email uses **Nodemailer**
  SMTP; dev prints to stdout. Real providers (prod mail, an SMS gateway) are added as adapters at
  #17 or when a feature needs them.
- **Lint baseline is shared by convention.** The web `eslint.config.mjs` mirrors the API's baseline
  rules (import order, `@/` alias, no `../` imports, unused imports, type-aware TS rules) and adds
  angular-eslint. Change a baseline rule in both repos together.

**Money & data**

- **Amounts are integers in the currency's minor unit** (satang for THB). There are no floats
  anywhere, API or DB. The API returns `{ amount, currencyCode }`, and the web formats it with `Intl`.
- **Currency is a master table** (ISO 4217 code, minor-unit digits, active flag). Only **THB** is
  active at launch; others can be switched on later. Names come from `Intl.DisplayNames` on the web,
  so they aren't stored.
- **A wallet has exactly one currency.** Its transactions inherit it. There is no FX conversion in
  the MVP, and totals across currencies are shown per currency.
- **Every user-owned row carries `userId`**, and every query is scoped by it. One user never sees
  another's data until family sharing (#16) defines how.
- **IDs are UUIDv7 strings** (time-sortable). Timestamps are stored as integer epoch ms. Calendar
  dates of transactions are stored as `YYYY-MM-DD` in the user's timezone (default `Asia/Bangkok`).

**Auth** (full spec: [docs/features/auth.md](docs/features/auth.md))

- Three ways to sign in: **email**, **Google**, or **phone OTP** (SMS, only for a number already
  verified on an existing account; no sign-up by phone). Email defaults to **passwordless** (one 6-digit OTP +
  magic link in the same email). A user may **optionally set a password** and then sign in with
  email + password.
- **The `users` table holds no password.** Credentials live in their own tables
  (`password_credentials`, `user_identities`).
- Sign-up is **invite-only** (an allowlist of family emails), with no public registration.
- The rules follow current OWASP guidance (ASVS 5.0, Authentication / Password Storage / Session
  Management / OAuth 2.0 cheat sheets) and NIST SP 800-63B-4. Specifics are in the spec.

---

## Backlog / open questions

- **Prod email provider** for OTP and magic links (decide at #17). Dev uses Nodemailer with no
  provider. Proposal: **Resend** (free tier, offers SMTP too, so it can stay a Nodemailer config).
- **SMS gateway account**: SMS is for phone-OTP sign-in (auth spec rules 21–27), gateway =
  **ThaiBulkSMS**. Its adapter (`sms.thaibulksms.ts`) is written when the account and API key
  exist; until then dev uses the `console` SMS provider.
- **Family sharing model** (#16): shared wallets with members (owner / editor / viewer), or a
  "household" that owns wallets? Decide before #16, ideally before #6 if it changes the wallet table.
- **Offline support**: queue new transactions while offline and sync later? Nice for travel. It's
  out of scope for the MVP; the PWA only caches the app shell.
- **FX / multi-currency reports**: convert to THB with daily rates. Out of scope until a non-THB
  currency is actually used.
- **Import from Money Lover** (CSV export → our transactions). Decide after #8.
