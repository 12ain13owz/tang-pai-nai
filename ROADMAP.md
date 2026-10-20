# Tang Pai Nai — Roadmap

Single source of truth for **what is built, what is next, and which decisions are already locked**.
Read this first, before `AGENTS.md`, when picking up work or planning a feature.

> **For AI assistants:** this file tells you _what_ to build and _in what order_. _How_ to write code
> lives in each app's `AGENTS.md` (`api/AGENTS.md`, `web/AGENTS.md`). If this file disagrees with the code, the code wins — fix this file
> in the same change. Never re-open a decision listed under [Locked decisions](#locked-decisions)
> without the user asking; propose, don't assume.

---

## Product

**Tang Pai Nai (ตังค์ไปไหน, "where did the money go?")** is a personal income / expense tracker. Its
reference app is **Money Lover**, which the owner uses today; we keep what works there and drop the
rest. It's built for the owner and their family: anyone may sign up, and family members are brought
in by invitation to a shared wallet. No SEO, no monetisation. It feels like a native mobile app
(installable PWA with a bottom tab bar).

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

**Vertical slices, one feature at a time.** Finish a feature end-to-end before starting the next.

**One feature (or one part of it, e.g. Auth 4.3) = one new Claude session = one branch = one PR.**
Start a fresh session for each instead of continuing an old one. The new session knows nothing of
earlier chats: it learns only from the repo (this file, the feature's spec, the `AGENTS.md` files
and `DESIGN.md`). So a session ends by writing down everything the next one needs (step 4), and a
decision agreed in chat but not in the repo is lost.

0. **Feature doc**. Write or refine `docs/features/<feature>.md` (template in that folder's
   `README.md`), agree on it, and commit it on its own (`docs(<feature>): ...`). It is the shared spec
   for API and web.
1. **API**. Drizzle schema + migration + seed, then the feature (entity → repository port → service →
   Drizzle adapter → schema/controller/routes), following `AGENTS.md` §6 and §8.
2. **Web**. Screens under `src/app/features/<feature>/`, following the web repo's `AGENTS.md`.
3. **Tests**. Once the feature works end to end (manual checks: `curl` for the API, Playwright for
   the web) and the owner confirms the behavior, write the tests for both apps as the last commits
   of the PR (see `api/AGENTS.md` §1 Testing). Not earlier: tests against code that is still
   changing just get rewritten.
4. **Update this file** (the hand-off to the next session). Move the feature to ✅ and note any new
   decision, deferred item or known issue, including tests left pending for a feature that is
   still experimental. Rules that apply beyond the feature go where they belong (`AGENTS.md`,
   `DESIGN.md`), not only in the PR or the chat.

Small, separate commits per step. Each PR gets a Vercel preview URL, so check it on a phone before
merging.

---

## Status

| #   | Feature / phase             | API | Web | Notes                                                                                                                |
| --- | --------------------------- | --- | --- | -------------------------------------------------------------------------------------------------------------------- |
| 0   | Starter repos               | ✅  | ✅  | API from `node-express-ts-starter`; Angular 22 + Tailwind + shared lint                                              |
| 1   | Local dev workflow          | ✅  | ✅  | run both apps in the sandbox, `/api` dev proxy, notifier (email/SMS providers), no API keys                          |
| 2   | Database foundation         | ✅  | —   | Drizzle + `@libsql/client`; local file DB, Turso in prod; migrations, seed                                           |
| 3   | App shell                   | —   | ✅  | PWA (offline app shell), bottom tab bar, dark mode, empty tab pages. See below                                       |
| 4   | Auth                        | ✅  | ✅  | email code + link, password, Google, Security page, phone OTP. [spec](docs/features/auth.md)                         |
| 4a  | **Offline sync foundation** | ⬜  | ⬜  | **← next.** encrypted local DB, PIN lock, outbox, `/sync/push` + `/sync/pull`. [spec](docs/features/offline-sync.md) |
| 5   | Currency                    | ⬜  | ⬜  | master table, THB default. [spec](docs/features/currency.md)                                                         |
| 6   | Wallet                      | ⬜  | ⬜  | accounts with a currency + balance; `wallet_members` table from day one. [spec](docs/features/wallet.md)             |
| 7   | Category                    | ⬜  | ⬜  | income/expense, 1 level of sub-categories, default set seeded per user. [spec](docs/features/category.md)            |
| 8   | Transaction                 | ⬜  | ⬜  | the core: add/edit/delete, list by day/month, ➕ button. [spec](docs/features/transaction.md)                        |
| 9   | Transfer between wallets    | ⬜  | ⬜  | two linked entries, excluded from income/expense totals                                                              |
| 10  | Reports                     | ⬜  | ⬜  | month summary, by-category breakdown, month-to-month trend                                                           |
| 11  | Budget                      | ⬜  | ⬜  | per category (or total) per period, progress + over-budget warning                                                   |
| 12  | Recurring transactions      | ⬜  | ⬜  | rules + Vercel Cron to materialise due entries                                                                       |
| 13  | Debt / loan                 | ⬜  | ⬜  | "lent to / borrowed from" with repayments                                                                            |
| 14  | Event / trip                | ⬜  | ⬜  | tag transactions to a trip, see its total (useful when travelling)                                                   |
| 15  | Search, filter, CSV export  | ⬜  | ⬜  |                                                                                                                      |
| 16  | Family sharing              | ⬜  | ⬜  | invite by email, editor/viewer; rules in [offline-sync](docs/features/offline-sync.md) 13–16 + backlog               |
| 17  | Deploy (Vercel)             | ⬜  | ⬜  | **deferred** until the owner asks. Vercel ×2, `/api` rewrite, previews, real mail provider, API keys                 |

✅ done · 🚧 in progress · ⬜ not started · — not applicable

Each row gets its `docs/features/<feature>.md` before work starts. Rows 0–8 (with 4a) are the MVP.
After #8 the app can replace Money Lover for daily use. Until #17, everything runs **locally only** (see locked
decision "Local-first").

