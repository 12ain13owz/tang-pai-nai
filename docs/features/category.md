# Category

> Status: Spec — not built yet. Code will live in `src/features/category/`.

## Purpose

Categories classify each transaction as income or expense ("อาหาร", "เงินเดือน", …), with one level
of sub-categories ("อาหารและเครื่องดื่ม → ร้านอาหาร, คาเฟ่"), the way Money Lover does. Each
profile has its own set, starting from a template the user can then add to, edit, merge and
delete. Reports and budgets group by them.

## Out of scope

- More than two levels.
- Debt/loan categories. There are only two types, **income and expense** (decided with the owner
  before #6). Money Lover's third type, "Debt / Loan", is for money that leaves or enters a wallet
  without being spending or earning: lending a friend ฿1,000 (not an expense, you expect it back),
  borrowing from family, and the repayments. That becomes its own feature, Debt / loan (#13),
  rather than a category type.
- Global or shared categories. Each user owns their copy, so editing one never affects anyone else.

## Data model

`src/core/database/schema/category.ts`

- **categories** — `id`, `userId`, `profileId` (FK profiles; each profile has its own set,
  [profile.md](profile.md)), `type` (`income` | `expense`), `parentId?` (FK categories),
  `name`, `icon`, `color`, `isArchived` (default `false`), `sortOrder`, plus the sync columns
  (`createdAt`, `updatedAt`, `deletedAt?`, `changeSeq`, `updatedBy`; see
  [offline-sync.md](offline-sync.md)).

Names live in the DB because users edit them, unlike tripsurance's i18n-keyed master data. The
template is written in Thai (rule 8).

## Business rules

1. Every query is scoped to the signed-in user and the current profile (anything else → `404`).
2. `name` is 1–40 chars after trimming, and unique among siblings (same profile, `type`,
   `parentId`; case-insensitive). So the same name may exist once as income and once as expense
   (a "ครอบครัว" expense main and a "ครอบครัว" income main), but never twice in the same type.
3. **One level only**: a category with a `parentId` can't be a parent itself.
4. A child's `type` always equals its parent's `type`. Changing the parent's type is refused when it
   has children or transactions.
5. Deleting (decided with the owner before #6):
   - **A sub-category** is removed by **merging into its main**: its transactions move to the main
     category, then the sub is deleted. Say how many move ("ย้าย 12 รายการไปที่ อาหารและเครื่องดื่ม").
   - **A main category with no transactions** (its subs included) is deleted after a confirm.
   - **A main category with transactions** warns with the count ("มี 37 รายการในหมวดนี้และหมวด
     ย่อย") and suggests **merging into another main of the same type**: its transactions and its
     subs move there, then it's deleted. The user may also cancel. It's never deleted with its
     transactions still pointing at it.
   - **Archive** stays available to hide a category from pickers without moving anything; archived
     ones still show in history and reports.
   - A merge is one local write (every moved transaction and the delete), so it syncs as one set
     of ops.
6. Archiving a parent archives its children too.
7. Moving a category under another parent is allowed (same type, rule 3 holds). Its transactions
   move with it.
8. **Template**: written once when a **profile is created**, by the device creating it, in Thai,
   with icons ([profile.md](profile.md) rule 5). The user can add, rename, re-icon, merge and
   delete from there. Proposed:
   - Expense: อาหารและเครื่องดื่ม (ร้านอาหาร, คาเฟ่), การเดินทาง (น้ำมัน, ขนส่งสาธารณะ, แท็กซี่),
     ที่อยู่อาศัย (ค่าเช่า, ค่าน้ำ, ค่าไฟ, อินเทอร์เน็ต), ช้อปปิ้ง, บันเทิง, สุขภาพ, การศึกษา,
     ครอบครัว, ของขวัญและบริจาค, ประกัน, ท่องเที่ยว, อื่นๆ
   - Income: เงินเดือน, โบนัส, ดอกเบี้ยและเงินปันผล, ขายของ, ได้รับเงิน, อื่นๆ

## Endpoints

| Method | Path                | Auth   | What                                                  |
| ------ | ------------------- | ------ | ----------------------------------------------------- |
| GET    | `/categories`       | Bearer | Tree (parents with `children`); `?type=` `?archived=` |
| POST   | `/categories`       | Bearer | Create                                                |
| PATCH  | `/categories/:id`   | Bearer | Update name/icon/color/parent/archived/sortOrder      |
| DELETE | `/categories/:id`   | Bearer | Delete (no transactions/children, else 409)           |
| PUT    | `/categories/order` | Bearer | Reorder siblings: `{ parentId, ids: [...] }`          |

## Web screens

- **Category picker** (bottom sheet, used by the transaction form): tabs for รายจ่าย / รายรับ, a
  grid of icons with parents and their children inline, plus search.
- **Manage categories** (Account tab): list by type, add a main or a sub, edit, merge, delete
  (with the counts above), archive, reorder.

## Interactions

- Transaction requires `categoryId`. The category's `type` decides whether the amount counts as
  income or expense.
- Reports and budgets group by category. A parent's total includes its children.
