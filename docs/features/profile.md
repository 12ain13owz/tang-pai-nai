# Profile

> Status: **Built** in #6.1; wallets joined in #6.2 (delete takes them, rule 8). API:
> `api/src/features/profile/` (sync handler only). Web: `core/profile` (`ProfileService`),
> `layout/` (switcher, profile sheet, create step) and `features/account/pages/profiles-page`.
> Categories join in #7.

## Purpose

A profile keeps one area of a person's money apart from the others: "ส่วนตัว", "ครอบครัว",
"ร้านกาแฟ". Each profile has its own wallets (#6.2), its own category set (#7) and therefore its
own transactions, reports and budgets. One user has any number of profiles and switches between
them from the header. Nothing is shared between profiles, and nothing is created for the user:
they make their first profile, then its first wallet.

## Out of scope

- Sharing a profile. Sharing works per wallet (#16, `wallet_members`); where a wallet shared
  with you shows up is an open question below.
- Totals or reports across profiles.
- A default currency or timezone per profile (the wallet holds the currency).
- Wallets (#6.2) and categories (#7) themselves.

## Data model

`api/src/core/database/schema/profile.ts`

- **profiles**: `id` (UUIDv7 from the device), `userId` (FK users, the owner), `name`, `icon`
  (a lucide name, e.g. `lucideHouse`), `color` (`#rrggbb`), `sortOrder` (integer ≥ 0), plus the
  sync columns (`createdAt`, `updatedAt`, `deletedAt?`, `changeSeq`, `updatedBy`; see
  [offline-sync.md](offline-sync.md)). Indexes (`userId`, `changeSeq`) and (`changeSeq`).
- Later tables point at it: `wallets.profileId` (#6.2), `categories.profileId` (#7).
  Transactions reach their profile through the wallet.
- The device keeps the same table (`profiles`, snake_case) and the **current profile per
  device** outside the database (rule 6).

## Business rules

1. Profiles are synced own data: each user sees and syncs only their own (another user's id is
   `ID_TAKEN` on push, never visible on pull). There is no REST endpoint; the web app writes them
   locally and they travel through `/sync/push` and `/sync/pull`.
2. `name` is 1–30 characters after trimming, and **unique among the user's live profiles**
   (case-insensitive). The device checks what it knows; the server checks again (a profile made
   offline on another device with the same name is `rejected` with `CONFLICT`).
3. `icon` is a lucide export name (`lucide` + PascalCase, ≤ 40 characters). The web app offers a
   curated set and shows a default icon for a name it doesn't know, so the server only checks the
   shape. `color` is `#` + 6 lowercase hex digits; the web app offers a fixed palette and draws
   the glyph white or black for contrast (DESIGN.md §3 User colours).
4. A user has at most **20 live profiles** (server check, `CONFLICT`; the web app hides "add" at
   20).
5. **No automatic profile.** A new user (or a user whose profiles are all deleted) has none, and
   the app's data tabs show the "create profile" step (Web screens). Creating the first profile
   makes it current; the next step is its first wallet (#6.2).
6. **Current profile per device**: the id is kept in `localStorage` under `tpn-profile:<userId>`
   on a trusted device, and in `sessionStorage` on an untrusted one (offline-sync rule 1: nothing
   lasting in browser storage). It isn't synced, so two devices may show different profiles.
   Opening the app shows that profile if it is still live, else the first by order (rule 7), else
   the create step. Wiping the local data removes the key.
7. Order: `sortOrder` ascending, then `createdAt`, then `id`. A new profile goes last
   (`max + 1`). Reordering writes `sortOrder` on each profile whose position changed (one op per
   row, the usual later-edit-wins on conflict).
8. **Delete** is a soft delete after a confirm sheet (no undo: from #6.2 it removes the profile's
   wallets and transactions too, as tombstones in the **same local write**, because the server
   runs no rule check on a delete, offline-sync rule 10). The last profile may be deleted; the
   app then shows the create step. Deleting the current profile switches to the first remaining
   one.
9. A profile deleted on another device disappears on the next pull; if it was current here, the
   device switches as in rule 8 and says so in a toast. Delete beats edit (offline-sync rule 12).
10. An untrusted device can create, edit and delete profiles only while online (offline-sync
    rule 1); offline the form says so and its save is disabled.

## Endpoints

None of its own. Rows travel through the sync endpoints as table `profiles`:

| Method | Path         | Auth   | What                                         |
| ------ | ------------ | ------ | -------------------------------------------- |
| GET    | `/sync/pull` | Bearer | `profiles` rows with the other synced rows   |
| POST   | `/sync/push` | Bearer | upsert / delete ops on `profiles` (rule 1–4) |

The row shape is in OpenAPI (`SyncProfileRow`).

## Web screens

Glossary: โปรไฟล์ / Profile (DESIGN.md §11).

- **Create step** (rule 5): the Transactions tab shows an empty state "สร้างโปรไฟล์แรก" with one
  line on what a profile is and a "สร้างโปรไฟล์" button that opens the profile form. The Wallets
  and Reports tabs show the same empty state, and the ➕ button goes to the Transactions tab
  while there is no profile.
- **No wallet yet**: once a profile exists, the Transactions and Wallets tabs show the
  first-wallet step (wallet rule 12, #6.2).
- **Profile form** (a compact sheet, DESIGN.md §6; reworked in #6.2): the icon on its colour and
  the name on one row; tapping the icon opens an "ไอคอนและสี" view (colour swatches, the curated
  lucide grid; picking an icon goes back). Save is the one button at the bottom; in edit mode a
  trash icon in the header leads to the delete confirm view. Used for create and edit; "fix" of
  a rejected profile op opens it with the refused values (`FIX_ROUTES` →
  `/account/profiles?fix=<opId>`). Asks before closing with unsaved input.
- **Profile switcher** (decided at the start of #6.1): on the Transactions, Wallets and Reports
  tabs the header's left side shows the current profile (24px icon circle, name, chevron) instead
  of the page title (the tab bar already says which tab it is; the document title stays the page
  title). Tapping it opens a sheet: the profiles in order with a check on the current one, "จัดการ
  โปรไฟล์" as a header icon and "เพิ่มโปรไฟล์" (hidden at 20) as the sheet's button. The Account tab keeps its page title.
- **Account › โปรไฟล์** `/account/profiles`: the list in order (icon, name, "รอ sync" on a
  pending row). Tap a row to edit it in the form, whose header trash icon ("ลบโปรไฟล์") opens
  the confirm view naming the profile and how many wallets (and from #8 transactions) go with
  it. "จัดลำดับ" switches the list to an order mode with one grip handle per row (decided
  while building 6.1): press and hold it (~0.3 s on touch, at once with a mouse), then drag;
  the handle also moves its row with the ↑ / ↓ keys (DESIGN.md §8).

## Interactions

- **Wallet (#6.2)**: `wallets.profileId` (required); a wallet push is rejected when its profile
  isn't the user's live profile. The Wallets tab lists the current profile's wallets.
- **Category (#7)**: one category set per profile, `categories.profileId`; a wallet can hide
  categories it doesn't use. The default set is written **by the device that creates the
  profile**, in the same local write as the profile (decided at the start of #6.1, so two
  devices never seed one profile twice). Profiles made before #7 exist only in dev data and get
  the set from a one-off script at #7.
- **Transaction (#8)**, reports, budgets: filtered by the current profile through its wallets.
- **Offline sync**: `profiles` is a pushable synced table (`core/sync` handler, the reference
  for `wallets`; device schema step + `SYNC_TABLES` entry).

## Open questions

- **Wallets shared with you (#16)**: they belong to the owner's profile, which you can't see.
  Proposal: a "แชร์กับฉัน" group in the switcher sheet, listing shared wallets outside your own
  profiles. Decide at #16.
