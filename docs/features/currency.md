# Currency

> Status: Spec — not built yet. Code will live in `src/features/currency/`.

## Purpose

A master list of currencies that wallets can use. Only **THB** is active at launch. Other currencies
exist in the table and can be switched on when needed (e.g. a JPY cash wallet for a trip), without a
migration.

## Out of scope

- **Exchange rates / conversion.** Each wallet keeps its own currency, and totals are grouped per
  currency (see ROADMAP backlog "FX").
- Per-user currency lists. The table is global, so every user sees the same active currencies.

## Data model

`src/core/database/schema/currency.ts`

- **currencies** — `code` (PK, ISO 4217, e.g. `THB`), `minorUnit` (digits after the decimal point:
  THB 2, JPY 0, KWD 3), `isActive` (default `false`), `sortOrder`, `createdAt`, `updatedAt`.

Names and symbols are **not stored**. The web app renders them with `Intl.DisplayNames` /
`Intl.NumberFormat` from `code`.

Seed: `THB` (active, sortOrder 0), plus inactive `USD`, `EUR`, `JPY`, `GBP`, `CNY`, `KRW`, `SGD`,
`HKD`, `TWD`, `AUD`, `VND`, `LAK`, `MYR`.

## Business rules

1. `code` is 3 uppercase letters and never changes.
2. `minorUnit` comes from ISO 4217 and never changes once any wallet uses the currency. Changing it
   would rescale every stored amount.
3. Only active currencies can be picked for a **new** wallet. Deactivating a currency doesn't touch
   existing wallets.
4. A currency is never deleted; deactivate it instead.
5. The list is ordered by `sortOrder` ascending, with ties broken by `code`.

## Endpoints

| Method | Path          | Auth   | What                        |
| ------ | ------------- | ------ | --------------------------- |
| GET    | `/currencies` | Bearer | Active currencies, in order |

Activating a currency is done by seed/migration for now. There's no admin UI, because the app has no
admin role.

## Web screens

None of its own. The wallet form has a currency picker that shows only when more than one currency is
active, and defaults to THB.

## Interactions

- Wallet stores `currencyCode` (FK) and uses `minorUnit` to validate amounts.
- Web formatting: `new Intl.NumberFormat('th-TH', { style: 'currency', currency: code })`.
