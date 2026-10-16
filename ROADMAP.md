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
| 1   | **Deploy & dev workflow**  | ⬜  | ⬜  | **← next.** Vercel ×2, `/api` rewrite, Claude GitHub Action, previews                                     |
| 2   | Database foundation        | ⬜  | —   | Drizzle + `@libsql/client`; local file DB, Turso in prod; migrations, seed                                |
| 3   | App shell                  | —   | ⬜  | spartan/ui + shared form fields done; still: PWA (`@angular/pwa`), bottom tab bar, dark mode, empty pages |
| 4   | Auth                       | ⬜  | ⬜  | email OTP / magic link (default), optional password, Google. [spec](docs/features/auth.md)                |
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

✅ done · ⬜ not started · — not applicable

Each row gets its `docs/features/<feature>.md` before work starts. Rows 0–8 are the MVP. After #8 the
app can replace Money Lover for daily use.

---

## Next up: Deploy & dev workflow (#1)

Goal: every later feature can be built from a phone, through GitHub.

1. **GitHub**: create the repo, push `main`, protect `main` (PR + green CI required). CI already
   exists: `.github/workflows/api.yml` and `web.yml`, each running only when its folder changes.
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

- Two ways to sign in: **email** or **Google**. Email defaults to **passwordless** (one 6-digit OTP +
  magic link in the same email). A user may **optionally set a password** and then sign in with
  email + password.
- **The `users` table holds no password.** Credentials live in their own tables
  (`password_credentials`, `user_identities`).
- Sign-up is **invite-only** (an allowlist of family emails), with no public registration.
- The rules follow current OWASP guidance (ASVS 5.0, Authentication / Password Storage / Session
  Management / OAuth 2.0 cheat sheets) and NIST SP 800-63B-4. Specifics are in the spec.

---

## Backlog / open questions

- **Email provider** for OTP and magic links. Proposal: **Resend** (free tier, simple HTTP API). The
  provider sits behind a `core/mailer` port, so it can be swapped.
- **Family sharing model** (#16): shared wallets with members (owner / editor / viewer), or a
  "household" that owns wallets? Decide before #16, ideally before #6 if it changes the wallet table.
- **Offline support**: queue new transactions while offline and sync later? Nice for travel. It's
  out of scope for the MVP; the PWA only caches the app shell.
- **FX / multi-currency reports**: convert to THB with daily rates. Out of scope until a non-THB
  currency is actually used.
- **Import from Money Lover** (CSV export → our transactions). Decide after #8.
