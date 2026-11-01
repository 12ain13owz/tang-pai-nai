# Wallet

> Status: Spec, revised for #6.2 (decisions from the start of #6: ROADMAP → "Now: Profile +
> Wallet"). Code will live in `api/src/features/wallet/` and, on the web, the Wallets tab
> (`features/wallets`). The points under [Open questions](#open-questions) are settled at the
> start of 6.2, before any code.

## Purpose

A wallet is where money sits: cash, a bank account, a credit card, an e-wallet. Every wallet
belongs to one **profile** ([profile.md](profile.md)), every transaction belongs to exactly one
wallet, and the Wallets tab shows the current profile's wallets with their balances and a total
per currency, like Money Lover.

## Out of scope

- The sharing UI (inviting members, roles screen) is #16. The `wallet_members` table exists from
  this feature on (see [offline-sync.md](offline-sync.md) rules 13–16), empty until then.
- A wallet **type** (cash / bank / card / …). Dropped at the start of #6: the icon says what the
  wallet is.
- Bank or brand logos, and letter badges. Icons are drawings of what the wallet is (rule 8).
- Savings goals, credit-card statement cycles, bank sync.
- Moving a wallet to another profile.

## Data model

`api/src/core/database/schema/wallet.ts`

- **wallets** (synced, like `profiles`): `id` (UUIDv7 from the device), `userId` (the
  **owner**), `profileId` (FK profiles), `name`, `currencyCode` (FK currencies),
  `initialBalance` (integer, minor units, may be negative), `icon` (rule 8), `color`
  (`#rrggbb`), `excludeFromTotal` (default `false`), `isArchived` (default `false`),
  `sortOrder`, plus the sync columns (`createdAt`, `updatedAt`, `deletedAt?`, `changeSeq`,
  `updatedBy`). Indexes (`userId`, `changeSeq`), (`changeSeq`), (`profileId`).
- **wallet_members**: `walletId` (FK), `userId` (FK), `role` (`editor` | `viewer`), `addedAt`.
  PK (`walletId`, `userId`). The owner isn't listed here. Server only (not synced) and empty
  until #16.
- The device keeps `wallets` (snake_case, a new local schema step + `SYNC_TABLES` entry).

**Balance isn't stored.** It's computed as `initialBalance + Σ income − Σ expense ± transfers` for
the wallet, from the local database. Until transactions exist (#8) it equals `initialBalance`.

## Business rules

1. Wallets are synced own data, scoped to the owner (another user's id is `ID_TAKEN` on push).
   Members reach shared wallets through online endpoints in #16.
2. **Profile**: `profileId` must be one of the owner's **live** profiles when the wallet is
   created or edited (server check, `CONFLICT`; e.g. the profile was deleted on another device
   while this one added a wallet offline). A wallet never moves to another profile.
3. `name` is 1–50 characters after trimming, unique among the **profile's** non-archived wallets
   (case-insensitive; server check, `CONFLICT`). The same name may exist in another profile
   (decided before 6.2).
4. **Currency** (decided at the start of #6, with its message): `currencyCode` must be active
   when the wallet is created. It may change only while the wallet has **no transactions**. Once
   it has some, the form shows the currency read-only with a line saying why ("เปลี่ยนสกุลเงิน
   ไม่ได้เพราะกระเป๋านี้มีธุรกรรมแล้ว สร้างกระเป๋าใหม่สำหรับสกุลเงินอื่นแทน" / "This wallet has
   transactions, so its currency can't change. Create a new wallet for another currency."). The
   picker shows only when more than one currency is active; otherwise the wallet is THB.
5. `initialBalance` is an integer within ±10¹⁵, entered in the currency's major unit and stored in
   minor units (no floats).
6. **Archive and delete** (built in 6.2, decided before it): a wallet with transactions can't be
   deleted, only archived (the device
   enforces this, because the server runs no check on a delete: offline-sync rule 10). Archived
   wallets are hidden from pickers and the total but keep their history in reports. A wallet
   with no transactions is deleted as a tombstone, after a confirm sheet. Only the owner can
   archive or delete (rule 13 of offline-sync, from #16).
7. **Total** ("ยอดรวม") sums the current profile's non-archived wallets with
   `excludeFromTotal = false`, **grouped by currency**.
8. **Icons** (decided at the start of #6, refined before 6.2: no letter badges): `icon` is
   either a curated **lucide** export name (`lucideWallet`, …) or a name from our own **`tpn`
   SVG set** (`tpn` + PascalCase, e.g. `tpnBankColumns`), drawn where lucide has no clear
   picture. Icons say **what the thing is at a glance** (a bank, a card, cash, a coffee cup, a
   buffet), never a bank's or brand's logo. Because there are no logos, the set offers **several
   bank and card drawings** (and the user's colour), so someone with debit cards at three banks
   can tell them apart. A new wallet starts with a default icon (`lucideWallet`) and colour; the
   user picks another from the catalogue at any time.

   The server checks only the shape (`^(lucide|tpn)[A-Z][A-Za-z0-9]*$`, ≤ 40 characters); a name
   the web doesn't know shows the default icon, as for profiles.

9. **No automatic wallet** (replaces "a new user starts with เงินสด"). After creating a profile,
   the user creates its first wallet (rule 12).
10. **Order**: `sortOrder` ascending, then `createdAt`, then `id`, within the profile. Reordering
    uses the same order mode and drag handle as profiles (DESIGN.md §8).
11. **Deleting a profile** tombstones its wallets in the same local write (profile rule 8); the
    profile's confirm sheet says how many wallets go with it.
12. **First wallet step**: while the current profile has no live wallet, the Transactions tab
    shows "เพิ่มกระเป๋าเงินใบแรก" with a button that opens the wallet form (replacing the 6.1
    placeholder), the Wallets tab shows the same, and ➕ leads there.

## Endpoints

None in 6.2: wallets travel through `/sync/push` and `/sync/pull` as table `wallets`, like
profiles (OpenAPI `SyncWalletRow`). Online `GET`s for members of shared wallets arrive with #16
(offline-sync rule 15).

## Web screens

- **Wallets tab** (current profile): the total per currency at the top, then the wallet list
  (40px icon badge, name, balance), then an "เก็บถาวร" group, collapsed. Tapping a wallet opens
  it in the form for now (its transactions list comes with #8). "จัดลำดับ" = the drag-handle
  order mode.
- **Wallet form** (bottom sheet, like the profile sheet): name, icon (the catalogue grouped by
  meaning: money places, cards, cash, …; lucide and `tpn` mixed), colour, starting balance, currency (rule 4), "exclude from total", and in edit
  mode archive / delete. "Fix" of a rejected op opens it (`FIX_ROUTES`).
- **First wallet step** (rule 12).

## Interactions

- **Profile**: `wallets.profileId`; deleting a profile takes its wallets (rule 11).
- **Category (#7)**: one set per profile; a wallet can hide categories it doesn't use (the table
  for that comes with #7).
- **Transaction (#8)**: requires `walletId` and inherits the wallet's currency; rule 4's
  "has transactions" and rule 6 become real then.
- Reports and budgets filter by wallet.

## Offline

The owner's wallets live in the local database and change through sync (offline-sync rules
8–12). Shared wallets follow offline-sync rules 13–16 from #16.

## Open questions

Settled before 6.2 (owner, in the 6.1 session):

- **Icons**: no letter badge; lucide where it fits, our own `tpn` SVGs where it doesn't (rule 8).
  `tpn` style: lucide's (24 × 24 grid, 2px round stroke, no fill), so both mix in one grid.
  First wallet set, to draw in 6.2 (lucide covers piggy bank `lucidePiggyBank`, card
  `lucideCreditCard`, cash `lucideBanknote`, coins `lucideCoins`, phone `lucideSmartphone`,
  safe `lucideVault`, columns `lucideLandmark`): `tpn` adds several **bank** buildings
  (columns with ฿, modern tower, branch with awning, ATM), several **cards** (debit with chip,
  contactless, two stacked cards), a **baht coin** and **baht note**, **e-wallet with QR**,
  **gold bar**, **savings jar**, **envelope of cash**. The same catalogue grows for categories
  in #7 (food, buffet, coffee cup, …). Kept as SVG strings in code beside the picker
  (`shared/components/icon-badge`), registered like lucide's.
- **Name scope**: unique within the profile (rule 3).
- **Archive**: built in 6.2 (rule 6). The `isArchived` column must exist from the first
  migration anyway, so the toggle and the "เก็บถาวร" group cost little now; the "has
  transactions, so no delete" gate becomes real in #8.
- **Wallet filter and time range on the Transactions tab** (#8, owner's direction, Money
  Lover style): the wallet switcher sits at the **header centre**, and a **⋮ menu** at the
  header right holds the filters: view by day / month (default, the current month) / quarter /
  year / all / custom range. Layout to confirm at the start of #8 (see transaction.md → Open
  questions).