---

## Done: Auth (#4)

**Next up is Offline sync foundation (#4a)**, spec
[docs/features/offline-sync.md](docs/features/offline-sync.md).

Spec: [docs/features/auth.md](docs/features/auth.md). Built in five parts (4.4 was split in two at
its start), one PR each, API and web together. The endpoints table in the spec says which part each
route belongs to.

| Part | What                                                                                     | Status |
| ---- | ---------------------------------------------------------------------------------------- | ------ |
| 4.1  | Email code + magic link, open sign-up, sessions (refresh rotation), sign-out, `/auth/me` | ✅     |
| 4.2  | Optional password (Argon2id, breach check), recent-auth rule + step-up code              | ✅     |
| 4.3  | Google sign-in (OIDC + PKCE)                                                             | ✅     |
| 4.4a | Account → Security: sessions, sign out others, link / unlink Google, credential mail     | ✅     |
| 4.4b | Phone OTP: add / change / remove a number, sign in with phone (console SMS provider)     | ✅     |

4.1 in detail (✅ done):

- **API**: tables `users`, `otp_challenges`, `sessions` (with `authTime`), `rate_limit_buckets`
  (`user_identities` comes with 4.3, `password_credentials` with 4.2). Endpoints
  `POST /auth/email/start`, `POST /auth/email/verify`, `POST /auth/refresh`, `POST /auth/sign-out`,
  `GET /auth/me`. `authenticate` middleware, `trust proxy`, `__Host-rt` cookie, Origin check,
  DB-backed limits, mail through `notifier` in the UI language. New env: `JWT_SECRET`,
  `OTP_PEPPER` (random values from `setup-env`), `WEB_ORIGIN`, `TRUST_PROXY_HOPS`,
  `SIGNUP_ENABLED`, `EMAIL_DAILY_LIMIT`. Cleanup (rule 20) as the npm script `auth:cleanup`; its
  cron endpoint waits for #17.
- **Web**: sign-in, enter-code (`app-otp-field`) and magic-link (`/auth/link`) pages outside the
  shell; auth store (access token in memory), API client + interceptor (refresh once on 401, then
  sign-in), auth guard, silent refresh at start, sign-out on the account page.
- **Checks**: curl in the sandbox (start → code from stdout → verify → refresh → sign-out, plus
  wrong, expired, reused codes and limits), Playwright at 375×812 (light/dark, th/en), then tests +
  OpenAPI once the owner confirms the behaviour.
- **Not in 4.1**: password, Google, phone, trusted device / PIN / local DB (#4a), invitations (#16).
- **Checked**: curl against the dev API (mail read from stdout) for the happy path and every
  error path, limit and the closed-sign-up / daily-cap configs; Playwright at 375×812 in th/en ×
  light/dark for code and link sign-in, reload (silent refresh), sign-out, three tabs refreshing
  at once, and the interceptor's refresh-and-retry. Tests: API 147 (service on an in-memory repo,
  HTTP, Drizzle adapter on SQLite, core security/errors), web 40 (auth service, interceptor,
  guards, error messages).
- **Known**: through `ng serve`'s proxy every browser is `127.0.0.1`, so the per-IP limit (20
  starts/hour) is shared by everything you test locally; empty `rate_limit_buckets` in
  `api/data/local.db` if you hit it. Opening the built app offline with a session (start-up
  refresh unreachable) was only checked in `ng serve`, where there's no service worker.

