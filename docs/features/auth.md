# Auth

> Status: **4.1 built** (email code + magic link, sessions, sign-out, `/auth/me`); **4.2 built**
> (optional password, recent auth, step-up code); **4.3 built** (Google sign-in); 4.4 is spec,
> built in two parts: **4.4a** Account › Security (sessions, linking / unlinking Google, mail on
> credential change, rules 28–31) and **4.4b** phone OTP (rules 21–27), see
> [ROADMAP](../../ROADMAP.md#next-up-auth-4).
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
- **user_identities** — `id`, `userId` (FK, cascade), `provider` (`google`), `providerSubject` (the
  OIDC `sub`), `emailAtLink` (the provider's email when linked, shown on the account page),
  `createdAt`, `lastUsedAt`. Unique on (`provider`, `providerSubject`), index on `userId`. Always
  match on `sub`, never on email. A later change of the Google email doesn't touch `users.email`.
- **otp_challenges** — `id`, `channel` (`email` | `sms`), `purpose` (`sign_in` | `reauth` |
  `verify_phone`), `destination` (lowercased email or E.164 phone), `userId?` (set for `reauth`
  and `verify_phone`), `codeHash`,
  `linkTokenHash?` (email only), `attempts`, `expiresAt`, `consumedAt?`, `createdAt`. One row per
  "send me a code" request, on any channel. Index on (`channel`, `destination`, `createdAt`).
- **sessions** — `id`, `userId`, `familyId`, `tokenHash`, `expiresAt`, `absoluteExpiresAt`,
  `authTime` (when the credential was last checked; copied on rotation, used by rule 13),
  `signedInAt` (when the family was created; copied on rotation, shown by rule 28, 4.4a),
  `revokedAt?`, `replacedById?`, `lastUsedAt`, `userAgent?`, `createdAt`. Each row is one refresh
  token. All rotations of one sign-in share a `familyId`.
- **rate_limit_buckets** — `key` (e.g. `otp:email:<hash>`, `otp:ip:<hash>`, `verify:ip:<hash>`,
  `email:global:day`, `otp:sms:<hash>`, `otp:sms-ip:<hash>`, `sms:global:day`,
  `pw:email:<hash>`, `pw:ip:<hash>`),
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
    - a **step-up code**: `POST /auth/reauth/start` (Bearer, `{ lang }` as in rule 4) mails a
      **code only** (no link) to the user's own email; `POST /auth/reauth/verify` `{ code }` checks it like rule 7
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

14. Use the Authorization Code flow with **PKCE (S256)**, **`state`** and **`nonce`** (decided at the
    start of 4.3):
    - **On/off**: Google is on only when `GOOGLE_CLIENT_ID` and `GOOGLE_CLIENT_SECRET` are both set.
      Otherwise `/auth/google/*` answer `404` and `GET /auth/providers` says `google: false`, so the
      web hides the button (ROADMAP "Local-first"). `GOOGLE_ISSUER` (default
      `https://accounts.google.com`) is read through its discovery document
      (`/.well-known/openid-configuration`), so a local stand-in can replace Google in dev and tests
      (`npm run dev:oidc`); a non-https issuer is refused when `NODE_ENV=production`.
    - **Start** (`GET /auth/google/start?returnUrl=`): makes a random `state`, `nonce` and PKCE
      verifier, keeps them with the `returnUrl` (an in-app path only, like the web's
      `safeReturnUrl`) in the cookie **`__Host-goidc`**: an encrypted and signed JWE
      (`jose`, key derived from `JWT_SECRET` with HKDF), httpOnly, Secure, Path=/,
      **`SameSite=Lax`** (a Strict cookie isn't sent on the redirect back from Google), 10 min.
      Then `302` to Google with `scope=openid email profile`, `prompt=select_account`. The redirect
      URI is `WEB_ORIGIN` + `/api/auth/google/callback` (through the `/api` rewrite / dev proxy).
    - **Callback**: reads and clears the cookie, checks `state` against it, exchanges the code
      server-side (with the verifier and the client secret), and validates the ID token with
      `jose`: signature against the issuer's JWKS, `iss`, `aud` = our client id, `exp` (60 s clock
      tolerance), `nonce`. Its per-IP limit is the verify limit of rule 7.
    - **Which user**: find by (`google`, `sub`); found → that user (updates `lastUsedAt`). Not
      found: `email_verified` must be true, else refuse. A user with that email exists → **link
      automatically** (log `identity linked`, rule 19) and the web shows a one-time notice. No
      user → create one if rule 1 allows, with Google's `name` as `displayName` (else the email's
      local part), `picture` as `avatarUrl`, and `emailVerifiedAt` = now.
    - **Name and picture are taken once**: on creation only. Linking fills `avatarUrl` only when
      it's empty; later sign-ins never overwrite what the user has.
    - A disabled user (rule 3) is refused after all the checks above. A Google sign-in sets the new
      session's `authTime` (it counts as recent auth, rule 13).
    - **Language**: `GET /auth/google/start?lang=` (`th` | `en`, default `th`) is kept in the
      cookie, for the mail an automatic link sends (rule 31, 4.4a).
    - **Never puts tokens in the redirect URL**. Success sets the refresh cookie and redirects to
      `/auth/callback` on the web app (with `returnUrl`, and `linked=google` after an automatic
      link), which calls `/auth/refresh` to get an access token. A failure redirects to
      `/auth/callback?error=<reason>`: `cancelled` (the user said no at Google), `email_unverified`,
      `signup_closed` (the generic "sign-up is closed" message of rule 1), `disabled`,
      `rate_limited`, or `failed` (state or cookie missing / wrong, code exchange or token
      validation failed; the details go to the log only).

**Sessions & tokens**

15. **401 means only "access token missing/invalid/expired"** on authenticated routes. The web app
    refreshes once on 401, then retries. Business-rule failures use 400/403/404/422.
16. `/auth/refresh` and `/auth/sign-out` read the cookie, so they also require the request's `Origin`
    to equal the web origin (`WEB_ORIGIN`, which also builds the magic link), as CSRF defence in
    depth on top of `SameSite=Strict`. A missing or different `Origin` is `403`. Rate limits key on
    the client IP, so Express `trust proxy` is set to the number of proxies in front of the API
    (`TRUST_PROXY_HOPS`: the dev proxy or the Vercel rewrite).
17. Sign-out revokes the current session family and clears the cookie. "Sign out other devices"
    revokes every other family (rule 28).
18. Never log, return or store raw secrets: passwords, codes, link tokens, refresh tokens. Logs carry
    user ids, session ids and token **hashes** only. The OTP is hashed with **HMAC-SHA256 using a
    server secret** (`OTP_PEPPER`) rather than plain SHA-256, because a 6-digit code is trivial to
    brute-force offline from a plain hash.
19. Every auth event is logged (sign-in success/failure + method — `email`, `password`, `google`
    — refresh reuse detected, password set/changed/removed, identity linked / unlinked, sessions
    revoked from Account › Security) at `info`/`warn`, for later review.
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
    digits); anything else is a `422`. The web has one `type="tel"` field (`inputmode="tel"`,
    `autocomplete="tel-national"`) where the number is typed the Thai way (`0812345678`; `+66`,
    spaces and dashes are accepted too), and shows numbers as `081-234-5678` (decided at the start
    of 4.4).
    **SMS off**: `GET /auth/providers` answers `{ google, phone }`, `phone` being false when
    `SMS_PROVIDER=disabled`. The web then hides "Sign in with phone number" and the "add number"
    action (a number already saved still shows, read-only). Every `/auth/phone*` route answers `503`
    **before** looking at the number, so a disabled provider never tells known numbers from
    unknown ones.
