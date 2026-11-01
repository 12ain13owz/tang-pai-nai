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
- Bank or brand logos. Icons are generic (rule 8).
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
   (case-insensitive; server check, `CONFLICT`).
4. **Currency** (decided at the start of #6, with its message): `currencyCode` must be active
   when the wallet is created. It may change only while the wallet has **no transactions**. Once
   it has some, the form shows the currency read-only with a line saying why ("เปลี่ยนสกุลเงิน
   ไม่ได้เพราะกระเป๋านี้มีธุรกรรมแล้ว สร้างกระเป๋าใหม่สำหรับสกุลเงินอื่นแทน" / "This wallet has
   transactions, so its currency can't change. Create a new wallet for another currency."). The
   picker shows only when more than one currency is active; otherwise the wallet is THB.
5. `initialBalance` is an integer within ±10¹⁵, entered in the currency's major unit and stored in
   minor units (no floats).
6. **Archive and delete**: a wallet with transactions can't be deleted, only archived (the device
   enforces this, because the server runs no check on a delete: offline-sync rule 10). Archived
   wallets are hidden from pickers and the total but keep their history in reports. A wallet
   with no transactions is deleted as a tombstone, after a confirm sheet. Only the owner can
   archive or delete (rule 13 of offline-sync, from #16).
7. **Total** ("ยอดรวม") sums the current profile's non-archived wallets with
   `excludeFromTotal = false`, **grouped by currency**.
8. **Icons** (decided at the start of #6): `icon` is one of
   - a curated lucide export name (`lucideWallet`, …),
   - a name from our own **`tpn` SVG set** (`tpn` + PascalCase, e.g. `tpnBank`), generic
     drawings of money places, never a bank's or brand's logo,
   - a **letter badge** `letter:<text>` (1–2 characters, e.g. `letter:K`), drawn as text on the
     wallet's colour.

   The server checks only the shape (`^(lucide|tpn)[A-Z][A-Za-z0-9]*$` or `^letter:.{1,2}$`, ≤ 40
   characters); a name the web doesn't know shows a default icon, as for profiles.

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
- **Wallet form** (bottom sheet, like the profile sheet): name, icon (tabs or groups for lucide /
  `tpn` / letter), colour, starting balance, currency (rule 4), "exclude from total", and in edit
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

Settle these at the start of 6.2 (proposals):

- **`tpn` icon set**: which drawings, and who draws them. Proposal: about 12 simple outline SVGs in
  lucide's style (24px grid, 2px stroke): bank building, card, coins, cash note, QR / e-wallet,
  piggy bank, safe, envelope, gold bar, phone wallet, shopping bag, savings jar; kept in
  `web/public/icons/tpn/` or as strings in code beside the picker.
- **Letter badge text**: the user types it, or it's the name's first character. Proposal: the
  first character by default, editable to 1–2 characters.
- **Name uniqueness scope**: per profile (rule 3, proposed) or per user.
- **Wallet filter on the Transactions tab**: the header's left side is now the profile switcher.
  Proposal: an "ทุกกระเป๋า ▾" chip under the header, built with #8.
- **Archive in 6.2**: with no transactions yet every wallet can be deleted, so archive is only
  reachable once #8 exists. Proposal: build the column and the toggle now, the "has
  transactions" gate with #8.
