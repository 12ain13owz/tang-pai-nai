# CSV export + move transactions

> Status: Built (#15) — code in `web/src/app/features/account/pages/export-page/` and
> `web/src/app/layout/category-sheet.ts`. Mock-up: [mockups/export.html](mockups/export.html)

## Purpose

Two small tools around the data the app already has, both on the device and offline:

- **CSV export**: the current profile's money rows as one CSV file, to keep a copy or work on it
  in Excel / Google Sheets.
- **Move transactions** to another category, all of a category's or one wallet's (owner, 7.3):
  what a merge can't do when only one wallet should change.

## Out of scope

Decided by the owner at the start of #15 (the Transactions tab must stay about income and
expense; browsing is done by period there and by category in Reports):

- Text search, a filter screen, filters in the Transactions tab or Reports, an event filter
  (event.md Q10: the event page already lists its rows and totals).
- Ticking rows one by one (a selection mode), bulk delete, bulk event changes.
- Import (backlog: "Import from Money Lover").

## Data model

Nothing new: no table, no column, no API change. The export reads the local database; a move
writes `transactions` rows (and a wallet's `hiddenCategoryIds`) through the outbox.

## Business rules

**Export**

1. Account › ข้อมูลของฉัน › **ส่งออก CSV** (`/account/export`) exports the **current profile**.
   It works offline (it only reads).
2. Choices, each starting on "all": **dates** (ทั้งหมด = the oldest to the newest row, or a
   custom range of two days), **wallets** (ทุกกระเป๋า = every wallet of the profile, archived and
   excluded-from-total ones too, or some), **categories** (ทุกหมวด, or some: income and expense
   tabs; a parent ticks its children, a parent with only some children ticked shows half
   ticked; archived categories are listed, merged ones are not), and **รวมการโอนเงินและยืม-คืน**
   (on by default). Choosing some categories turns that switch off and disables it: transfers
   and debt entries have no category.
3. The button says how many rows the file will hold ("ส่งออก n รายการ"), counted on each change;
   with none it is disabled. It shares the file (Web Share with files) where the device can,
   otherwise downloads it, then shows a toast.
4. **Rows**: live transactions (every one, `excludeFromReport` too), and when the switch is on,
   each transfer side whose wallet is chosen (โอนออก / โอนเข้า) and each debt entry with a wallet
   that is chosen (its kind, signed by the money in the wallet as on the Transactions tab).
   Order: `occurredOn` ascending, then `createdAt`, then `id`; a transfer's outgoing side first.
5. **File**: UTF-8 with a BOM (Excel reads Thai), comma separated, CRLF line ends, RFC 4180
   quoting (a field with `,` `"` or a line break is quoted, `"` doubled). Named
   `tangpainai-<profile>-<YYYY-MM-DD>.csv` (today), the profile's name kept to ASCII letters,
   digits, `-` and `_`; a Thai name is left out (`tangpainai-<YYYY-MM-DD>.csv`): browsers drop a
   download name with other characters. Headers in the UI language.
6. **Columns**: date (`YYYY-MM-DD`), type (รายรับ / รายจ่าย / โอนออก / โอนเข้า / a debt entry's
   kind), parent category, category (a top-level category has an empty parent), wallet, amount
   (signed: + money in, − money out; the currency's minor-unit digits with `.`, no thousands
   separator), currency code, note, event (a live event's name), excluded from report (ใช่ / Yes
   or empty). A field starting with `=` `+` `-` `@` that is not the amount is prefixed with `'`
   so a spreadsheet does not run it as a formula.

**Move transactions** (category sheet, edit mode)

7. A category with live transactions offers **ย้ายรายการ**: an icon in the sheet's header (disabled
   with none) and a link under "ลบไม่ได้" next to the merge link. It moves the category's **own**
   live transactions (not its children's); recurring rules and debts keep their category.
8. Choices: **from wallet** (ทุกกระเป๋า, or one wallet that holds some of them, each with its
   count) and **to category**: an open category of the same type and profile, not itself, picked
   in the merge picker's tree. One wallet chosen shows **ซ่อน "<name>" ในกระเป๋านี้** (off by
   default; adds the category's id to that wallet's `hiddenCategoryIds`, category rule 13).
9. "ย้าย n รายการ" asks once (from → to, the count, the hide), then moves every row in **one local
   write**: each row is an upsert with only `categoryId` changed (its pending op is rewritten,
   outbox rule). The sheet closes and a toast offers **เลิกทำ**: rows still on the target go back
   to the source and the wallet's hidden list goes back, again in one write.
10. Only where the device may write (`canWrite`, offline-sync rule 1). Sync is per row as for any
    edit: if another device edits one of those rows later, its edit wins that row (later edit
    wins), a delete wins over the move, and the loser's notice is the usual one.

## Web screens

See the mock-up. Export page: three radio groups (dates, wallets, categories) with the chosen
ones as chips and "แก้ไข", the switch, the count button. Pickers: a sheet with ticks per row
(wallets) or per tab and tree (categories). Move: a view of the category sheet (wallet radios
with counts, the target row, the hide switch), then the confirm view.

## Volume

20,000 rows over 3 years (transaction.md → Volume): counting is one aggregate per change; the
export reads the chosen rows once and builds the text in one pass; a move of thousands of rows
is one write.