4.2 in detail (✅ done):

- **Decided at the start of 4.2**: password = 8–128 characters with lower + upper + digit + other
  (owner's choice over NIST's 15+, spec rule 11), plus the HIBP breach check
  (`PASSWORD_BREACH_CHECK=hibp|off`, `HIBP_API_URL` for a local stand-in; fail open after 3 s) and
  "not the email". Recent auth = `authTime` ≤ 10 min, the current password, or a **step-up code**
  (`/auth/reauth/start` + `/verify`, code-only mail, updates `authTime` of the current family).
  The password screen is `/account/password`, opened from a short "Security" section on the
  account page until 4.4.
- **API**: table `password_credentials` (Argon2id PHC string via `@node-rs/argon2`, m = 19 MiB,
  t = 2, p = 1, rehash on sign-in when the parameters change), `otp_challenges.purpose` gains
  `reauth`. Endpoints `POST /auth/password/sign-in`, `PUT` / `DELETE /auth/password`,
  `POST /auth/reauth/start` / `verify`; `hasPassword` on every `user`. Failure limits 5 per email
  and 30 per IP per 15 min; `PUT` revokes every other session family.
- **Web**: "Sign in with password" link + `/auth/password` page; account → Security row →
  `/account/password` (set / change / remove, re-auth step in place).
