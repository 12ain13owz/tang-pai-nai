# Family sharing

> Status: **Built (16.1)**; **16.2 in progress** (shared profiles in the switcher, editors write)
> — API `src/features/sharing/`, sync push; web `core/sharing`, `features/account`
> (Account › แชร์กระเป๋า), the profile switcher.
> Mock-ups: [mockups/sharing.html](mockups/sharing.html) (16.1, round 2),
> [mockups/sharing-16.2.html](mockups/sharing-16.2.html) (16.2, round 2).

## Purpose

An owner shares some wallets of one profile with family members, who see them online. #16 is two
parts: **16.1** = invitations, members and a read-only view of shared wallets; **16.2** = the
owner's profile appears in the member's **profile switcher** and works like their own (the same
tabs, ➕ and transaction sheet), **online only**; an editor adds, edits and deletes transactions
there (owner's choice at the start of 16.2, mock-up round 2).

## Out of scope

- Members writing anything but **transactions** of a shared wallet: no wallets, categories,
  transfers, debts, events or recurring rules. Nothing of a shared profile works offline.
- Sharing a whole profile, categories, rules, debts or events. Shared wallets count in **no**
  report or total of the member (report.md: own wallets only).
- Joining by link: an invitation is matched on the **verified email** only (auth.md).

## Data model

Schema: `api/src/core/database/schema/sharing.ts` (invites) and `wallet.ts` (members). Both are
**server only**, never synced; the web keeps what it reads in memory (offline-sync rule 15).

- **transactions.addedBy** (16.2, nullable, no FK): the member who added the row; `null` = the
  owner. Set by the server, never by a device; kept by every later write.
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
9. What a member reads of a shared profile (`GET /sharing/with-me/:profileId/rows`): the profile
   (name, icon, colour), the owner, their role, the people who added rows (names), the shared
   wallets (name, icon, colour, currency, hidden categories, archived = gone), the owner's
   categories of that profile, and the wallets' **transactions** (tombstones included, by
   `changeSeq` like a pull). Transfers and debt entries are **not listed**: their money is folded
   into the wallet's `initialBalance`, so balances stay right. No events, recurring rules, debts
   or other wallets.
10. A shared profile is **online only**: the switcher's "แชร์กับฉัน" group is disabled offline or
    while the server is down, and a shared profile in use shows a blocked screen until it is back
    (no old data). Opening the app always starts on an own profile.
