# Transaction

> Status: **Spec, revised at the start of #8** (offline-first and profiles). Built in two parts,
> one session and PR each: **8.1** (the table, the add / edit form, the Transactions tab with its
> Money Lover header (wallet switcher, ⋮ time range, swipeable period tabs; from a mock-up
> first), real wallet balances, the "has transactions" rules of wallets and categories) and
> **8.2** (whatever 8.1 leaves, and a look at quick amounts from a mock-up). API:
> `api/src/features/transaction/` (sync handler only). Web: `core/transaction`
> (`TransactionService`), `layout/transaction-sheet`, `features/transactions` (the
> Transactions tab).

## Purpose

The core of the app: record money in or out of a wallet, against a category, on a date. The
Transactions tab (home) lists the current profile's transactions grouped by day for one month,
with the month's income, expense and net, like Money Lover's "Transactions" tab. Adding one takes
a few taps from the centre ➕.

## Out of scope

- Transfers between wallets (#9, built on top of this), debt / loan (#13; Money Lover's third
  tab "หนี้สิน/เงินกู้" is not in the form).
- Recurring rules (#12), events / trips (#14), attachments and receipt photos, the AI / chat
  entry of the reference app (backlog).
- Search and filter beyond month + wallet (#15).
- Members adding to a shared wallet (#16): until then every transaction belongs to a wallet the
  signed-in user owns.
- Quick amounts above the keypad (500 / 1,000 / …): not in 8.1. Money Lover has none, they
  would need a setting to turn them off, and they crowd the form; 8.2 looks at them in a mock-up
  first (owner, at the start of #8).

## Data model

`api/src/core/database/schema/transaction.ts`

- **transactions** (synced, like `categories`): `id` (UUIDv7 from the device), `userId` (the
  **wallet's owner**; #16 decides how a member's add is recorded), `profileId` (FK profiles,
  cascade), `walletId` (FK wallets, cascade), `categoryId` (FK categories, cascade), `amount`
  (integer, minor units, **always > 0**), `occurredOn` (`YYYY-MM-DD`, the device's local date),
  `note` (≤ 500 characters, `''` when empty), `excludeFromReport` (default `false`), plus the
  sync columns (`createdAt`, `updatedAt`, `deletedAt?`, `changeSeq`, `updatedBy`; see
  [offline-sync.md](offline-sync.md)).
- Server indexes: (`userId`, `changeSeq`), (`changeSeq`), (`walletId`), (`categoryId`),
  (`profileId`). The server never lists transactions by month (devices do), so it needs only the
  sync and FK indexes.
- `profileId` is stored although the wallet already implies it, so `PROFILE_CHILD_TABLES`, the
  profile sweep and the monthly query work on the table alone; it always equals the wallet's and
  the category's `profileId` (rule 1).
- The cascades only matter when the server purges a parent's 90-day-old tombstone: a live
  transaction never points at a tombstone for long (rules 9–10).
- **The device** keeps `transactions` (snake_case, local schema step 8, a `SYNC_TABLES` entry,
  listed in `PROFILE_CHILD_TABLES`) with local indexes for the screens (Volume below):
  (`profile_id`, `occurred_on`), (`wallet_id`), (`category_id`).

The **sign isn't stored**: income or expense comes from the category's `type`, so changing the
category may flip it. The **currency** comes from the wallet. Balances and totals are computed,
never stored (ROADMAP → Money & data).

## Business rules

1. **Own data, synced.** Transactions are scoped to the owner (another user's id is `ID_TAKEN`
   on push, never visible on pull). There is no REST endpoint: the web app writes them locally
   and they travel through `/sync/push` and `/sync/pull` as table `transactions`. **Server check**
   (`CONFLICT`, the message tells the device what to fix) for a live row:
   - `profileId` is one of the owner's live profiles, and a transaction never moves to another
     profile;
   - `walletId` is the owner's live wallet of that profile;
   - `categoryId` is the owner's live category of that profile.
2. **Archived wallet or category** (decided at the start of #8): archived means "not in use", so
   the pickers offer only open wallets and open, non-hidden categories when adding or **changing
   to** one; an edit may keep the archived wallet or category the row already has. The server
   doesn't refuse an archived one, so an expense added offline isn't bounced because another
   device archived its wallet meanwhile; it shows in the archived wallet's history.
3. `amount` is an integer from 1 to 10¹⁵ in minor units. The form takes major units and converts
   with the currency's `minorUnit` (`parseMajor`, no floats).
4. `occurredOn` is a real calendar date (`YYYY-MM-DD`), from 2000-01-01 to at most one year after
   today. The form starts on **today** (the device's local date). Server check: the shape, a real
   date, and not after the server's today + 1 year + 1 day (time zones).
5. **Currency**: moving a transaction to a wallet with **another currency** is refused (the
   amount would be meaningless): the form's wallet picker offers only wallets of the row's
   currency when editing, and the server checks it (the stored row's wallet currency vs the new
   one). While only THB is active this never shows.
6. `note`: up to 500 characters after trimming; empty is `''`.
7. **Delete** is a tombstone, acting at once with **undo** in the toast (DESIGN.md §6; an upsert
   of the tombstone the device has seen restores it, offline-sync rule 12). Screens read
   `deleted_at IS NULL` only.
8. **Edit** can change every field except `profileId` (rule 1). Two devices editing the same row:
   the later edit wins the whole row, delete beats edit, the loser gets a notice (offline-sync
   rule 12).
9. **Profile delete** tombstones the profile's transactions in the same local write
   (`PROFILE_CHILD_TABLES`, profile rule 8), and the confirm counts them ("ธุรกรรม n รายการ").
   A device that pulls a profile tombstone tombstones its live transactions of that profile
   (wallet rule 11's sweep). A refused profile create carries no transactions (a new profile has
   none until its first wallet syncs, and a transaction's wallet is pushed first).
10. **Wallets and categories with transactions** (wallet rules 4 and 6, category rules 4–6):
    - A wallet with live transactions can't change its **currency** (device + server check) and
      can't be **deleted**, only archived (device; deletes run no check, offline-sync rule 10).
    - A category with live transactions can't change its **type** (device + server check) and
      can't be **deleted**, only archived (device). Moving it under another parent of the same
      type keeps its transactions (they point at it by id).
    - **A device that pulls a wallet or category tombstone tombstones its live transactions of
      it** (decided at the start of #8), like the profile sweep. This only happens in a race (device A deletes
      a wallet it sees as empty while offline device B adds to it, and B's add reaches the
      server first). The other order is already safe: B's add arrives after the tombstone, the
      check refuses it (rule 1) and B fixes it by picking another wallet.
    - Archiving a wallet or category changes nothing for its transactions: they stay in the list,
      the totals and the balance.
11. **Month summary** for a month and a set of wallets: `income` = Σ amount of income-type rows,
    `expense` = Σ amount of expense-type rows, `net` = income − expense. All three leave out
    `excludeFromReport` rows and are **one line per currency** when the wallets span several.
    **All wallets** ("ทุกกระเป๋า", decided at the start of #8) = the profile's wallets **without**
    `excludeFromTotal`, archived ones included (their history stays, wallet rule 6); a wallet
    excluded from the total is seen by choosing it in the wallet switcher.
12. **Wallet balance** = `initialBalance` + Σ income − Σ expense of all its live transactions,
    `excludeFromReport` ones included (± transfers from #9).
13. **Order**: `occurredOn` desc, then `createdAt` desc, then `id` desc. There is no time of day
    (decided at the start of #8, like Money Lover): rows show under the day the user chose, and
    within a day the one recorded last is on top. `createdAt` is a sync column every row has
    anyway, so nothing extra is stored, and changing a row's date keeps its place among that
    day's rows by when it was recorded.
14. An untrusted device adds, edits and deletes only while online and the server answers
    (offline-sync rule 1), as for categories.

## Volume

A family using the app daily reaches **tens of thousands of rows** over a few years (20 a day ≈
7,000 a year). The device must stay instant with that:

- The local database is in memory, so reads are fast, but every screen query goes through an
  index: the month list and summary use (`profile_id`, `occurred_on`) with
  `occurred_on BETWEEN first AND last`; balances use (`wallet_id`); "has transactions" uses
  `EXISTS` on (`wallet_id`) / (`category_id`).
- Balances for all wallets come from **one** aggregate query (`GROUP BY wallet_id`, joined to
  `categories.type`), not one query per wallet; the month summary is one aggregate too. The month
  list reads only that month's rows.
- Signals recompute these on each local write and pull (the existing pattern); no screen loads
  every transaction into memory.
- The encrypted snapshot grows by roughly 150–250 bytes per row (≈ 5 MB at 20,000 rows); saving
  it after each write stays well under a second. Checked with 20,000 generated rows in 8.1.
- The first pull of a big account is 500 rows a page (offline-sync rule 9), so 20,000 rows are 40
  requests on a new device, done once.

## Endpoints

None of its own. Rows travel through the sync endpoints as table `transactions` (OpenAPI
`SyncTransactionRow`):

| Method | Path         | Auth   | What                                              |
| ------ | ------------ | ------ | ------------------------------------------------- |
| GET    | `/sync/pull` | Bearer | `transactions` rows with the other synced rows    |
| POST   | `/sync/push` | Bearer | upsert / delete ops on `transactions` (rules 1–6) |

The device pushes a transaction after the wallet and category it points at (outbox order).
Online `GET`s for members of shared wallets arrive with #16.

## Web screens

Glossary: ธุรกรรม / Transaction, รายรับ / รายจ่าย, คงเหลือ (summary), ยอดเงิน (wallet) (DESIGN.md
§11).

- **Transactions tab** (home, 8.1; layout from a mock-up the owner approves first): the header
  holds the profile switcher (its 28px icon on this tab), the **wallet switcher** at the centre
  ("ทุกกระเป๋า ▾" or one wallet, opening a sheet of the profile's wallets), the sync pill (dot +
  short word) and a **⋮ menu** with "ดูตาม" day / week / month (default) / quarter / year / all /
  custom range. Under it, **swipeable period tabs** that follow the range (for months: … เดือนก่อน
  / เดือนนี้ / อนาคต; "อนาคต" = rows after today). Then the summary card (รายรับ / รายจ่าย /
  คงเหลือ, one line per currency; one wallet adds its balance), then the period's days with
  entries, newest first: a day header (วันนี้ / เมื่อวาน / `จ. 14 ต.ค.` left, the day's net right),
  and rows (40px category badge, category name, the note or the wallet name muted under it,
  amount right: `-฿120.00` expense colour, `+฿25,000.00` income colour, "รอ sync" on a pending
  row). An empty period says so with "เพิ่มธุรกรรม". Tap a row to edit it. The first-wallet step
  stays (wallet rule 12). The chosen wallet and range are remembered per profile on the device.
- **Transaction form** (a long sheet form with labels, DESIGN.md §6; the ➕ opens it to add, a row
  opens it to edit). From the owner's Money Lover screenshot, adapted (no debt tab, no photo / chat buttons, labels
  on every field), confirmed with a mock-up:
  - header: X left, "เพิ่มธุรกรรม" / "แก้ไขธุรกรรม" centred, delete (red) right when editing;
  - type tabs รายจ่าย / รายรับ (`app-segmented-field`), starting on รายจ่าย;
  - กระเป๋าเงิน: the wallet row (badge, name, ›) opening a wallet picker view; it starts on the
    last wallet used on this device for this profile, else the first open one;
  - จำนวนเงิน: the amount in large figures with the currency code, typed on an **on-screen
    keypad** (decided at the start of #8): C, ⌫, + − × ÷, 0–9, 000 and the decimal point, so the
    phone keyboard never opens; maths runs on integers in minor units and a division rounds half
    up to the currency's minor unit; "=" / leaving the field settles the expression;
  - หมวดหมู่: the category row opening the category picker view: the chosen wallet's open,
    non-hidden categories of the tab's type (`isHiddenIn(wallet.hiddenCategoryIds, category)`),
    parents with children; a type with none left says so and links to the wallet's "หมวดหมู่ที่ใช้"
    (category rule 13). Switching the tab or the wallet clears a category that no longer fits;
  - วันที่: ‹ the date › (a day back / forward) and tapping the date opens a date picker;
  - บันทึกช่วยจำ: the note (`app-textarea-field`);
  - "ไม่รวมในรายงาน" switch (`excludeFromReport`, rule 11);
  - one main button "บันทึก" pinned at the bottom. Asks before closing with unsaved input.
- **Wallet and category forms**: the currency is read-only with wallet rule 4's line once the
  wallet has transactions; the delete icon is disabled with a line ("มีธุรกรรมแล้ว เก็บถาวรแทน")
  for a wallet or category with transactions; a category's type is read-only with a line once it
  has transactions.
- **Wallets tab**: balances are real (rule 12).
- **Profile delete confirm**: counts transactions too.
- There is no separate detail screen: a row opens the form, whose header holds delete (undo in
  the toast).

## Offline

The owner's transactions live in the local database and change through sync (offline-sync rules
8–12); a trusted device adds, edits and deletes offline. Editors of a shared wallet may **add**
offline but edit / delete online only (offline-sync rules 13–16, #16).

## Interactions

- **Profile**: `transactions.profileId`; deleting a profile takes its transactions (rule 9).
- **Wallet**: requires `walletId`, inherits its currency; its balance, "can change currency" and
  "can delete" read this table (rules 10, 12).
- **Category**: requires `categoryId`; its `type` decides income or expense; "can change type"
  and "can delete" read this table (rule 10). Hidden categories are left out of the picker only.
- Reports (#10) and budgets (#11) are computed from this table; a parent category's total
  includes its children's.

## Open questions

Settled at the start of #8 (owner): the Money Lover header comes in 8.1 rather than a temporary
month stepper (no build-then-remove); no time of day (rule 13); archived wallets and categories
are left out of the pickers, the server doesn't refuse them (rule 2); a pulled wallet or category
tombstone takes its live transactions (rule 10); the on-screen calculator keypad, quick amounts
looked at in 8.2; "all wallets" leaves out wallets excluded from the total (rule 11);
`excludeFromReport` in 8.1; a row opens the form (no detail screen).
