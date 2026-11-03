# Report

> Status: **Spec** (#10), waiting on the owner's choices in [Open questions](#open-questions)
> and the mock-up `docs/features/mockups/report.html`. No API change is planned: everything is
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
- `transfers` only for the opening / closing balance (if E1 is chosen), never for income or
  expense (transfer rule 5).

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
9. Nothing in this tab writes, except through the transaction sheet a row opens (its own rules
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
  - **summary card**: รายรับ, รายจ่าย, สุทธิ (signed, one card per currency, Q6), with the
    extras chosen in E1–E3;
  - **trend card**: income and expense bars for the last periods (Q2), the chosen one
    highlighted; tapping a bar chooses that period;
  - **by category card**: รายจ่าย / รายรับ tabs, a chart (Q1), then one row per top-level
    category: badge, name, share, amount; a row opens the category's page.
- **Category page** (`/reports/category/:id`, ‹ back to the tab, same period and wallets):
  - the category's total and share; for a parent, one row per sub-category plus
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

For the owner, each with a proposal (mock-up `docs/features/mockups/report.html`):

- **Q1 Chart form for "by category".** A: a donut with the categories' colours + the list
  (Money Lover). B: a thin bar split by category over a **ranked list** whose rows each have a
  bar of their share (bars on one baseline compare more exactly than slices; user colours may
  repeat, and the list's badge + name carries identity either way). C: the list only.
  **Proposal: B.**
- **Chart library.** Proposal: **draw SVG ourselves** (a few small components, ~0 kB of
  dependency, themes and dark mode through our tokens). Chart.js is ~70 kB gzip, ECharts far
  more; the tab is lazy, so neither touches the initial bundle, but both are more code than the
  three simple charts need.
- **Q2 Period.** Proposal: the Transactions tab's units **month (default), quarter, year,
  custom** with the same chips and ⋮ "ดูตาม"; no day / week / all (too short or too long to
  compare). Its own choice, remembered per profile (not shared with the Transactions tab). The
  trend shows the last **6 months**, **4 quarters** or **5 years** ending at the chosen one; a
  custom range has no trend card.
- **Q3 Wallet.** Proposal: the same wallet switcher and the **same chosen wallet as the
  Transactions tab** (one "which wallet am I looking at" for the app), while the period stays
  per tab.
- **Q4 Money on the parent itself.** Proposal: a row with the parent's badge named
  **"ไม่ระบุหมวดย่อย"** / "No sub-category", listed among the children by its amount; tapping
  it lists only those rows. Shown only when it isn't zero.
- **Q5 Drill-down.** Proposal: a **page inside the tab** (‹ back), not a sheet (sheets are for
  create / edit / pick, DESIGN.md §6): parent → sub-categories + all its transactions; a
  sub-category → its transactions; a transaction → the transaction sheet.
- **Q6 Several currencies** (only THB today). Proposal: the summary shows one card per
  currency (as the Transactions tab); the trend and breakdown show **one currency**, with a
  currency switch (chips) that appears only when the view has more than one. Built but unseen
  until a second currency is switched on.
- **Q7 API.** Proposal: **none**, computed on the device (rule 9, Volume).
- **Extras** (pick any):
  - **E1** ยอดต้นงวด / ยอดปลายงวด (opening / closing balance of the wallets in view, transfers
    included), as Money Lover's report shows.
  - **E2** change against the previous period under รายรับ / รายจ่าย ("+12% จากเดือนที่แล้ว").
  - **E3** average expense per day of the period (to today for the current one).
  - **E4** on a category page, the same category's amount in the previous period.
  - **E5** a muted line "ไม่รวมในรายงาน n รายการ" when the period has such rows, so a total
    that looks low is explained.
