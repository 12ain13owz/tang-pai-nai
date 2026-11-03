# Category

> Status: **Built** in #7: 7.1 (categories, the default set, Account › หมวดหมู่) and 7.2
> (hiding per wallet, rule 13, from the wallet form and the category form). Revised at the start
> of #7 (one set per profile, the default set written with the profile, a wallet can hide
> categories). API: `api/src/features/category/` (sync handler only), `wallets.hiddenCategoryIds`
> in `features/wallet`. Web: `core/category` (`CategoryService`),
> `core/profile/default-categories.ts`, `core/wallet/hidden-categories.ts`,
> `layout/category-sheet`, `layout/wallet-sheet`, `features/account/pages/categories-page`.
> #8.1 made rules 4 and 6's "has transactions" real (type: device + server check) and built the
> transaction form's picker; sub-categories show in their parent's tinted panel (DESIGN.md §6).
> **7.3 (merge, rule 15): spec, waiting for the owner's OK** (proposals marked in rule 15 and
> Open questions → 7.3).

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
- (Built in #8.1: the transaction form's picker and the "has transactions" rules.)

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
- **Merged into** (7.3, rule 15): `mergedIntoId?` (text, the category the row was merged into;
  no FK, so purging either row never cascades into the other). Only a tombstone carries it: a
  live row's is always null. Device: `merged_into_id`, an `ALTER TABLE` step.

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
   while it has no live children (server check), and only while it has no live transactions
   (server check, `CONFLICT`, since #8.1).
5. **Move**: a category may move under another parent of the same type, become a top-level one,
   or (with no children) go under a parent (rule 3 holds). From #8 its transactions move with it.
6. **Delete** is a tombstone after a confirm view, only for a category with **no live children**
   (the device enforces this: the server runs no check on a delete, offline-sync rule 10; the form
   says "ลบหมวดหมู่ย่อยก่อน" instead). A category with live transactions can't be deleted, only
   archived or **merged** (#8.1; the form says so and, from 7.3, offers the merge, rule 15). A
   pulled category tombstone takes its live transactions (transaction rule 10), unless it was
   merged: then they follow it (rule 15). A device that pulls a parent's tombstone **tombstones its live children** it holds
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
    profile's live categories it holds (wallet rule 11's sweep). The confirm says how many
    wallets and categories go with it (categories counted from 7.2, owner's request).
    **A refused profile create** (e.g. a name clash with a profile another device made first)
    refuses its default categories and first wallet too: the sync sheet shows **one** item for
    the profile ("และหมวดหมู่ n รายการ"); fixing it re-queues the profile and its child rows in one
    write, discarding it discards them all (decided at the start of #7; applies to every
    `PROFILE_CHILD_TABLES` table).
13. **Hidden per wallet** (7.2): a wallet lists the categories it doesn't use in
    `hiddenCategoryIds`; the transaction form's picker (#8) leaves them out for that wallet. Ids
    the device doesn't know (deleted, another profile's) are ignored, so the server checks only
    the shape (an array of UUIDs, at most 200; a push without the field means `[]`). Settled at
    the start of 7.2 (owner):
    - **Hiding a parent stores the parent's id only** and hides its children too, including
      children added later. While the parent is hidden its children's switches show off and
      can't be changed; a child's own id stays in the list as it was, so showing the parent
      again brings back what was hidden before.
    - An **archived** category's id stays in the list (unarchiving it keeps it hidden). Ids of
      categories the device knows are tombstones are dropped when the wallet is saved, and
      duplicates are dropped too.
    - A wallet **may hide every category of a type** (a credit card with no income); #8's picker
      then says so and points to the wallet's "หมวดหมู่ที่ใช้".
    - The row is in the wallet form when **creating and editing**.
    - **The category form chooses its wallets too** (decided while building 7.2, owner's idea):
      saving a category writes the profile's open wallets whose list changes (its own id added
      or removed) in the same local write.

    Two devices editing the same wallet follow the usual later-edit-wins for the whole row.

14. An untrusted device can create, edit, archive, delete and merge categories only while
    online (offline-sync rule 1), as for profiles.
15. **Merge** (7.3): move a category's transactions to another category, then delete it. It is
    the way to retire a category that has transactions (rule 6) without moving them one by one.
    - **Into any category of the same profile and `type`** (owner, at the start of 7.3, as in
      Money Lover: "อาหาร" with "ค่าข้าว" and "ค่าน้ำ": "ค่าน้ำ" may go into "ค่าข้าว" or into
      "อาหาร"), top-level or sub-category, **except itself and its own children** (they go
      with it). Income merges only with income, expense only with expense: a transaction's
      income / expense comes from its category's type, so another type would turn them over.
      The target is live and **non-archived**; the source may be archived (retiring an old
      archived one is the common case).
    - **A top-level source with live children**: the user picks what happens to them:
      - **Move the sub-categories** (default): each child goes under the target, or under the
        target's parent when the target is a sub-category (one level only, rule 3), last
        among the children there, in its current order, keeping its own transactions,
        archive state and hidden-per-wallet state. An open child whose name clashes with an
        open child there (rule 2) is **merged into that child** instead, and a child named
        like the target itself (a sub-category target) merges into the target. Archived
        children hold no name, so they always move.
      - **Merge everything**: every child is merged into the target too, so all the
        transactions land on the target itself.
    - **One local write, no undo**: the transactions move, the children move or are
      tombstoned, the merged ids leave every wallet's `hiddenCategoryIds` (rule 13; the target
      keeps its own state), and the source is tombstoned with `mergedIntoId` = the target (a
      merged child points at the category it went into). The form asks first in a confirm view
      ("ย้ายธุรกรรม n รายการไปที่ X", "เลิกทำไม่ได้"), like a profile or wallet delete
      (DESIGN.md §6).
    - **Who moves the transactions** (owner, at the start of 7.3): the **server**, and a merge
      **doesn't need the network**: the device merges locally and queues one op. A
      category tombstone that carries a `mergedIntoId` is applied in one database transaction
      with its follow-ups: every live transaction of the source moves to the target (each
      stamped with its own `changeSeq`, `updatedBy` = the user), and every live child still
      under a merged top-level source (one another device added, or one whose move was
      refused) is merged into the target the same way. So the merging device pushes only the
      category and wallet ops (a handful), not one op per transaction, and pulls the moved rows
      back. It still moves its own rows locally in the same write, so the screen is right at
      once. (The other way, one op per moved transaction, would push thousands of ops for a
      big category, 100 per request, and leave a gap for a row the merging device never saw.)
    - **Why `mergedIntoId` at all**: two devices of one user both offline is the only way a
      merge meets a row it didn't move (B adds a transaction to "ค่าน้ำ" while A merges it).
      Later-edit-wins (offline-sync rule 12) can't settle that, since they are different rows,
      and without it transaction rule 10 would delete B's row. With both devices online the
      other one pulls the merge within a sync round and this doesn't happen.
    - **Follow-ups only follow a valid target**: a live category of the same profile and type
      (if the target is itself a merged tombstone, follow its `mergedIntoId`, at most 5 hops).
      Otherwise the tombstone is a plain one (rule 6, transaction rule 10). Deletes still run
      no check (offline-sync rule 10): the server checks only the shape of `mergedIntoId` (a
      UUID or null).
    - **Late rows follow the merge**: a pushed **live
      transaction** whose `categoryId` is a merged tombstone is **moved to its target** by the
      server check instead of refused, and the push answers `applied` with the moved row, so
      the device shows it at once. A **category** pushed under a merged parent (a child added
      offline) is refused as today (`CONFLICT`, the parent is gone) and the user fixes it.
    - **Devices that pull a merged tombstone** move their local rows that still point at it
      (transactions to the target, children merged into the target) without new ops: the
      server did the same moves, and their rows arrive in the same pull. A row with a pending
      op keeps it (its push is redirected as above).
    - **Outbox order**: the children's moves (with `moveOpLast`, rule 3's parent first), then
      the wallets, then the tombstones (children merged into the target first, the source last).
    - Merging never adds an open category, so rule 11's limit doesn't apply. A rename of a
      child to dodge a clash isn't offered: the clash merges.

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
  holds **archive** (undo in the toast; coming back may be refused, rules 2 and 7), **merge**
  (7.3, rule 15) and **delete** (a confirm view; disabled with a line when it has children). "Fix" of a rejected op opens it
  (`FIX_ROUTES` → `/account/categories?fix=<opId>`). Asks before closing with unsaved input.
