# Wallet

> Status: Spec — not built yet. Code will live in `src/features/wallet/`.

## Purpose

A wallet is where money sits: cash, a bank account or debit card, a credit card, an e-wallet
(TrueMoney, LINE Pay, ShopeePay, Grab…). Like Money Lover, a person has as many wallets as they
like, every transaction belongs to exactly one wallet, and the app shows each wallet's balance plus
a total, with a per-wallet switch to leave it out of the total (Money Lover's premium feature,
free here). Wallets live inside a **profile** ([profile.md](profile.md)): each profile has its own
wallets and its own total.

## Out of scope

- The sharing UI (inviting members, roles screen) is #16. The `wallet_members` table and access
  rules exist from this feature on (see [offline-sync.md](offline-sync.md) rules 13–16).
- Savings goals and credit-card statement cycles (Money Lover has these; we can add them later if
  missed).
- Bank sync.

## Data model

`src/core/database/schema/wallet.ts`

- **wallets** — `id`, `userId`, `profileId` (FK profiles), `name`, `type` (`cash` | `bank` |
  `credit_card` | `e_wallet` | `other`), `currencyCode` (FK currencies), `initialBalance` (integer, minor units, may be
  negative), `icon`, `color`, `excludeFromTotal` (default `false`), `isArchived` (default
  `false`), `sortOrder`, plus the sync columns (`createdAt`, `updatedAt`, `deletedAt?`, `changeSeq`,
  `updatedBy`; see [offline-sync.md](offline-sync.md)). `userId` is the **owner**.
- **wallet_members**: `walletId` (FK), `userId` (FK), `role` (`editor` | `viewer`), `addedAt`.
  PK (`walletId`, `userId`). The owner isn't listed here. It stays empty until #16 adds the UI.

`type` is a label and the default icon only; it limits nothing. `bank` covers a bank account and
its debit card ("ธนาคาร / เดบิต"), since a debit card spends from that account. `credit_card`
stays apart because it may later get a negative balance view or a statement cycle. `icon` is an
icon name from the app's own set (Web screens → Icons), never an uploaded image.

**Balance isn't stored.** It's computed as `initialBalance + Σ income − Σ expense ± transfers` for
the wallet. Add a cached column only if this gets slow.

## Business rules

1. Every query is scoped to the signed-in user and the current profile: wallets they own, plus
   wallets they're a member of (by role). Any other wallet id returns `404`, never `403`.
2. `name` is 1–50 chars after trimming, and unique per profile among non-archived wallets
   (case-insensitive).
3. `currencyCode` must be active when the wallet is created. Changing it later (decided with the
   owner before #6): amounts are stored in the currency's minor unit, so the number itself never
   changes, only the currency it's shown in.
   - **No transactions yet**: change freely.
   - **Has transactions, same `minorUnit`** (THB ↔ USD): allowed after a confirm that says the
     amounts stay the same numbers, only the currency label changes (for fixing a wrong pick, not
     a conversion).
   - **Has transactions, different `minorUnit`** (THB ↔ JPY): refused; make a new wallet instead
     (otherwise ฿65.50 would read as ¥6,550).
   - **Say it plainly** (owner's request): the device knows the wallet's transactions, so the form
     explains before saving, never after. Under the currency field, a hint when the wallet has
     transactions: "มีรายการแล้ว เปลี่ยนสกุลได้เฉพาะสกุลที่มีทศนิยมเท่ากัน และตัวเลขเดิมจะไม่ถูก
     แปลงค่า" / "This wallet has transactions: you can only switch to a currency with the same
     decimals, and the amounts won't be converted". Picking a same-decimals currency asks: "฿100
     จะแสดงเป็น $100 ตัวเลขไม่ถูกแปลงตามอัตราแลกเปลี่ยน เปลี่ยนไหม" / "฿100 will show as $100.
     Amounts aren't converted. Change it?". Picking a different-decimals one shows an error line
     under the field: "เปลี่ยนเป็น ¥ ไม่ได้ เพราะกระเป๋านี้มีรายการแล้วและทศนิยมไม่เท่ากัน
     ให้สร้างกระเป๋าใหม่สกุลนี้แทน" / "Can't switch to ¥: this wallet has transactions and the
     decimals differ. Make a new wallet in this currency instead". (Final wording goes through
     DESIGN.md §11 when built.)
   - The server refuses the same cases as a backstop (a push answers `rejected` with code
     `WALLET_CURRENCY_LOCKED`, which the sync sheet translates).
4. `initialBalance` is an integer within ±10¹⁵.
5. A wallet with transactions can't be deleted, only **archived**. Archived wallets are hidden from
   pickers and from the total, but their history stays in reports. A wallet with no transactions can
   be deleted (soft delete, `deletedAt`). Only the owner can archive or delete.
6. The total balance ("ยอดรวม") sums the current profile's non-archived wallets with
   `excludeFromTotal = false`, **grouped by currency**.
7. **No wallet is created automatically**: right after creating a profile, the onboarding opens
   the wallet form for its first wallet ([profile.md](profile.md) rule 5). A profile with no wallet
   shows an empty state with "เพิ่มกระเป๋าเงิน" (Add wallet) where wallets are needed.

## Endpoints

| Method | Path             | Auth   | What                                                                        |
| ------ | ---------------- | ------ | --------------------------------------------------------------------------- |
| GET    | `/wallets`       | Bearer | List (with computed balance); `?archived=true` includes archived            |
| GET    | `/wallets/:id`   | Bearer | Detail with balance                                                         |
| POST   | `/wallets`       | Bearer | Create                                                                      |
| PATCH  | `/wallets/:id`   | Bearer | Update name/type/icon/color/flags/sortOrder (+ currency if no transactions) |
| DELETE | `/wallets/:id`   | Bearer | Delete (only if no transactions, else 409)                                  |
| PUT    | `/wallets/order` | Bearer | Reorder: `{ ids: [...] }`                                                   |

## Web screens

- **Icons** (decided with the owner before #6): the picker offers a curated lucide set plus the
  app's **own SVG set** (cards of several kinds, wallets, piggy bank, bank, phone / QR for
  e-wallets). **No brand logos** for wallets: a wallet for TrueMoney or Grab uses a **letter
  badge** ("T", "G", up to 2 characters) on a colour the user picks, so nothing copies a
  trademark. Real brand marks appear only on sign-in buttons (Google), as their brand guidelines
  allow.

- **Wallets tab** (current profile): the total per currency at the top, then the wallet list (icon, name, balance).
  Tapping a wallet opens its transactions, and long-press/drag reorders.
- **Wallet form** (bottom sheet): name, type, icon (or letter badge), colour, starting balance, currency (only if more
  than one is active), and an "exclude from total" toggle.
- **Wallet switcher** in the header of the Transactions tab: "all wallets" or one wallet.

## Interactions

- Transaction requires `walletId` and inherits the wallet's currency.
- Reports and budgets can filter by wallet.

## Offline

The owner's wallets live in the local database and change through sync. The endpoints above serve
members of shared wallets (online) and tests. See [offline-sync.md](offline-sync.md).
