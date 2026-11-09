# Family sharing

> Status: Spec (16.1) — API `src/features/sharing/`, web `core/sharing`, `features/account`
> (Account › แชร์กระเป๋า), `features/wallets` (แชร์กับฉัน, `/wallets/shared/:id`).
> Mock-up: [mockups/sharing.html](mockups/sharing.html) (round 2).

## Purpose

An owner shares some wallets of one profile with family members, who see them online. #16 is two
parts: **16.1** (this doc) = invitations, members and a **read-only** view of shared wallets for
every role; **16.2** = an editor adds offline and edits / deletes online (offline-sync rules 14,
16: `baseSeq`, owner wins, removed member's queued adds `rejected`).

## Out of scope

- Members writing anything (16.2). In 16.1 an editor sees what a viewer sees; the role is stored
  and shown.
- Sharing a whole profile, categories, rules, debts or events. Shared wallets count in **no**
  report or total of the member (report.md: own wallets only).
- Joining by link: an invitation is matched on the **verified email** only (auth.md).

## Data model

Schema: `api/src/core/database/schema/sharing.ts` (invites) and `wallet.ts` (members). Both are
**server only**, never synced; the web keeps what it reads in memory (offline-sync rule 15).

- **wallet_members** (from #6): `walletId`, `userId`, `role` (`editor` | `viewer`), `addedAt`.
  One row per shared wallet. A **member** below is one person on one profile of the owner: the
  rows of that user on that profile's wallets, all with **one role**.
- **wallet_invites**: `id`, `profileId` (FK, cascade), `ownerId` (FK users, cascade), `email`
  (trimmed, lower case), `role`, `walletIds` (JSON array), `createdAt`, `expiresAt`, `lastSentAt`.
  Unique (`profileId`, `email`). Rows go away when answered, cancelled or expired.

## Business rules

1. Only the wallet's owner manages sharing, per profile (the one selected in the app). A member is
   a person with one role over the wallets the owner ticked; changing the role changes it for all.
2. An invite holds an email, a role (default `editor`) and at least one **open, live** wallet of
   that profile (all ticked by default; archived wallets aren't offered). New wallets are **not**
   shared automatically: the owner ticks them later (the page lists wallets shared with nobody).
3. No invite to yourself, to someone already a member of that profile, or a second pending one
   for the same profile and email (`409`). At most **10 people per profile**, members and pending
   invites together.
4. Each send (invite or resend) mails the invitee once: the inviter's display name and the wallet
   names, no free text; the link only opens sign-in with the email filled in
   (`/auth/sign-in?email=…`) and grants nothing. Limits: **10 sends per owner per day**, a
   **10-minute** cooldown per invite for resend, and every send counts toward
   `EMAIL_DAILY_LIMIT`. A refused send creates nothing.
5. An invite **expires after 14 days** (resend doesn't extend it). Expired rows are ignored
   everywhere and deleted on the next invite write (no cleanup job).
6. A signed-in user sees the pending invites addressed to their **verified** email (exact,
   case-insensitive), wherever they signed in from. Nothing joins until they **accept**; decline
   deletes the invite. Accepting adds the invite's wallets that are still open and live (none
   left → `409`, invite deleted).
7. The owner can change a member's role and wallets (an empty set removes them) or remove them;
   the member can **leave** all wallets of that owner's profile at once. Every change takes
   effect on the member's next request (rule 16 of offline-sync).
8. A member sees a shared wallet while it is live and **not archived** and its profile is live;
   otherwise it is gone for them (`404`), membership rows stay until the owner changes them.
9. What a member reads: the wallet (name, icon, color, currency, balance computed by the server
   like the app's: initial + transactions ± transfers ± debt entries), the owner's display name
   and email, their own role, the owner's categories of that profile, and the wallet's entries
   for a date range: transactions (category, amount, date, note, excludeFromReport), transfer
   sides as "out" / "in" **without the other wallet**, and debt entries as "in" / "out"
   **without the debt**. No events, recurring rules or other wallets.
10. All sharing calls need the network; offline, the web shows what it already read this session
    and disables every action.

## Endpoints

All behind `authenticate`; anything the caller may not see is `404`.

| Method | Path                                           | What                                                 |
| ------ | ---------------------------------------------- | ---------------------------------------------------- |
| GET    | `/sharing/profiles/:profileId`                 | Owner: members, pending invites, unshared wallets    |
| POST   | `/sharing/profiles/:profileId/invites`         | Owner: invite `{ email, role, walletIds, lang }`     |
| POST   | `/sharing/invites/:id/resend`                  | Owner: send the mail again `{ lang }`                |
| DELETE | `/sharing/invites/:id`                         | Owner: cancel                                        |
| PUT    | `/sharing/profiles/:profileId/members/:userId` | Owner: `{ role, walletIds }` (empty = remove)        |
| DELETE | `/sharing/profiles/:profileId/members/:userId` | Owner: remove                                        |
| GET    | `/sharing/with-me`                             | Member: invites to me + shares grouped by profile    |
| POST   | `/sharing/invites/:id/accept`                  | Member: accept                                       |
| POST   | `/sharing/invites/:id/decline`                 | Member: decline                                      |
| DELETE | `/sharing/with-me/:profileId`                  | Member: leave that owner's profile                   |
| GET    | `/sharing/wallets/:walletId`                   | Member: wallet + balance + role + owner, categories  |
| GET    | `/sharing/wallets/:walletId/entries`           | Member: entries `?from=YYYY-MM-DD&to=` (to optional) |

Error codes: `SHARE_SELF`, `SHARE_ALREADY_MEMBER`, `SHARE_INVITE_PENDING` (409),
`SHARE_MEMBER_LIMIT` (409), `SHARE_WALLETS_INVALID` (422), `SHARE_INVITE_EMPTY` (409),
`SHARE_DAILY_LIMIT` / `SHARE_RESEND_COOLDOWN` / `RATE_LIMITED` (429 with `Retry-After`).

## Web screens

- **Account › แชร์กระเป๋า** (`/account/sharing`, a row under หมวดหมู่ with the current profile
  and how many people): invites to me (accept / decline), the profile's members (role, how many
  wallets), pending invites, a card per wallet shared with nobody, "แชร์กับฉัน" grouped by owner
  (⋮ leave), and "เชิญสมาชิก". Sheets: invite (email, role, wallet checklist) and member /
  pending invite (role, wallets, save; ⋮ remove, or resend / cancel). A badge on the row and a
  dot on the Account tab while invites to me are pending.
- **Wallets tab**: a "แชร์กับฉัน · ของ <owner>" section under the own wallets, not in the total.
- **Shared wallet** (`/wallets/shared/:id`): balance, month tabs, summary card, entries by day
  with the owner's categories; ⋮ reload. Read-only.
- The data lives in `SharingService` (memory only), loaded after the shell's first render with a
  dynamic `import()`; it is cleared when the user changes or signs out.

## Interactions

- Reads `wallets`, `profiles`, `categories`, `transactions`, `transfers`, `debts`,
  `debt_entries`, `users` and `rate_limit_buckets` through `@/core/database/schema`, never other
  features.
- Auth: the invitee signs in the usual way; matching uses `users.email` + `emailVerifiedAt`.
