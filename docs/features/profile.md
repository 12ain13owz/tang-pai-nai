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

1. **A new user has no profile.** The user creates every profile, the first one included
   (decided with the owner before #6), so nothing is made automatically and two devices can never
   both create a starter set.
2. `name` is 1–30 chars after trimming, unique per user among live profiles (case-insensitive).
3. Every screen and every query works inside the **current profile**: wallets, totals,
   categories, transactions, reports. Switching profile switches all of them at once.
4. The app opens on the **last profile used on this device**. If it's gone (deleted on another
   device), it falls back to the first profile by `sortOrder`, or to the empty state when none is
   left.
5. **Onboarding** (also for any later new profile): create the profile → create its first wallet
   (wallet form, nothing pre-filled but the currency) → done. Creating a profile also writes its
   **category template** (category spec rule 8) in the same local write, on the device that
   created it, so the template syncs to other devices like any other rows.
   - Until a profile exists, the Transactions tab (the first screen) shows an empty state with
     one button, "สร้างโปรไฟล์" (Create a profile); the other tabs and ➕ lead to the same flow.
6. Deleting a profile is a soft delete of the profile **and everything in it**, after asking
   (DESIGN.md: confirm when undo is impossible). Deleting the last one brings back the "Create a
   profile" empty state.
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

- ~~Who creates the starting profile, wallet and categories~~: decided, the user creates the
  profile and the first wallet; the device that creates a profile writes its category template
  (rules 1 and 5).
- **Sharing (#16)**: share a single wallet (the current locked decision) or a whole profile?
  A profile is the more natural unit for a household; revisit at #16.
