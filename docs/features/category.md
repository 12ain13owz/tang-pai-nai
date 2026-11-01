# Category

> Status: Spec, revised at the start of #7 (one set per profile, the default set written with the
> profile, a wallet can hide categories). Built in two parts (decided at the start of #7): **7.1**
> categories, the default set and the manage screen; **7.2** hiding categories per wallet (rule
> 13). API: `api/src/features/category/` (sync handler only). Web: `core/category`
> (`CategoryService`), `layout/category-sheet`, `features/account/pages/categories-page`.

## Purpose

Categories classify each transaction as income or expense ("อาหาร", "เงินเดือน", …), with one level
of sub-categories ("อาหาร → กาแฟ"), the way Money Lover does. Reports and budgets group by them.
Each **profile** ([profile.md](profile.md)) has its own set, so "ร้านกาแฟ" and "ส่วนตัว" never mix
their categories.

## Out of scope

- More than two levels.
- Debt/loan categories. Debt (#13) gets its own types when it's built.
- Global or shared categories. Each profile owns its copy, so editing one never affects another
  profile or user. Categories of a wallet shared with you (#16): backlog.
- The category picker in the transaction form (#8), and every "has transactions" rule (rule 6,
  rule 5's type change), which become real with #8.

## Data model

`api/src/core/database/schema/category.ts`

- **categories** (synced, like `wallets`): `id` (UUIDv7 from the device), `userId` (the owner),
  `profileId` (FK profiles, cascade), `type` (`income` | `expense`), `parentId?` (FK categories,
  cascade; null for a top-level category), `name`, `icon` (rule 9), `color` (`#rrggbb`),
  `isArchived` (default `false`), `sortOrder`, plus the sync columns (`createdAt`, `updatedAt`,
  `deletedAt?`, `changeSeq`, `updatedBy`; see [offline-sync.md](offline-sync.md)). Indexes
  (`userId`, `changeSeq`), (`changeSeq`), (`profileId`), (`parentId`).
- The device keeps `categories` (snake_case, a new local schema step + `SYNC_TABLES` entry) and
  lists it in `PROFILE_CHILD_TABLES` (`core/profile`).
- **Hidden per wallet** (7.2, decided at the start of #7): a column on wallets,
  `wallets.hiddenCategoryIds` (a JSON array of category ids, default `[]`), not a table of its own:
  it travels with the wallet row and needs no handler (rule 13).

Names live in the DB because users edit them. The default set is written in the language the app
shows when the profile is created (rule 8).

## Business rules

1. Categories are synced own data, scoped to the owner (another user's id is `ID_TAKEN` on push,
   never visible on pull). There is no REST endpoint; the web app writes them locally and they
   travel through `/sync/push` and `/sync/pull`. **Profile**: `profileId` must be one of the
   owner's live profiles when the category is created or edited (server check, `CONFLICT`), and a
   category never moves to another profile.
2. `name` is 1–40 characters after trimming, unique among its **non-archived siblings** (same
   profile, `type` and `parentId`; case-insensitive; server check, `CONFLICT`). The same name may
   sit under another parent ("อื่น ๆ" under several). An archived category holds no name, so
   unarchiving it into a clash is refused, as for wallets.
3. **One level only**: a category with a `parentId` can't be a parent. The parent must be a live,
   non-archived, top-level category of the same profile and `type` (server check, `CONFLICT`). A
   category with live children can't take a parent (server check).
4. A child's `type` always equals its parent's. A top-level category's `type` may change only
   while it has no live children (server check); from #8 also only while it has no transactions.
5. **Move**: a category may move under another parent of the same type, become a top-level one,
   or (with no children) go under a parent (rule 3 holds). From #8 its transactions move with it.
6. **Delete** is a tombstone after a confirm view, only for a category with **no live children**
   (the device enforces this: the server runs no check on a delete, offline-sync rule 10; the form
   says "ลบหมวดหมู่ย่อยก่อน" instead). From #8 a category with transactions can't be deleted, only
   archived. A device that pulls a parent's tombstone **tombstones its live children** it holds
   (a child another device added that the deleting device didn't know), like wallet rule 11.
7. **Archive** acts at once with undo in the toast. Archived categories are hidden from pickers but
   still shown in history and reports. Archiving a parent archives its children in the same write;
   unarchiving a parent unarchives its children. A child can't be unarchived while its parent is
   archived (server check: a non-archived child needs a non-archived parent, `CONFLICT`).
8. **Default set** (decided at the start of #6): written **by the device that creates the
   profile, in the same local write** as the profile, never seeded by the server, so two devices
   never seed one profile twice. Names in the app's language at that moment (decided at the start
   of #7; Thai below, English in the web's default-set file), each with an icon and colour:
   - Expense: อาหารและเครื่องดื่ม (กาแฟ, ร้านอาหาร), การเดินทาง (น้ำมัน, ขนส่งสาธารณะ, แท็กซี่),
     ที่อยู่อาศัย (ค่าเช่า, ค่าน้ำ, ค่าไฟ, อินเทอร์เน็ต), ช้อปปิ้ง, บันเทิง, สุขภาพ, การศึกษา,
     ครอบครัว, ของขวัญและบริจาค, ประกัน, ท่องเที่ยว, อื่น ๆ
   - Income: เงินเดือน, โบนัส, ดอกเบี้ยและเงินปันผล, ขายของ, ได้รับเงิน, อื่น ๆ

   Profiles made before #7 exist only in dev data and get the set from a one-off script in
   `api/scripts/` (Thai names, server writes with `changeSeq`).

9. **Icons** follow wallet rule 8: a curated lucide name or one of our `tpn` SVGs (lucide's
   style, no logos, no letter badges); the server checks only the shape
   (`^(lucide|tpn)[A-Z][A-Za-z0-9]*$`, ≤ 40 characters). The catalogue gains food and drink
   (bowl, buffet, coffee cup, …), transport, home and bills, shopping, health, learning, family,
   giving, insurance, travel and income groups, as `tpn` where lucide has no clear picture. A new
   category starts with a default icon (`lucideShapes`) and colour; a name the web doesn't know
   shows the default.
10. **Order**: `sortOrder` ascending, then `createdAt`, then `id`, among siblings (same profile,
    `type`, `parentId`). A new category goes last among its siblings. Reordering uses the order
    mode and grip handle of profiles (DESIGN.md §8): parents move with their children, a child
    moves only within its parent.
11. A profile holds at most **200 non-archived categories** (server check, `CONFLICT`; the web
    hides "add" at 200). Archiving frees a place.
12. **Profile delete** tombstones its categories in the same local write (profile rule 8, through
    `PROFILE_CHILD_TABLES`), and a device that pulls a profile's tombstone tombstones that
    profile's live categories it holds (wallet rule 11's sweep). The confirm counts wallets only.
    **A refused profile create** (e.g. a name clash with a profile another device made first)
    refuses its default categories and first wallet too: the sync sheet shows **one** item for
    the profile ("และหมวดหมู่ n รายการ"); fixing it re-queues the profile and its child rows in one
    write, discarding it discards them all (decided at the start of #7; applies to every
    `PROFILE_CHILD_TABLES` table).
13. **Hidden per wallet** (7.2): a wallet lists the categories it doesn't use in
    `hiddenCategoryIds`; the transaction form's picker (#8) leaves them out for that wallet. Ids
    the device doesn't know (deleted, another profile's) are ignored, so the server checks only
    the shape (an array of UUIDs, at most 200). Hiding a parent hides its children. Two devices
    editing the same wallet follow the usual later-edit-wins for the whole row.
14. An untrusted device can create, edit, archive and delete categories only while online
    (offline-sync rule 1), as for profiles.

## Endpoints

None of its own (decided at the start of #7, like profiles and wallets). Rows travel through the
sync endpoints as table `categories` (OpenAPI `SyncCategoryRow`):

| Method | Path         | Auth   | What                                            |
| ------ | ------------ | ------ | ----------------------------------------------- |
| GET    | `/sync/pull` | Bearer | `categories` rows with the other synced rows    |
| POST   | `/sync/push` | Bearer | upsert / delete ops on `categories` (rule 1–11) |

Online `GET`s for members of shared wallets arrive with #16 if needed.

## Web screens

Glossary: หมวดหมู่ / Category, หมวดหมู่ย่อย / Sub-category, รายจ่าย / รายรับ (DESIGN.md §11).

- **Account › หมวดหมู่** `/account/categories` (decided at the start of #7), a row under
  "โปรไฟล์": the current profile's categories. At the top, the current profile (icon + name),
  tapping it opens the profile switch sheet. Tabs รายจ่าย / รายรับ, then the list: parents (40px
  badge, name, "รอ sync" on a pending row) with their children indented under them, "เพิ่ม
  หมวดหมู่" (hidden at 200 with a line saying why), then a folded "เก็บถาวร (n)" group. Tap a row
  to edit it. "จัดลำดับ" switches to the order mode (rule 10).
- **Category form** (a compact sheet, DESIGN.md §6): row 1 the icon on its colour and the name;
  row 2 the type (รายจ่าย / รายรับ, segmented; read-only for a child, or for a parent with
  children); row 3 "หมวดหมู่หลัก" (none or a parent, opening a picker view in the same sheet with
  the type's top-level categories). The icon opens the "ไอคอนและสี" view (swatches, then the
  catalogue grouped by meaning). Save is the one button at the bottom. In edit mode the header
  holds **archive** (undo in the toast; coming back may be refused, rules 2 and 7) and **delete**
  (a confirm view; disabled with a line when it has children). "Fix" of a rejected op opens it
  (`FIX_ROUTES` → `/account/categories?fix=<opId>`). Asks before closing with unsaved input.
- **Category picker** (#8): in the transaction form, the current wallet's non-hidden,
  non-archived categories of the chosen type.
- **Wallet form** (7.2): a "หมวดหมู่ที่ใช้" row opening a view of the profile's categories with a
  switch each.

## Interactions

- **Profile**: `categories.profileId`; the default set comes with a new profile (rule 8); deleting
  a profile takes its categories (rule 12).
- **Wallet**: `wallets.hiddenCategoryIds` (7.2, rule 13).
- **Transaction (#8)** requires `categoryId`; the category's `type` decides whether the amount
  counts as income or expense. Reports and budgets group by category; a parent's total includes
  its children.

## Open questions

Settled at the start of #7 (owner): split into 7.1 / 7.2; the default set follows the app's
language at creation; manage screen at Account › หมวดหมู่ with the current profile at its top;
hiding per wallet is a `wallets` column; a refused profile create groups its child rows under one
sync-sheet item. Proposed with the revision (change on request): archived categories hold no
name (rule 2), 200 per profile (rule 11), a pulled parent tombstone takes its children (rule 6),
unarchiving a parent brings its children back (rule 7).