- **Not in 4.2**: Google, phone, sessions list / sign out others (4.4), mail on password change
  (backlog), trusted device / PIN (#4a).
- **Form rules that came out of the review** (web/DESIGN.md §6): one error message at a time (a
  server error clears once the user edits the form), field hints and errors 4px under the input,
  server error lines 8px under the field.
- **Checked**: curl against the dev API with a local HIBP stand-in (every policy code, set →
  other device `SESSION_REVOKED` → password sign-in, recent auth by time / current password /
  step-up code, wrong / reused / other user's codes, same answer and timing for wrong password,
  unknown email and no password, both failure limits with `Retry-After`, disabled user, rehash,
  HIBP slow / down / `off`, no password in any log); Playwright at 375×812 in th/en × light/dark
  for the whole flow. Tests: API 218 (service, HTTP, Drizzle adapter, Argon2 helpers, HIBP
  checker against a local server), web 67 (auth service, policy validator, error keys, the
  password page's confirm step).
- **Known**: the step-up mail shares the sign-in mail's 60 s cooldown (spec rule 13), which only
  shows when a test ages a session by hand. The policy is checked in the browser too, so a change
  to `PASSWORD_POLICY` goes in both `api/…/auth.const.ts` and `web/…/core/auth/password-policy.ts`.

4.3 in detail (✅ done):

- **Decided at the start of 4.3** (spec rule 14): tested in the sandbox against a **local OIDC
  stand-in** (`npm run dev:oidc` in `api/`, its issuer set by `GOOGLE_ISSUER`); an existing user
  with the same verified email is **linked automatically** and the web shows a one-time notice;
  Google's name and picture are used **only when the user is created** (linking only fills an
  empty avatar); callback errors show on the web's `/auth/callback` page (`?error=<reason>`);
  the button sits under the email form after an "or" divider; the account page gets a read-only
  "Google · linked" row; the web asks `GET /auth/providers` whether Google is on.
- **API**: table `user_identities`; `GET /auth/providers`, `GET /auth/google/start`,
  `GET /auth/google/callback`; `identities` on every `user`. New env: `GOOGLE_CLIENT_ID`,
  `GOOGLE_CLIENT_SECRET`, `GOOGLE_ISSUER`. `core/security` gained an OIDC client
  (`oidc-client.ts`: discovery, code exchange, ID token check) and a sealed JWE box
  (`sealed-box.ts`) for the `__Host-goidc` round-trip cookie.
- **Web**: "Continue with Google" on sign-in, `/auth/callback`, the account page row. spartan
  `sonner` was added; the toaster lives in the app root, lifted above the tab bar.
- **Checked**: curl against the dev API and `dev:oidc` for new user, second sign-in, linking (name
  kept, empty avatar filled, `linked=google` once), `/auth/me`, every broken token (aud, issuer,
  expiry, signature, nonce), state mismatch, missing cookie, code replay, provider down, unverified
  email, cancel, sign-up closed (strangers refused, existing users and linking still work),
  disabled user, the per-IP limit, unsafe `returnUrl`s and no env (`404`). Playwright at 375×812
  in th/en × light/dark for the button, the round trip to `returnUrl`, the account row, the link
  toast, the error pages, cancel, Google off and offline. Tests: API 286 (service on a fake
  provider, HTTP, OIDC client against a local provider with real RS256 keys, sealed box, env,
  Drizzle adapter), web 85 (providers + start URL, callback page, sign-in button).
- **Known**: one Google round trip per browser at a time: starting a second one in another tab
  replaces the `__Host-goidc` cookie, so finishing the first ends in `error=failed`. The button
  is our outline style with Google's real "G" mark, not Google's white / dark button. A real
  Google client (Cloud Console, redirect URI `<WEB_ORIGIN>/api/auth/google/callback`) is set up
  at deploy (#17); until then only the stand-in has been used.
- **Not in 4.3**: linking Google while signed in, unlinking (4.4), mail on linking (backlog "Mail
  on credential change").

4.4 (decided at its start, spec rules 21–31; 4.4a and 4.4b ✅ done):

- **Split**: 4.4a (Security page, sessions, Google link / unlink, mail on credential change) and
  4.4b (phone OTP) are separate sessions and PRs, 4.4a first.
- **Security page** `/account/security`: one "Security" row on the account page opens it; two
  groups, "Ways to sign in" (password → `/account/password`, phone → `/account/phone` in 4.4b,
  Google with Link / Unlink in the row) and "Signed-in devices" (sessions + "Sign out other
  devices"). The confirm step (`reauth-step`) runs in place.
- **Sessions** (rule 28): device from the user agent (parsed on the web), signed in at, last
  active, "This device"; revoking one or all others needs **no** recent auth. `sessions` gains
  `signedInAt` (copied on rotation), since the family's first row is deleted by cleanup.
- **Google link** (rule 29): `POST /auth/google/link` needs recent auth and returns the Google
  URL (the round-trip cookie carries `mode: link`); one Google per user; a Google account linked
  to someone else is refused (`google_in_use`), never merged; its email need not match. Back on
  `/account/security`. **Unlink** (rule 30) needs recent auth.
- **Mail on credential change** (rule 31): password set / changed / removed, Google linked
  (including automatic linking) / unlinked, phone added / changed / removed; no link, no code;
  language from `lang` in the request; never blocks the change.
- **Phone (4.4b)**: `GET /auth/providers` gains `phone` (`SMS_PROVIDER` ≠ `disabled`), and
  `/auth/phone*` answer `503` before any lookup when it's off; one Thai-style `tel` field shown as
  `081-234-5678`; Thai SMS of one segment (≤ 70 UTF-16 units, rule 26).
- **API (4.4a)**: `sessions.signedInAt` (migration 0003, hand-edited: SQLite can't add a NOT NULL
  column to a table with rows; old rows get it from the absolute expiry). `GET` / `DELETE
/auth/sessions`, `DELETE /auth/sessions/:id`, `POST` / `DELETE /auth/google/link`. The Google
  round-trip cookie may now carry `link: { userId, sessionFamilyId }` and `lang`; the callback asks
  `googleFlowMode()` which way to go. Credential changes take `lang`; `notifyCredentialChange`
  sends the mail of rule 31. New error codes `CURRENT_SESSION`, `IDENTITY_ALREADY_LINKED`,
  `GOOGLE_IN_USE`.
- **Web (4.4a)**: `/account/security` (`features/account/pages/security-page`), the account
  page's single Security row, `deviceLabel()` (user agent → "Chrome · Android"), and `ReauthFlow`
  (`features/account/reauth-flow.ts`): the confirm-step state, provided per page and shared by the
  password and Security pages.
- **Checked (4.4a)**: curl against the dev API and `dev:oidc` for the session list (order, current,
  `signedInAt` kept on refresh), revoke one / own (`400`) / unknown / someone else's (`404`), sign
  out others and the revoked devices' `SESSION_REVOKED`; Google link with recent auth by step-up
  code and by password, `IDENTITY_ALREADY_LINKED`, `google_in_use`, cancel, bad signature and
  nonce, session revoked or user disabled during the round trip, the per-IP limit; unlink and its
  no-op; mails in th / en (also for an automatic link), the daily cap skipping the mail but not the
  change; migration 0003 on a table with rows. Playwright at 375×812 in th/en × light/dark for the
  page, the revoke confirm, the link round trip + toast, unlink by password and by email code, the
  in-use error, sign out others and offline. Tests: API 323 (service, HTTP, Drizzle adapter, mail
  builder), web 104 (auth service, device label, Security page).
- **Known (4.4a)**: a current-password proof covers one request only (as in 4.2): linking right
  after unlinking with a password asks again; a step-up code covers 10 minutes. The device name is
  a hint from the user agent: an iPad on Safari says "Safari · Mac", and a PWA looks like its
  browser. "Last active" moves on sign-in and refresh, not on every API call. A signed-out
  device's access token still works for its last ≤ 10 minutes (rule 28). A long "last active"
  wraps the device row to three lines at 375px; the owner accepted that.
- **Not in 4.4a**: phone OTP (4.4b, rules 21–27: the `console` SMS provider, `/auth/phone*`,
  `providers.phone`, `/account/phone`, `/auth/phone`), the ThaiBulkSMS adapter (backlog), trusted
  device / PIN / local DB (#4a), invitations (#16).

4.4b in detail (✅ done):

- **Decided at the start of 4.4b** (spec rules 21–27, 31): the mail on a phone change names the
  last 4 digits; `/account/phone` stays put after a confirm (a "saved" line, like the password
  page); the saved number typed again is refused before any SMS (`422 PHONE_UNCHANGED`); the
  sign-in page's "Sign in with phone number" sits at the bottom under "Sign in with password".
  Also settled: the daily SMS cap is checked on every start but counted per SMS sent, sign-in and
  add-number starts share the per-number / per-IP buckets, the `503` carries `PHONE_DISABLED`,
  `POST /auth/phone/confirm` needs no recent auth (the code was sent after it).
- **API**: `POST /auth/phone/start` + `/verify` (5-min SMS code, `202` and the minimum time for
  any number, nothing stored for an unknown one), `POST /auth/phone` (recent auth) +
  `/confirm` (`409 PHONE_IN_USE`, the code used up), `DELETE /auth/phone`; `phone` on every
  `user`, `providers.phone`. A `phoneGate` answers `503` in front of every `/auth/phone*` while
  `SMS_PROVIDER=disabled`. `otp_challenges` rows now carry their `channel` (the repository's
  challenge methods take an optional channel, plus `*UserChallenge` methods for
  `verify_phone`); no migration (the columns existed since 4.1). New env `SMS_DAILY_LIMIT`
  (default 100). `normalizeThaiMobile` / `maskPhone` in `shared/utils/phone.ts`; numbers are
  masked in logs and `phone` is redacted from error logs. SMS texts in `auth.mail.ts`
  (`buildPhoneSms`, 63 UTF-16 units).
- **Web**: `/auth/phone` (`PhoneSignInPage`) → the shared `/auth/code` screen in SMS mode
  (`AuthFlowStore.pending().phone`); `/account/phone` (`PhonePage`: number → SMS code with a
  resend timer, remove after asking, confirm step in place); a phone row on the Security page
  (read-only while SMS is off). `core/auth/phone.ts` mirrors the API's normaliser and adds
  `formatThaiMobile` (`081-234-5678`) and `thaiMobileValidator`.
- **Checked**: curl against the dev API with SMS read from stdout for add / change / remove,
  sign-in, wrong / locked / expired / reused codes, recent auth by step-up code and by password,
  every limit (cooldown, 3 per number, 10 per IP with unknown numbers counted, verify per IP,
  the daily cap for known and unknown numbers), another user's number (`409`), a disabled user
  (no SMS; `403` after the code), `SMS_PROVIDER=disabled` (`503` before token and body) and the
  same timing for known and unknown numbers; Playwright at 375×812 in th/en × light/dark for
  the Security row, the phone page (every state), sign-in by phone and SMS off. Tests: API 374
  (service, HTTP, Drizzle adapter, phone helpers, SMS length, redaction), web 134 (phone
  helpers, auth service, phone page, Security row, sign-in link, phone sign-in, SMS code
  screen).
- **Known**: through `ng serve`'s proxy every browser is one IP, so the 10 SMS starts per hour
  per IP is easy to hit while testing; empty `rate_limit_buckets` as in 4.1. Asking for a code
  for a number another user holds still costs one SMS: the `409` comes only at confirm
  (decided, rule 25). Only the `console` SMS provider has been used; the ThaiBulkSMS adapter
  waits for its account (backlog).

## Done: App shell (#3)

Web only: an installable PWA skeleton that opens offline, before any data feature exists.

1. **PWA**: ✅ `@angular/pwa`. `ngsw-config.json` prefetches the app shell (HTML, all JS chunks
   including lazy pages, CSS, icons) and has **no `dataGroups`**, so API responses are never
   cached; `/api/**` is also excluded from navigation fallback. `public/manifest.webmanifest`:
   `ตังค์ไปไหน`, `standalone`, portrait, `any` + `maskable` icons (`public/icons/`), plus an
   `apple-touch-icon`. `core/pwa/app-update.service.ts` shows "มีเวอร์ชันใหม่ → โหลดใหม่" under the
   header on `VERSION_READY` (also on an unrecoverable SW state) and re-checks for a new version
   whenever the app comes back to the foreground. The SW is off in `ng serve`; test PWA behaviour
   on `npm run build` output.
2. **Storage persistence helper**: ✅ `core/pwa/device-storage.service.ts`: `persist()`,
   `isPersisted`, `isInstalled` (`display-mode: standalone` or iOS `navigator.standalone`). Nothing
   calls `persist()` yet: #4a does, at the trust prompt. The account page shows both values.
3. **Bottom tab bar**: ✅ `layout/` (`AppShell` is the layout route; header + page + fixed bar).
   ธุรกรรม / กระเป๋า / raised ➕ (→ `/transactions/new`) / รายงาน / บัญชีผู้ใช้, each a lazy feature
   route with an empty page. Safe-area insets on header and bar; `core/viewport/keyboard.service.ts`
   hides the bar when the visual viewport shrinks by > 150px (on-screen keyboard).
4. **Dark mode**: ✅ `core/theme/theme.service.ts`, key `tpn-theme` (absent = system). An inline
   script in `index.html` applies it before boot (no white flash) and sets `theme-color`. The picker
   lives on the account page.
5. **Online/offline indicator**: ✅ `core/network` + `layout/network-status.ts` in the header. It
   becomes the sync status in #4a.
6. **Checked**: `npm run build` emits `ngsw-worker.js`. Served from `dist/` with an SPA fallback,
   Playwright (375×812, light and dark) opened the app once, went offline, reloaded and saw the tab
   bar and "ออฟไลน์", and opened lazy tabs offline. It also checked the theme override survives a
   reload, the bar hides with a shrunk visual viewport, and the update banner appears after a new
   build is deployed and reloads into it.

Known behaviour: Angular's SW only announces a new version to pages it served, so the very first
visit (before the SW controlled the page) sees the update on its next reload, not as a banner.

## Done: Local dev workflow (#1)

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
   hides the button; `npm run dev:oidc` in `api/` is a local stand-in to test it). Scheduled jobs (auth cleanup, recurring #12) run as npm scripts locally
   instead of Vercel Cron.
6. **Testing a feature**: unit/integration tests (`npm test`) plus a real run in the sandbox: start
   both apps, exercise the API with `curl`, and check screens with Playwright (Chromium is
   pre-installed in Claude Code cloud sessions).
7. **Done**: both apps start with one command each and `GET http://localhost:4200/api/health`
   answers through the proxy. The console mailer was checked by calling `notifier` directly; the
   first real mail is `POST /auth/email/start`, so seeing it on stdout is part of Auth (#4)'s
   check, not a separate test endpoint.

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
   - Auth env per environment: fresh `JWT_SECRET` / `OTP_PEPPER` (never the dev ones),
     `WEB_ORIGIN` = the web project's URL, `TRUST_PROXY_HOPS` matching Vercel's proxy chain.
     Rate limits trust `X-Forwarded-For`, so the API must only be reachable through the web
     project's rewrite (or the hop count must strip a client-sent header); check this before
     launch.
   - Auth cleanup (rule 20): add `POST /internal/cron/auth-cleanup` behind `CRON_SECRET` calling
     the same `authService.cleanup()` as `npm run auth:cleanup`, scheduled daily.
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

## Done: Database foundation (#2)

- `drizzle-orm` + `@libsql/client` + `drizzle-kit`. `DATABASE_URL` = `file:./data/local.db` in dev,
  `libsql://…turso.io` + `DATABASE_AUTH_TOKEN` in prod.
- `src/core/database/` exports the client. `onShutdown` closes it locally.
- Schema lives in `src/core/database/schema/<feature>.ts` (one file per feature). Migrations are
  generated by drizzle-kit and committed.
- Seed script for dev data.
- ✅ All of the above: see `api/AGENTS.md` §2 "Database" for how to add a table. No tables exist
  yet; each feature adds its own (`schema/<feature>.ts` + a generated migration).
- Still open: delete the starter's `todo` reference feature once the first real layered feature exists, and
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
- **UI in Thai and English**, Thai by default, switched at runtime with no reload (Transloco;
  there's no SSR/SEO, so no per-language builds). Translations are bundled so both work offline.
  Formats follow the language: Thai shows พ.ศ., English the Gregorian year. Names that read oddly
  in Thai stay English (theme names). Details: `web/AGENTS.md` → UI text, `web/DESIGN.md` §11.
- **Look: selectable themes.** Midnight Gold (navy + gold) by default, plus Indigo Night, Gold
  Coin and Plum, each with light and dark; Noto Sans Thai (loopless) self-hosted. See
  `web/DESIGN.md` §3–4.
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
- **Every user-owned row carries `userId`** (its owner), and every query is scoped by it. The one
  exception is a wallet shared through `wallet_members`: members reach that wallet and its
  transactions by their role ([offline-sync](docs/features/offline-sync.md) rules 13–16).
- **IDs are UUIDv7 strings** (time-sortable). Timestamps are stored as integer epoch ms. Calendar
  dates of transactions are stored as `YYYY-MM-DD` in the user's timezone (default `Asia/Bangkok`).

**Offline-first** (full spec: [docs/features/offline-sync.md](docs/features/offline-sync.md))

- **Works fully offline on trusted devices.** The web app reads and writes an **encrypted local
  database**; changes go to an outbox and sync with the server when online (push, then pull). The
  server is the meeting point and the authority, not the screen's data source.
- **Synced rows are sync-ready**: the device generates the UUIDv7 `id`; `updatedAt`; **soft delete**
  via `deletedAt` (tombstones); a server-assigned `changeSeq` as the pull cursor.
- **Balances and totals are always computed** from transactions, never stored.
- **Trusted device + PIN**: offline storage only when the user marks the device as trusted at
  sign-in. A 6-digit PIN unlocks it and wraps the key that encrypts the local DB. The app locks on
  open and after 5 min. 5 wrong PINs, a revoked session, or a different user signing in **wipe** the
  local data. Untrusted devices work online only.
- **Conflicts**: the later edit wins between the same user's devices; in a shared wallet **the
  owner always wins**; delete beats edit; the losing version is kept in `change_history` and the
  loser is told.
- **Shared wallets**: owner = full offline. Editor = view/edit/delete **online only**, but may
  **add** transactions offline. Viewer = online, read only. `wallet_members` exists from #6; the
  sharing UI is #16.

**Auth** (full spec: [docs/features/auth.md](docs/features/auth.md))

- Three ways to sign in (all built, #4): **email**, **Google**, or **phone OTP** (SMS, only for a number already
  verified on an existing account; no sign-up by phone). Email defaults to **passwordless** (one 6-digit OTP +
  magic link in the same email). A user may **optionally set a password** and then sign in with
  email + password.
- **The `users` table holds no password.** Credentials live in their own tables
  (`password_credentials`, `user_identities`).
- **Open sign-up**: anyone who can read their email can create an account. `SIGNUP_ENABLED=false`
  closes sign-up as a kill switch; a global daily email cap (`EMAIL_DAILY_LIMIT`) limits abuse.
  Family members join by **invitation** to a shared wallet (#16), matched on their verified email.
  (Replaced the earlier invite-only allowlist.)
- The rules follow current OWASP guidance (ASVS 5.0, Authentication / Password Storage / Session
  Management / OAuth 2.0 cheat sheets) and NIST SP 800-63B-4. Specifics are in the spec.
  **One deliberate exception**: the password policy is 8+ characters with all four character
  classes (owner's choice, spec rule 11), not NIST's 15+ without composition rules.

---

## Backlog / open questions

- **Prod email provider** for OTP and magic links (decide at #17). Dev uses Nodemailer with no
  provider. Proposal: **Resend** (free tier, offers SMTP too, so it can stay a Nodemailer config).
- **SMS gateway account**: SMS is for phone-OTP sign-in (auth spec rules 21–27), gateway =
  **ThaiBulkSMS**. Its adapter (`sms.thaibulksms.ts`) is written when the account and API key
  exist; until then dev uses the `console` SMS provider.
- **Local DB library** (#4a): proposal = SQLite WASM in memory + one encrypted snapshot in OPFS;
  alternative Dexie. Confirm with a spike. See [offline-sync](docs/features/offline-sync.md) → Open
  questions.
- **Invitations** (#16), proposal: the owner invites an email as editor/viewer. An existing user
  sees the invite in the app; anyone else gets an email whose link opens sign-in with the email
  filled in, and the invite attaches once that email is verified (matched on the verified email,
  never on the link, so a forwarded mail grants nothing). At most **one pending invite per wallet
  and email** (re-sending reuses the row, with a cooldown) and none for someone already a member,
  to keep the table small. Invites expire after **14 days** (purged by the auth cleanup job), each
  user may send **10 per day**, and invite mails count toward `EMAIL_DAILY_LIMIT`. The mail holds
  only the inviter's name and the wallet name, no free text, so it can't carry phishing.
- **GitGuardian check is red on auth PRs** (from 4.2): its GitHub App flags the made-up passwords
  in `*.test.ts` / `*.spec.ts` and the `PASSWORD_BREACH_CHECK` setting name as "Generic Password".
  They are false positives, and the check isn't required, so PRs merge anyway; don't chase it in a
  feature session. The app ignores `.gitguardian.yaml` (that file only helps a local ggshield).
  Fix once someone has dashboard access: mark the incidents as false positives and exclude test
  files in the workspace settings.
- **Open sign-up obligations**: before strangers use the app, add account deletion (with its
  data) and a short privacy notice (PDPA).
- **Shared wallet categories** (#16): when an editor adds to the owner's wallet, they pick from the
  **owner's** categories (proposal), so the owner's reports stay consistent.
- **FX / multi-currency reports**: convert to THB with daily rates. Out of scope until a non-THB
  currency is actually used.
- **Import from Money Lover** (CSV export → our transactions). Decide after #8.