22. `POST /auth/phone/start` `{ phone }` sends a 6-digit code (same generation and hashing as rule
    4 and 18) **only if a user has that verified number and is active**. It **always** answers
    `202` with the same body and similar timing; for an unknown number it sends nothing (so no SMS
    is paid for) and sleeps instead, like rule 5.
23. Limits: **resend cooldown 60 s** per number, **3 starts per number per hour**, **10 per IP per
    hour** (`otp:sms-ip:`, separate from email's per-IP bucket), and a **global cap of 100 SMS per
    day** (`SMS_DAILY_LIMIT`, env) across the app, which caps the bill if the limits above are
    bypassed. Over a limit returns `429` with `Retry-After`;
    hitting the global cap also logs a `warn`.
24. `POST /auth/phone/verify` `{ phone, code }`: the code expires after **5 minutes**, allows **5
    wrong attempts**, is compared in constant time, and is single-use, as in rule 7. Success
    creates a session (rule 3 still applies to disabled users).
25. **Adding a number** (Account → Security): `POST /auth/phone` `{ phone }` needs recent
    authentication (rule 13), then sends a `verify_phone` code to that number. `POST
/auth/phone/confirm` `{ code }` saves it as `users.phone` with `phoneVerifiedAt`. If another
    user already holds that number, the confirm fails with a generic `409` (it reveals only what the
    person proved they own). Changing the number repeats the flow; `DELETE /auth/phone` removes it
    (recent auth). The start limits of rule 23 apply here too. Adding, changing and removing a
    number each send the mail of rule 31; the routes take `lang` like the others.
26. The SMS text is Thai only and fits **one segment** (Thai is sent as UCS-2: 70 characters,
    counted in UTF-16 units; a longer text is billed as two). It names the app and the expiry and
    never contains a link (decided at the start of 4.4):
    - sign-in: `รหัสเข้าสู่ระบบ ตังค์ไปไหน: 123456 ใช้ได้ 5 นาที ห้ามบอกผู้อื่น` (63)
    - `verify_phone`: `รหัสยืนยันเบอร์ ตังค์ไปไหน: 123456 ใช้ได้ 5 นาที ห้ามบอกผู้อื่น` (63)

    A test keeps both at ≤ 70 units.

27. Phone events are logged like rule 19 (sign-in success/failure with method `phone`, number
    added/changed/removed) with the number **masked** (`+66*****5678`), never in full.

**Account › Security (4.4a)** (decided at the start of 4.4)

28. **Sessions.** `GET /auth/sessions` lists the caller's active session families (not revoked,
    not past either expiry), one entry each, most recently used first, as
    `{ id, userAgent, signedInAt, lastUsedAt, current }`. `id` is the family id; `userAgent` the latest one seen
    (the web turns it into "Chrome · Android", or "Unknown device"); `current` flags the caller's
    own family. No IP is stored or shown.
    - `DELETE /auth/sessions/:id` revokes that family. Someone else's, unknown or already ended
      → `404`; the caller's own → `400` `CURRENT_SESSION` (the web uses sign-out for that).
    - `DELETE /auth/sessions` ("sign out other devices", rule 17) revokes every other family and
      answers `{ revoked }` (how many).
    - **No recent auth** (the owner's choice): revoking protects the account, and whoever is
      thrown out can sign in again. The caller's own session must still be active, as on every
      credential route. A revoked device's access token keeps working for its last ≤ 10 min, but
      its next refresh is `SESSION_REVOKED`.
29. **Linking Google while signed in.** `POST /auth/google/link` (Bearer,
    `{ currentPassword?, lang }`) needs Google on (`404` otherwise) and recent auth (rule 13). A user has **at most one** Google
    identity: one already linked → `409` `IDENTITY_ALREADY_LINKED` (unlink first). It sets the
    `__Host-goidc` cookie as rule 14's start does, with `mode: link`, the caller's user id and
    session family, and answers `{ authorizationUrl }`; the web then navigates there.
    The callback checks everything rule 14 checks, then (in link mode):
    - the session family in the cookie must still be active and belong to an active user, else
      `failed` / `disabled`;
    - the `sub` already belongs to **another** user → `google_in_use` (accounts are never
      merged); to this user → success with nothing to do;
    - otherwise the identity is created with the Google email as `emailAtLink`. The Google email
      **need not** match `users.email`, and `email_verified` isn't required: the user proved both
      accounts just now. An empty `avatarUrl` is filled, as in rule 14.
    - It creates **no session** and leaves the refresh cookie alone. It redirects to
      `/account/security?linked=google`, or `/account/security?error=<reason>`: `google_in_use`,
      `already_linked` (another Google was linked meanwhile), `disabled`, `rate_limited` or
      `failed`; a cancel comes back with no `error`. Never to `/auth/callback`.
30. **Unlinking Google.** `DELETE /auth/google/link` `{ currentPassword?, lang }` needs recent
    auth (rule 13), removes the identity and answers the user; a no-op `200` when none is linked.
    Sessions made with Google stay; the email code always remains a way in.
31. **Mail on credential change** (ASVS). One short mail to `users.email` after: password set,
    changed or removed; Google linked (from Security, or automatically at sign-in, rule 14) or
    unlinked; phone number added, changed or removed (4.4b). Not on sign-out or revoking sessions.
    - Content: what changed and when (the user's `timezone`, formatted for the language: Thai with
      พ.ศ.), then "If this wasn't you, sign in with an email code, change what was changed, and
      sign out other devices on the Security page". No link and no code: users learn that this
      mail never asks them to click anything.
    - Language: the routes that change credentials take an optional `lang` (`th` | `en`, default
      `th`) in the body, as `/auth/reauth/start` does; an automatic link uses the `lang` of
      `/auth/google/start`.
    - Sent after the change is saved. A failed send or a reached `EMAIL_DAILY_LIMIT` logs a `warn`
      and skips the mail; the change still succeeds. It counts toward the daily cap but not toward
      the per-email start limits of rule 6.

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
| POST   | `/auth/phone/start`      | —      | Send SMS code to a verified number (always `202`)              | 4.4b |
| POST   | `/auth/phone/verify`     | —      | `{ phone, code }` → user + access token; cookie                | 4.4b |
| POST   | `/auth/phone`            | Bearer | Add or change number (recent auth): send `verify_phone` code   | 4.4b |
| POST   | `/auth/phone/confirm`    | Bearer | `{ code }` → save the number as verified                       | 4.4b |
| DELETE | `/auth/phone`            | Bearer | Remove the number (recent auth)                                | 4.4b |
| GET    | `/auth/providers`        | —      | Which extra ways are on: `{ google }`, + `phone` (4.4b)        | 4.3  |
| GET    | `/auth/google/start`     | —      | Redirect to Google (PKCE + state + nonce)                      | 4.3  |
| GET    | `/auth/google/callback`  | —      | Finish Google sign-in or link; redirects to web                | 4.3  |
| POST   | `/auth/google/link`      | Bearer | Start linking Google (recent auth) → `{ authorizationUrl }`    | 4.4a |
| DELETE | `/auth/google/link`      | Bearer | Unlink Google (recent auth)                                    | 4.4a |
| POST   | `/auth/refresh`          | cookie | Rotate refresh token → new access token                        | 4.1  |
| POST   | `/auth/sign-out`         | cookie | Revoke current session; clear cookie                           | 4.1  |
| GET    | `/auth/me`               | Bearer | Current user + `hasPassword` (4.2) + `identities` (4.3)        | 4.1  |
| GET    | `/auth/sessions`         | Bearer | Active sessions (one per family), current one flagged          | 4.4a |
| DELETE | `/auth/sessions/:id`     | Bearer | Revoke one other session family                                | 4.4a |
| DELETE | `/auth/sessions`         | Bearer | Revoke all other session families → `{ revoked }`              | 4.4a |

Exact request/response shapes go in OpenAPI (`/docs`) once the endpoints are built. Every `user`
in a response (sign-in, refresh, `/auth/me`, `PUT /auth/password`) carries `hasPassword` and
`identities` (4.3): `[{ provider: 'google', email, linkedAt }]`, empty when nothing is linked, and
`phone` (4.4b): the verified number in E.164, or `null`.

## Web screens

All of these sit outside the app shell (no tab bar) and carry a language switch, because someone
who isn't signed in can't reach the account page.

- **Sign-in**: an email field with a "Send code" button, a "Continue with Google" button, a
  "Sign in with password" link, and a "Sign in with phone number" link (phone field → the same
  enter-code screen). Each extra way appears with its part (4.2–4.4). Offline, it says sign-in
  needs a connection and retries the silent refresh by itself once back online.
- **Enter code**: 6 boxes (`inputmode="numeric"`, `autocomplete="one-time-code"` so the phone can
  auto-fill it), a resend timer, and a "check your email for the link" hint.
- **Sign-in, Google** (4.3): under the email form, a "or" divider and a full-width outline
  "Continue with Google" button (44px, Google's multicolour "G" per its branding guidelines). It's
  a plain navigation to `/api/auth/google/start?returnUrl=…`, hidden when `GET /auth/providers`
  says `google: false` or can't be reached, and disabled offline.
- **Magic-link landing** `/auth/link` and **Google return** `/auth/callback` (4.3). The return page
  calls `/auth/refresh` (a spinner meanwhile) and goes to `returnUrl`; with `linked=google` it
  shows a one-time toast "Google is now linked to your account". With `error=…` it shows an error
  state like the magic-link page (icon, heading, one line, "Back to sign in"); `cancelled` goes
  straight back to sign-in instead.
- **Sign in with password** `/auth/password`: email + password (`app-password-field`), a link back
  to the email code. Reached from the sign-in page's "Sign in with password" link.
- **Password** `/account/password` (4.2, inside the shell): set / change / remove. Until 4.4's
  Security page exists, the account page has a short "Security" section with one row (password ·
  set / not set) that opens it; 4.4a moves that row into Account → Security unchanged. 4.3 adds a
  read-only row under it: "Google · linked (email)" or "not linked", hidden while Google is off.
  Linking from a signed-in account and unlinking come with 4.4a. A `403
REAUTH_REQUIRED` opens a confirm step in place: the current password (if one is set) or a
  step-up code to the user's email (`app-otp-field`), then the action is retried.
- **Account → Security** `/account/security` (4.4a, inside the shell; layout decided at the start
  of 4.4). The account page's "Security" section shrinks to one row, "ความปลอดภัย / Security",
  that opens it. The page has a back button and two groups of list rows:
  - **Ways to sign in**: Password (set / not set → `/account/password`, unchanged); Phone number
    (4.4b: the number or "not added" → `/account/phone`, hidden while phone is off and no number
    is saved); Google (hidden while Google is off): "Link" when none, else its email with
    "Unlink". Link and unlink run the `403 REAUTH_REQUIRED` confirm step in place (the password
    page's `reauth-step`); unlink asks "Unlink Google?" first. Coming back from Google,
    `?linked=google` shows the 4.3 toast and `?error=` one error line (`google_in_use`: "This
    Google account is linked to another account"; others: "Linking Google failed. Try again").
  - **Signed-in devices**: one row per session (device label, "signed in <date>", "active
    <relative time>", a "This device" badge on the current one). Other rows have a "Sign out"
    button (acts at once, no undo: a revoked session can't come back, so it asks first); under
    the list, an outline "Sign out other devices" button (asks first, then a toast with how many).
    Hidden when this is the only session.
  - Offline: the online-only notice, actions disabled, the list from the last load.
- **Phone** `/account/phone` (4.4b): add / change (number field → `app-otp-field` for the SMS
  code, resend timer) or remove (asks first), with the same confirm step.
- **Sign in with phone** `/auth/phone` (4.4b): the phone field, then the enter-code screen with an
  "check your SMS" hint and no magic-link line.

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
  name and credit are in place. Until then `SMS_PROVIDER=disabled` makes `/auth/phone*` answer
  `503` and `GET /auth/providers` says `phone: false`, so the web hides it (rule 21).
- **Access token lifetime** of 10 min: fine with silent refresh. Raise it only if refresh traffic
  turns out to be a problem.
- **Password policy**: decided in 4.2 as 8+ characters with all four character classes (rule 11),
  the owner's choice over NIST's 15+ without composition rules. Revisit if the app opens to
  strangers.
- **Google email ownership** (4.3): automatic linking trusts `email_verified`. Google is
  authoritative for `@gmail.com` and for Workspace domains, which covers the family; revisit
  (e.g. confirm with an email code before linking) if the app opens to strangers.
- **Notify on credential change**: decided at the start of 4.4 (rule 31), built in 4.4a.
