# Report

> Status: **Spec** (#10). Q1–Q7 and the extras settled by the owner (round 1 of the mock-up
> `docs/features/mockups/report.html`); the summary card's layout is still open (S1–S3). No API change is planned: everything is
> computed on the device from the local database.

## Purpose

The Reports tab answers "where did the money go?" for a period: how much came in and went out,
which categories took it, and how this period compares with the ones before. It reads the same
transactions as the Transactions tab and never stores a total (ROADMAP → Money & data).

## Out of scope

- Budgets and their progress (#11), events / trips (#14), search, filters and CSV export (#15).
- Converting between currencies (ROADMAP → Backlog "FX / multi-currency reports"): every figure
  is in one currency at a time.
- Shared wallets seen as a member (#16): the report covers the signed-in user's own wallets.
- A report by wallet or by note / payee, and charts of balances over time (later, if asked).

## Data model

No table of its own and no new column. A report reads, for the current profile:

- `transactions` (live, `excludeFromReport = 0`) joined to `categories` (`type`, `parentId`,
  name, icon, colour; archived ones included) and `wallets` (`currencyCode`);
- `transfers` only for ยอดเริ่มต้น / ยอดสุดท้าย (rule 10), never for income or expense
  (transfer rule 5).

## Business rules

1. **What counts** is transaction rule 11: income = Σ amount of income-type rows, expense =
   Σ amount of expense-type rows, net = income − expense, over the chosen period and wallets.
   `excludeFromReport` rows and **transfers are left out** (transfer rule 5). Archived wallets
   and categories still count (wallet rule 6, category rule 7); categories hidden in a wallet
   too (hiding is for the picker only).
2. **Wallets**: "ทุกกระเป๋า" = the profile's wallets without `excludeFromTotal`, archived ones
   included (transaction rule 11); one wallet can be chosen instead, an excluded one included.
3. **One currency at a time**: every figure, chart and percentage is in one currency, never
   added across currencies (ROADMAP → Money & data). See Q6 for how a view with several is
   shown.
4. **By category**: a **top-level category's total includes its sub-categories'**
   (transaction.md → Interactions). The breakdown lists top-level categories of one type
   (รายจ่าย or รายรับ), largest first, each with its amount and its **share** of the type's
   total for the period (shares are rounded for display; the amounts are exact).
5. **Recorded on the parent itself**: a transaction may be saved on a top-level category that
   has children. In the parent's breakdown that money is its own row (Q4: "ไม่ระบุหมวดย่อย"),
   so the children's rows plus that row always add up to the parent's total.
6. **A category with nothing in the period** isn't listed. A merged category (7.3) is a
   tombstone whose transactions already moved to its target, so it never appears; its money
   shows under the target.
7. **Trend**: income and expense per period for the chosen period and the ones before it
   (Q2), same wallets and currency, so month-to-month change is visible.
8. **Periods and dates** are the Transactions tab's (`period.ts`): weeks start on Monday,
   ค.ศ. in both languages, `occurredOn` is a calendar date with no time of day.
9. **Balances** (E1): **ยอดเริ่มต้น** / Starting balance = the wallets in view's balance
   (transaction rule 12, transfers and `excludeFromReport` rows included) at the end of the day
   before the period, **ยอดสุดท้าย** / Ending balance = at the end of its last day. So ยอดสุดท้าย
   − ยอดเริ่มต้น = net + the view's transfer net + the `excludeFromReport` rows' signed sum. On
   "ทุกกระเป๋า" it's the wallets of rule 2 (archived ones too, unlike ยอดรวม). Not shown for
   "ทั้งหมด"-like ranges with no start (a custom range always has both dates).
10. **Average expense per day** (E3) = expense ÷ the period's days; for the current period, the
    days up to today. Shown for periods of more than one day.
11. **Left out** (E5): when the period has `excludeFromReport` rows, a line "ไม่รวมในรายงาน n
    รายการ" with their signed sum opens a page listing them, so a low total is explained.
12. **Previous period** (E4): a category page shows the same category's amount in the period
    before (same unit, same wallets). The summary has **no** "% against the previous period"
    (E2, declined by the owner).
13. Nothing in this tab writes, except through the transaction sheet a row opens (its own rules
    apply). Works the same offline; an untrusted device reads what it has pulled.

## Volume

Up to tens of thousands of rows (transaction.md → Volume). Every figure is **one aggregate
query** through the (`profile_id`, `occurred_on`) index, never a scan of every row into memory:

- summary: the existing `TransactionService.summary` (`GROUP BY currency, type`);
- by category: `GROUP BY` the top-level id (`coalesce(c.parent_id, c.id)`), type and currency;
  a parent's breakdown groups by `category_id` within that parent;
- trend: `GROUP BY` the period key (`substr(occurred_on, 1, 7)` for months, …) over the
  covered span, for both types at once;
- a drill-down list is the period's rows of those categories, drawn 100 at a time like the
  Transactions tab.

To be measured with **20,000 rows** over 3 years on `npm run build` (switching period, opening
the tab, a drill-down), as in 8.1, and the Transactions tab measured again after #9.

## Endpoints

None. The tab reads the local database only.

## Web screens

Proposal, to be confirmed with the mock-up (Open questions):

- **Reports tab** (`features/reports`, lazy):
  - header like the Transactions tab: profile icon left, the **wallet switcher** in the centre,
    sync icon and **⋮** right (⋮: "ดูตาม · เดือน ›" → month / quarter / year / custom, Q2);
  - the **period chips** under it (`09/2026 · เดือนที่แล้ว · เดือนนี้`), a sideways swipe moves
    period;
  - **summary card** (layout open: S1–S3 in the mock-up): ยอดเริ่มต้น, รายรับ, รายจ่าย,
    สุทธิ, ยอดสุดท้าย (rules 9–11), the average expense per day and "ไม่รวมในรายงาน n
    รายการ" (one card per currency, Q6);
  - **trend card**: income and expense bars for the last periods (Q2), the chosen one
    highlighted; tapping a bar chooses that period;
  - **by category card**: รายจ่าย / รายรับ tabs, a chart (Q1), then one row per top-level
    category: badge, name, share, amount; a row opens the category's page.
- **Category page** (`/reports/category/:id`, ‹ back to the tab, same period and wallets):
  - the category's total, its share and the previous period's amount (rule 12); for a parent, one row per sub-category plus
    "ไม่ระบุหมวดย่อย" (rule 5); a sub-category row opens its own page;
  - then **every transaction of the category in the period** (a parent: its children's and
    its own), in day cards like the Transactions tab; a row opens the transaction sheet (edit,
    delete with undo).
- Empty period: `app-empty-state` "ยังไม่มีธุรกรรมในช่วงนี้" with "เพิ่มธุรกรรม".

Glossary: รายงาน / Report, รายรับ / รายจ่าย, สุทธิ / Net, หมวดหมู่หลัก / ย่อย (DESIGN.md §11).

## Interactions

- **Transaction**: the source of every figure (rule 1); its sheet edits rows from a drill-down.
- **Category**: type, parent and colour decide the grouping and the badges.
- **Wallet**: currency and `excludeFromTotal` decide which rows count (rules 2–3).
- **Transfer**: never income or expense (transfer rule 5).
- **Budget** (#11) will reuse the by-category aggregate.

## Open questions

**Settled at the start of #10** (owner, round 1 of the mock-up):

- **Q1** by category = **B**: a thin bar split by category over a ranked list (top-level
  categories, largest first), each row with a bar of its share in the category's colour; the
  badge + name carry identity (user colours may repeat). Charts are **our own SVG**, no chart
  library.
- **Q2** period: month (default), quarter, year, custom, with the Transactions tab's chips and
  ⋮ "ดูตาม"; its own choice, remembered per profile. Trend: the last 6 months, 4 quarters or 5
  years ending at the chosen one; a tap on a bar chooses that period; no trend for custom.
- **Q3** wallet: the same switcher and the **same chosen wallet** as the Transactions tab.
- **Q4** money on a parent itself: a row **"ไม่ระบุหมวดย่อย"** / "No sub-category" with the
  parent's badge, among the children by amount, only when not zero; it opens those rows only.
- **Q5** drill-down: a **page in the tab** (‹ back); parent → sub-categories + all its
  transactions; sub-category → its transactions; a row → the transaction sheet.
- **Q6** currencies: one summary card per currency; the trend and breakdown one currency at a
  time with currency chips shown only when the view has more than one.
- **Q7** no API: computed on the device.
- **Extras**: E1 balances (labels **ยอดเริ่มต้น / ยอดสุดท้าย**, owner's wording, not
  ต้นงวด / ปลายงวด), E3 average per day, E4 the previous period on a category page, E5 the
  "ไม่รวมในรายงาน" line. **Not** E2 (% against the previous period).

**Open**: the summary card's layout (mock-up round 2): **S1** a statement that adds up top to
bottom (ยอดเริ่มต้น, รายรับ, รายจ่าย, สุทธิ, then โอนเงิน and ไม่รวมในรายงาน when not zero,
ยอดสุดท้าย; the average per day under it), **S2** the balances on a card of their own above the
income / expense card, **S3** the net as the headline with paired tiles. Proposal: **S1**.
