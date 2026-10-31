# Category

> Status: Spec — not built yet. Code will live in `src/features/category/`.

## Purpose

Categories classify each transaction as income or expense ("อาหาร", "เงินเดือน", …), with one level
of sub-categories ("อาหาร → กาแฟ"), the way Money Lover does. Reports and budgets group by them.

## Out of scope

- More than two levels.
- Debt/loan categories. Debt (#13) gets its own types when it's built.
- Global or shared categories. Each user owns their copy, so editing one never affects anyone else.

## Data model

`src/core/database/schema/category.ts`

- **categories** — `id`, `userId`, `profileId` (FK profiles; each profile has its own set,
  [profile.md](profile.md)), `type` (`income` | `expense`), `parentId?` (FK categories),
  `name`, `icon`, `color`, `isArchived` (default `false`), `sortOrder`, plus the sync columns
  (`createdAt`, `updatedAt`, `deletedAt?`, `changeSeq`, `updatedBy`; see
  [offline-sync.md](offline-sync.md)).

Names live in the DB because users edit them, unlike tripsurance's i18n-keyed master data. The
default set is seeded in Thai.

## Business rules

1. Every query is scoped to the signed-in user (another user's id → `404`).
2. `name` is 1–40 chars after trimming, and unique among siblings (same user, `type`, `parentId`;
   case-insensitive).
3. **One level only**: a category with a `parentId` can't be a parent itself.
4. A child's `type` always equals its parent's `type`. Changing the parent's type is refused when it
   has children or transactions.
5. A category with transactions can't be deleted, only **archived**. Archived categories are hidden
   from pickers but still shown in history and reports. One with no transactions (and no children)
   can be deleted.
6. Archiving a parent archives its children too.
7. Moving a category under another parent is allowed (same type, rule 3 holds). Its transactions
   move with it.
8. **Default set**: seeded once when the user is created, in Thai, with icons. Proposed:
   - Expense: อาหารและเครื่องดื่ม (กาแฟ, ร้านอาหาร), การเดินทาง (น้ำมัน, ขนส่งสาธารณะ, แท็กซี่),
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
- **Manage categories** (Account tab): list, add, edit, archive, reorder.

## Interactions

- Transaction requires `categoryId`. The category's `type` decides whether the amount counts as
  income or expense.
- Reports and budgets group by category. A parent's total includes its children.
