# Transaction

> Status: Spec — not built yet. Code will live in `src/features/transaction/`.

## Purpose

The core of the app: record money in or out of a wallet, against a category, on a date. The main
screen lists transactions grouped by day for a selected month, with month-level income, expense and
net, like Money Lover's "Transactions" tab. Adding one should take a few taps via the centre ➕
button.

## Out of scope

- Transfers between wallets (#9, built on top of this).
- Recurring rules (#12), events/trips (#14), attachments/receipt photos (backlog).
- Search & filter beyond month + wallet (#15).

## Data model

`src/core/database/schema/transaction.ts`

- **transactions** — `id`, `userId`, `profileId` (FK profiles, the same as its wallet's and
  category's, [profile.md](profile.md)), `walletId` (FK), `categoryId` (FK), `amount` (integer, minor
  units, **always > 0**), `occurredOn` (`YYYY-MM-DD`, the user's local date), `occurredAt?` (epoch
  ms, optional time of day), `note?` (≤ 500 chars), `excludeFromReport` (default `false`),
  plus the sync columns (`id` generated on the device, `createdAt`, `updatedAt`, `deletedAt?`,
  `changeSeq`, `updatedBy`; see [offline-sync.md](offline-sync.md)). `userId` is the user who
  created it; access follows the wallet (owner or member).
- Indexes: (`userId`, `occurredOn`), (`walletId`, `occurredOn`), (`categoryId`).

The **sign isn't stored**. Income vs expense comes from the category's `type`, so changing the
category flips it. The currency comes from the wallet.

## Business rules

1. Every query is scoped to the signed-in user. The wallet and category must both belong to the user
   (otherwise `404`) and must not be archived when creating or **changing to** them.
2. `amount` is a positive integer ≤ 10¹⁵. The API receives minor units, and the web app converts what
   the user typed using the currency's `minorUnit`.
3. `occurredOn` is a valid calendar date, not more than 1 year in the future. It defaults to today
   in the user's timezone.
4. Editing can change any field. Moving a transaction to a wallet with a **different currency** is
   refused (`422`), because the amount would be meaningless.
5. Delete is a **soft delete** (`deletedAt`), so other devices learn about it through sync. "Undo"
   clears `deletedAt` while the snackbar is open. Deleted rows are excluded everywhere.
6. Month summary for (`month`, optional `walletId`): `income` = Σ amount of income-type, `expense` =
   Σ amount of expense-type, `net` = income − expense. All three exclude `excludeFromReport` rows and
   are **grouped by currency** when "all wallets" spans several currencies.
7. Wallet balance includes **every** transaction, including `excludeFromReport` ones.
8. The list is ordered by `occurredOn` desc, then `occurredAt` desc (nulls last), then `createdAt` desc.

## Endpoints

| Method | Path                | Auth   | What                                                           |
| ------ | ------------------- | ------ | -------------------------------------------------------------- |
| GET    | `/transactions`     | Bearer | `?month=YYYY-MM&walletId=` → days with entries + month summary |
| GET    | `/transactions/:id` | Bearer | Detail                                                         |
| POST   | `/transactions`     | Bearer | Create                                                         |
| PATCH  | `/transactions/:id` | Bearer | Update                                                         |
| DELETE | `/transactions/:id` | Bearer | Delete                                                         |

## Web screens

- **Transactions tab** (home): a wallet switcher, swipeable month tabs (… เดือนก่อน / เดือนนี้ /
  อนาคต), a summary card (รายรับ / รายจ่าย / คงเหลือ), and a day-grouped list (date header with
  the day total, rows with category icon, name, note, amount in green or red). Tap a row to open it.
- **Add / edit transaction** (full-height bottom sheet from the ➕ tab): a big amount field with a
  numeric keypad, then category, wallet (defaulting to the last used), date (today / yesterday /
  pick), and note. A "Save" button stays fixed above the keyboard.
- **Transaction detail**: fields plus Edit and Delete (with undo).

## Offline

Owners read and write transactions in the local database, and sync carries them. Editors of a
shared wallet may **add** offline but edit/delete online only. Conflict rules are in
[offline-sync.md](offline-sync.md) rules 12–16.

## Interactions

- Reads wallet (currency, ownership) and category (type, ownership).
- Wallet balance, reports (#10) and budgets (#11) are all computed from this table.
