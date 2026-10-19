# Auth

> Status: **4.1 built** (email code + magic link, sessions, sign-out, `/auth/me`); **4.2 in
> progress** (optional password, step-up code); 4.3–4.4 are spec
> (see [ROADMAP](../../ROADMAP.md#next-up-auth-4)).
> Code lives in `src/features/auth/`, token helpers in
> `src/core/security/`, the `authenticate` middleware in `src/core/middleware/`.
> Reference implementation to adapt: `tripsurance-be/src/features/auth/` (refresh rotation, sessions,
> httpOnly cookie, dummy-hash timing guard). The differences are listed under
> [Changes vs tripsurance](#changes-vs-tripsurance).

## Purpose

Lets people sign up and stay signed in on their phones. **Anyone can create an account** with an
email they can read (rule 1). The owner brings family in by **inviting** them to a shared wallet
(#16), not through a special sign-up path. There are three ways in:

1. **Email** (default): enter an email, receive **one email** with a 6-digit code **and** a magic
   link, and use either one. Users who prefer passwords can **optionally set one**. After that they
   can sign in with email + password, and the code/link still works.
2. **Google**: "Continue with Google" (OpenID Connect).
3. **Phone OTP**: enter a Thai mobile number and receive a 6-digit code by SMS. This works only for a
   number the user has already **added and verified** in Account → Security (rules 21–27). It
   never creates an account.

Email and Google lead to the same user when the email matches (see rule 14). Phone sign-in finds
the user by their verified number.

## Out of scope

- **Invitations** to a shared wallet: specified with Family sharing (#16). Auth's only part is that
  a pending invitation is matched on the **verified** email once its owner signs in.
- Roles / admin panel. Every user is equal and owns only their own data.
- MFA / passkeys. Passkeys (WebAuthn) are the natural next step and fit as another `user_identities`
  provider later.
- Other OAuth providers (Apple, LINE, …). The identity table supports them, but they aren't built.
- **Sign-up by phone**, and non-Thai numbers (only `+66` mobiles are accepted, rule 21).

## Data model

Drizzle schema: `src/core/database/schema/auth.ts`. All ids are UUIDv7, and all timestamps are epoch ms.

- **users** — `id`, `email` (unique, stored lowercase), `displayName`, `avatarUrl?`,
  `emailVerifiedAt?`, `phone?` (E.164, unique when set), `phoneVerifiedAt?`, `status` (`active` |
  `disabled`), `timezone` (default `Asia/Bangkok`), `createdAt`, `updatedAt`. It holds **no password
  and no provider data.** `phone` is set only once verified (rule 25); until then the pending number
  lives on the challenge.
- **password_credentials** — `userId` (PK, FK), `passwordHash` (Argon2id, PHC string), `updatedAt`.
  A row exists only if the user has set a password.
- **user_identities** — `id`, `userId`, `provider` (`google`), `providerSubject` (the OIDC `sub`),
  `emailAtLink`, `createdAt`, `lastUsedAt`. Unique on (`provider`, `providerSubject`). Always match on
  `sub`, never on email.
- **otp_challenges** — `id`, `channel` (`email` | `sms`), `purpose` (`sign_in` | `reauth` |
  `verify_phone`), `destination` (lowercased email or E.164 phone), `userId?` (set for `reauth`
  and `verify_phone`), `codeHash`,
  `linkTokenHash?` (email only), `attempts`, `expiresAt`, `consumedAt?`, `createdAt`. One row per
  "send me a code" request, on any channel. Index on (`channel`, `destination`, `createdAt`).
- **sessions** — `id`, `userId`, `familyId`, `tokenHash`, `expiresAt`, `absoluteExpiresAt`,
  `authTime` (when the credential was last checked; copied on rotation, used by rule 13),
  `revokedAt?`, `replacedById?`, `lastUsedAt`, `userAgent?`, `createdAt`. Each row is one refresh
  token. All rotations of one sign-in share a `familyId`.
- **rate_limit_buckets** — `key` (e.g. `otp:email:<hash>`, `otp:ip:<hash>`, `verify:ip:<hash>`,
  `email:global:day`, `otp:sms:<hash>`, `sms:global:day`, `pw:email:<hash>`, `pw:ip:<hash>`),
  `count`,
  `windowStart`. These counters are DB-backed because in-memory limits reset on every serverless
  instance.

Raw OTPs, link tokens and refresh tokens are **never stored**, only their hashes (rule 18).

## Tokens & session

- **Access token**: JWT, **HS256 pinned** (verification rejects any other `alg`), lifetime
  **10 min**. Claims: `sub`, `sid` (session family), `iat`, `exp`, `iss`, `aud`, `jti`. The secret
  is ≥ 32 random bytes, from env. It's returned in the response body, and the web app keeps it **in
  memory only**.
- **Refresh token**: **opaque** 32 random bytes (base64url), not a JWT. It's sent only as the
  httpOnly cookie **`__Host-rt`** (`Secure`, `Path=/`, no `Domain`, `SameSite=Strict`), in every
  environment. That works because the browser sees one origin through the `/api` rewrite (ROADMAP →
  "Same origin via rewrite"). `http://localhost` counts as secure, but a phone on a LAN IP over
  plain http does not, so test on a phone with an https preview (#17). The DB stores it as SHA-256.
  - Idle lifetime **30 days**, sliding: every refresh issues a new token with a fresh 30-day
    expiry, capped by the session's **absolute lifetime of 180 days**. After that the user signs in
    again.
- **Rotation + reuse detection**: every `/auth/refresh` revokes the presented token and issues a new
  one (`replacedById` links them). If a token that was **already rotated** is presented again, treat
  it as theft and **revoke the whole family** (every session row with that `familyId`).
- **Session** = the newest non-revoked, non-expired row of a family. `GET /auth/sessions` lists one
  entry per family.
- Sign-in and `/auth/refresh` both answer `{ accessToken, expiresIn, user }`, so a reload needs one
  call to get back in. A failed refresh is `401` with a `code` in the body: `SESSION_REVOKED`
  (signed out, revoked, or reuse detected) or `SESSION_EXPIRED` (no cookie, unknown token, idle or
  absolute expiry). See [Offline & trusted devices](#offline--trusted-devices).

## Business rules

**Sign-up & identity**

1. **Open sign-up**: the first successful email verify (or Google sign-in) for an unknown email
   creates the user, so only someone who can read that inbox gets an account. Env
   `SIGNUP_ENABLED=false` closes sign-up (a kill switch against abuse): existing users still sign
   in, unknown emails get the same `202` but no mail (rule 5), and Google shows a generic "sign-up
   is closed" page. Nothing reveals whether an email is registered.
2. Emails are trimmed, lowercased and validated (`z.email()`) before any lookup.
3. A disabled user (`status = disabled`) can't sign in or refresh. This returns `403` _after_ the
   credential check, so it doesn't reveal account status to someone who doesn't hold the credential.

**Email code / magic link (default)**

4. `POST /auth/email/start` `{ email, lang }` creates a challenge with a **6-digit code**
   (`crypto.randomInt`, so uniformly random) and a **32-byte link token**, invalidates the email's
   earlier open challenges, and sends one email containing both. Both expire after **10 minutes**.
   `lang` (`th` | `en`, default `th`) is the app's current UI language; the email is written in it.
5. It **always** answers `202` with the same body. The challenge row is created even when no mail
   is sent (sign-up closed and the email unknown), so verify behaves the same for every email, and
   every start takes at least a fixed minimum time, so timing doesn't tell the cases apart either.
6. Limits: **resend cooldown 60 s** per email, **5 starts per email per hour**, **20 per IP per
   hour**, and a **global cap on emails per day** (`EMAIL_DAILY_LIMIT`, default 100, the free tier
   of the planned mail provider), which caps the damage if someone uses us to mail-bomb strangers.
   Over a limit returns `429` with `Retry-After` (generic; hitting the global cap also logs a
   `warn`).
7. `POST /auth/email/verify` accepts `{ email, code }` **or** `{ token }`. A challenge allows **5
   wrong code attempts**, then it is dead and the user must start again. Comparisons are
   constant-time (`timingSafeEqual`). A challenge is **single-use**: `consumedAt` is set in the same
   transaction that creates the session. Failures are `400` with a `code`: `OTP_INVALID` (wrong
   code, attempts left), `OTP_LOCKED` (5 wrong attempts), `OTP_EXPIRED` (expired, used, replaced by
   a newer one, or none; also any unknown link token). Limit: **30 verifies per IP per 15 min**.
8. **Magic link = no side effect on GET.** The email links to the web app (`/auth/link#token=…`).
   The page reads the token from the URL fragment, which never reaches server logs or the `Referer`
   header, and **POSTs** it to `/auth/email/verify`. That way mail scanners that pre-fetch links
   can't consume the token.
9. A successful verify sets `emailVerifiedAt` and creates a session (new user → create the user
   first, if rule 1 allows, with the email's local part as `displayName`).

**Password (optional)**

10. Passwords are hashed with **Argon2id** (`@node-rs/argon2`, prebuilt so it works on Vercel)
    using at least the OWASP baseline **m = 19 MiB, t = 2, p = 1**. Store the PHC string so the
    parameters can be raised later, and rehash on the next successful sign-in when they change.
11. Password policy. **The owner chose this deliberately** (4.2): it departs from NIST SP
    800-63B-4 / ASVS 5.0, which ask for 15+ characters and no composition rules, because family
    members are used to the familiar "8 characters, mixed" rule. The email code stays available, so
    nobody needs a password. Changing the numbers is one constant (`PASSWORD_POLICY`) on each side.
    - **Minimum 8 characters, maximum 128**, counted in Unicode code points. All Unicode is
      allowed, including spaces, and nothing is truncated or normalised.
    - **Must contain** at least one lowercase letter (`\p{Ll}`), one uppercase letter (`\p{Lu}`),
      one digit (`\p{Nd}`) and one other character (anything that isn't a letter or digit, so a
      space or `!` counts). **No periodic expiry.**
    - Reject passwords that appear in known breaches. Use the HIBP k-anonymity range API (only the
      first 5 chars of the SHA-1 are sent, with `Add-Padding`). Env `PASSWORD_BREACH_CHECK`
      (`hibp` | `off`, default `hibp`) switches it, and `HIBP_API_URL` (default
      `https://api.pwnedpasswords.com`) can point it at a local stand-in for testing. If HIBP is
      unreachable or slower than **3 s**, **fail open** and log a warning, so an outage doesn't
      block users.
    - Reject passwords equal to the email or the email's local part (case-insensitive).
    - A refused password is `422` with a `code`: `PASSWORD_TOO_SHORT`, `PASSWORD_TOO_LONG`,
      `PASSWORD_TOO_WEAK` (a missing character class), `PASSWORD_MATCHES_EMAIL`,
      `PASSWORD_BREACHED`. The web checks the first four before sending.
12. `POST /auth/password/sign-in` `{ email, password }` returns the same `400`
    `INVALID_CREDENTIALS` ("Invalid email or password") for unknown email, wrong password, or a user
    who has no password set. It runs a dummy Argon2 verify when there is no hash, so timing doesn't
    reveal which. Rate limits count **failures**: **5 per email per 15 min** and **30 per IP per 15
    min**; once either is reached, every attempt is `429` (with `Retry-After`) until the window
    ends, before any password is checked. A successful sign-in doesn't reset them. Limits slow
    attackers down but don't lock the account hard, so an attacker can't lock a family member out.
    The email code always remains available. The policy of rule 11 is not checked at sign-in (a
    stored password stays valid if the policy changes).
13. `PUT /auth/password` `{ newPassword, currentPassword? }` (set or change) needs **recent
    authentication**, any one of:
    - the session family's `authTime` is ≤ **10 min** ago (signing in with a code, link or password
      sets it; a refresh keeps it);
    - `currentPassword` is correct (only for a user who has one). A wrong one is `400`
      `CURRENT_PASSWORD_INVALID` and counts toward the per-email limit of rule 12;
    - a **step-up code**: `POST /auth/reauth/start` (Bearer, no body) mails a **code only** (no
      link) to the user's own email; `POST /auth/reauth/verify` `{ code }` checks it like rule 7
      (10 min, 5 wrong attempts, single use, `OTP_*` codes) and sets `authTime` = now on the current
      session family. It creates no session. Start shares the limits of rule 6 (cooldown, per
      email, per IP, daily cap), verify the per-IP limit of rule 7.

    Without any of these the answer is `403` `REAUTH_REQUIRED`; the web then asks for the current
    password or a step-up code and retries. On success, `PUT` revokes **all other** session
    families and answers the user. `DELETE /auth/password` `{ currentPassword? }` removes the
    password under the same recent-auth rule (other sessions stay; it is a no-op `200` when no
    password is set). "Forgot password" is simply: sign in with an email code, then set a new
    password within 10 min. There is no separate reset-token flow.

**Google (OIDC)**

14. Use the Authorization Code flow with **PKCE (S256)**, **`state`** and **`nonce`**. They're kept in
    a short-lived (10 min), signed, httpOnly cookie for the round trip. The callback:
    - checks `state` against the cookie, exchanges the code server-side, and validates the ID token:
      signature (Google JWKS), `iss`, `aud` = our client id, `exp`, `nonce`;
    - finds the user by (`google`, `sub`). If there isn't one: when `email_verified` is true and a
      user with that email exists, **link** the identity to that user. Otherwise create the user (if
      rule 1 allows). If `email_verified` is false, refuse;
    - **never puts tokens in the redirect URL**. It sets the refresh cookie and redirects to
      `/auth/callback` on the web app, which then calls `/auth/refresh` to get an access token.

**Sessions & tokens**

15. **401 means only "access token missing/invalid/expired"** on authenticated routes. The web app
    refreshes once on 401, then retries. Business-rule failures use 400/403/404/422.
16. `/auth/refresh` and `/auth/sign-out` read the cookie, so they also require the request's `Origin`
    to equal the web origin (`WEB_ORIGIN`, which also builds the magic link), as CSRF defence in
    depth on top of `SameSite=Strict`. A missing or different `Origin` is `403`. Rate limits key on
    the client IP, so Express `trust proxy` is set to the number of proxies in front of the API
    (`TRUST_PROXY_HOPS`: the dev proxy or the Vercel rewrite).
17. Sign-out revokes the current session family and clears the cookie. "Sign out other devices"
    revokes every other family.
18. Never log, return or store raw secrets: passwords, codes, link tokens, refresh tokens. Logs carry
    user ids, session ids and token **hashes** only. The OTP is hashed with **HMAC-SHA256 using a
    server secret** (`OTP_PEPPER`) rather than plain SHA-256, because a 6-digit code is trivial to
    brute-force offline from a plain hash.
19. Every auth event is logged (sign-in success/failure + method, refresh reuse detected, password
    set/changed/removed, identity linked) at `info`/`warn`, for later review.
20. Cleanup: a daily **Vercel Cron** job (`POST /internal/cron/auth-cleanup`, protected by
    `CRON_SECRET`) deletes challenges, sessions and rate-limit buckets more than 7 days past
    expiry or revocation. It replaces tripsurance's `setInterval`, which can't run on serverless.
    Until deploy, the same job runs locally as an npm script.

**Phone OTP (third option)**

SMS costs money per message and is a target for SMS-pumping fraud, so its limits are tighter than
email's. It goes through `notifier` (`core/notification`) on the SMS channel. In dev the `console`
SMS provider prints the code, so the whole flow is testable without an SMS account; the
**ThaiBulkSMS** adapter is added when its account exists (ROADMAP #17).

21. Phone numbers are trimmed and normalised to E.164 before any lookup (`081-234-5678` →
    `+66812345678`). Only Thai mobile numbers are accepted (`+66` followed by 6, 8 or 9 and 8 more
    digits); anything else is a `422`.
22. `POST /auth/phone/start` `{ phone }` sends a 6-digit code (same generation and hashing as rule
    4 and 18) **only if a user has that verified number and is active**. It **always** answers
    `202` with the same body and similar timing; for an unknown number it sends nothing (so no SMS
    is paid for) and sleeps instead, like rule 5.
23. Limits: **resend cooldown 60 s** per number, **3 starts per number per hour**, **10 per IP per
    hour**, and a **global cap of 100 SMS per day** (`SMS_DAILY_LIMIT`, env) across the app, which
    caps the bill if the limits above are bypassed. Over a limit returns `429` with `Retry-After`;
    hitting the global cap also logs a `warn`.
24. `POST /auth/phone/verify` `{ phone, code }`: the code expires after **5 minutes**, allows **5
    wrong attempts**, is compared in constant time, and is single-use, as in rule 7. Success
    creates a session (rule 3 still applies to disabled users).
25. **Adding a number** (Account → Security): `POST /auth/phone` `{ phone }` needs recent
    authentication (rule 13), then sends a `verify_phone` code to that number. `POST
/auth/phone/confirm` `{ code }` saves it as `users.phone` with `phoneVerifiedAt`. If another
    user already holds that number, the confirm fails with a generic `409` (it reveals only what the
    person proved they own). Changing the number repeats the flow; `DELETE /auth/phone` removes it
    (recent auth). The start limits of rule 23 apply here too.
26. The SMS text is short, Thai, and names the app and the expiry, e.g. `รหัสเข้าสู่ระบบ Tang Pai
Nai: 123456 (หมดอายุใน 5 นาที) ห้ามบอกรหัสนี้กับผู้อื่น`. It never contains a link.
27. Phone events are logged like rule 19 (sign-in success/failure with method `phone`, number
    added/changed/removed) with the number **masked** (`+66*****5678`), never in full.

## Endpoints

All live under `/auth`, on the public router. "Bearer" = needs `authenticate`.

| Method | Path                     | Auth   | What                                                           | Part |
| ------ | ------------------------ | ------ | -------------------------------------------------------------- | ---- |
| POST   | `/auth/email/start`      | —      | Send code + magic link (always `202`)                          | 4.1  |
| POST   | `/auth/email/verify`     | —      | `{ email, code }` or `{ token }` → user + access token; cookie | 4.1  |
| POST   | `/auth/password/sign-in` | —      | Email + password → user + access token; cookie                 | 4.2  |
| PUT    | `/auth/password`         | Bearer | Set or change password (recent auth); revokes other sessions   | 4.2  |
| DELETE | `/auth/password`         | Bearer | Remove password (recent auth)                                  | 4.2  |
| POST   | `/auth/reauth/start`     | Bearer | Mail a step-up code to the user's own email (rule 13)          | 4.2  |
| POST   | `/auth/reauth/verify`    | Bearer | `{ code }` → `authTime` = now on the current session family    | 4.2  |
| POST   | `/auth/phone/start`      | —      | Send SMS code to a verified number (always `202`)              | 4.4  |
| POST   | `/auth/phone/verify`     | —      | `{ phone, code }` → user + access token; cookie                | 4.4  |
| POST   | `/auth/phone`            | Bearer | Add or change number (recent auth): send `verify_phone` code   | 4.4  |
| POST   | `/auth/phone/confirm`    | Bearer | `{ code }` → save the number as verified                       | 4.4  |
| DELETE | `/auth/phone`            | Bearer | Remove the number (recent auth)                                | 4.4  |
| GET    | `/auth/google/start`     | —      | Redirect to Google (PKCE + state + nonce)                      | 4.3  |
| GET    | `/auth/google/callback`  | —      | Finish Google sign-in; sets cookie; redirects to web           | 4.3  |
| POST   | `/auth/refresh`          | cookie | Rotate refresh token → new access token                        | 4.1  |
| POST   | `/auth/sign-out`         | cookie | Revoke current session; clear cookie                           | 4.1  |
| GET    | `/auth/me`               | Bearer | Current user + `hasPassword` (4.2) + linked providers (4.3)    | 4.1  |
| GET    | `/auth/sessions`         | Bearer | Active sessions (one per family), current one flagged          | 4.4  |
| DELETE | `/auth/sessions/:id`     | Bearer | Revoke one session family                                      | 4.4  |
| DELETE | `/auth/sessions`         | Bearer | Revoke all other session families                              | 4.4  |

Exact request/response shapes go in OpenAPI (`/docs`) once the endpoints are built. Every `user`
in a response (sign-in, refresh, `/auth/me`, `PUT /auth/password`) carries `hasPassword`.

## Web screens

All of these sit outside the app shell (no tab bar) and carry a language switch, because someone
who isn't signed in can't reach the account page.

- **Sign-in**: an email field with a "Send code" button, a "Continue with Google" button, a
  "Sign in with password" link, and a "Sign in with phone number" link (phone field → the same
  enter-code screen). Each extra way appears with its part (4.2–4.4). Offline, it says sign-in
  needs a connection and retries the silent refresh by itself once back online.
- **Enter code**: 6 boxes (`inputmode="numeric"`, `autocomplete="one-time-code"` so the phone can
  auto-fill it), a resend timer, and a "check your email for the link" hint.
- **Magic-link landing** `/auth/link` and **Google return** `/auth/callback`.
- **Sign in with password** `/auth/password`: email + password (`app-password-field`), a link back
  to the email code. Reached from the sign-in page's "Sign in with password" link.
- **Password** `/account/password` (4.2, inside the shell): set / change / remove. Until 4.4's
  Security page exists, the account page has a short "Security" section with one row (password ·
  set / not set) that opens it; 4.4 moves that row into Account → Security unchanged. A `403
REAUTH_REQUIRED` opens a confirm step in place: the current password (if one is set) or a
  step-up code to the user's email (`app-otp-field`), then the action is retried.
- **Account → Security** (4.4): set/change/remove password, add/change/remove phone number, linked
  Google account, active sessions with
  "sign out other devices".

## Interactions

- **App start**: the web app calls `/auth/refresh` once (the access token lives in memory only, so a
  reload starts without one). Success → into the app; failure → sign-in. A guard keeps every
  in-app route behind a signed-in user.
- **Invitations** (#16): sign-in attaches pending wallet invitations addressed to the verified
  email. Their rules (one pending invite per wallet and email, expiry, daily cap) live with #16.
- Every user-owned feature (wallet, category, transaction, …) sits behind `authenticate` and scopes
  every query by `req.user.id`.
- Category: a new user gets the default category set seeded on creation (see `category.md`).
- Mail: sent with `notifier.send({ channel: email, … })` from `core/notification`. In dev the
  `console` provider prints it to stdout (or `smtp` + `SMTP_URL` sends to a local catcher); the prod
  provider is picked at deploy (ROADMAP #17).
- Google sign-in is off unless `GOOGLE_CLIENT_ID` / `GOOGLE_CLIENT_SECRET` are set: its endpoints
  return `404` and the web hides the button. Local dev runs without them (ROADMAP "Local-first").

## Changes vs tripsurance

| tripsurance-be                               | Here                                                         | Why                                                  |
| -------------------------------------------- | ------------------------------------------------------------ | ---------------------------------------------------- |
| `User.password` column (bcrypt, cost 10)     | `password_credentials` table, Argon2id                       | User holds no secrets; OWASP's preferred algorithm   |
| Password: 8+ chars, upper/lower/digit/symbol | Same rule, plus a breach check and "not the email"           | Owner's choice (rule 11); breach check per OWASP     |
| Refresh token is a JWT                       | Opaque random token                                          | Nothing to decode; it's only ever looked up by hash  |
| Rotation rejects a reused token              | Reuse **revokes the whole family**                           | Stops the thief as well as the replay                |
| `SameSite=Lax` + shared `COOKIE_DOMAIN`      | `__Host-` cookie, `SameSite=Strict`, same origin via rewrite | `*.vercel.app` is a public suffix                    |
| No limit on sign-in; in-memory limits        | DB-backed limits on sign-in, OTP start/verify                | Brute force; serverless instances don't share memory |
| Forgot/reset-password token flow             | Sign in with email code, then set a password                 | One fewer token type to secure                       |
| `setInterval` cleanup                        | Vercel Cron                                                  | Serverless                                           |

## Offline & trusted devices

Signing in is always online. What happens on the device afterwards (the trusted-device choice, PIN
lock, local-data wipe on a revoked or expired session or on sign-out) is specified in
[offline-sync.md](offline-sync.md) rules 1–7. The server side here doesn't change: `/auth/refresh`
answering "revoked" vs "expired" distinctly (both `401`, with a different `code` in the body) is what
lets the web app decide whether to wipe or keep local data.

## Open questions

- **Phone sign-in later**: switch it on in production only once the ThaiBulkSMS adapter, sender
  name and credit are in place. Until then `SMS_PROVIDER=disabled` makes `/auth/phone/*` answer
  `503`, and the web hides the phone link.
- **Access token lifetime** of 10 min: fine with silent refresh. Raise it only if refresh traffic
  turns out to be a problem.
- **Password policy**: decided in 4.2 as 8+ characters with all four character classes (rule 11),
  the owner's choice over NIST's 15+ without composition rules. Revisit if the app opens to
  strangers.
- **Notify on password change**: ASVS asks for a mail when a credential changes. Not in 4.2;
  proposal: one short mail on set / change / remove, added with 4.4's Security page.
