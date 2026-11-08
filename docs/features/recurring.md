# Recurring transactions

> Status: **Spec, draft round 1** (#12): every rule below marked _(proposal)_ waits on the
> owner's answer in Open questions. Mock-up: [mockups/recurring.html](mockups/recurring.html).
> Builds on [transaction.md](transaction.md), [transfer.md](transfer.md) and
> [offline-sync.md](offline-sync.md).

## Purpose

Money that comes and goes on a schedule (salary, rent, bills, a monthly move to savings) is
entered once as a **rule**, and the app records each **occurrence** when it is due, so nobody
types the same rent every month. An occurrence is an ordinary transaction (or transfer) once
recorded: it shows in the list, the balances and the reports, and can be edited or deleted like
any other. Occurrences still to come show as "not recorded yet" so the month ahead is visible.

## Out of scope

- **Push notifications / reminders** on the phone (no server job and no push before #17; the
  app tells the user when it is opened, rule 10).
- **A server job that records occurrences** (the old ROADMAP note's Vercel Cron): the app is
  local-only until #17 and offline-first, so the device does it (Q1).
- Several weekdays in one rule ("every Mon and Thu"), "the second Friday of the month", working
  days only: one rule per weekday instead. Kept out unless the owner asks.
- Editing a single future occurrence before it is due (Q6: edit it when it comes, or use "ask
  first").
- Members of a shared wallet making rules on the owner's wallet (#16).

## Data model

`api/src/core/database/schema/recurring.ts` _(proposal, Q9)_

- **recurring_rules** (synced, like `transactions`): `id` (UUIDv7 from the device), `userId`,
  `profileId` (FK profiles, cascade), `kind` (`transaction` | `transfer`),
  - the template: `walletId` (FK wallets, cascade; the from wallet of a transfer),
    `categoryId` (FK categories, cascade; `null` for a transfer), `toWalletId` (FK wallets,
    cascade; `null` for a transaction), `amount` (integer minor units > 0), `note` (≤ 500,
    `''`), `excludeFromReport` (transactions only, `false` for a transfer);
  - the schedule: `startOn` (`YYYY-MM-DD`), `frequency` (`day` | `week` | `month` | `year`),
    `interval` (1–99: every n units), `endOn` (`YYYY-MM-DD` or `null`), `endCount` (1–999 or
    `null`; at most one of the two), `confirm` (`false` = record by itself, `true` = ask first,
    Q1);
  - the state: `nextOn` (`YYYY-MM-DD`, the first occurrence not recorded or skipped yet; `null`
    once the rule has ended), `isPaused`;
  - plus the sync columns (`createdAt`, `updatedAt`, `deletedAt?`, `changeSeq`, `updatedBy`).
- **transactions.recurringId** and **transfers.recurringId** (nullable text, no FK: a rule may
  be deleted while its rows stay): the rule an occurrence came from (the form's "จากรายการซ้ำ"
  line, the list's ↻ mark, the server's duplicate rule 9).
- Server indexes: (`userId`, `changeSeq`), (`changeSeq`), (`profileId`), (`walletId`),
  (`categoryId`), (`toWalletId`).
- **The device** keeps `recurring_rules` (a new local schema step, `SYNC_TABLES`,
  `PROFILE_CHILD_TABLES`) with (`profile_id`), (`wallet_id`), (`category_id`),
  (`to_wallet_id`), and `recurring_id` columns on `transactions` / `transfers` (an
  `ALTER TABLE` step with a `NULL` default).
- **An occurrence's id is deterministic** _(proposal, Q2)_: a UUID (version 8) made from a
  SHA-256 of `ruleId + ':' + date`. Two devices that record the same occurrence produce the
  **same row**, never two.

One table for both kinds rather than two: a rule is few columns, few rows (tens per profile),
and one list, one sheet and one sweep serve both.

## Business rules

**Rules**

1. **Own data, synced.** Like transaction rule 1: no REST endpoint, table `recurring_rules`
   through `/sync/push` and `/sync/pull`. **Server check** (`CONFLICT`) for a live rule: its
   profile is the owner's live profile and never changes; `walletId` (and `toWalletId`) are the
   owner's live wallets of that profile, `toWalletId` ≠ `walletId` with the same currency; a
   transaction rule's `categoryId` is the owner's live category of that profile; at most
   **100** live rules per profile _(proposal)_.
2. **Fields** follow the occurrence they make: amount as transaction rule 3, note rule 6,
   `startOn` as rule 4 (2000-01-01 to a year after today), `endOn` ≥ `startOn`, `interval`
   1–99, `endCount` 1–999. Validation: `kind` decides which of `categoryId` / `toWalletId` is
   set.
3. **The schedule** _(proposal, Q3)_: occurrence _k_ (0, 1, 2, …) is `startOn` + _k_ ×
   `interval` units. Always counted from `startOn`, never from the previous occurrence, so:
   - **month / year on the 29th–31st**: a month without that day uses its **last day**
     (31 → 30 Nov, 28 or 29 Feb), and the next month goes back to the 31st; 29 Feb yearly is
     28 Feb in other years;
   - **week**: the weekday of `startOn`; **day**: every n days.
   - **End**: none, the last occurrence on or before `endOn`, or after `endCount` occurrences
     (counted from `startOn`, recorded or skipped alike). The rule then **ends** (`nextOn` =
     `null`) and moves to "สิ้นสุดแล้ว".
4. **Editing a rule** _(proposal, Q6)_ changes only occurrences **not recorded yet**: recorded
   ones are ordinary rows and stay as they are. A changed schedule (start, frequency, interval)
   sets `nextOn` to the new schedule's first date **on or after today**; nothing is recorded
   backwards. Changing `startOn` into the past therefore records nothing before today.
5. **Pause** (`isPaused`): no occurrence is recorded; resuming sets `nextOn` to the first date
   on or after today (the paused ones are not caught up).
6. **Delete** is a tombstone with undo in the toast. Recorded occurrences stay (their
   `recurringId` points at the tombstone; the "จากรายการซ้ำ" line hides).

**Recording occurrences** _(proposal, Q1–Q2)_

7. **The device records them** (Q1, choice ก): whenever the app is unlocked or the shell opens
   (after the first sync round, or at once while offline / the server doesn't answer), when the
   date changes while it is open, and right after a rule is saved. For each live, open
   (rule 12), not paused rule of **every** profile of the user (not only the one on screen), it
   walks from `nextOn` to **today** (the device's local date):
   - `confirm = false`: writes each occurrence (a transaction or transfer with the
     deterministic id, `recurringId`, the rule's template and the occurrence's date) and
     moves `nextOn` past it, **all in one local write** with the rule;
   - `confirm = true`: writes nothing; the dates from `nextOn` to today are **due** (rule 10).
   - An occurrence whose id already exists locally (live or a tombstone) is not written again,
     only `nextOn` moves.
   - At most 400 occurrences per rule in one pass (a daily rule a year behind); the rest the
     next pass.
   - An untrusted device records only while it may write (online and the server answering,
     offline-sync rule 1).
8. **Saving a transaction with "ทำซ้ำ"** writes the rule with `nextOn` = `startOn` and runs
   rule 7 for it in the same write: a start on or before today records the occurrences up to
   today (the one the user just typed is the first occurrence, with the deterministic id); a
   start in the future records nothing yet.
9. **Two devices never make two rows of one occurrence** (Q2):
   - The deterministic id makes both devices write the **same row id**.
   - **Server rule** (new, in the transaction and transfer handlers): a pushed **create**
     (`baseSeq` `null`) of an occurrence (`recurringId` set) whose id the server already has
     **keeps the server's row** (live, edited by the user, or deleted = skipped) and answers it
     as `overridden` **without a conflict notice**, so a second device never undoes an edit or
     a skip, and nobody is told about a "conflict" that isn't one.
   - The rule's `nextOn`: both devices push the same rule with a later `nextOn`. The server keeps
     the **later `nextOn`** of the two (the rules handler's `resolve`), and a rule conflict
     whose versions differ only in `nextOn` writes **no notice**.
   - To make the race rare, an online device records after its first sync round of the open
     (rule 7), so it usually sees the other device's rows first.
10. **Due items** (`confirm = true`): the Transactions tab shows a card "ถึงกำหนด n รายการ" at
    the top in every period until each is handled; it opens a sheet listing them, oldest
    first: **บันทึก** (writes the occurrence as the rule says, on its date), **ข้าม** (writes the
    occurrence as a **tombstone** with the deterministic id, so every device knows it was
    skipped), or a tap that opens the transaction form filled from the rule (the amount of this
    month's bill), whose save records it. Either moves `nextOn` past it. "บันทึกทั้งหมด"
    records every due item as is. Each action has undo in the toast.
11. **Telling the user**: after a pass that recorded something, one toast at the top
    "บันทึกรายการซ้ำ n รายการ" with "ดู" (the rules page). Rows from a rule carry a small ↻ after
    the category name.

**Wallets and categories** _(proposal, Q7)_

12. **Archived** wallet (either side) or category: the rule **stops by itself** while it is
    archived (no occurrence is recorded; `nextOn` moves on, nothing is caught up), shown under
    "หยุดไว้" with the reason in red. It records again from today once unarchived or once the
    rule points at an open one.
13. **Merged category** (category rule 15): rules on it follow it to the target, like its
    transactions: the device in the merge write, the server in the merged tombstone's
    `followUp` and in `resolve` for a rule pushed late.
14. **Deleted wallet or category**: its rules are tombstoned **in the same local write** (the
    delete confirm counts them, "รายการซ้ำ n รายการ"), and a device that pulls the tombstone
    tombstones its live rules on it (the sweep of transaction rule 10). A wallet or category
    whose only users are rules may still be deleted.
15. **A wallet with live rules keeps its currency** and **a category with live rules keeps its
    type** (device + server check), as with transactions: the rule's amount and sign would
    change meaning.
16. **Profile delete** tombstones its rules in the same write (`PROFILE_CHILD_TABLES`); the
    confirm counts them. A refused profile create refuses its rules too.

**Upcoming**

17. Occurrences not recorded yet are **projected** on the fly, never stored: the Transactions
    tab's **"อนาคต"** shows those of the next **3 months** _(proposal, Q8)_ beside the stored
    future rows, faded with a dashed badge and "ยังไม่บันทึก". They count in **no** total, sum,
    balance or report (only recorded rows are money). Tapping one opens its rule.

## Volume

Rules are tens per profile, so every rule query reads the whole (indexed) profile list. A pass
of rule 7 is one local write however many occurrences it records. Projecting 3 months of a
daily rule is ~90 rows, drawn in the 100-row pages of the list. To check with 20,000 rows: the
pass at unlock, the "อนาคต" tab, the rules page.

## Endpoints

None of its own: table `recurring_rules` in `/sync/pull` and `/sync/push` (OpenAPI
`SyncRecurringRuleRow`), `recurringId` on `SyncTransactionRow` / `SyncTransferRow`. The device
pushes a rule after its wallets and category, and an occurrence after its rule.

## Web screens

Mock-up: [mockups/recurring.html](mockups/recurring.html) (frame numbers below).

- **Transaction form** (1–3): under "เพิ่มเติม", a row **"ทำซ้ำ · ไม่ทำซ้ำ ›"** above "ไม่รวมใน
  รายงาน", opening a view **"ทำซ้ำ"** in the sheet: ไม่ทำซ้ำ / ทุกวัน / ทุกสัปดาห์ (the date's
  weekday) / ทุกเดือน (its day) / ทุกปี (its day and month) / กำหนดเอง ทุก n วัน·สัปดาห์·เดือน·ปี;
  "สิ้นสุด": ไม่สิ้นสุด / ถึงวันที่ / ครบ n ครั้ง; "เมื่อถึงกำหนด": บันทึกให้อัตโนมัติ / ถามก่อนบันทึก.
  Back on the form the date row reads "เริ่ม", the row shows the rule, and a line says the next
  date. Only when adding; "save and add another" hides while "ทำซ้ำ" is set _(proposal)_. The
  29th–31st get a line on short months (4).
- **Transfer form**: the same row and view, if transfers repeat (Q4).
- **Rules page** (5, 7) Account › ข้อมูลของฉัน › **"รายการซ้ำ"**, also from the ⋮ menu (11):
  "ใช้อยู่" (by next date), "หยุดไว้", "สิ้นสุดแล้ว (n)" folded; a row = badge (wallet badge
  on its corner), category · note (a transfer: "โอนเงิน กสิกร → ออมทรัพย์"), the schedule and
  next date (or the due date, or why it stopped), the signed amount; "ถามก่อน" as a small tag.
  - in the header opens the transaction form with "ทุกเดือน" set. Empty: `app-empty-state`.
- **Rule sheet** (6): the transaction (or transfer) sheet in rule mode, "แก้ไขรายการซ้ำ", with
  pause / resume and delete in the header, and a line "ครั้งถัดไป … · บันทึกแล้ว n ครั้ง".
- **Transactions tab** (8–11): the ↻ mark on rows from a rule; the "ถึงกำหนด" card and sheet;
  the projected rows in "อนาคต"; the ⋮ menu's new row "รายการซ้ำ ›".
- **A recorded occurrence** opened in the form (12): "เพิ่มเติม" open, with a row "จากรายการซ้ำ ·
  ทุกเดือน วันที่ 1 ›" that opens the rule. Deleting it skips that occurrence (it is never made
  again).
- **Sync sheet**: a refused rule reads "รายการซ้ำ: ค่าเช่า · 8,500.00 · ทุกเดือน"; "แก้" opens
  the rule sheet (`FIX_ROUTES`).

Glossary _(proposal)_: รายการซ้ำ / Recurring, ทำซ้ำ / Repeat, ถึงกำหนด / Due, ข้าม / Skip,
หยุดชั่วคราว / Pause.

## Interactions

- **Transaction / Transfer**: occurrences are their rows (`recurringId`); the server's
  duplicate rule (rule 9) lives in their handlers.
- **Wallet / Category**: rules point at them; archive, merge, delete and the currency / type
  locks (rules 12–15).
- **Profile**: `PROFILE_CHILD_TABLES` (rule 16).
- **Reports**: read recorded rows only (projected ones never count).

## Open questions

Round 1, to settle with the owner (proposal first):

- **Q1 How a due occurrence appears.** ก _(proposal)_: the device records it when the app
  opens (rule 7), and each rule chooses **"บันทึกให้อัตโนมัติ"** (default) or **"ถามก่อน
  บันทึก"** (a due card to confirm or skip, for bills whose amount changes; Money Lover has
  both: recurring transactions and bills). ข: always ask (Money Lover's bills only). ค: always
  automatic. A server job (after #17) is not an option: it can't reach an offline device and
  doesn't exist before deploy.
- **Q2 Two devices.** _(proposal)_ deterministic occurrence ids + the server keeping its row for
  a second create, silently (rule 9); the rule's `nextOn` only moves forward.
- **Q3 Schedule.** _(proposal)_ day / week / month / year with "every n"; the 31st → the
  month's last day; end by date or count; no "several weekdays" (Out of scope).
- **Q4 Transfers.** _(proposal)_ yes, the same rule table (`kind`), from the transfer form.
- **Q5 Where.** _(proposal)_ the form row under เพิ่มเติม, Account › รายการซ้ำ + the ⋮ menu
  row, the due card on the Transactions tab, projected rows in "อนาคต".
- **Q6 Editing.** _(proposal)_ a rule edit changes what isn't recorded yet; a recorded
  occurrence is edited or deleted like any row (delete = skip); a due one can be edited before
  it is recorded (rule 10); no edit of a single future occurrence ahead of time.
- **Q7 Archived / merged / deleted.** _(proposal)_ archived → stops by itself (no catch-up);
  merged → follows; deleted → its rules go too; currency and type locked by live rules.
- **Q8 Upcoming horizon.** _(proposal)_ 3 months in "อนาคต"; not in "เดือนนี้" (its days after
  today) and never in totals.
