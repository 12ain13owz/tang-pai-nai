# Debt / loan

> Status: **Built** (#13; Open questions: what the owner settled). API: `api/src/features/debt/`
> (two sync handlers), `api/src/core/database/debt-link.ts` (a row's `debtId`, read by the
> transaction and recurring handlers too). Web: `core/debt` (`DebtService`),
> `core/wallet/debt-tables.ts` (the tables and their SQL, read by name by wallets, categories,
> transactions, recurring rules and reports), `features/debts` (the pages under
> `/wallets/debts` and their sheets). Mock-up: [mockups/debt.html](mockups/debt.html) (frame
> numbers below). Builds on [transaction.md](transaction.md), [transfer.md](transfer.md),
> [recurring.md](recurring.md) and [offline-sync.md](offline-sync.md).

## Purpose

Keep track of money **borrowed from** someone (a parent, a cooperative, a card's instalment plan)
and money **lent to** someone, how much is still owed, and every repayment, so the owner can see
at a glance who owes what. Borrowed money isn't income and lent money isn't an expense: **money
is counted as an expense once** (owner's direction after #10), either when it is spent or when
it is repaid, chosen per debt (Q1).

## Out of scope

- **Interest worked out from a rate** (% per year, amortisation tables). Interest is typed as an
  amount when it is paid (Q5).
- Reminders / push notifications before a due date (no server job before #17; the list shows
  overdue debts in red).
- A contacts list or linking a debt to another user of the app: the person is a free name (Q3).
  Sharing a debt with the other person waits for #16 if ever.
- Several currencies in one debt, or a debt paid from a wallet of another currency.
- Credit-card statement cycles (a card stays a wallet with a negative balance, wallet rule 5).

## Data model

`api/src/core/database/schema/debt.ts`. Two tables of their own (Q2) plus a column on
`transactions` and on `recurring_rules`.

- **debts** (synced): `id` (UUIDv7 from the device), `userId`, `profileId` (FK profiles,
  cascade), `direction` (`borrowed` | `lent`), `person` (1–50 characters: who or where, "แม่",
  "KTC"), `note` (≤ 500, `''`), `currencyCode` (FK currencies), `countAs` (`spent` | `repaid`;
  always `spent` for `lent`, Q1), `categoryId` (FK categories, cascade; the expense category of
  the instalments, set only for `repaid`), `dueOn` (`YYYY-MM-DD` or `null`), plus the sync
  columns (`createdAt`, `updatedAt`, `deletedAt?`, `changeSeq`, `updatedBy`).
  - **Nothing about the amount is stored**: the debt's total and what is left are computed from
    its entries and linked transactions (ROADMAP → Money & data), and so is "closed" (left = 0,
    Q6).
- **debt_entries** (synced): the money of a debt that is **not** income or expense (Q4):
  `id`, `userId`, `profileId` (FK, cascade), `debtId` (FK debts, cascade), `kind` (`principal`:
  borrowed / lent, more of it later | `repayment`: paid back / received back), `walletId` (FK
  wallets, cascade; `null` only on a `repaid` debt: its `principal`, goods bought on
  instalment with no cash in, and a forgiven rest, rule 4), `amount` (1 to 10¹⁵ minor units), `occurredOn`, `note`,
  `recurringId` (a repayment recorded by a rule, Q7), plus the sync columns.
- **transactions.debtId** (nullable text, no FK, like `recurringId`): a counted transaction that
  belongs to a debt: an instalment of a `repaid` debt, interest, or a forgiven remainder (Q4–Q6).
- **recurring_rules.debtId** (nullable text, no FK: SQLite can't add one with a cascade to a table
  that exists, and the device deletes a debt's rules with it) and a new rule `kind` `debt` (Q7).
- Server indexes: the sync pair, (`profileId`), (`walletId`), (`debtId`), (`categoryId`).
  Device: (`profile_id`), (`debt_id`), (`wallet_id`) on `debt_entries`; (`debt_id`) on
  `transactions` (a partial index `WHERE debt_id IS NOT NULL`).

**What is left** of a debt = Σ `principal` − Σ `repayment` − Σ amount of its linked transactions
that **settle** it. Only an **instalment of a `repaid` debt** (a linked expense) settles it
(decided while building: see rule 4). The other linked transactions are counted money that
leaves what is left alone: **interest** (a borrowed debt's expense, a lent debt's income) and a
**forgiven rest**'s transaction (a lent debt's expense, a borrowed `spent` debt's income), whose
repayment entry settles the debt. No extra column: the category's type and the debt's direction
and `countAs` tell them apart, all locked once used.

## Business rules

**Debts**

1. **Own data, synced.** Like transaction rule 1: no REST endpoint, tables `debts` and
   `debt_entries` through `/sync/push` and `/sync/pull`. **Server check** (`CONFLICT`) for a
   live debt: its profile is the owner's live profile and never changes; `currencyCode` active
   when created; a `repaid` debt's `categoryId` is the owner's live **expense** category of that
   profile; at most **100 open debts** per profile (Q12).
2. `direction` and `countAs` are chosen when the debt is created and **never change** (they
   decide how its rows count). `person` 1–50 after trimming, `note` ≤ 500, `dueOn` a real date
   from 2000-01-01 to 50 years after today (a mortgage).
3. **Counted once** (Q1):
   - **`spent`** ("นับตอนใช้เงิน", default; every `lent` debt): the money borrowed comes into a
     wallet as a `principal` entry, **not income**; what is bought with it is an ordinary
     expense; repaying the principal is a `repayment` entry, **not an expense**; interest is an
     expense (Q5). Lending is the mirror: out of a wallet, not an expense; back in, not income;
     interest received is income.
   - **`repaid`** ("นับตอนผ่อนคืน", borrowed only: buying on instalment): the `principal` entry
     has **no wallet** (nothing came in, so the purchase is recorded nowhere as money); each
     instalment is an ordinary **expense transaction** in the debt's category with `debtId`,
     so it counts in the reports and settles the debt.
4. **Closed** = nothing left (Q6): a debt whose left amount is 0 shows under "ปิดแล้ว", dated
   by its last row. More `principal` reopens it by itself; less than 0 reads "จ่ายเกิน" and stays
   open. "ปิดหนี้" with something left writes either the last repayment (the rest, into a
   wallet) or a **forgiven rest**: **two rows in one wallet** (decided while building, owner
   confirmed), both noted "ยกหนี้": a `repayment` entry of the rest (uncounted, it settles the
   debt) and a counted transaction of the same amount in the chosen category, an expense for a
   lent debt (the money left the wallet uncounted, so it counts now, once), an income for a
   borrowed `spent` debt (forgiven by the lender). The wallet doesn't move; a single counted row
   would have taken the money out of the wallet a second time. The wallet is the one the debt
   used last. A `repaid` debt forgiven writes an uncounted `repayment` with no wallet (its
   purchase was never counted).
5. **Delete** (Q11) asks first (no undo: wallet balances change on every device): the debt and
   its entries become tombstones in one write; its linked transactions **stay** as ordinary rows
   (`debtId` points at the tombstone, the link hides); its rules go (recurring rule 14).

**Entries and linked transactions**

6. An entry's wallet is the owner's live wallet of the debt's profile with the **debt's
   currency** (server check); archived accepted as for transfers (transfer rule 2). `amount`,
   `occurredOn` and `note` as transaction rules 3, 4 and 6. Validation: `walletId` is `null`
   only on a `repaid` debt (its `principal`, and a forgiven rest, rule 4).
7. **Balance**: a wallet's ยอดเงิน (transaction rule 12) adds `principal` of a borrowed debt and
   `repayment` of a lent one, and takes away the other two, like a transfer side. **Never** in
   รายรับ / รายจ่าย / สุทธิ, a day's net, the reports' figures or budgets (as transfer rule 5);
   in the reports' ยอดเริ่มต้น / ยอดสุดท้าย (they are balances).
8. A transaction's `debtId` (server check): the owner's live debt of the same profile, and the
   transaction's wallet has the debt's currency. A late push whose debt is a tombstone is
   **kept with `debtId` cleared** (the `resolve` hook), never refused: the money was real.
9. **A wallet with entries counts as "has transactions"** (wallet rules 4 and 6): currency fixed,
   archive only. **A category used by a live debt** keeps its type and can't be deleted (archive
   or merge instead); a merge moves `debts.categoryId` with its transactions (category rule 15,
   device and server `followUp`). An archived category still takes instalments of a debt
   already using it (transaction rule 2).
10. **Sweeps** (transaction rule 10): a device that pulls a wallet tombstone tombstones its live
    entries; a pulled debt tombstone tombstones its entries; a pulled category tombstone (not
    merged) tombstones the `repaid` debts on it, with their entries. Profile delete takes debts
    and entries (`PROFILE_CHILD_TABLES`), and the confirm counts them.
11. Two devices editing the same debt or entry: the later edit wins, delete beats edit, a notice
    for the loser (offline-sync rule 12). Two devices adding repayments add two rows (no
    conflict; the left amount is computed).
12. Debts are written offline like everything else; only a device whose browser storage refused the local database (offline-sync rule 1) writes only online
    with the server answering, as everywhere.

**Instalments** (Q7)

13. The debt form may set **"ผ่อนเป็นงวด"** (when adding only): n instalments × amount (the
    total split evenly to start), **every month** from the first one (built monthly only; the
    owner confirmed), a wallet, and "บันทึกให้อัตโนมัติ" / "ถามก่อนบันทึก". It writes a
    **recurring rule** (`endCount` = n) right after the debt: a `repaid`
    debt's rule is `kind` `transaction` with `debtId` (each occurrence an expense in its
    category), a `spent` debt's is the new `kind` `debt` (each occurrence a `repayment` entry
    with a deterministic id, recurring rule 9). Due / ask-first / skip / upcoming work as in #12.
14. A rule whose debt is closed stops (recurring rule 12's "stopped", reason "หนี้ … ปิดแล้ว",
    nothing caught up); it records again if the debt reopens. A deleted debt's rules are
    tombstoned with it (rule 5), and a device that pulls a debt tombstone tombstones its rules.
    A `debt` rule is edited on its debt's page (amount, wallet, note; pause and delete): its
    schedule doesn't change there (delete it and set a new plan); an instalment rule of a
    `repaid` debt opens in the transaction form's rule mode like any rule (#12).

## Volume

Debts are tens per profile and entries a few a month, so the debts page reads the profile's
debts with one query (sub-selects through the `debt_id` indexes of entries and linked
transactions). Balances stay one aggregate (one more `UNION ALL` branch), and the Transactions
tab merges the period's entries like transfer sides (`entries`, one pass, 100 rows drawn at a
time).

