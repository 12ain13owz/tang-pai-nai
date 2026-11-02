# Transfer

> Status: **Spec (draft)**, proposals to confirm with the owner at the start of #9 (see Open
> questions). Builds on [transaction.md](transaction.md).

## Purpose

Move money from one wallet to another (cash out of the bank, pay off a credit card, put money
into savings) without it counting as income or expense. One transfer shows as money leaving one
wallet and arriving in the other, so both balances are right, while the month's รายรับ / รายจ่าย
stay what was really earned and spent.

## Out of scope

- **Different currencies** (Proposal Q2): both wallets must share a currency. A rate / a second
  amount comes when a non-THB currency is actually used (ROADMAP backlog, FX).
- **A fee field** (Proposal Q3): a bank fee is an ordinary expense the user records beside it.
- Transfers between profiles (a profile is a separate area of money) and between users (#16).
- Recurring transfers (#12), budgets (#11; transfers never count against a budget).

## Data model

`api/src/core/database/schema/transfer.ts` (Proposal Q1: a table of its own, one row per
transfer, not two `transactions` rows)

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

**Why one row** (Q1): the "two linked entries" are how a transfer **reads** (out of one wallet,
into the other), not how it is stored. One row is one sync op, so a transfer can never be half
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
   (the summary card, a day's net, reports #10, budgets #11).
6. **Balance**: a wallet's ยอดเงิน = `initialBalance` + Σ income − Σ expense − Σ transfers out +
   Σ transfers in (transaction rule 12; one aggregate for all wallets). ยอดรวม sums balances
   (wallet rule 7), so a transfer between two counted wallets leaves it unchanged, and one to a
   wallet excluded from the total (savings) lowers it.
7. **One transfer, both sides** (Q5): it is created, edited and deleted as a whole; there is no
   way to change or delete one side. Delete is a tombstone at once with undo (transaction rule
   7). Two devices: the later edit wins the whole row, delete beats edit.
8. **A wallet with transfers counts as "has transactions"** (wallet rules 4 and 6, transaction
   rule 10): its currency is fixed (device + server check, `wallets` handler) and it can only
   be archived, not deleted. A device that pulls a wallet tombstone tombstones the live
   transfers on either side of it (the race in transaction rule 10).
9. **Profile delete** tombstones its transfers in the same write (`PROFILE_CHILD_TABLES`); the
   confirm counts them with the transactions ("ธุรกรรม n รายการ", Q8). A refused profile create
   refuses its transfers too (category rule 12).
10. **Order** with transactions: `occurredOn` desc, `createdAt` desc, `id` desc (transaction
    rule 13).
11. An untrusted device adds, edits and deletes only while online and the server answers.

## Volume

Transfers are a few a month, but read with transactions: the list is one `UNION ALL` of both
tables over (`profile_id`, `occurred_on`), and balances add one `GROUP BY` per side
(`from_wallet_id`, `to_wallet_id`) to the existing aggregate. Still 100 rows drawn at a time.

## Endpoints

None of its own: table `transfers` in `/sync/pull` and `/sync/push` (OpenAPI
`SyncTransferRow`). The device pushes a transfer after both wallets it points at.

## Web screens

- **Transaction form** (Q4): the type tabs gain a third, **โอนเงิน** (`รายจ่าย · รายรับ ·
  โอนเงิน`), so a transfer is one tap from ➕ like any entry. On โอนเงิน the card's rows are:
  **from wallet** (with its ยอดเงิน), a **⇅ swap** button, **to wallet** (with its ยอดเงิน;
  only wallets of the from wallet's currency, never the same one), amount (keypad, quick
  amounts), note, date. No category row, no เพิ่มเติม. Errors: "เลือกกระเป๋าปลายทาง", "ใส่จำนวนเงิน
  ที่มากกว่า 0". Title "โอนเงิน" / "แก้ไขการโอน".
  - Switching tabs keeps the amount, note and date; the wallet becomes the from wallet.
  - The to wallet starts on the one last used from that from wallet on this device (Q7), else
    empty.
  - **Editing** a transfer opens on โอนเงิน with the other two tabs disabled (and the reverse
    for a transaction: Q6); copy, delete + undo, save and add another work as for a transaction.
  - "The last type" (8.2) remembers only รายจ่าย / รายรับ (Q7).
- **List row** (Q5, DESIGN.md §5: neutral, no income / expense colour): a muted round badge with
  ⇄ (`lucideArrowLeftRight`), the title "โอนเงิน", under it the wallets "กสิกร → เงินสด", then the
  note; the amount in the normal text colour.
  - **Both wallets in view** (ทุกกระเป๋า): one row, the amount **without a sign** (the money
    stayed in view).
  - **One side in view** (a wallet chosen in the switcher, or the other wallet excluded from the
    total): one row with that side only, "ไปยัง ออมทรัพย์" / "จาก กสิกร", the amount **signed**
    (−/+) in the normal text colour, so the direction reads without colour.
- **Summary card** (Q5): รายรับ / รายจ่าย / สุทธิ never include transfers; when the view's
  transfers don't net to zero (one side in view) a fourth line **"โอน"** shows their signed net,
  so the change in the balance is explained.
- **Wallets tab**: balances include transfers (rule 6). No new row.
- **Sync sheet**: a refused transfer reads "โอนเงิน กสิกร → เงินสด ฿500.00"; "แก้" opens it.

## Interactions

- **Wallet**: both sides; balance, "has transactions" (rule 8).
- **Transaction**: shares the form, the list, the order and the period tabs (the oldest row
  of either table starts the tabs).
- **Reports (#10), Budget (#11)**: never read this table for income / expense.

## Open questions

Proposals for the owner (start of #9): Q1 one `transfers` row; Q2 same currency only; Q3 no fee
field; Q4 a third tab in the form; Q5 one row, signed only when one side is in view, plus a "โอน"
summary line; Q6 a transfer and a transaction can't turn into each other when editing; Q7
remember the to wallet per from wallet, not the transfer tab; Q8 count transfers with
transactions in the profile delete confirm.