11. An **editor** adds, edits and deletes transactions of the shared wallets (any income /
    expense row, the owner's too) through `POST /sync/push`, sent at once, never queued. A
    **viewer** reads only (➕ and the sheet's save / delete are off).
12. On push, an editor's row is stored as the owner's (`userId` = the owner, so it syncs to the
    owner's devices), `updatedBy` = the editor, `addedBy` = the editor on a create; fields the
    editor can't see (`eventId`, `recurringId`, `debtId`) keep the stored values (null on a
    create). The wallet must be shared with them as editor, before and after a move, and the
    category must be one of the owner's of that profile (the usual check, as the owner).
13. An editor's update or delete needs `baseSeq` = the row's current `changeSeq`; otherwise it's
    `rejected` with `STALE` (the web reloads and says "รายการนี้เพิ่งถูกแก้ไข"). A wallet no
    longer shared with them as editor is `rejected` with `NOT_SHARED` (the web says so and goes
    back to an own profile).
14. **Owner wins**: when the owner's push conflicts (older `baseSeq`) with a version an editor
    wrote, the owner's version wins whatever the times, even over the editor's delete (the row
    comes back); the editor gets no notice (they see it on the next load). Between the owner's
    own devices rule 12 of offline-sync is unchanged.
15. The owner sees "เพิ่มโดย <name>" on rows with `addedBy`, offline too; the name comes from the
    profile's members once read online (`GET /sharing/profiles/:id`), else "สมาชิก".

## Endpoints

All behind `authenticate`; anything the caller may not see is `404`.

| Method | Path                                           | What                                              |
| ------ | ---------------------------------------------- | ------------------------------------------------- |
| GET    | `/sharing/profiles/:profileId`                 | Owner: members, pending invites, unshared wallets |
| POST   | `/sharing/profiles/:profileId/invites`         | Owner: invite `{ email, role, walletIds, lang }`  |
| POST   | `/sharing/invites/:id/resend`                  | Owner: send the mail again `{ lang }`             |
| DELETE | `/sharing/invites/:id`                         | Owner: cancel                                     |
| PUT    | `/sharing/profiles/:profileId/members/:userId` | Owner: `{ role, walletIds }` (empty = remove)     |
| DELETE | `/sharing/profiles/:profileId/members/:userId` | Owner: remove                                     |
| GET    | `/sharing/with-me`                             | Member: invites to me + shares grouped by profile |
| POST   | `/sharing/invites/:id/accept`                  | Member: accept                                    |
| POST   | `/sharing/invites/:id/decline`                 | Member: decline                                   |
| DELETE | `/sharing/with-me/:profileId`                  | Member: leave that owner's profile                |
| GET    | `/sharing/with-me/:profileId/rows`             | Member: a shared profile's rows `?since=&limit=`  |

Error codes: `SHARE_SELF`, `SHARE_ALREADY_MEMBER`, `SHARE_INVITE_PENDING` (409),
`SHARE_MEMBER_LIMIT` (409), `SHARE_WALLETS_INVALID` (422), `SHARE_INVITE_EMPTY` (409),
`SHARE_DAILY_LIMIT` / `SHARE_RESEND_COOLDOWN` / `RATE_LIMITED` (429 with `Retry-After`).
Push results for editors (16.2): `rejected` with `STALE` or `NOT_SHARED`.

## Web screens

- **Account › แชร์กระเป๋า** (`/account/sharing`, a row under หมวดหมู่ with the current profile
  and how many people): invites to me (accept / decline), the profile's members (role, how many
  wallets), pending invites, a card per wallet shared with nobody, "แชร์กับฉัน" grouped by owner
  (⋮ leave), and "เชิญสมาชิก". Sheets: invite (email, role, wallet checklist) and member /
  pending invite (role, wallets, save; ⋮ remove, or resend / cancel). A badge on the row and a
  dot on the Account tab while invites to me are pending.
- **Profile switcher** (16.2): the own profiles, then "แชร์กับฉัน": one row per owner's profile
  (name · ของ <owner> · how many wallets · role). Picking one makes every tab show it:
  Transactions (the shared wallets), Wallets (their balances, no wallet actions or debts),
  Reports ("รายงานดูได้เฉพาะโปรไฟล์ของคุณ"); ➕ and a row open the usual transaction sheet (no
  event or repeat rows: none are shared). Offline: the group is disabled, a shared profile in use
  shows "ใช้งานไม่ได้ขณะออฟไลน์" with a way back. 16.1's "แชร์กับฉัน" section of the Wallets tab
  and `/wallets/shared/:id` are gone.
- The data lives in `SharingService` (memory only), loaded after the shell's first render with a
  dynamic `import()`; it is cleared when the user changes or signs out. A shared profile's rows
  are put in **TEMP tables** of the in-memory database that shadow the synced ones while it is
  in use: the screens read them unchanged, and the saved snapshot (the `main` schema only) never
  holds them (offline-sync rule 15). Own sync rounds wait while a shared profile is in use.

## Interactions

- Reads `wallets`, `profiles`, `categories`, `transactions`, `transfers`, `debts`,
  `debt_entries`, `users` and `rate_limit_buckets` through `@/core/database/schema`, never other
  features.
- Sync (16.2): who may write a wallet is `@/core/database/wallet-access` (`walletAccess`), read by
  `features/sync`; the transactions handler's `shared` hook says which fields an editor keeps.
- Auth: the invitee signs in the usual way; matching uses `users.email` + `emailVerifiedAt`.

## Open questions

- None for 16.2.
