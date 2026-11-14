# Report

> Status: **Built** (#10), web only: every figure is computed on the device from the local
> database, no API change. Web: `core/report` (`ReportService`), `features/reports` (the tab,
> `/reports/category/:id[/:sub]`, `/reports/excluded`), the Transactions header in its
> `reports` view. Mock-up: `docs/features/mockups/report.html` (three rounds).

## Purpose

The Reports tab answers "where did the money go?" for a period: how much came in and went out,
which categories took it, and how this period compares with the ones before. It reads the same
transactions as the Transactions tab and never stores a total (ROADMAP → Money & data).

## Out of scope

- Budgets (in the backlog since #10), events / trips (#14), CSV export (#15, [export.md](export.md); search and filters were dropped).
- Converting between currencies (ROADMAP → Backlog "FX / multi-currency reports"): every figure
  is in one currency at a time.
- Shared wallets seen as a member (#16): the report covers the signed-in user's own wallets.
- A report by wallet or by note / payee, and charts of balances over time (later, if asked).

## Data model

No table of its own and no new column. A report reads, for the current profile:

- `transactions` (live, `excludeFromReport = 0`) joined to `categories` (`type`, `parentId`,
  name, icon, colour; archived ones included) and `wallets` (`currencyCode`);
- `transfers` only for ยอดเริ่มต้น / ยอดสุดท้าย (rule 9), never for income or expense
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
7. **Trend** (owner, 2026-11, replacing "the chosen period and the ones before it"): the
   chosen period **split into its months**, income and expense per part, same wallets and
   currency, so nothing on the tab comes from outside the chosen period. A quarter is 3
   months, a year 12; a custom range is split by month up to 12 months, by quarter up to 36,
   else by year, the first and last part cut to the range. A period inside one month (the
   month unit, a short custom range) has **no trend**.
8. **Periods and dates** are the Transactions tab's (`period.ts`): weeks start on Monday,
   ค.ศ. in both languages, `occurredOn` is a calendar date with no time of day.
9. **Balances** (E1): **ยอดเริ่มต้น** / Starting balance = the wallets in view's balance
   (transaction rule 12, transfers and `excludeFromReport` rows included) at the end of the day
   before the period, **ยอดสุดท้าย** / Ending balance = at the end of its last day. So ยอดสุดท้าย
   − ยอดเริ่มต้น = net + the view's transfer net + the `excludeFromReport` rows' signed sum. On
   "ทุกกระเป๋า" it's the wallets of rule 2 (archived ones too, unlike ยอดรวม). Every report
   unit has both ends (there is no "ทั้งหมด"; a custom range always has both dates).
10. **Average expense per day** (E3) = expense ÷ the period's days, rounded half up to the
    minor unit; for the current period, the days up to today. Shown for periods of more than
    one day with some expense.
11. **Left out** (E5): when the period has `excludeFromReport` rows, a line "ไม่รวมในรายงาน n
    รายการ" with their signed sum opens a page listing them, so a low total is explained.
12. **Previous period** (E4): a category page shows the same category's amount in the period
    before (same unit and length, same wallets), named by its dates ("เทียบกับ ก.ย. 2026:
    1,135.00"), since "เดือนที่แล้ว" would clash with the chip of that name. The summary has
    **no** "% against the previous period" (E2, declined by the owner).
13. **A category page lists the rows it counts** (not `excludeFromReport` ones, which have
    their own page, rule 11), in the chosen currency, so its list adds up to its total.
14. **Empty**: the tab shows the empty state only when the period has no income, expense,
    left-out row or transfer in view; a wallet with only transfers (savings) still gets its
    summary, since its balances moved.
15. Nothing in this tab writes, except through the transaction sheet a row opens (its own rules
    apply). Works the same offline, on what the device has pulled.

## Volume

Up to tens of thousands of rows (transaction.md → Volume). Every figure is **one aggregate
query** through the (`profile_id`, `occurred_on`) index, never a scan of every row into memory:

- summary: the existing `TransactionService.summary` (`GROUP BY currency, type`) plus one
  aggregate for the left-out rows and one per balance (`UNION ALL` of the transactions and both
  sides of transfers up to a day, `GROUP BY` currency);
- by category: `GROUP BY` the top-level id (`coalesce(c.parent_id, c.id)`) of one type and
  currency; a parent's split groups by `category_id` within it;
- trend: one aggregate over the covered span, each row put in its period by a `CASE` on
  `occurred_on` (any unit), `GROUP BY` period and type;
- a drill-down list is `TransactionService.list` with a filter (categories, counted or left
  out, currency), drawn 100 rows at a time like the Transactions tab.

**Checked in #10** with 20,000 rows over 3 years (Playwright, `npm run build`): the first pull
≈ 3.4 s, opening the tab ≈ 0.12 s, switching month or year 0.09–0.15 s, a whole year of one
category (3,283 rows) ≈ 0.28 s, back to the tab ≈ 0.06 s. The Transactions tab measured again
after #9: switching month ≈ 0.10 s, "ทั้งหมด" ≈ 0.47 s, the next 100 rows ≈ 0.08 s.

## Endpoints

None. The tab reads the local database only.

## Web screens

Owner's choices in #10 (mock-up rounds 1–3; DESIGN.md → Reports):

- **Reports tab** (`features/reports`, lazy):
  - header: the Transactions tab's (profile icon, the **wallet switcher** in the centre, sync
    icon, ⋮), the same chosen wallet (Q3); its ⋮ holds only "ดูตาม · เดือน ›" → เดือน / ไตรมาส /
    ปี / กำหนดเอง… (Q2), its own choice kept per profile on the device; custom opens the
    tab's own range sheet;
  - the **period chips** (`09/2026 · เดือนที่แล้ว · เดือนนี้`, no "อนาคต"), a sideways swipe
    moves period;
  - the **summary card** (H1, reordered by the owner in 2026-11: what came in and went out is
    what a report is read for, one per currency): the period's name, รายรับ / รายจ่าย as
    the headline in tiles tinted with the money colours (↙ / ↗ beside the word), then
    "สุทธิ" on one line, ยอดเริ่มต้น → ยอดสุดท้าย on one line, then small chips only when they
    say something: "เฉลี่ยรายจ่าย 755.84/วัน", "โอนเงิน −5,000.00", "ไม่รวมในรายงาน 2 รายการ
    −1,500.00 ›" (a link to its page);
  - **currency chips** below the summary, above the breakdown and trend, only when the view
    has more than one currency (Q6);
  - the **by category card** (Q1-B), right under the summary (what the money went on comes
    second): รายจ่าย / รายรับ tabs, "ตามหมวดหมู่" with the type's total, a thin bar split by
    category, then the top-level categories largest first: badge, name, amount, a bar of its
    size in its colour, the share, and "2 หมวดย่อย" / "เก็บถาวร"; a row opens the category
    page;
  - the **trend card** last, only for a period longer than a month (rule 7): "รายเดือน"
    (รายไตรมาส, รายปี for a long custom range), a pair of bars per part, a compact scale
    (`50K`); tapping a pair **shows its figures** above the bars ("มี.ค. 2026 · รายรับ … ·
    รายจ่าย …", that pair full strength and outlined, the others faded) and never changes
    the chosen period; tapping it again clears it. Each pair is a button naming its part and
    both amounts;
  - an empty period: `app-empty-state` "ยังไม่มีธุรกรรมในช่วงนี้" with "เพิ่มธุรกรรม" (rule 14).
- **Category page** (`/reports/category/:id`, the header ‹ and the category's name; same
  period, wallet and currency; the chips and swipe work here too):
  - a card: the badge, the total in the type's colour, "89.7% ของรายจ่าย · ต.ค. 2026", "เทียบกับ
    ก.ย. 2026: 400.00" (rule 12);
  - for a parent with sub-categories: "หมวดหมู่ย่อย" as the same split list, with
    "ไม่ระบุหมวดย่อย · บันทึกที่หมวดหลักโดยตรง" for its own money (Q4);
  - "ธุรกรรม n รายการ" and the day cards of the Transactions tab (rule 13); a row opens the
    transaction sheet.
- **Sub-category / "ไม่ระบุหมวดย่อย" page** (`/reports/category/:id/:sub`, `sub` = a child's id
  or `direct`): "อาหาร › กาแฟ" over the total, the share of the parent, the rows; ‹ goes back
  to the parent's page. The header reads "อาหาร · ไม่ระบุหมวดย่อย" for `direct`.
- **Left out page** (`/reports/excluded`, "ไม่รวมในรายงาน"): one line on what the switch does,
  then the period's left-out rows in day cards.

Glossary: รายงาน / Report, รายรับ / รายจ่าย, สุทธิ / Net, ยอดเริ่มต้น / ยอดสุดท้าย (Starting /
Ending balance), หมวดหมู่หลัก / ย่อย (DESIGN.md §11).

## Interactions

- **Transaction**: the source of every figure (rule 1); its sheet edits rows from a drill-down.
- **Category**: type, parent and colour decide the grouping and the badges.
- **Wallet**: currency and `excludeFromTotal` decide which rows count (rules 2–3).
- **Transfer**: never income or expense (transfer rule 5).
- **Budget** (backlog) would reuse the by-category aggregate.

## Open questions

**Settled at the start of #10** (owner, round 1 of the mock-up):

- **Q1** by category = **B**: a thin bar split by category over a ranked list (top-level
  categories, largest first), each row with a bar of its share in the category's colour; the
  badge + name carry identity (user colours may repeat). Charts are **our own SVG**, no chart
  library.
- **Q2** period: month (default), quarter, year, custom, with the Transactions tab's chips and
  ⋮ "ดูตาม"; its own choice, remembered per profile. Trend: ~~the last 6 months, 4 quarters or
  5 years ending at the chosen one; a tap on a bar chooses that period~~ (changed by the owner
  in 2026-11: data from outside the chosen period confused the month view, and a tap that
  moved the period shifted the bars under the finger): the chosen period's own months, none
  for a month; a tap shows a bar's figures (rule 7).
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

**Summary card**: round 2 (S1 a statement that adds up, S2 the balances on
their own card, S3 the net as the headline with paired tiles): the owner liked S3's look but
not its finish, and found S1 clear but long. Round 3 combines them: **H1** S3's headline and
tinted income / expense tiles, the balances as one line (ยอดเริ่มต้น → ยอดสุดท้าย), and small
chips for the average per day, โอนเงิน and ไม่รวมในรายงาน (only when not zero); **H2** the same
head with a "ยอดเงิน 61,200 → 71,250" row that unfolds S1's statement in place. The owner
chose **H1**.

**Decided while building** (owner, from the Playwright screenshots): the previous period is
named by its dates (rule 12); a wallet with only transfers shows its summary, not the empty
state (rule 14); a category page lists only counted rows (rule 13); every category is listed,
no "อื่น ๆ" fold; the report pages keep the chips; the average per day of the current period
counts up to today.

**Known**: several currencies are built (chips, one card per currency) but only seen in
specs, since only THB is active.
