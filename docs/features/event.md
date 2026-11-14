# Event / trip

> Status: **Built** (#14; owner: "ตามเสนอ" on Q1–Q12 at the start). API: `api/src/features/event/`
> (one sync handler), `api/src/core/database/event-link.ts` (a transaction's `eventId`). Web:
> `core/event` (`EventService`), `features/events` (the pages under `/transactions/events` and
> the sheet); the form's row and the list's tag read `events` by name in `core/transaction`. Mock-up:
> [mockups/event.html](mockups/event.html) (Thai, dark; frame numbers below). Builds on
> [transaction.md](transaction.md) and [offline-sync.md](offline-sync.md).

## Purpose

Tag income and expenses to a trip or an event ("เชียงใหม่", "งานแต่งน้องเอ") and see what it
cost: the total, by category, and its rows, across wallets. Useful while travelling: during the
event's dates new rows take it by themselves.

## Out of scope

- Several events on one row, or tags (Q1): one row, at most one event.
- Transfers and debt entries (Q4): they move money, they don't spend it.
- An event filter in reports or the Transactions tab (Q10): dropped at the start of #15 (owner: the event page already lists its rows; export.md → Out of scope).
- A budget per event, sharing an event (#16), an event's own currency (totals are per currency).

## Data model

`api/src/core/database/schema/event.ts`.

- **events** (synced): `id`, `userId`, `profileId` (FK profiles, cascade), `name` (1–50),
  `icon` + `color` (as wallets: a `lucide…`/`tpn…` name, `#rrggbb`), `startOn` (`YYYY-MM-DD`),
  `endOn` (`YYYY-MM-DD` ≥ `startOn`, or `null` = not set), `isClosed` ("จบแล้ว"), plus the sync
  columns. Indexes: (`userId`, `changeSeq`), (`changeSeq`), (`profileId`).
- **transactions.eventId** (Q1): nullable, **no FK** (a column added to an existing table,
  `api/AGENTS.md` → Sync), index (`eventId`). The device's `transactions.event_id` (local schema
  step 13) has the same index; `events` is a `SYNC_TABLES` entry and in `PROFILE_CHILD_TABLES`.
- An event's totals are **computed** from its live transactions, never stored.

## Business rules

1. **Own data, synced** (Q3). Events belong to a profile and span its wallets. No REST routes:
   table `events` on `/sync/push` + `/pull`. Server check for a live row: the owner's live
   profile, never moved to another profile; at most **50 open** (not closed) events per profile
   (Q11; a stored open one already counts).
2. `name` 1–50 characters after trimming; `startOn` a real date from 2000-01-01 up to a year
   after today (`isEntryDay`); `endOn` a real date (no upper bound), not before `startOn`, or
   `null`.
3. **A transaction's `eventId`** (Q4): an event of the transaction's profile (`CONFLICT`
   otherwise). An event that is **gone** (deleted on another device) is **cleared** by the
   server, never refused, like `debtId`. A closed event may stay on a row (an edit keeps it),
   but the picker offers only open ones.
4. **Totals** (Q5) of an event: income, expense and net of all its live transactions, **including
   `excludeFromReport` ones**, one line per currency, whatever their dates. The list shows each
   event's expense and its row count.
5. **Default in the form** (Q7): when **adding** a transaction, the event is the open event whose
   dates hold the form's date (`startOn ≤ date ≤ endOn`, no `endOn` = no end); several = the
   latest `startOn` (then the latest created). Changing the date picks again until the user
   chooses (an event or "ไม่ผูก") by hand. Editing and copying keep the row's event. Nothing is
   stored for "the active event", so two devices can't disagree about it.
6. **Close / reopen** (Q2): `isClosed`; a closed event leaves the picker and the default, its
   rows and totals stay. "เปิดอีกครั้ง" reopens it (rule 1's limit applies).
7. **Delete** (Q9) asks first ("ธุรกรรม n รายการจะยังอยู่ แค่ไม่ผูกกับอีเวนต์นี้แล้ว") and writes
   **only the event's tombstone**: its rows keep `eventId`, which no screen reads once the event
   is gone (tags, totals, the form's row), and the server clears it when such a row is pushed
   again (rule 3). Untagging the rows in the same write was tried first and dropped: another
   device's offline edit of one of them then lost the whole row to the delete (later edit wins).
8. **Profile delete** tombstones its events (`PROFILE_CHILD_TABLES`); a pulled profile tombstone
   sweeps them like wallets. Two devices editing one event: the later edit wins (offline-sync
   rule 12).
9. **Recurring rules** (Q8) carry no event: the rows they record have none. Category merge moves
   rows without touching their event.

## Endpoints

None of its own: `events` and `transactions.eventId` travel on `/sync/push` and `/sync/pull`
(OpenAPI `SyncEventRow`).

## Web screens

Lazy pages `features/events` at `/transactions/events` (Q6), reached from the Transactions tab's
⋮ menu ("อีเวนต์ / ทริป ›"). Account › ข้อมูลของฉัน had a row until 2026-11 (events are data,
not settings); the plan is to show an event as a view of the Transactions tab.

1. **List**: "ยังไม่จบ (n)" by `startOn` desc ("กำลังใช้" on events whose dates hold today),
   "จบแล้ว (n)" folded; each row: icon, name, dates, expense, row count. "เพิ่มอีเวนต์" below.
2. **Event page**: expense large, income and net under it, row count and wallets; "จบทริป" /
   "เปิดอีกครั้ง" and "เพิ่มรายการ" (the transaction form with this event); by category
   (expense) with bars; rows by day as on the Transactions tab (tap = edit). ✎ opens the sheet.
3. **Event sheet**: name + icon/colour, start (today by default), end (optional, clearable);
   on edit a delete button in the header (rule 7).
4. **Transaction form**: an "อีเวนต์" row under the date (rule 5), × clears it; transfer and debt
   sheets have none. Rows with an event show a small tag with its name in the Transactions tab.

## Volume

Event totals for the list are **one** `GROUP BY event_id` query over the profile's events; the
event page reads its rows through the `event_id` index and draws them 100 at a time
("แสดงเพิ่ม"). **Checked in #14** with 20,000 rows over 3 years, 600 of them in one event
(Playwright, `npm run build`): the first pull ≈ 3.4 s, the events page ≈ 0.14 s, the event page
≈ 0.15 s, the next 100 rows ≈ 0.26 s, the form with its default event ≈ 0.16 s, a save shown in
the event's totals ≈ 0.22 s.

## Interactions

Transactions (`eventId`), profiles (sweep), the sync sheet (table name, fix route). Reports,
transfers, debts and recurring rules don't read it.