- **Category picker** (#8.1): in the transaction form, the chosen wallet's non-hidden,
  non-archived categories of the chosen type, children in their parent's tinted panel (the same
  panel in Account › หมวดหมู่ and the wallet's "หมวดหมู่ที่ใช้", owner's choice "3+4").
- **Wallet form** (7.2): a "หมวดหมู่ที่ใช้" row under "ไม่รวมในยอดรวม" (create and edit), drawn
  like "หมวดหมู่หลัก": the label left, "ทั้งหมด" or "ซ่อน n" right (n = the profile's open
  categories hidden here, children of a hidden parent included), a ›. It opens a view in the
  same sheet (‹ back, no bottom button, no explanation line): tabs รายจ่าย / รายรับ, then the
  wallet's profile's open categories, parents with their children indented, a switch each (on =
  used; a child of a hidden parent shows off, locked, "ซ่อนตามหมวดหมู่หลัก"). The choice is part
  of the form, saved with its one button.
- **Merge** (7.3, rule 15; mock-up: [mockups/category-merge.html](mockups/category-merge.html)): a header icon
  (`lucideMerge`, "ผสานหมวดหมู่") between archive and delete, in edit mode only, disabled when
  there is no possible target. The delete-disabled line of a category with transactions
  becomes "หมวดหมู่นี้มีธุรกรรม n รายการ จึงลบไม่ได้ ผสานเข้าหมวดหมู่อื่นแทนได้" with a
  "ผสาน" link that opens the same view. Views in the same sheet:
  - `merge` ("ผสานเข้ากับ", ‹ back, no bottom button): the type's open top-level categories
    with their open children in the tinted tree (DESIGN.md §6); every row can be tapped except
    the source and its own children (left out). A sub-category's own parent sits first with
    "หมวดหมู่หลักของตัวเอง". Tapping a row goes to the confirm view.
  - `confirmMerge` (‹ back, a destructive "ผสาน" button): "ผสาน “กาแฟ” เข้ากับ “ร้านอาหาร”
    ใช่ไหม", then one line per effect: "ย้ายธุรกรรม n รายการไปที่ “ร้านอาหาร”"; for a
    top-level source with children the segmented choice "ย้ายหมวดหมู่ย่อย" / "รวมทั้งหมด" with
    "หมวดหมู่ย่อย m รายการย้ายไปไว้ใต้ “X” (k รายการรวมกับชื่อเดียวกัน)" or "หมวดหมู่ย่อย m
    รายการรวมเข้า “X” ด้วย"; "“กาแฟ” จะถูกลบ เลิกทำไม่ได้". After the write the sheet closes
    and the toast says "ผสาน “กาแฟ” เข้ากับ “ร้านอาหาร” แล้ว" (no undo).