**Checked in #13** with 20,000 transactions over 3 years plus 46 debts and 614 entries
(Playwright, `npm run build`): the debts page 0.08 s, a debt's page 0.07 s, the Wallets tab (its
"ยืม-คืน" card) 0.06 s, a repayment saved and shown 0.6 s; the Transactions tab: a month 0.10 s,
"ทั้งหมด" 0.51–0.60 s (0.47 s in #10).

## Endpoints

None of its own: tables `debts` and `debt_entries` in `/sync/pull` and `/sync/push`, `debtId`
on transactions and recurring rules. Outbox order: wallet and category → debt → its entries,
linked transactions and rule → the rule's occurrences.

## Web screens

Mock-up frames in brackets. Where (Q9): the Wallets tab's card and the ⋮ menu (Account ›
ข้อมูลของฉัน had a row until 2026-11: debts are data, not settings, and two ways in are enough).

- **Wallets tab** (1): under the total, above the wallets (2026-11: 20 wallets pushed it out of
  sight), a titled card **"ยืม-คืน"**: "ยืมมา · ต้องคืน n
  รายการ" (left amount, expense colour) and "ให้ยืม · รอรับคืน n รายการ" (income colour, "เลย
  กำหนด n" in red), each opening the debts page on that tab. ยอดรวม stays the wallets' total
  (Q8; "หลังหักหนี้" is an option). With no open debt either way it is one row, "ไม่มีหนี้ค้าง ›",
  to the debts page.
