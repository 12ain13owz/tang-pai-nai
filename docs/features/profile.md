# Profile

> Status: Spec (decided with the owner before #6) — not built yet. Built with Wallet in #6. Code
> will live in `src/features/profile/` (API) and `web/src/app/features/profile/`.

## Purpose

A **profile** is a separate set of books inside one account: its own wallets, categories,
transactions, budgets and reports, with its own totals. One person can keep several (personal,
a shop, a trip with friends, the household…) without signing up with another email, and switch
between them in a tap. Money Lover can only split wallets and leave some out of the total; a
profile splits everything.

## Out of scope

- Sharing a profile with someone else. Sharing is #16; whether it shares a wallet or a whole
  profile is decided there (Open questions).
- Totals or reports across profiles. Each profile stands alone.
- Moving a wallet (with its transactions) to another profile. Later, if missed.

## Data model

`src/core/database/schema/profile.ts`

- **profiles** — `id` (UUIDv7 from the device), `userId` (owner), `name`, `icon`, `color`,
  `sortOrder`, plus the sync columns ([offline-sync.md](offline-sync.md)). A synced table.
- Every user-data table carries **`profileId`** (FK profiles) beside `userId`: wallets,
  categories, transactions, and later budgets, recurring rules, debts and events. A row belongs to
  exactly one profile, and anything it points at (a transaction's wallet and category) must be in
  the same profile.
- **The current profile is a device setting**, not synced: the web app keeps the last opened
  profile id per user (`tpn-profile:<userId>` in `localStorage`) and opens it again next time.

## Business rules

1. A user has **at least one** profile. A new user starts with one, "ส่วนตัว" (Personal); the
   others are created by the user.
2. `name` is 1–30 chars after trimming, unique per user among live profiles (case-insensitive).
3. Every screen and every query works inside the **current profile**: wallets, totals,
   categories, transactions, reports. Switching profile switches all of them at once.
4. The app opens on the **last profile used on this device**. If it's gone (deleted on another
   device), it falls back to the first profile by `sortOrder`.
5. A new profile gets its own **default categories** (category spec rule 8) and one wallet
   "เงินสด" (wallet spec rule 7).
6. Deleting a profile is a soft delete of the profile **and everything in it**, after asking
   (DESIGN.md: confirm when undo is impossible). The last profile can't be deleted.
7. Sync carries every profile of the user, so each device has all of them offline; the profile
   switch itself needs no network.

## Web screens

- **Profile switcher**: tapping the page title area in the header opens a bottom sheet with the
  profiles (icon, name, a check on the current one), "เพิ่มโปรไฟล์" and edit. The header shows the
  current profile's name or icon so it's always clear which books are open.
- **Profile form** (bottom sheet): name, icon, colour.
- Account page: a "Profiles" entry for reorder, edit and delete.

## Interactions

- Wallet, category, transaction and every later data feature add `profileId` and scope by it
  (`ROADMAP.md` → Money & data).
- Offline sync: profiles are an ordinary synced table; pull returns rows of every profile.

## Open questions

- **Who creates the starting profile, wallet and categories** of a new user (and of a new
  profile): the server at sign-up (then pulled), or the first device (risk: two devices each
  create one)? Decide at the start of #6.
- **Sharing (#16)**: share a single wallet (the current locked decision) or a whole profile?
  A profile is the more natural unit for a household; revisit at #16.