- **Category form** (7.2): row 4 "ใช้ในกระเป๋า" (shown while the profile has an open wallet):
  "ทุกกระเป๋า" or "n จาก m กระเป๋า", opening a view of the profile's open wallets with a switch
  each (a wallet that hides the chosen parent shows off, locked). Saved with the category.

## Interactions

- **Profile**: `categories.profileId`; the default set comes with a new profile (rule 8); deleting
  a profile takes its categories (rule 12).
- **Wallet**: `wallets.hiddenCategoryIds` (7.2, rule 13).
- **Transaction (#8)** requires `categoryId`; the category's `type` decides whether the amount
  counts as income or expense. Reports and budgets group by category; a parent's total includes
  its children.

## Open questions

Settled at the start of 7.3 (owner; mock-up of the views:
[mockups/category-merge.html](mockups/category-merge.html)): a category merges into **any**
category of the same profile and type (top-level or sub-category, except itself and its own
children), as in Money Lover; the **server** moves the transactions when the merged tombstone
lands (one op, no network needed to merge, rule 15); shared wallets (#16) stay on the roadmap,
since a merge only meets an unmoved row when one user's two devices are both offline.

Also settled (owner, at the start of 7.3): an archived source may merge, the target may not;
a clashing child merges into the same-named child, and one whose move is refused (a clash
another offline device made) is merged into the target by the server; merged ids leave the
wallets' lists and the target keeps its own hidden state; a confirm view, no undo. Moving one
wallet's transactions to another category (and hiding the old one there) is not a merge: it
is #15's bulk edit.

Settled at the start of 7.2 (owner): rule 13's details (a parent's id only, archived ids kept,
a type may be hidden entirely, the row in create and edit), and the profile delete confirm
counts categories too (rule 12). Settled while building 7.2 (owner, from mock-ups): no
explanation line in the categories view, the category form chooses its wallets too, the buffet
icon became a chafing dish (the other drawings kept as icons of their own).

Settled while building 7.1 (owner, from mock-ups): white glyphs on every user colour (DESIGN.md
§3); the Account tab became grouped rows that open pages (option A1), so หมวดหมู่ is one of
them. The default set's colours are the darker palette.

Settled at the start of #7 (owner): split into 7.1 / 7.2; the default set follows the app's
language at creation; manage screen at Account › หมวดหมู่ with the current profile at its top;
hiding per wallet is a `wallets` column; a refused profile create groups its child rows under one
sync-sheet item. Proposed with the revision (change on request): archived categories hold no
name (rule 2), 200 per profile (rule 11), a pulled parent tombstone takes its children (rule 6),
unarchiving a parent brings its children back (rule 7).
