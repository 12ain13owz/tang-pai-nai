# Wallet

> Status: Spec — not built yet. Code will live in `src/features/wallet/`.

## Purpose

A wallet is where money sits: cash, a bank account, a credit card, an e-wallet. Like Money Lover,
every transaction belongs to exactly one wallet, and the app shows each wallet's balance plus a
total.

## Out of scope

- Sharing a wallet with family members (#16, design TBD).
- Savings goals and credit-card statement cycles (Money Lover has these; we can add them later if
  missed).
- Bank sync.

## Data model

`src/core/database/schema/wallet.ts`

- **wallets** — `id`, `userId`, `name`, `type` (`cash` | `bank` | `credit_card` | `e_wallet` |
  `other`), `currencyCode` (FK currencies), `initialBalance` (integer, minor units, may be
  negative), `icon`, `color`, `excludeFromTotal` (default `false`), `isArchived` (default
  `false`), `sortOrder`, `createdAt`, `updatedAt`.

**Balance isn't stored.** It's computed as `initialBalance + Σ income − Σ expense ± transfers` for
the wallet. Add a cached column only if this gets slow.

## Business rules

1. Every query is scoped to the signed-in user. Another user's wallet id returns `404`, never `403`.
2. `name` is 1–50 chars after trimming, and unique per user among non-archived wallets
   (case-insensitive).
3. `currencyCode` must be active when the wallet is created, and **can't change once the wallet has
   any transaction**.
4. `initialBalance` is an integer within ±10¹⁵.
5. A wallet with transactions can't be deleted, only **archived**. Archived wallets are hidden from
   pickers and from the total, but their history stays in reports. A wallet with no transactions can
   be deleted.
6. The total balance ("ยอดรวม") sums non-archived wallets with `excludeFromTotal = false`, **grouped
   by currency**.
7. A new user starts with one wallet: "เงินสด" (cash, THB, balance 0).

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

- **Wallets tab**: the total per currency at the top, then the wallet list (icon, name, balance).
  Tapping a wallet opens its transactions, and long-press/drag reorders.
- **Wallet form** (bottom sheet): name, type, icon, colour, starting balance, currency (only if more
  than one is active), and an "exclude from total" toggle.
- **Wallet switcher** in the header of the Transactions tab: "all wallets" or one wallet.

## Interactions

- Transaction requires `walletId` and inherits the wallet's currency.
- Reports and budgets can filter by wallet.

## Open questions

- If family sharing (#16) means "shared wallet", `wallets.userId` becomes the owner and a
  `wallet_members` table is added. Nothing here blocks that.
