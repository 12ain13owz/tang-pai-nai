# Transfer

> Status: **Built** in #9 (Open questions: what the owner settled). Builds on
> [transaction.md](transaction.md). API: `api/src/features/transfer/` (sync handler only).
> Web: `core/transaction` (`TransferService`, `TransactionService.entries` / `transferSides`),
> `layout/transfer-sheet`, the ⋮ menu in `layout/transactions-header`, the Wallets tab button.

## Purpose

Move money from one wallet to another (cash out of the bank, pay off a credit card, put money
into savings) without it counting as income or expense. One transfer shows as money leaving one
wallet and arriving in the other (two rows in the list), so both balances are right, while the
month's รายรับ / รายจ่าย stay what was really earned and spent.

## Out of scope

- **Different currencies** (Q2): both wallets must share a currency (each wallet has one,
  wallet rule 4). A rate / a second amount comes when a non-THB currency is actually used
  (ROADMAP backlog, FX).
- **A fee field** (Q3): a bank fee is an ordinary expense in a category, which the user enters
  as its own transaction.
- Transfers between profiles (a profile is a separate area of money) and between users (#16).
- Budgets (backlog; transfers never count against a budget). Recurring transfers are built in
  #12 ([recurring.md](recurring.md), Q4): a rule records each occurrence as a transfer with
  `recurringId`.

## Data model

`api/src/core/database/schema/transfer.ts` (Q1: a table of its own, one row per transfer, not
two `transactions` rows; on screen it reads as two transactions)

- **transfers** (synced, like `transactions`): `id` (UUIDv7 from the device), `userId` (the
  wallets' owner), `profileId` (FK profiles, cascade), `fromWalletId` (FK wallets, cascade),
  `toWalletId` (FK wallets, cascade), `amount` (integer, minor units, **always > 0**),
  `occurredOn` (`YYYY-MM-DD`), `note` (≤ 500 characters, `''` when empty), plus the sync
  columns (`createdAt`, `updatedAt`, `deletedAt?`, `changeSeq`, `updatedBy`).
- No `categoryId` (a transfer has no category, so it's never in a by-category report) and no
  `excludeFromReport` (a transfer is never in a report).
- Server indexes: (`userId`, `changeSeq`), (`changeSeq`), (`profileId`), (`fromWalletId`),
  (`toWalletId`).
- **The device** keeps `transfers` (local schema step 9, a `SYNC_TABLES` entry, listed in
  `PROFILE_CHILD_TABLES`) with indexes (`profile_id`, `occurred_on`), (`from_wallet_id`),
  (`to_wallet_id`).

**Why one row** (Q1): the "two linked entries" are how a transfer **reads** (two rows in the
list: out of one wallet, into the other), not how it is stored. One row is one sync op, so a transfer can never be half
applied (one side rejected, the other kept), two devices can never leave its sides with
different amounts or dates, delete / undo / conflicts work exactly as for a transaction, and
`transactions.categoryId` stays required with the sign coming from the category.

## Business rules

1. **Own data, synced.** Like transaction rule 1: no REST endpoint, table `transfers` through
   `/sync/push` and `/sync/pull`. **Server check** (`CONFLICT`) for a live row:
   - `profileId` is one of the owner's live profiles, and a transfer never moves to another
     profile;
   - `fromWalletId` and `toWalletId` are the owner's live wallets of that profile;
   - `fromWalletId` ≠ `toWalletId`;
   - both wallets have the **same currency** (Q2).
2. **Archived wallets**: as transaction rule 2: the pickers offer open wallets only (an edit may
   keep an archived wallet the row already has); the server doesn't refuse an archived one.
3. `amount` 1 to 10¹⁵ minor units, typed on the same calculator keypad (transaction rule 3).
4. `occurredOn` and `note`: as transaction rules 4 and 6.
5. **Not income or expense.** A transfer is left out of รายรับ, รายจ่าย and สุทธิ everywhere
   (the summary card, a day's net, reports #10, budgets if they come).
6. **Balance**: a wallet's ยอดเงิน = `initialBalance` + Σ income − Σ expense − Σ transfers out +
   Σ transfers in (transaction rule 12; one aggregate for all wallets). ยอดรวม sums balances
   (wallet rule 7), so a transfer between two counted wallets leaves it unchanged, and one to a
   wallet excluded from the total (savings) lowers it.
7. **One transfer, both sides** (Q6): it is created, edited and deleted as a whole; there is no
   way to change or delete one side (changing the amount on the incoming row changes the
   outgoing one, deleting either row deletes both). Delete is a tombstone at once with undo (transaction rule
   7). Two devices: the later edit wins the whole row, delete beats edit.
8. **A wallet with transfers counts as "has transactions"** (wallet rules 4 and 6, transaction
   rule 10): its currency is fixed (device + server check, `wallets` handler) and it can only
   be archived, not deleted. A device that pulls a wallet tombstone tombstones the live
   transfers on either side of it (the race in transaction rule 10).
9. **Profile delete** tombstones its transfers in the same write (`PROFILE_CHILD_TABLES`); the
   confirm counts them with the transactions ("ธุรกรรม n รายการ"). A refused profile create
   refuses its transfers too (category rule 12).
10. **Order** with transactions: `occurredOn` desc, `createdAt` desc, `id` desc (transaction
    rule 13); a transfer's two rows sit together, the outgoing one first (Q5).
11. Transfers are written offline like everything else; only a device whose browser storage refused the local database (offline-sync rule 1) adds, edits and
    deletes them only while online and the server answers.

## Volume

Transfers are a few a month, but read with transactions: the period's transfer sides are one
`UNION ALL` (out, in) over (`profile_id`, `occurred_on`), merged in order into the period's
transactions (`entries`, one pass), and balances stay one aggregate (`UNION ALL` of the
transactions and both sides, `GROUP BY` wallet). Still 100 rows drawn at a time. Not measured
again with 20,000 rows in #9 (the transaction queries didn't change).

## Endpoints

None of its own: table `transfers` in `/sync/pull` and `/sync/push` (OpenAPI
`SyncTransferRow`). The device pushes a transfer after both wallets it points at.

## Web screens

- **Transfer form** (Q4: its own sheet, not a tab of the transaction form, which keeps รายจ่าย /
  รายรับ only): the same frame (DESIGN.md §6), title "โอนเงิน" / "แก้ไขการโอน", one card of rows:
  **from wallet** (with its ยอดเงิน), a **⇅ swap** button, **to wallet** (with its ยอดเงิน; only
  wallets of the from wallet's currency, never the same one), amount (keypad, quick amounts),
  note, date. No category, no เพิ่มเติม. Errors: "เลือกกระเป๋าปลายทางก่อน", "ใส่จำนวนเงินที่มากกว่า
  0". Choosing the to wallet as the from wallet (or one of another currency) empties the to
  wallet. The pickers are a view in the same sheet, each wallet with its balance and "ไม่รวมใน
  ยอดรวม" when it has it. The keypad belongs to the amount row, as in the transaction form.
  - The from wallet starts like the transaction form's wallet; the to wallet starts on the one
    last used from that from wallet on this device (Q7), else empty.
  - Editing (either row opens it) shows copy (a new transfer dated today) and delete (both rows,
    at once with undo); save and add another when adding.
  - Opened from the Transactions tab's ⋮ menu and from the Wallets tab (below).
- **The ⋮ menu** of the Transactions tab (Q4, owner's choice B: more items will join it) becomes
  a two-level nav list: level one "โอนเงิน" (opens the transfer sheet) and "ดูตาม · เดือน ›";
  "ดูตาม" turns the menu into the units (‹ back, the 8.1 list: day … custom range).
- **List rows** (Q5, the owner replaces DESIGN.md §5's "transfers are neutral"): a transfer shows
  as **two rows**, the outgoing one first: a muted ⇄ badge, the title "โอนเงิน", under it
  "โอนไปยัง ออมทรัพย์" / "ได้รับจาก กสิกร", then the note; the amount signed and coloured like any
  money that leaves or enters a wallet: **−1,000.00 in the expense colour** on the from side,
  **+1,000.00 in the income colour** on the to side. Each row is a side of one wallet, so:
  - "ทุกกระเป๋า": the side of each wallet in view, with that wallet's 20px badge on the corner;
    a side in a wallet excluded from the total isn't shown (the other side still is);
  - one wallet chosen: that wallet's side only.
- **Summary card and a day's net**: รายรับ / รายจ่าย / สุทธิ never include transfers (rule 5).
  A fourth line **"โอน"** shows the view's signed transfer net (in − out of the wallets in
  view) when it isn't zero, so the change in the balance is explained: a chosen wallet, or on
  "ทุกกระเป๋า" a transfer to or from a wallet excluded from the total.
- **Wallets tab**: balances include transfers (rule 6). Beside "เพิ่มกระเป๋าเงิน" (outline) a
  **"โอนเงิน"** button tinted gold (`bg-brand/10 text-brand`; maia's `secondary` looked the
  same as its outline, owner's request: the two must not read alike), shown while the profile
  has two or more open wallets.
- **Sync sheet**: a refused transfer is "การโอนเงิน", reading "โอนเงิน กสิกร → เงินสด · 500.00 ·
  note"; "แก้" opens its sheet (`/transactions?fix=`).

## Interactions

- **Wallet**: both sides; balance, "has transactions" (rule 8).
- **Transaction**: shares the form, the list, the order and the period tabs (the oldest row
  of either table starts the tabs).
- **Reports (#10), Budget (backlog)**: never read this table for income / expense.

## Open questions

Settled at the start of #9 (owner, from two rounds of HTML mock-ups): Q1 a `transfers` table
of its own, shown as transactions; Q2 the same currency only (each wallet has one); Q3 no fee
field, a fee is its own expense in a category; Q4 a sheet of its own, opened from a two-level ⋮
menu (choice B) and from the Wallets tab (a button that doesn't look like "เพิ่มกระเป๋าเงิน");
Q5 two rows, outgoing first, red − / green + with "โอนไปยัง" / "ได้รับจาก" (replaces DESIGN.md
§5's neutral transfers); Q6 editing or deleting either row changes the whole transfer; Q7 the
to wallet remembered per from wallet; the summary's "โอน" line; profile delete counts
transfers with transactions; "Transactions" stays the English tab label (asked while building).
