# Transaction

> Status: **8.1 built** (the table, the form, the Transactions tab with its Money Lover header,
> real balances, the "has transactions" rules of wallets and categories). **8.2 built**: quick
> amounts, toasts on top, "ใช้บ่อย" categories, copy, save and add another, the last type. API: `api/src/features/transaction/`
> (sync handler only). Web: `core/transaction` (`TransactionService`, `period.ts`),
> `layout/transactions-header`, `layout/transaction-sheet`, `layout/view-wallet-sheet`,
> `layout/custom-range-sheet`, `features/transactions` (the Transactions tab).

## Purpose

The core of the app: record money in or out of a wallet, against a category, on a date. The
Transactions tab (home) lists the current profile's transactions grouped by day for one month,
with the month's income, expense and net, like Money Lover's "Transactions" tab. Adding one takes
a few taps from the centre ➕.

## Out of scope

- Transfers between wallets ([transfer.md](transfer.md), #9: their own table, shown in this
  list), debt / loan (#13; Money Lover's third
  tab "หนี้สิน/เงินกู้" is not in the form).
- Recurring rules ([recurring.md](recurring.md), #12: a rule records its occurrences as
  ordinary transactions with `recurringId`), events / trips (#14), attachments and receipt photos, the AI / chat
  entry of the reference app (backlog).
- Search and filter beyond month + wallet (#15).
- Members adding to a shared wallet (#16): until then every transaction belongs to a wallet the
  signed-in user owns.

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
3. `amount` is an integer from 1 to 10¹⁵ in minor units. The form takes major units on its
   calculator keypad and works the expression out as exact fractions to the currency's
   `minorUnit` (`evaluate`, no floats; a division rounds half away from zero).
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
   (wallet rule 11's sweep). A refused profile create (made offline) refuses its transactions
   too: they are grouped under the profile's one sync-sheet item ("ธุรกรรม n รายการ") and go
   again with it when it is fixed (category rule 12; the outbox keeps them after their wallet).
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
    - **A merged category** (7.3, category rule 15) is the exception: its tombstone carries
      `mergedIntoId`, and its transactions follow it to the target instead of being deleted
      (the server moves them; a late push to it is moved, not refused).
    - Archiving a wallet or category changes nothing for its transactions: they stay in the list,
      the totals and the balance.
11. **Month summary** for a month and a set of wallets: `income` = Σ amount of income-type rows,
    `expense` = Σ amount of expense-type rows, `net` = income − expense. All three leave out
    `excludeFromReport` rows and are **one line per currency** when the wallets span several.
    **All wallets** ("ทุกกระเป๋า", decided at the start of #8) = the profile's wallets **without**
    `excludeFromTotal`, archived ones included (their history stays, wallet rule 6); a wallet
    excluded from the total is seen by choosing it in the wallet switcher.
12. **Wallet balance** = `initialBalance` + Σ income − Σ expense of all its live transactions,
    `excludeFromReport` ones included, − transfers out + transfers in (transfer rule 6).
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
- A long period ("ทั้งหมด", a year) is **drawn 100 rows at a time**; more come as the end of
  the list scrolls near (the totals and the summary still cover the whole period).
- The first pull of a big account is 500 rows a page (offline-sync rule 9), so 20,000 rows are 40
  requests on a new device, done once.
- **Checked in 8.1** with 20,000 rows over 3 years (Playwright, `npm run build`): the first pull
  ≈ 5.5 s, switching month ≈ 0.17 s, "ทั้งหมด" ≈ 0.8 s (it froze for 12 s before the 100-row
  pages), a save shows in the list in ≈ 0.2 s. **Again in #10** (after the transfers): switching
  month ≈ 0.10 s, "ทั้งหมด" ≈ 0.47 s, the next 100 rows ≈ 0.08 s.

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

- **Transactions tab** (home; owner's choices in #8 from mock-ups, Money Lover style; DESIGN.md
  §2 and §5):
  - header: the profile's 28px icon left (opens the switch sheet), the **wallet switcher** in the
    very centre (a pill; "ทุกกระเป๋า" or one wallet, opening a sheet with the total, the open
    wallets with their balances and the archived ones folded), and right the **sync icon**
    (the pill in its icon form, on every tab since #9) and the **⋮** menu (since #9 a two-level
    list: "โอนเงิน" and "ดูตาม · เดือน ›", which turns into day / week / month (default) / quarter /
    year / all / custom range, the last in a sheet with two dates; transfer.md);
  - the balance large (ยอดรวม of rule 11's wallets, or the chosen wallet's ยอดเงิน);
  - **period tabs** as chips that follow the unit, oldest first back to the oldest row, the
    current one in view: `09/2026 · เดือนที่แล้ว · เดือนนี้ · อนาคต` (only the month view has
    อนาคต = rows after this month), `31/10/2026 · เมื่อวาน · วันนี้`, `19/10 – 25/10/2026 ·
สัปดาห์ที่แล้ว · สัปดาห์นี้`, `Q2 2026 …`, `2024 · ปีที่แล้ว · ปีนี้`; a sideways swipe over the list
    moves period. Only the chosen period's rows show;
  - the summary card: รายรับ left, รายจ่าย right, สุทธิ under them (signed, one card per currency);
  - a card per day, newest first: the date large (`02`), วันนี้ / เมื่อวาน / the weekday over
    the month and year (ค.ศ.), the day's net right; rows: the category badge (with the wallet's
    20px badge on its corner on "ทุกกระเป๋า" only), the category name (a transfer: two rows,
    transfer.md → Web screens), the user's note under it
    (nothing when empty), "รอ sync" as a small cloud line, the signed amount right in income /
    expense colour without the currency symbol (it comes back when the rows mix currencies);
  - an empty period says so with "เพิ่มธุรกรรม". The chosen wallet and unit are remembered per
    profile on the device. The first-wallet step stays (wallet rule 12).
- **Transaction form** (the ➕ opens it to add, a row opens it to edit; owner's choices in #8
  from the Money Lover screenshot and mock-ups; no debt tab, no photo / chat buttons):
  - header: X left, "เพิ่มธุรกรรม" / "แก้ไขธุรกรรม" centred, delete (red, at once with undo)
    right when editing;
  - type tabs รายจ่าย / รายรับ (`app-segmented-field`), starting on รายจ่าย;
  - then **one card of rows told apart by icons, no labels above them** (screen-reader labels
    stay): wallet (opens a picker view; starts on the wallet the tab shows, else the last one
    used here, else the first open one; editing offers only the row's currency), amount
    (`app-calc-amount-field`: the currency code, the expression large and its result), category
    (opens the picker view: the chosen wallet's open, non-hidden categories of the type,
    children in their parent's tinted panel; a type with none left says so and opens the
    wallet's "หมวดหมู่ที่ใช้" over the form, category rule 13; switching type or wallet drops a
    category that no longer fits), note (opens its own view with a tall box and a 500 counter;
    ‹ keeps the text), date (‹ › a day, the middle opens the native date picker);
  - "ไม่รวมในรายงาน" folded under **เพิ่มเติม** (open by itself for a row that has it on);
  - the **calculator keypad** (`app-calc-keypad`) belongs to the amount row: it opens by itself
    when adding (not when editing) and on a tap on the amount, and closes on "=" or when any
    other control of the form is used (a row, the type tabs, the date, เพิ่มเติม; 8.2), the
    expression settling; a hardware keyboard types into it;
  - one main button "บันทึก" (above the keypad while it shows). Errors: "ใส่จำนวนเงินที่มากกว่า 0",
    "เลือกหมวดหมู่ก่อน". Asks before closing with unsaved input. An untrusted device offline gets
    the notice and a disabled save.
  - **Quick amounts** (8.2, owner's choices from a mock-up): a row of chips `20 · 50 · 100 · 500
· 1,000` (major units, Thai banknotes) at the top of the keypad's panel, shown only while
    the keypad is; the keys get 4px shorter so the form loses little. A chip **adds** like
    counting notes: an empty amount (or one ending in an operator) takes the number, otherwise
    `+<number>` is appended, so `500` then `100` reads `500+100 = 600`. Money Lover has none, so
    Account › การแสดงผล has a switch "ปุ่มจำนวนเงินด่วน" (on by default, kept per device like
    the theme, not synced); off, the keypad is exactly 8.1's.
  - **Save and add another** (8.2, only when adding): an outline icon button beside "บันทึก"
    saves, keeps the sheet open with the same type, wallet, category, date and "เพิ่มเติม",
    clears the amount and the note, and opens the keypad again (for a pile of receipts).
  - **Copy** (8.2, editing): an icon in the header opens "เพิ่มธุรกรรม" holding the form's
    values with the date set to today (the row being edited is left as it was saved); an
    archived wallet or category falls back as when adding (rule 2).
  - The type tabs start on the type of the last transaction added in this profile on this
    device (8.2), else รายจ่าย.
  - **Category picker**: above the tree, a row **"ใช้บ่อย"** of up to 4 categories (8.2): the
    type's categories with the most live transactions dated in the last 90 days, ties to the
    one recorded last, among those the picker offers (open, not hidden in the wallet). It is a
    shortcut only: the tree keeps the user's own order (the owner's question in 8.2: frequency
    never reorders the list, so the two don't fight), and the row is absent without history.
- **Wallet and category forms**: the currency is read-only with wallet rule 4's line once the
  wallet has transactions; the delete icon is disabled with a line ("…มีธุรกรรมแล้ว จึงลบไม่ได้
  เก็บถาวรแทนได้") for a wallet or category with transactions; a category's type is read-only
  with a line once it has transactions.
- **Wallets tab**: balances are real (rule 12).
- **Profile delete confirm**: counts transactions too ("กระเป๋าเงิน 1 ใบ หมวดหมู่ 27 รายการ
  และธุรกรรม 5 รายการ ในโปรไฟล์นี้…", `Intl.ListFormat`).
- **Sync sheet**: a refused transaction reads as its category, amount and note; "แก้" opens it.
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
- Reports (#10, [report.md](report.md)) and budgets (backlog) are computed from this table; a
  parent category's total includes its children's. `list` takes a filter (categories, counted
  or left-out rows, a currency) for the report's pages.

## Open questions

Settled at the start of #8 (owner): the Money Lover header comes in 8.1 rather than a temporary
month stepper (no build-then-remove); no time of day (rule 13); archived wallets and categories
are left out of the pickers, the server doesn't refuse them (rule 2); a pulled wallet or category
tombstone takes its live transactions (rule 10); the on-screen calculator keypad, quick amounts
looked at in 8.2; "all wallets" leaves out wallets excluded from the total (rule 11);
`excludeFromReport` in 8.1; a row opens the form (no detail screen).

Settled while building 8.1 (owner, from mock-ups and screenshots): **ค.ศ. in the whole app**
(DESIGN.md §5); the form has no labels above its rows and the note is its own view; the
list's day cards and chip tabs follow the owner's Money Lover screenshot, with only the chosen
period's rows; the wallet switcher sits in the very centre, so the sync pill is an icon on this
tab; "ไม่รวมในรายงาน" folds under เพิ่มเติม; the wallet badge on the category badge on "ทุกกระเป๋า"
(choice ก); sub-categories in a panel tinted with the parent's colour (choice "3+4"); the
initial bundle warning budget is 750 kB.

Settled at the start of 8.2 (owner, from a mock-up): quick amounts as a chip row at the top of
the keypad, a chip adds, a fixed set with an on/off switch per device (on by default); toasts
sit at the **top** of the screen everywhere (DESIGN.md §6), so they never cover the keypad or a
sheet's main button; "ใช้บ่อย" categories, copy, save and add another, the last type
remembered.