- **Debts page** `/wallets/debts` (2, 10): tabs ยืมมา | ให้ยืม, the total left, open debts by due
  date (none last): badge (the category's for `repaid`, a muted hand otherwise), person, note and
  "คืนแล้ว x จาก y" with a thin bar, a "ผ่อน" tag, the left amount and the due date (overdue in
  red); "ปิดแล้ว (n)" folded; "เพิ่มรายการยืม" / "เพิ่มรายการให้ยืม" (the tab's way) under the list.
- **Debt form** (3, 4), a sheet "เพิ่มรายการยืม" / "เพิ่มรายการให้ยืม" (following its own ยืมมา | ให้ยืม choice; the toast
  too: "บันทึกรายการยืมแล้ว") / "แก้ไขหนี้": tabs ยืมมา | ให้ยืม, then the card:
  person (free text with the names used before), amount (keypad), wallet "เงินเข้ากระเป๋า" /
  "จ่ายจากกระเป๋า" (a category "ค่างวดเป็นรายจ่ายหมวด" for `repaid`), note, date; "นับเป็นรายจ่าย"
  (two radio rows, borrowed only); "ผ่อนเป็นงวด" (the repeat view of #12 plus a count); under
  "เพิ่มเติม" "กำหนดคืน". Editing changes person, note, due date only (amounts are entries);
  delete in the header (12).
- **Debt page** `/wallets/debts/:id` (5, 7): the left amount large, the bar, paid / total, due,
  how it counts; the next instalment (its rule) when there is one; buttons **คืนเงิน** /
  **รับคืน** (main), **ยืมเพิ่ม** / **ให้ยืมเพิ่ม** (gold tint), **ปิดหนี้** (outline); the history,
  newest first, each row opening its sheet.
- **Repayment sheet** (6): amount (keypad, a first quick chip "ทั้งหมด x" = what's left), wallet,
  note, date, and "ดอกเบี้ย / ค่าธรรมเนียม" (an amount + a category, remembered per debt on the
  device) that writes a linked counted transaction in the same write. A `repaid` debt's "จ่าย
  งวด" opens the transaction form filled (category, amount of one instalment, `debtId`).
- **Close sheet** (9): what is left, then "รับคืนส่วนที่เหลือ" / "คืนส่วนที่เหลือ" or "ยกหนี้" with
  its category and date (rule 4).
- **Transactions tab** (8): an entry is a row like a transfer side: a muted hand badge (the
  wallet's on its corner), "ยืมจาก แม่" / "คืนเงิน · สหกรณ์" / "ให้ยืม · น้องบี" / "รับคืน · น้องบี",
  signed by the money in the wallet. The summary card gets a line **"หนี้ (ยืม/คืน)"** with the
  view's signed entry net when not zero (like "โอน"). Linked transactions carry a small hand
  mark after the category name; their form shows "หนี้: แม่ ›" under เพิ่มเติม.
- **The ⋮ menu** (11): "ยืม-คืน ›".
- **Reports**: no new screen; the summary chips get "หนี้" like "โอนเงิน" when the period has
  entries.
- **Sync sheet**: a refused debt reads "หนี้ · แม่", an entry "คืนเงิน · แม่ · 2,000.00"; "แก้"
  opens the debt page (`FIX_ROUTES`).
- **Delete confirms**: a wallet can't be deleted with entries (rule 9); a category says it is
  used by n debts; the profile's counts "หนี้ n รายการ".

Glossary: ยืม-คืน / Loans (the section: the card, the ⋮ row, the page title; owner 2026-11,
after หนี้สิน, หนี้ / เงินกู้ and ยืมมา | ให้ยืม read as three names for one thing), หนี้ / debt (one
of them: แก้ไขหนี้, ปิดหนี้, ลบหนี้, "หนี้: แม่ ›"; adding one says which way: เพิ่มรายการยืม /
Add money borrowed, เพิ่มรายการให้ยืม / Add money lent), ยืมมา / Borrowed, ให้ยืม / Lent, คืนเงิน / Repay,
รับคืน / Received back, ต้องคืน / To pay back, รอรับคืน / To get back, ปิดหนี้ / Close, ยกหนี้ /
Forgive, ผ่อน / Instalment, กำหนดคืน / Due.

## Interactions

- **Wallet**: entries move its balance (rule 7) and count as "has transactions" (rule 9).
- **Transaction**: `debtId` (rules 3, 4, 8); the list merges entries (8).
- **Category**: a `repaid` debt's category (rule 9); merge follows.
- **Recurring**: instalments (rules 13–14), `kind` `debt`.
- **Reports**: entries count only in the balances (rule 7).
- **Profile**: `PROFILE_CHILD_TABLES` (rule 10).

## Open questions

**Decided while building** (owner: "ยืนยัน", from the Playwright screenshots): a forgiven rest
is two rows in one wallet (rule 4); "ผ่อนเป็นงวด" is monthly only; a `debt` rule's schedule
isn't edited on the debt's page (rule 14); a category used by a debt says the usual "มีธุรกรรม
แล้ว" when its delete is refused. Also while building: the person field suggests the names used
before; the repayment sheet's "ทั้งหมด x" is a tinted button under the card (the keypad's chips
add, so it isn't one of them); a debt's sheet titles are imperative ("คืนเงิน" / "Repay").

**Settled at the start of #13** (owner: "ตามเสนอ", every proposal of round 1 of the mock-up;
the options offered beside them were not taken):

- **Q1 Counted once.** Proposal: **a choice per debt** made when it is created, "ตอนใช้เงิน"
  (default) or "ตอนผ่อนคืน" (borrowed only), never changed after (rule 3). Alternative:
  "ตอนใช้" only (an instalment purchase then recorded as one expense and repayments uncounted).
- **Q2 Own table or a kind of wallet.** Proposal: **own tables** `debts` + `debt_entries`. A
  wallet kind would bring the 20-wallet limit, debts in every wallet picker, no person / due
  date / closed state, and "repaid" counting can't be expressed with transfers. Today's
  workaround (a wallet + transfers, or "ไม่รวมในรายงาน") keeps working.
- **Q3 Borrowed vs lent, the person.** Proposal: `direction` per debt; the person is a **free
  name** (suggested from names used before), not a contact or user; one debt per loan (two
  loans from แม่ = two debts, or "ยืมเพิ่ม" on one).
- **Q4 Repayments.** Proposal: uncounted money = **`debt_entries`** rows (shown like transfer
  sides); counted money (instalments of `repaid`, interest, forgiven) = **ordinary transactions
  with `debtId`**, so reports, budgets and the category pages need no change. Alternatives:
  everything as transactions in special "debt" categories (Money Lover's way, which mixes
  them into the category lists and "ไม่รวมในรายงาน"), or transfers to a debt (needs nullable
  transfer wallets: a table rebuild on both sides).
- **Q5 Interest.** Proposal: an optional **amount** in the repayment sheet, written as a counted
  transaction in a category the user picks (remembered per debt); no rate, no schedule.
- **Q6 Partial / close.** Proposal: closed is **computed** (nothing left); "ปิดหนี้" offers the
  rest as a repayment or "ยกหนี้" counted once (rule 4); overpaid shows "จ่ายเกิน".
- **Q7 Instalments as recurring rules.** Proposal: yes, "ผ่อนเป็นงวด" in the debt form makes a
  #12 rule ending after n (a `transaction` rule with `debtId` for `repaid`, a new `debt` kind
  for repayments of a `spent` debt); a closed debt stops its rule.
- **Q8 Totals.** Proposal: **ยอดรวม unchanged** (the money in the wallets); the Wallets tab's
  "ยืม-คืน" card shows what is owed and lent. Option: a line "หลังหักหนี้" under ยอดรวม.
  Transactions tab: entries as rows, a "หนี้" line on the summary card; reports: balances only.
- **Q9 Where.** Proposal: the Wallets tab card (main), the ⋮ menu row and Account › ข้อมูลของฉัน;
  pages under `/wallets/debts` (lazy, nothing injected by the shell).
- **Q10 Archived / merged / deleted wallet or category.** Proposal: archived → nothing changes
  (entries stay, pickers offer open ones); merged category → the debt follows; a wallet with
  entries can't be deleted; a category used by a live debt can't be deleted (rule 9); the
  sweeps of rule 10 for races.
- **Q11 Deleting a debt.** Proposal: confirm first (no undo), entries go, counted transactions
  stay unlinked, rules go (rule 5); "ปิดหนี้" is offered as the usual way.
- **Q12 Limits and extras.** Proposal: 100 open debts per profile; due date with overdue in red;
  a "ทั้งหมด x" quick chip. **Not** proposed (options): a "หลังหักหนี้" line (Q8), a reminder
  card on the Transactions tab for debts due within 7 days, a share text ("ทวง") with the
  history, a report page of interest paid.
