# AGENTS.md

Guidance for AI assistants (and humans) working in `web/`. Read this **before** creating or
modifying a feature.

If anything here conflicts with the actual code, the code wins — update this file in the same change.

> **Project context:** this folder is the web app of **Tang Pai Nai (ตังค์ไปไหน)**, a personal income /
> expense tracker modelled on Money Lover, for the owner and their family. _What_ to build and in what
> order lives in [`ROADMAP.md`](../ROADMAP.md); what each feature does (data, rules, endpoints)
> lives in [`docs/features/`](../docs/features/README.md). Read the feature doc before building its
> screens. How screens look and read (layout, colour, type, patterns, wording) lives in
> [`DESIGN.md`](DESIGN.md). This file only covers _how_ to write the code here. Run every npm command
> from this folder (`cd web`).

---

## 1. What this project is

A **mobile-first, app-like PWA**: Angular 22 (standalone, zoneless, signals), Tailwind CSS v4 and
spartan/ui. It is client-side only. There is no SSR and no SEO, because the app is private.

Pattern references: **kixly-deck-admin** (Angular: feature layout, typed reactive forms, shared
`*-field` components) and **tripsurance-fe** (latest field API and payload rules), adapted to Angular
and spartan.

UX target: it should feel like a native mobile app. That means a fixed **bottom tab bar**, bottom
sheets instead of centred modals, safe-area insets (`env(safe-area-inset-*)`), large touch targets
(≥ 44px), and no hover-only interactions. Design for a 375px-wide screen first; wider screens just
centre the same layout (max width ~480px). The full design guide is [`DESIGN.md`](DESIGN.md).

### Testing

Same policy as the API (`../api/AGENTS.md` §1 Testing): **feature first, tests once it's settled.**
Build the screens, check them in the browser (§5), and once the developer confirms the behavior,
write the tests as the last commit(s) of the same PR. Existing tests must keep passing; update them
in the same PR when a behavior change is intended. Put `<name>.spec.ts` beside the file under test
(Vitest via `ng test`, globals enabled). Guard-rail specs such as `core/i18n/translations.spec.ts`
(both languages have the same keys) apply at all times.

## 2. Folder structure

```
src/app/
  core/        # App-wide singletons: API client, auth/session, interceptors, guards, config
  layout/      # App shell: bottom tab bar, page header, sheet host
  features/    # One folder per feature (transactions, wallets, categories, budgets, ...)
  shared/
    ui/                # spartan helm components: GENERATED, don't edit (see §3 UI)
    components/form/   # our *-field wrappers + form helpers (see §3 Forms)
    components/<group>/  # other shared components, one flat folder per group
    types/  utils/  pipes/
  app.ts       # Root component
  app.config.ts
  app.routes.ts  # Lazy-loads each feature's routes
```

Dependency direction (same as the API):

```
features  ->  core  ->  shared
features  ->  shared
layout    ->  core, shared
```

- Features never import other features' internals. Go through `@/features/<name>` (its `index.ts`),
  and prefer lifting shared logic into `core/` or `shared/`. This is enforced by ESLint.
- `shared/` imports nothing from `core/`, `layout/` or `features/`.

### Shared components

Owner's rule (after #16.1): **a component used in more than one place lives in
`shared/components`**, never as a copy in each feature.

- "More than one place" = two features, or a feature and `layout/`. A component used only
  inside one feature stays in that feature's `components/`.
- Put it in `shared/components/<group>/` with **its own barrel** (`money-summary`, `period`,
  `sheet`, `date-row`, `wallet-pick`). A module exported from a barrel the shell imports lands
  in the initial bundle even when only a lazy screen uses it (ROADMAP → "Known, for later"), so
  never add a lazy screen's component to a barrel the shell already uses, and check the build's
  initial total after a move.
- `shared/` can't read `core/` services: pass data in through `input()` (already formatted, like
  `MoneySummaryLine`, `WalletPickItem`) and send actions out through `output()`; the pages keep
  the services. `app-date-row` takes `today` and `locale` from the sheet for the same reason.
- Only components that do the same job are shared; ones that only partly match stay where they
  are (16R left the debts' `category-pick`, the Reports summary card and the day cards).
- Form controls follow the same rule as `*-field` wrappers in `shared/components/form` (§3 Forms).
- When you find a copy, don't add a third one: move it in the same PR if it is small, or list
  it in ROADMAP.

### App shell & PWA

- `app.routes.ts` mounts `AppShell` (`layout/`) as the layout route for the tab pages: header (page
  title from the route's `title`, sync status pill, update banner), the page, and the fixed
  bottom tab bar. `<main>` carries `[appFadeIn]="tab()"` (`shared/components/fade`, kept apart
  from the lazy pages' `slide` so the shell's bundle doesn't carry it): a new tab fades in. Give every routed page a `title` that is a **translation key** (`title.wallets`);
  `PageTitleStrategy` (`core/routing`) translates it for the header and the document title.
  Full-screen flows that shouldn't show the bar (sign-in, PIN) go outside it.
- The sign-in flow (`features/auth`, under `/auth/*`) is mounted before the shell with its own
  `AuthLayout` (app name + language switch); so are the device screens `/auth/lock` (PIN on)
  and `/auth/tab` (offline-sync rules 2–3). The shell route carries `shellGuard` (`core/offline`,
  `canActivate` + `canActivateChild`): it makes the local database on a device's first open and
  opens it (with its PIN, when it has one) even offline; a session the server refused goes to
  sign-in. See "Trusted device" below.
- App-wide device state lives in `core/` as signal services: `ThemeService` (`core/theme`),
  `LanguageService` (`core/i18n`), `NetworkStatusService` (`core/network`), `KeyboardService`
  (`core/viewport`), `AppUpdateService` + `DeviceStorageService` (`core/pwa`), `OfflineService`
  and `SyncService` (`core/offline`), `ProfileService` (`core/profile`), `WalletService`
  (`core/wallet`), `CategoryService` (`core/category`), `TransactionService` (`core/transaction`),
  `ReportService` (`core/report`, kept out of the shell so it stays in the lazy chunks),
  `DebtService` (`core/debt`, likewise: only the Wallets tab and the debts pages inject it),
  `EventService` (`core/event`, likewise: only the events pages inject it).
- The header shows ‹ on a page inside the Account tab (`parentOf` in `layout/profile-routes`):
  the Account tab is grouped rows that each open a page (owner's choice A1 in #7). A report page
  goes one level up (`/reports/category/<id>/<sub>` → `/reports/category/<id>` → `/reports`). A
  page whose title is data (a category's name) calls `PageTitleStrategy.setOverride(title)`
  and sets it back to `null` on destroy.
- The service worker (`ngsw-config.json`) caches the **app shell only**. Never add `dataGroups`:
  data comes from the local DB ([offline-sync](../docs/features/offline-sync.md) → Layers). It is
  off in `ng serve`, so check PWA behaviour against `npm run build` output served with an SPA
  fallback. It also prefetches `/sqlite/sqlite3.wasm` (copied from `@sqlite.org/sqlite-wasm` by
  `angular.json`), so the local database opens offline.

### Trusted device & local database (`core/offline`, #4a)

Spec: [offline-sync.md](../docs/features/offline-sync.md) rules 1–7.

- `LocalDatabase`: SQLite WASM **in memory**, loaded lazily (`locateFile` → `/sqlite/`). Schema
  changes are appended to `MIGRATIONS` in `local-database.ts` (applied by `PRAGMA user_version`);
  never edit a step that shipped. Write through `OfflineService.write(db => …)`: one SQLite
  transaction, then the snapshot is saved (calls during a save are coalesced).
- The vault (IndexedDB `tpn-vault`, `vault-storage.ts`) holds the clear meta (user id + name, the
  data key, wrong-PIN count) and **one** AES-GCM snapshot of the whole database
  (`vault-crypto.ts`). **The PIN is optional, off by default** (rule 2, after 16.2): with it on,
  `meta.key` is the key wrapped by the PIN and the key lives in memory only while unlocked; with
  it off, `meta.key` is `null` and `meta.deviceKey` holds the `CryptoKey` itself.
- `OfflineService.state()`: `none` (no local database yet) / `locked` / `unlocked` / `elsewhere` (another
  tab holds the `tpn-local-db` Web Lock). `hasPin()`; `enable(pin?)` (no PIN by default);
  `open()` (PIN off: opens at once, `shellGuard` calls it); `unlock(pin)` and `verifyPin(pin)`
  answer `ok` / `wrong` / `wiped` (the 5th wrong PIN wipes and signs out); `changePin` (turns the
  PIN on too), `removePin`, `lock`, `wipe`. With the PIN on it locks by itself after 5 minutes
  idle or in the background; it wipes on a revoked session either way.
- **Every signed-in device keeps its data** (rule 1, after 16.2): no trust step, no offline
  switch. `shellGuard` calls `enable()` (no PIN) on the first open; `isTrusted()` now means "the
  vault exists". Only when browser storage refuses it does `openInMemory()` open a database for
  the tab's life (writes then need the server, `ProfileService.canWrite`).
- **Expired session** (rule 7): offline or with the server down the app keeps working; once the
  server refuses the session, the interceptor, `shellGuard` and an `OfflineService` effect send
  the user to sign-in, the data kept. The sign-in page says whose data the device holds
  (`auth.localData`). Anything that ends a user's time on the device (sign-out, revoked, someone
  else signing in) calls `OfflineService.wipe()`.
- `isOpen()` says whether a database is open at all; `changes()` is bumped by every `write()`, so a screen's `computed()`
  reads re-run (read it, then `isOpen()`, then query `db()`).
- Specs: jsdom has no IndexedDB or `matchMedia`, and no `/sqlite/`. A drawer renders into
  `document.body` (query there), and a radio's `[value]` is a property, so find it by its
  `aria-label` (`profile-sheet.spec.ts`). For real SQL use
  `openTestDatabase()` (`core/offline/testing-db.ts`, the wasm from `node_modules`), as
  `OPEN_LOCAL_DATABASE` or behind a fake `OfflineService` (`sync.service.spec.ts`,
  `wallet.service.spec.ts`, `wallet-sheet.spec.ts`, `category.service.spec.ts`,
  `category-sheet.spec.ts`, `hidden-categories.spec.ts`; their test database has no pulled
  currencies, so put the ones you need with `putRow`); `offline.service.spec.ts` uses a key/value fake. Stub
  `DeviceStorageService` for the shell (`app.spec.ts`), and `ProfileService` for the sync pill
  and sheet (`rejectedItems`; `sync-status.spec.ts`). `vi.mock` doesn't work with Angular's
  bundled Vitest runner; inject seams instead.
- **Toasts are module state** (`toastState` from `@spartan-ng/brain/sonner`), and in CI several
  spec files share one worker, so toasts from one file reach the next. A spec that checks
  toasts calls `toastState.dismiss()` (no id = all) in `beforeEach`, and a spec whose component
  shows toasts calls it in `afterEach` too.

### Sync (`core/offline`, #4a.2)

Spec: [offline-sync.md](../docs/features/offline-sync.md) rules 8–12.

- **Every own-data write** goes through `queueWrite(db, table, op, row)` (`outbox.ts`) inside
  `OfflineService.write(...)`: the row lands in its local table and the outbox in one transaction.
  `op` is `upsert` (the whole row, with `createdAt`, `updatedAt: Date.now()`, `deletedAt`) or
  `delete` (the row with `deletedAt` set: a tombstone locally, `{ id, updatedAt }` on the wire).
  Keep the row's `changeSeq` in the object you pass (spread the current row), it becomes the
  op's `baseSeq`. Ids are `uuidv7()`. Screens list rows `WHERE deleted_at IS NULL`.
- **A synced table on the device** = a schema step in `MIGRATIONS` (step 14 after #16.2; a spec
  that rebuilds an older snapshot undoes the newer steps first, `UNDO_STEP_14`, `UNDO_STEP_13`
  then `UNDO_STEP_12` in `local-database.spec.ts`) (snake_case columns,
  `change_seq INTEGER` nullable) + an entry in `SYNC_TABLES` (`sync-tables.ts`: key, camelCase
  columns, booleans, `json` columns, `readOnly` for master data). `putRow` / `getRow` / `fromSql`
  map between them. A **JSON column** (an array, e.g. `wallets.hiddenCategoryIds`) is stored as
  text, `'[]'` when the row has none, and parsed by `fromSql`; a typed reader still checks the
  shape (`toWallet` in `core/wallet`). A new column on a shipped table is an `ALTER TABLE` step
  with a default, and specs that rebuild an older snapshot drop it first.
- `SyncService` runs the rounds (push, then pull, `tpn-sync` Web Lock) by itself; screens don't
  call the API for own data. It exposes `status()` (`errors` / `offline` / `unreachable` /
  `syncing` / `pending` / `synced`), `pendingCount()`, `rejected()`, `notices()`, `lastSyncedAt()`,
  `serverTables()`, `sync()`, `flush()` (before sign-out: how many ops would be lost),
  `discard(opId)`, `rejectedOp(opId)`, `dismissNotice(id)`.
- **Server unreachable** (rule 11): a round, or the session check at open, that can't reach the
  API sets `NetworkStatusService.serverReachable` false and retries after `RETRY_DELAYS_MS`
  (5 s … then every 5 min); a round that gets through sets it back, and offline / locked /
  signed out stops the retries. A shared profile's (or an in-memory database's)
  `ProfileService.canWrite()` needs it too; its "needs online" notices switch to
  `sync.serverDownWrite` while `serverDown()`. Specs that
  stub `NetworkStatusService` give it both `isOnline` and `serverReachable` signals.
- `SyncService.rounds()` counts finished (or failed) rounds since the app loaded: work that
  should follow the first pull waits for it (the recurring pass, #12). An `overridden` result
  may come **without a notice** (the server kept its row quietly), so nothing is stored then.
  Specs that stub `SyncService` for a component that reaches `RecurringService` give it
  `rounds: signal(0)`, `canSync` and `isSyncing`.
- **Rejected ops**: the local row already went back to the server's version; the op keeps the
  refused values. A refused profile create carries its refused child rows
  (`ProfileService.rejectedItems()`, read by the sheet and the pill): fixing the profile re-sends
  them in the same write, discarding it drops them (`discardRefused`). "Fix" opens the table's form via `FIX_ROUTES` in `layout/sync-sheet.ts` with
  `?fix=<opId>` (a wallet goes to `/wallets` and calls `WalletService.openFix(opId)` itself,
  because the Wallets tab may be showing the first-wallet step); saving queues a new op and
  deletes the rejected one.
- The header's sync status is `layout/sync-status.ts`, one 44px icon on every tab (#9); its
  sheet (`layout/sync-sheet.ts`, spartan drawer) is `@defer`red until first opened. A new synced
  table needs its `sync.table<name>` key there (the sheet labels items by table).

### Profiles (`core/profile`, #6.1)

Spec: [profile.md](../docs/features/profile.md). Every data screen (wallets, transactions,
reports) shows the **current profile's** data.

- `ProfileService`: `profiles()` (live, in order), `current()` (a shared profile in use, else the
  device's choice, else the first; `shared()` / `isShared()`, #16.2), `ready()` (false only
  while a new device waits for its first pull), `canWrite()` (own data: always; a shared profile =
  an editor, online, ready; an in-memory database = online and the server answering), `serverDown()`, `atLimit()`, `nameTaken()`, `save(id | null, values, fixOpId?)`,
  `remove(id)`, `moveTo(id, index)`, `select(id)`. The current id is `tpn-profile:<userId>` in
  `localStorage` (`sessionStorage` for an in-memory database); `OfflineService.wipe()` removes it.
  `save()` of a new profile writes the default category set in the same write
  (`default-categories.ts`, in `LanguageService`'s language); `switchSheet` opens the switch
  sheet the shell renders (the header and Account › หมวดหมู่ use it).
- The shell owns the profile UI because every tab needs it: `layout/profile-switcher` (header,
  on `isProfileTab()` routes), `layout/profile-sheet` (create / edit / fix / delete, opened by
  `ProfileService.open(state)` from anywhere and `@defer`red), and `layout/profile-create-step`,
  which `AppShell` renders instead of the page on the data tabs while there is no profile. Data
  pages can therefore assume `current()` is set.
- A feature's rows carry `profileId` (from 6.2) and its queries filter by
  `profileService.current()`. `current()` is a **new object after every write or pull** (the
  rows are read again), so an effect that should run only when the profile changes (restoring a
  screen's remembered view) reads `profileService.currentId()` instead (fixed in #10: the
  Transactions tab jumped back to this period after a save). Deleting a profile must tombstone
  its rows in the same `OfflineService.write()` (profile rule 8).
- Reordering a list: an order mode with one CDK drag handle per row (`cdkDropList` /
  `cdkDrag` / `cdkDragHandle`, `cdkDragStartDelay` `{ touch: 300, mouse: 0 }`,
  `cdkDragPreviewClass="tpn-drag-preview"`) plus ↑ / ↓ on the handle; see
  `features/account/pages/profiles-page`.
- User icons and colours: `@/shared/components/icon-badge` (`app-icon-badge` with a `fallback`,
  `USER_ICONS` = the curated lucide icons + our `TPN_ICONS` SVG strings, `PROFILE_ICONS`,
  `WALLET_ICON_GROUPS`, `CATEGORY_ICON_GROUPS`, `USER_COLORS`, `userColor` (a stored colour as
  drawn: old palette colours map to their darker ones), `glyphColor`, `knownIcon(name, fallback)`); pick them in
  the sheet's icon-and-colour view with `app-icon-field` (flat `icons` or titled `groups`) and
  `app-color-field`. A `tpn` icon is an SVG string in `tpn-icons.ts` drawn in lucide's style
  (24 × 24, `stroke-width="2"`, round caps, `fill="none"`); `user-icons.spec.ts` checks that.
- Sheets with unsaved input: spartan's `disableClose` is read only when the drawer opens, so a
  dirty sheet re-opens on `(closed)` with its "discard?" question (`layout/profile-sheet`).
- **Sheets** (DESIGN.md §6): `hlm-drawer-content class="mx-auto h-[92dvh] w-full max-w-[480px]
data-[vaul-drawer-direction=bottom]:max-h-[92dvh]"` holding one `app-sheet-frame`
  (`@/shared/components/sheet`: `title`, `leadingIcon` `close` | `back`, `leadingLabel`,
  `(leading)`; project `[sheetActions]` icon buttons and a `[sheetFooter]` with the main button).
  A sheet with more than one step switches views inside the same drawer (`form` / `icons` /
  `confirmDelete` / `confirmDiscard`, see `layout/wallet-sheet`). Specs find icon buttons by
  `aria-label`. No grab handle: `src/styles.css` hides spartan's
  (`hlm-drawer-content[data-slot='drawer-content'] > div:first-child`: Tailwind's utilities here
  are unlayered, so it needs the attribute to outrank the one that shows it; the generated file
  stays untouched). Glass: `app-sheet-frame` puts its ✕ / ‹ in `tpn-glass` (a Tailwind
  `@utility` in `src/styles.css`) and wraps the `[sheetActions]` icons in one glass capsule, so a
  sheet adds nothing; `app-header`'s ‹ uses it too. Header icons are `tpn-hit size-9` with
  `size="18"` (a 36px disc, 44px tap): keep new ones the same.

### Wallets (`core/wallet`, #6.2)

Spec: [wallet.md](../docs/features/wallet.md).

- `WalletService`: `wallets()` (the current profile's live wallets in order, archived too),
  `openWallets()`, `archived()`, `hasWallet()`, `atLimit()` (20 open), `totals()` (per currency),
  `currencies()` / `activeCurrencies()` / `minorUnit(code)` / `defaultCurrency()` (from the
  pulled `currencies`), `balance(wallet)` (`initialBalance` + its live transactions, one
  aggregate for all wallets), `hasTransactions(id)`, `canChangeCurrency(id)` (false once it has
  some; `remove()` refuses then too), `nameTaken()`, `byId()`, `openOf(profileId)`,
  `save(id | null, values, fixOpId?, profileId?)` (`values.hiddenCategoryIds` goes through
  `cleanHidden`), `setArchived(id, archived)` (answers `nameTaken` / `limit` when coming
  back is refused), `remove(id)`, `moveTo(id, index)`, `sheet` / `open()` / `openFix()`.
- The shell renders `layout/wallet-first-step` instead of the Transactions and Wallets pages
  while the profile has no wallet (`isWalletTab()`), the ➕ leads there, and
  `layout/wallet-sheet` is `@defer`red like the profile sheet. `features/wallets` holds only the
  Wallets tab page.
- `ProfileService.remove()` tombstones the rows of `PROFILE_CHILD_TABLES` (tables with
  `profile_id`) in the same write, and an effect tombstones live child rows of a profile that is
  a tombstone here (deleted on a device that didn't know them, wallet rule 11). Categories are
  in that list since #7.1.
- **Hidden categories** (7.2, category rule 13): `core/wallet/hidden-categories.ts` holds
  `isHiddenIn(hidden, category)` (own id or the parent's: the one check #8's picker needs),
  `cleanHidden(db, ids)` (no duplicates, no known tombstones, at most 200), `toWallet` and
  `findWallet`. `core/category` builds on it (it reads `wallets` by name); `core/wallet` never
  imports `core/category`.

### Categories (`core/category`, #7.1)

Spec: [category.md](../docs/features/category.md).

- `CategoryService`: `categories()` (the current profile's live ones in order, archived too),
  `openCategories()`, `tree(type, archived?)` (parents with children), `archivedChildren(type)`,
  `openCount(type)`, `parents(type, exceptId)`, `childrenOf(id)`, `atLimit()` (200 open),
  `nameTaken(name, type, parentId, exceptId, profileId?)`, `byId()`, `treeOf(profileId, type)`,
  `hiddenIn(categoryId, profileId)` (open wallets listing its own id), `save(id | null, values,
fixOpId?, profileId?, hiddenIn?)` (a row that changes siblings goes last among the new ones;
  `hiddenIn` rewrites the open wallets whose list changes, in the same write),
  `setArchived(id, archived)` (a parent takes / brings back its children; answers `nameTaken` /
  `limit` / `parentArchived`), `remove(id)` (only without live children), `moveTo(id, index)`
  (among open siblings), `sheet` / `open()` / `openFix()`. An effect tombstones live children
  of a parent that is a tombstone here (category rule 6); the shell injects the service so it
  runs.
- **Merge** (7.3, category rule 15): `CategoryService.mergeTargets(id)` (the tree it may go
  into), `mergePlan(source, target, mode)` (counts for the confirm view),
  `merge(source, target, mode)` (one write: children move or merge, merged ids leave `hiddenCategoryIds`, tombstones
  with `mergedIntoId` pushed last as upserts), `transactionCount(id)`.
  `core/category/category-merge.ts`: `mergeTargetOf` (follows `merged_into_id`, as the API's
  `findMergeTarget`), `moveRow` (a row with a **pending op** gets the op rewritten and moved last;
  any other changes locally only, because the server makes the same move), `moveTransactions`,
  `followMerges` / `hasMergeLeftovers`: both sweeps (category rule 6, transaction rule 10) run
  it first, so rows of a merged tombstone follow it instead of being deleted.
- **Outbox order matters** when a row points at another: a category put under a parent queued
  after it calls `moveOpLast()` (`core/offline/outbox.ts`) so the parent is pushed first, and
  unarchiving a parent moves its children's ops after its own.
- `layout/category-sheet` (views `form` / `icons` / `parent` / `wallets` / `move` / `merge` /
  `confirmMerge` / `confirmDelete` / `confirmDiscard`; four header icons in edit mode (move,
  archive, merge, delete), so it passes `[actions]="4"` to `app-sheet-frame`; `app-segmented-field` for the type, disabled
  while it follows a parent or the row has children) is `@defer`red by the shell; `features/account/pages/categories-page`
  is Account › หมวดหมู่ with a two-level order mode (an inner `cdkDropList` per parent).
  `layout/wallet-sheet` has a `categories` view (tabs + `app-toggle-list-field`) for the
  wallet's `hiddenCategoryIds`.
- **Move transactions** (#15, [export.md](../docs/features/export.md) rules 7–10): the `move`
  view is `layout/category-move` (from wallet, to category, hide, confirm) on
  `layout/category-move-rows.ts` (`moveSources`, `moveCategoryRows`, `undoCategoryMove`: row
  upserts with only `categoryId` changed in one write, the wallet's hidden list, undo from the
  toast). They sit beside the sheet, not in `core/category`: a module exported from a barrel
  the shell imports lands in the initial bundle even when only a lazy screen uses it.

### Transactions (`core/transaction`, #8)

Spec: [transaction.md](../docs/features/transaction.md).

- `TransactionService`: `list(range, walletIds)` / `summary(range, walletIds)` (SQL through
  the local indexes; a period of the profile, never every row), `byId()`, `save(id | null,
values, fixOpId?, profileId?)` (remembers the wallet: `defaultWalletId()`), `remove()` +
  `restore()` (the toast's undo), `sheet` / `open()` / `openFix()` (a create state may carry
  `values` + `type`: "copy"), `frequentCategoryIds(profileId, type)` ("ใช้บ่อย", last 90 days),
  `lastType()` / `rememberType()` (8.2). The Transactions tab's view
  lives here too, shared by the header and the page: `viewWalletId` (null = "ทุกกระเป๋า",
  `viewWalletIds()` leaves out wallets excluded from the total), `unit` (`PeriodUnit`), `tab`,
  `custom`, `range()`, `tabs()`, `items()`, `summaryLines()`, `today`; `selectWallet` /
  `selectUnit` / `selectCustom` remember wallet and unit per profile (`tpn-profile:tx:…`, wiped
  with the device). An effect tombstones live transactions whose wallet or category is a
  tombstone here (rule 10); the shell injects the service so it runs.
- `core/transaction/period.ts`: `periodRange`, `periodTabs`, `periodLabel` (pure, ค.ศ.).
- `core/transaction/quick-amounts.ts`: `QUICK_AMOUNTS` and `QuickAmountsService` (`enabled`,
  `setEnabled`; a device setting in `localStorage` like the theme, Account › การแสดงผล).
  `app-calc-keypad` draws them from `quickAmounts` and emits `quickPressed`; the sheet adds them
  with `addQuickAmount` (`@/shared/utils` `calc.ts`).
- **Transfers** (#9, spec: [transfer.md](../docs/features/transfer.md)) live in
  `core/transaction` too: `TransferService` (`byId`, `save`, `remove` / `restore`,
  `defaultFromId`, `lastToId` (Q7, `tpn-profile:tx:transfer:…`), `sheet` / `open` / `openFix`;
  an effect tombstones live transfers with a side in a wallet that is a tombstone here; the
  shell injects it). One row per transfer (`transfers`, schema step 9); the list reads
  `TransactionService.entries(range, walletIds)`: `list` merged in order with
  `transferSides` (each side in view is a `TransferItem` with `kind: 'transfer'` and `side`
  `out` | `in`, the outgoing one first). `MoneySummary.transfer` is the view's transfer net (in −
  out; 0 for `null` wallets). Code that walks `items()` checks `kind`.
- `core/wallet` and `core/category` read the `transactions` (and `core/wallet` the
  `transfers`) table **by name** (`TRANSACTION_TABLE`, `TRANSFER_TABLE` in `wallet.type.ts`),
  because `core/transaction` builds on them. Balances and `hasTransactions` count both sides of
  a transfer.
- UI: `layout/transactions-header` (the tab's header, `@defer`red by `app-header` for the
  bundle), `layout/view-wallet-sheet`, `layout/custom-range-sheet`, `layout/transaction-sheet`
  (views `form` / `wallet` / `category` / `note` / `confirmDiscard`; the date row and the wallet
  view are `shared/components/date-row` and `wallet-pick`, as in the transfer sheet; keypad
  state: it closes on any other control of the form, `leaveAmount`; save and add, copy; no type
  control on the form: the `category` view's tabs are `pickType` (a lone control) and
  `chooseCategory` sets `type` from the category; the shell
  `@defer`s all three), `features/transactions` (the page; rows drawn 100 at a time with an
  `IntersectionObserver` sentinel; the list carries `[appSlide]="tabIndex()"` from
  `shared/components/slide`, which slides it in from the side of the chosen period (Web
  Animations, a fade only under reduced motion; the page host has `overflow-x-clip` for it); its summary card is `shared/components/money-summary`
  (`app-money-summary-card`, also used by a shared wallet's page, so the two never drift). ➕
  opens the sheet (`BottomTabBar.add()`); "fix" goes to
  `/transactions?fix=<opId>` (the page asks both services; each opens only its own table's op).
  `layout/transfer-sheet` (views `form` / `pick` (from or to) / `note` / `confirmDiscard`) is
  `@defer`red by the shell and opened by the header's two-level ⋮ menu and the Wallets tab.
- Specs: `transaction.service.spec.ts`, `transfer.service.spec.ts`, `transaction-sheet.spec.ts`,
  `transfer-sheet.spec.ts`, `transactions-page.spec.ts` put their rows with `putRow` like the
  other tables; `transactions-header.spec.ts` stubs the services (the menu only).

### Reports (`core/report`, #10)

Spec: [report.md](../docs/features/report.md). Read only: every figure is an aggregate over the
local database, nothing is stored.

- `ReportService`: its own `unit` (`ReportUnit`: month / quarter / year / custom, kept per
  profile in `tpn-profile:report:unit:…`, never custom), `tab` (a number, no "อนาคต"),
  `custom`, `customSheet`, `type` (the breakdown's tab), `chosenCurrency` / `currencyCode()`;
  `walletIds` and `today` are the Transactions tab's (Q3). `range()` / `previousRange()` always
  have both ends. `summaries()` (per currency: income, expense, net, transfer, left-out count
  and sum, `start` / `end` balances, `perDay`), `hasData()`, `breakdown()`, `trend()`; the
  page-level reads `byCategory(range, walletIds, type, currency, parentId?)` (a parent's split,
  its own money as `direct`) and `categoryTotal(range, walletIds, ids, currency)`.
- `features/reports`: the tab page, `/reports/category/:id[/:sub]` (`sub` = a child's id or
  `direct`) and `/reports/excluded`; `components/` (summary card H1, trend bars as buttons,
  share list, the day list drawn 100 at a time); `report-view.ts` (`reportView()`: chips,
  swipe, money; `periodName`, `sharePercent`). Its lists come from `TransactionService.list`
  with a third argument, a `ListFilter` (`categoryIds`, `report` `counted` | `excluded`,
  `currencyCode`).
- Charts are plain elements with token colours (no chart library, owner's choice in #10):
  heights and widths as `%` styles, every bar pair a button with an `aria-label`.
- The header is `layout/transactions-header` with `view="reports"` (only "ดูตาม", the report
  units); `app-header` shows it on `/reports` itself (`isReportsTab`). The tab's custom range
  sheet lives in the page (`@defer`), so the shell never loads `ReportService`.
- Shared with the Transactions tab: `shared/components/period` (`app-period-strip`, the
  `appSwipe` directive, `app-custom-range-sheet` with `range` in and `applied` out).
- Specs: `report.service.spec.ts` on a test database; the pages use
  `features/reports/report-testing.ts` (`setUpReports()`: real services, a seeded October).

### Recurring (`core/recurring`, #12)

Spec: [recurring.md](../docs/features/recurring.md).

- `RecurringService`: `items()` (the current profile's live rules as `RuleItem`s: state
  `active` / `paused` / `stopped` (an archived wallet or category) / `ended`, names, signs),
  `due()` (ask-first occurrences up to today), `byId()`, `itemOf()`, `recordedCount()`,
  `create(values)` (the rule and its occurrences up to today in one write), `update(id, values,
fixOpId?)` (a new schedule starts from today; a refused create comes back), `setPaused()`,
  `remove()` / `restore()`, `confirm(ruleId, on, values?)`, `skip(ruleId, on)` (a tombstone with
  the occurrence's id), `confirmAll()`, `upcoming(range, walletIds)` (3 months, never stored),
  `open(id)` (the transaction or transfer sheet in `rule` mode). An effect is the **recording
  pass**: after the first sync round (`SyncService.rounds()`) or at once when it can't sync,
  never while a round runs, over every profile; it sweeps rules of deleted wallets or
  categories (after `followMerges`) and **opens no write when nothing changes** (an empty write
  re-runs the pass forever).
- An occurrence's id is `occurrenceId(ruleId, day)` (`occurrence-id.ts`, SHA-256 in plain JS so
  it works inside a synchronous local write; a UUID v8). Whether one exists (live or skipped) is
  a lookup by that id; never write it twice.
- `schedule.ts` (pure: `occurrenceOn`, `indexOnOrAfter`, `isPastEnd`, `nextOnOrAfter`,
  `occurrencesBetween`, `lastOccurrence`; always counted from `startOn` with `addMonths`'
  clamp), `describe.ts` (texts for a schedule, given a translate function and a locale).
- A third kind, `debt` (#13, debt rule 13), records a debt's repayments as `debt_entries`
  (`tableOf`), and a transaction rule may carry `debtId` (a repaid debt's instalments; `update`
  keeps the rule's `debtId` when the form doesn't send one). A closed debt stops its rules
  (`stoppedBy` kind `debt`); `ruleTitle(item, t, full?)` (`describe.ts`) names a rule of any kind
  for the rules page, the due sheet and the upcoming rows. `open()` of a `debt` rule goes to its
  debt's page (`?rule=`).
- `core/wallet` / `core/category` read the table by name (`RECURRING_TABLE`, `tombstoneRules` in
  `core/wallet`): deleting a wallet or category tombstones its rules in the same write, a rule
  fixes a wallet's currency (`canChangeCurrency`) and a category's type (`ruleCount`), and
  `moveTransactions` (a merge) moves rules too.
- UI: `layout/repeat-view` (the "ทำซ้ำ" view, `value` is a `model`) and `layout/repeat-row`, used
  by both sheets (states `create` with `repeat` / `occurrence`, `rule`, `fixRule`);
  `features/account/pages/recurring-page`; `features/transactions/components/due-sheet`
  (`@defer`red by the page) and the page's due card and upcoming rows (`group.upcoming`).
- Specs: `recurring.service.spec.ts` on a test database (the pass runs on `TestBed.tick()`);
  the sheets and pages put `recurring_rules` rows with `putRow`.

### Debts (`core/debt`, #13)

Spec: [debt.md](../docs/features/debt.md).

- `DebtService`: `items()` (the current profile's live debts as `DebtItem`s: `total`, `paid`,
  `left`, `interest`, `instalments`, `lastOn`, `closed`, `forgiven`, `overdue`, all computed in
  one query, never stored), `openItems()`, `item(id)`, `byId()`, `entryById()`,
  `history(debtId)` (entries and linked transactions, newest first), `rules(debtId)`,
  `people()`, `create(values, plan?)` (the debt and its principal in one write; a plan is a
  recurring rule made right after), `update()`, `fix()`, `remove()` (entries and rules go, linked
  transactions stay), `saveEntry(id, debtId, values, interest?)` (interest = a linked counted
  transaction in the same write), `removeEntry()` / `restoreEntry()`, `close(...)` (the rest into a wallet, or forgiven: a repayment entry + a counted transaction in one
  wallet), `interestCategory()`, the sheets' signals `sheet` / `entrySheet` / `closeSheet`,
  `openFix(opId)`.
- The services it builds on read its tables **by name** from `core/wallet/debt-tables.ts`
  (`DEBT_TABLE`, `DEBT_ENTRY_TABLE`, `DEBT_ENTRY_SIGN_SQL` (an entry's sign in its wallet),
  `DEBT_SETTLES_SQL`, `DEBT_FORGIVES_SQL`, `DEBT_LEFT_SQL`): wallet balances and
  `hasTransactions`, a category's `hasTransactions` (a live debt uses it) and `moveTransactions`
  (a merge moves debts), `TransactionService.debtEntries` / `entries` (`DebtEntryItem`, kind `debt`) / `summary` (`debt`) and its sweep of orphaned debts and entries, report balances,
  `RecurringService` (a closed debt stops its rules). None of them imports `core/debt`.
- Transactions carry `debtId` (`TransactionValues.debtId` is optional: absent keeps the row's);
  the transaction sheet shows a "หนี้" row that opens the debt.
- UI: `features/debts` (`/wallets/debts`, mounted in `app.routes.ts` before `wallets`): the list
  and debt pages render `components/debt-sheets` (each sheet `@defer`red on its signal); the
  sheets share `components/category-pick` and the shared `app-wallet-pick` (rows from
  `walletPickItems()` in `debt-view.ts`) and `app-date-row`. A debt entry row on the
  Transactions tab navigates to `/wallets/debts/<id>?entry=<entryId>`. Validators of a sheet's
  form run while the form is built, so they read the control's parent, never fields declared
  after the form.
- Specs: `core/debt/debt-testing.ts` (`setUpDebts(today, routes)`: a test database, real
  services, `debt` / `entry` / `transaction` helpers), `debt.service.spec.ts`,
  `features/debts/debts.spec.ts` (`RouterTestingHarness`). A component that reaches `DebtService`
  through a stubbed `SyncService` needs `rounds` in the stub (it injects `RecurringService`).

### Events (`core/event`, #14)

Spec: [event.md](../docs/features/event.md).

- `EventService`: `items()` (the current profile's live events as `EventItem`s: `money` per
  currency with every tagged row, `excludeFromReport` ones too, `count`, `walletCount`,
  `current`; one aggregate query, never stored), `openItems()` / `closedItems()`, `atLimit()`
  (50 open), `item(id)`, `byId()`, `byCategory(id)`, `save(id | null, values, fixOpId?)`,
  `setClosed(id, closed)` (false when reopening is over the limit), `remove(id)` (**the
  tombstone only**: rows keep `eventId`, so another device's offline edit of one never loses
  to the delete), `rowCount(id)`, `sheet` / `open()` / `openFix()` / `refused()`.
- `core/transaction` reads `events` **by name** (`EVENT_TABLE`, `EventOption`):
  `eventOptions(profileId, keepId?)` (open ones by start, plus the row's own),
  `defaultEventId(profileId, day)` (rule 5), `liveEventId(id)` (null for a deleted event),
  `TransactionItem.eventName` (a live event only), `ListFilter.eventId`, and
  `TransactionValues.eventId` (optional: absent keeps the row's). It never imports `core/event`.
- The transaction sheet's "อีเวนต์" row is a signal (`eventId`, `eventChosen`), not a form
  control: while adding, an effect sets it from the date until the user picks (or clears) one;
  edit, fix and copy start from the row's live event; "ทำซ้ำ" saves none (rules carry no event).
  A create state may carry `eventId` (the event page's "เพิ่มรายการ").
- UI: `features/events` (`/transactions/events`, mounted in `app.routes.ts` before
  `transactions`): the list and event pages `@defer` `components/event-sheet` (dates in the
  shared `app-date-row`); `event-view.ts` (`eventDates` with `formatRange`, `counted` for the
  one/many keys).
- Specs: `core/event/event-testing.ts` (`setUpEvents`: `setUpDebts` plus an `event` helper),
  `event.service.spec.ts`, `features/events/events.spec.ts`, the transaction sheet's
  `event / trip` block.

### Export (`features/account/pages/export-page`, #15)

Spec: [export.md](../docs/features/export.md). Account › ส่งออก CSV, read only, offline.

- `export-data.ts` reads the tables by name (`exportCount`, `exportRows`, `exportCsv`,
  `walletChoices`, `categoryChoices`, `dataSpan`); `csv.ts` (`csvField`, `csvText` for the
  formula guard, `toCsv` with the BOM and CRLF, `exportFileName`, ASCII only); the page and its
  pick sheet (`export-pick-sheet.ts`, ticks per tab and tree). The page shares the file on a
  touch device (`navigator.share` with files) and downloads it elsewhere.
- Specs: `csv.spec.ts`, `export-data.spec.ts` and `export-page.spec.ts` on `setUpDebts()`
  (the page stubs `URL.createObjectURL` and the link's `click`).

### Sharing (`core/sharing`, #16.1, #16.2)

Spec: [sharing.md](../docs/features/sharing.md).

- `SharingService` is the one place that calls `/sharing/*` (online REST, offline-sync rule 15):
  what it reads stays in **signals only** (`withMe`, `owner(profileId)`, `readAt`) and is
  cleared when the signed-in user changes. `canCall()` = online and the server reachable;
  screens disable every action without it. `failure(error)` gives a translation key
  (`sharing.error.<CODE>`, `sharing.needsOnline`). `loadOwner` also feeds
  `TransactionService.addPeople` (the names behind "เพิ่มโดย …").
- **A shared profile in use** (16.2): `openShared(group)` sets `ProfileService.shared`
  (`loading` → `ready`; `current()` returns its profile, never stored), reads
  `/sharing/with-me/:id/rows` page by page while a running own round ends
  (`SyncService.idle()`), then `OfflineService.enterShared()` and `fillShared()` put the rows in
  **TEMP tables that shadow `SHARED_TABLES`** (`LocalDatabase.createShadows`): every service
  and screen reads them unchanged, `export()` (the saved snapshot) never holds them. Meanwhile
  own sync rounds wait (`canSync` false) and nothing is saved; `OfflineService.write` rolls back
  any op that isn't a transaction. An editor's write lands in the TEMP outbox and an effect
  pushes it at once (`SyncService.pushShared`, no pull); `STALE` → toast + read again,
  `NOT_SHARED` (or a 404 read) → toast + back to an own profile. `refreshShared()` reads what
  changed (every minute, back online, on visibility). `ProfileService.select()` /
  `leaveShared()` drop the TEMP tables; a lock clears it too.
- The shell loads the service with a dynamic `import()` after its first render (like
  `RecurringService`) and holds it in a signal for the Account tab's invite dot and the switch
  sheet's "แชร์กับฉัน" group (`[sharing]` input), so it stays out of the initial bundle; `import
type` is all the shell has of it. `AppShell.gate()` shows `layout/shared-profile-step` for a
  shared profile offline, on Reports and on the profile's own setup pages (`OWN_ONLY`). In a
  shared profile, screens hide what isn't shared (the Wallets tab's wallet actions and debts, the
  ⋮ menu's transfer / debts / events / rules, the sheet's "ทำซ้ำ" and hidden-category links),
  and ➕ is off while `canWrite()` is false (viewer, offline, loading).
- Specs: `core/sharing/sharing-testing.ts` (`setUpSharing`: test DB with profile `p1` and
  wallets, a fake `OfflineService` with real TEMP shadows, a fake push `sync.answer`,
  `provideHttpClientTesting`, network signals); answer reads with `envelope(data)` and let the
  promise settle (`setTimeout`) before checking signals. A fake `OfflineService` for a service
  that reaches `ProfileService` gives it `sharedActive` and `leaveShared`.

### Inside a feature

```
features/transactions/
  transactions.routes.ts     # lazy route config (default export Routes)
  transactions.api.ts        # HTTP calls for this feature only (uses core API client)
  transactions.store.ts      # signal-based state for the feature (when needed)
  transactions.type.ts       # response/request types mirroring the API contract
  transactions-form.type.ts  # typed reactive form: <Name>FormGroup + <Name>FormValue (see §3 Forms)
  pages/                     # routed components (one folder per page), orchestration only
  components/                # feature-only presentational components (no HTTP)
  index.ts                   # public API (routes + anything other features may use)
```

Skip files you don't need. Keep the naming when you add them.

A page in `pages/<page>/` imports its feature's own files by alias
(`@/features/auth/auth-flow.store`), since `../` is banned. Lint allows `@/features/<name>/...`
only from inside that same feature (`ownFeatureConfigs` in `eslint.config.mjs`); other features
still go through `@/features/<name>`.

Barrels (`index.ts`) are **single level**. A folder's `index.ts` re-exports only the files directly
inside it, never another barrel. Import from the folder that holds the file
(`@/shared/components/form`, not `@/shared/components`). Folders inside a feature get no barrel,
except the feature's own `index.ts`.

## 3. Hard conventions

### Imports & formatting

- Use the `@/` alias (→ `src/app/*`) for anything outside the current folder. `../` imports are
  banned by lint. Same-folder imports use `./`.
- Import order is enforced (`import/order`, alphabetized, no blank lines between groups):
  `@angular/**` → `rxjs` → other external → `@/...` → `./...` → `import type`.
- Type-only imports use `import type`. Don't turn an injected class into a type import. We use
  `inject()`, so lint auto-fix is safe.
- Prettier: 2 spaces, single quotes, **no semicolons**, trailing commas `es5`, width 100. Tailwind
  classes are auto-sorted by `prettier-plugin-tailwindcss`.
- Run `npm run fix` when unsure.

### TypeScript

- `strict` + `noUnusedLocals` / `noUnusedParameters`. No `any`, so use `unknown` and narrow it. Prefix
  intentionally unused params with `_`.
- Every Promise is awaited or handled (`no-floating-promises`).
- No `console.log` (only `console.warn` / `console.error`).

### Angular

- Standalone components only. Don't set `standalone: true` (it's the default). Don't set
  `ChangeDetectionStrategy.OnPush` either (the default in v22).
- Signals for state: `signal()`, `computed()`, `linkedSignal()`; `update`/`set`, never `mutate`.
- `input()`, `output()`, `model()`, `viewChild()`, never the decorator forms. `inject()`, never
  constructor injection.
- Host bindings go in the `host` object, never `@HostBinding` / `@HostListener`.
- Native control flow (`@if`, `@for`, `@switch`). Use `class`/`style` bindings, never `ngClass` /
  `ngStyle`. Don't import `CommonModule`.
- Lazy-load every feature route from `app.routes.ts`.

### Members & naming (same as kixly-deck-admin)

- Don't write `public`, because it's the default. Use `private` for internals and `protected` for
  members only the template reads.
- **No `readonly` on `inject()` results or on `signal()` / `computed()` / `input()` fields.**
  `readonly` is only for const-like values: `private readonly STORAGE_KEY = 'tpn-theme'`.
- Injected project services are named `<name>Service` (`authService`, `walletService`). Angular APIs
  have no suffix (`router`, `http`, `document`, `destroyRef`). `NonNullableFormBuilder` is `nnfb`.

```ts
private nnfb = inject(NonNullableFormBuilder)
private walletService = inject(WalletService)
private readonly MAX_NAME = 50
isProcessing = signal(false)
```

### UI: Tailwind for layout, spartan for components

- **Tailwind is the base for layout and spacing**: flex/grid, gaps, padding, sizing, safe areas,
  responsive tweaks. Write it in templates. Add custom CSS only when Tailwind can't express it.
- **spartan/ui is the base for how controls look**: buttons, inputs, fields, switches, sheets
  (drawer), dialogs, toasts (sonner), tabs. Use the helm directive or component (`hlmBtn`,
  `hlmInput`, `<hlm-switch>`, …) instead of styling raw elements yourself.
- Colours come from **theme tokens**: `bg-background`, `text-foreground`, `text-muted-foreground`,
  `bg-primary`, `text-brand`, `text-income`, `text-expense`, `text-destructive`, `border-border`, …,
  defined per theme in `src/styles/themes/*.css` (see `DESIGN.md` §3). Never use raw
  palette classes (`bg-slate-50`, `text-red-500`), so dark mode and re-theming keep working. The
  only exceptions are user-chosen colours (wallet/category colour), which arrive as data.
- `src/app/shared/ui/**` is **generated by the spartan CLI** (style `maia`, theme `neutral`, config
  in `components.json`) and is excluded from ESLint. Don't edit it by hand: wrap it, or regenerate
  it. To add a primitive, run `npx ng g @spartan-ng/cli:ui <name>` (e.g. `drawer`, `sonner`,
  `tabs`). It adds `@spartan-ng/helm/<name>` to `tsconfig.json`. Delete the `.nx/` cache folder it
  leaves behind.
- **Text in a focusable control is at least 16px** (`text-base`) on phones: iOS Safari zooms the
  page in when a smaller `input`, `select` or `textarea` gets focus. Never fix it with
  `maximum-scale=1` (it blocks pinch zoom, WCAG 1.4.4). Spartan primitives take a class input for
  it (`inputClass` on the OTP, `selectClass` on the native select).
- Icons: `@ng-icons/lucide` via `NgIcon` + `provideIcons({ ... })` in the component. Brand
  marks that must keep their own colours (Google's "G") live in `shared/components/brand`.
- Toasts: one `<hlm-toaster>` in the app root (`app.ts`), at the top of the screen (8.2). Show one
  with `toast.success(text)` from `@spartan-ng/brain/sonner`, translating the text when it's
  shown. `app.ts` moves the toaster beside `<body>` and `app.config.ts` sets CDK's
  `OVERLAY_DEFAULT_CONFIG` `usePopover: false`: a sheet in the top layer would cover every toast,
  and a toast inside `<body>` would be `aria-hidden` and count as a tap outside the sheet.

### Forms: Reactive Forms only, through shared fields

One pattern for every form in the app (adapted from kixly-deck-admin):

- **Always `NonNullableFormBuilder`** (`private nnfb = inject(NonNullableFormBuilder)`). **Never
  `new FormControl()` / `new FormGroup()`, and never Signal Forms or template-driven forms.** A
  form is always a typed `FormGroup` built by `nnfb.group`. A lone control outside a form (e.g. a
  list filter) is `nnfb.control(...)`, bridged to signals with `toSignal(control.valueChanges, {
initialValue })`.
- **Typed form model** in `<feature>-form.type.ts`:

  ```ts
  export interface WalletFormControls {
    name: FormControl<string>
    type: FormControl<WalletType | ''>
    excludeFromTotal: FormControl<boolean>
  }
  export type WalletFormGroup = FormGroup<WalletFormControls>
  export type WalletFormValue = ReturnType<WalletFormGroup['getRawValue']>
  ```

- **Render fields with the shared wrappers** in `@/shared/components/form`. Never hand-build
  `<label>` + input + error markup in a feature:

  | Field                   | Control type            | Use for                                       |
  | ----------------------- | ----------------------- | --------------------------------------------- |
  | `app-input-field`       | `FormControl<string>`   | text / email / tel / url / search             |
  | `app-password-field`    | `FormControl<string>`   | password with show/hide                       |
  | `app-textarea-field`    | `FormControl<string>`   | multi-line note                               |
  | `app-select-field`      | `FormControl<T \| ''>`  | short fixed list (native picker on phones)    |
  | `app-otp-field`         | `FormControl<string>`   | 6-digit code (`one-time-code`; `hideLabel`)   |
  | `app-switch-field`      | `FormControl<boolean>`  | on/off setting row                            |
  | `app-icon-field`        | `FormControl<string>`   | pick a curated icon (radio grid, groups)      |
  | `app-color-field`       | `FormControl<string>`   | pick a user colour (radio swatches)           |
  | `app-name-icon-field`   | `FormControl<string>`   | compact sheet: icon button + name             |
  | `app-amount-field`      | text + `negative` bool  | money in major units, +/− button, currency    |
  | `app-segmented-field`   | `FormControl<string>`   | two or three short options (รายจ่าย / รายรับ) |
  | `app-toggle-list-field` | `FormControl<string[]>` | rows with a switch each; holds the ids off    |
  | `app-calc-amount-field` | `FormControl<string>`   | the keypad's number (amount row)              |

  Every field takes `[control]` (the typed control, so templates are type-checked) plus `label`,
  and optionally `hint` / `placeholder`. Labels are linked to the control automatically, so there's
  no `id` input. Add a new `*-field` here (flat file, inline template, `HlmFieldImports` +
  `fieldErrorMessage`) when a control type repeats, e.g. an amount field for money.

- **Validation messages**: Angular's built-in `Validators.*` already show a translated default
  message (`field-error.ts` → `form.*` keys). For a custom message, wrap the validator with a
  **translation key**: `withMessage(Validators.required, 'wallets.nameRequired')`. A custom
  validator returns its key as the error value (`{ sameAsEmail: 'auth.passwordSameAsEmail' }`).
  Messages are translated at display time, so they follow a language switch. Errors appear once a
  field is touched, or for all fields on submit.
- **Form component shape:**

  ```ts
  @Component({
    selector: 'app-wallet-form',
    imports: [FORM_IMPORTS, TranslocoPipe, InputField, SelectField, SwitchField, HlmButton],
    template: `
      @let f = form.controls;
      <form [formGroup]="form" class="flex flex-col gap-4" (ngSubmit)="onSubmit()">
        <app-input-field [control]="f.name" [label]="'wallets.name' | transloco" />
        <app-select-field
          [control]="f.type"
          [label]="'wallets.type' | transloco"
          [options]="typeOptions()"
        />
        <app-switch-field
          [control]="f.excludeFromTotal"
          [label]="'wallets.excludeFromTotal' | transloco"
        />
        <button hlmBtn type="submit" [disabled]="isProcessing()">
          {{ 'common.save' | transloco }}
        </button>
      </form>
    `,
  })
  export class WalletForm {
    private nnfb = inject(NonNullableFormBuilder)

    wallet = input<Wallet | null>(null)
    isProcessing = input(false)
    submitted = output<WalletFormValue>()

    form: WalletFormGroup = this.nnfb.group({
      name: [
        '',
        [withMessage(Validators.required, 'wallets.nameRequired'), Validators.maxLength(50)],
      ],
      type: this.nnfb.control<WalletType | ''>('', Validators.required),
      excludeFromTotal: [false],
    })

    protected onSubmit(): void {
      if (this.form.invalid) {
        return // FORM_IMPORTS already marked every field touched, so errors are showing
      }
      this.submitted.emit(this.form.getRawValue())
    }
  }
  ```

  `FORM_IMPORTS` = `ReactiveFormsModule` + `MarkTouchedOnSubmit`, which attaches to every
  `<form [formGroup]>` by itself.

- **Reacting to one control**: a control's own `valueChanges` fires **before** the form's, so a
  `computed()` fed by `toSignal(form.valueChanges)` still holds the previous value there. Read
  `form.getRawValue()` (or the controls) inside such a subscription (see `dropUnfit` in
  `layout/transaction-sheet`, fixed in #9).
- **Form value → API payload**: build the payload as a **fresh object literal** naming only the fields
  the endpoint takes (`{ name: value.name, type: value.type }`). Never forward the form value object
  itself, because a UI-only field would silently leak into the request body. Map empty optional
  text to **`null`**, not `''` (null-first, as in kixly).
- The presentational form component holds no HTTP. The page (or the sheet opener) calls the service
  and owns `isProcessing`.
- `NgOptimizedImage` for static images.
- Prefer `@Service()` for new singleton services (v22+). Otherwise use `@Injectable({ providedIn: 'root' })`.
- Prefer inline templates for small components. External template/style paths are relative to the
  component file.

### Accessibility

Must pass AXE checks and WCAG AA (focus management, contrast, ARIA). `templateAccessibility` lint rules
are on, so don't disable them.

### Money & dates

- Amounts arrive from the API as **integers in minor units** (satang for THB) together with a currency
  code. Never do float maths on amounts. `@/shared/utils` has `parseMajor(text, minorUnit)`
  (typed text → minor units, through strings), `toMajorText()` (back, grouped) and
  `formatMoney(minor, code, minorUnit, locale)`. Format them for display only, with `Intl.NumberFormat`
  using `LanguageService.locale()` (`th-TH-u-ca-gregory` / `en-GB`), the currency's minor-unit
  digits and `currencyDisplay: 'narrowSymbol'` (so English shows ฿, not "THB"). The transaction
  list shows amounts without the symbol: `formatAmount(minor, minorUnit, locale, signed)`.
- **Amount keypad** (`@/shared/utils` `calc.ts`): `pressKey(expr, key, minorUnit)` keeps the
  typed number well formed, `evaluate(expr, minorUnit)` works it out as exact BigInt fractions
  to the minor unit, `addQuickAmount` adds a chip to it and returns the total. Never `eval` or
  floats. The keypad has **no operators** (owner, 2026-11) and `CALC_KEYBOARD` maps none; the
  engine still understands + − × ÷, so don't build on that.
- Dates: the API sends ISO strings. Display them with `Intl.DateTimeFormat(locale())`: both
  languages show the **Gregorian year** (owner's choice in #8; the Thai locale pins
  `-u-ca-gregory`). Calendar days are `YYYY-MM-DD` local dates: `toDay`, `fromDay`, `addDays`,
  `addMonths`, `isDay` in `@/shared/utils` (`day.ts`).

### UI text: Thai + English (Transloco)

- The UI ships in **Thai (default) and English**, switched at runtime with no reload
  (`@jsverse/transloco`, set up by `provideI18n()` in `core/i18n`). There is no SSR, so there are
  no per-language builds or URLs.
- **Never write UI text inline.** Every string is a key in `core/i18n/th.json` **and**
  `core/i18n/en.json`, grouped by feature (`wallets.emptyHeading`, `form.required`). Add both
  languages in the same change; `translations.spec.ts` fails if the key sets differ or a value is
  empty. Wording rules and the glossary are in `DESIGN.md` §11.
- In templates use the pipe: `{{ 'wallets.emptyHeading' | transloco }}`,
  `[label]="'wallets.name' | transloco"`, `[attr.aria-label]="'nav.add' | transloco"`. Params use
  `{{ name }}` in the JSON: `'form.minlength' | transloco: { requiredLength: 8 }`.
- In TypeScript (option labels, toasts), translate inside a `computed()` that first reads
  `languageService.language()`, so the text updates on a switch (see `themeOptions` in
  `features/account/pages/account-page/account-page.ts`).
- Translations are bundled as lazy chunks (not fetched JSON), so the service worker prefetches them
  and both languages work offline. `LanguageService` loads the saved language before the first
  render and loads a new one before switching, so keys never flash on screen.
- Not translated: the app name ตังค์ไปไหน, theme names (Midnight Gold, …), language names (each
  in its own language) and user data (wallet / category names).

## 4. API & session contract

- **Offline-first.** Screens read and write the **local database**, not the API. Own data reaches
  the server only through the sync outbox (`/sync/push` and `/sync/pull`). Direct API calls are for
  auth, sharing (`core/sharing`: invitations and wallets you're a member of, online only), and
  sync itself. Read
  [`offline-sync.md`](../docs/features/offline-sync.md) before building any data screen.
- **All calls go through `ApiClient`** (`@/core/api`): `api.get<T>('/wallets')`,
  `api.post<T>('/auth/email/start', body)`, `api.put` / `api.delete` (a body is allowed). Paths are relative to **`/api`**. In production,
  `web/middleware.js` (Vercel Routing Middleware, `API_ORIGIN` per environment) sends `/api/*` on
  the web project to the API project, so the browser sees one origin.
  That keeps the refresh-token cookie first-party (`*.vercel.app` is a public suffix, so
  cross-project cookies would be third-party and blocked). In dev, `ng serve` proxies `/api` to
  `http://localhost:3000` and strips the prefix (`proxy.conf.json`), the same mapping as the prod
  middleware. Deploy settings: `web/vercel.json`, steps in `docs/deploy.md`. So there is **no API
  base URL in an environment file**; never hardcode `http://localhost:3000`, and never call
  `HttpClient` directly from a feature.
- **Response envelope**: `{ message, timestamp, data?, code? }` (`ApiResponse<T>`): read `data`.
  On failure, `toApiError(error)` gives `{ status, code?, message?, retryAfterSeconds? }`;
  `isUnreachable()` is true for no network (status 0) or a proxy answering for a dead API
  (502–504 without a body). Pick UI text from `code`, never from the English `message`.
- **Session** (`@/core/auth`, spec: [`auth.md`](../docs/features/auth.md), API side:
  `../api/AGENTS.md` §4):
  - `AuthStore` holds the access token, user and `status` (`unknown` → `signedIn` /
    `signedOut` / `unreachable`) as signals. The access token lives **in memory only**, never in
    any storage. The refresh token is the httpOnly `__Host-rt` cookie the app can't read.
  - `authInterceptor` adds `Authorization: Bearer` to `/api` calls. On a `401` it calls
    `AuthService.refresh()` once and retries; if the refresh is refused it clears the store and
    goes to `/auth/sign-in?returnUrl=…`. Auth calls themselves pass `skipAuthRefresh()` as the
    request context so they're never retried.
  - `AuthService.refresh()` is shared by concurrent callers and runs inside a Web Lock
    (`tpn-auth-refresh`), so two tabs never present the same refresh token (the API treats a
    reused token as theft and signs every device of that sign-in out).
  - App start: `shellGuard` / `guestGuard` call `AuthService.restore()`, one silent refresh (after
    sending a sign-out made offline, if one is pending). A reload therefore costs one
    `/auth/refresh`. When the API is unreachable the status is `unreachable` (not signed out),
    and the sign-in page retries once the network is back.
  - `AuthStore.endedBy()` says why a refresh was refused (`revoked`, `expired`, or `null`).
    Every sign-in path goes through `AuthService` (`verifyCode`, `verifyLink`,
    `signInWithPassword`, `verifyPhone`, `finishGoogleSignIn`).
  - Sign-out: `SyncService.flush()` (push; if ops would be lost, ask first), then
    `AuthService.signOut()`, then `OfflineService.wipe()`, then navigate to sign-in
    ([offline-sync](../docs/features/offline-sync.md) rule 7).
    `signOutOrLater()` is for a device that must forget the session even offline (the lock
    screen's "forgot PIN", the 5th wrong PIN).
  - Password (4.2): `AuthService.signInWithPassword()`, `setPassword()`, `removePassword()`,
    `startReauth()` / `verifyReauth()`. `AuthUser.hasPassword` says whether one is set. Routes that
    change credentials may answer `403 REAUTH_REQUIRED`: show the confirm step (current password or
    a step-up code, `features/account/components/reauth-step.ts`) and send the same request again.
    `passwordPolicyValidator` (`@/core/auth`) mirrors the API's policy for instant feedback.
  - Google (4.3): `AuthService.providers()` (`GET /auth/providers`, asked once; off when
    unreachable) decides whether "Continue with Google" shows. `startGoogle(returnUrl)` is a
    **full-page navigation** to `/api/auth/google/start` (`googleStartUrl`), not an API call. The
    API comes back to `/auth/callback` (`features/auth/pages/google-callback-page`), which calls
    `refresh()` once: the URL never holds a token, only `returnUrl`, `linked=google` or
    `error=<reason>` (`GoogleFailure`). `AuthUser.identities` lists linked providers.
  - Account › Security (4.4a, `features/account/pages/security-page`): `sessions()`,
    `revokeSession(id)`, `revokeOtherSessions()`; `linkGoogle(lang)` is an API call that then
    **navigates** to Google's URL, and the API comes back to `/account/security?linked=google` or
    `?error=<reason>` (`GoogleLinkFailure`); `unlinkGoogle(lang)`. Calls that change credentials
    take the UI language (`LanguageService.language().id`) as `lang`, for the mail the API sends
    about the change. A page that runs the confirm step provides `ReauthFlow`
    (`features/account/reauth-flow.ts`), calls `reauth.refused(action, error, hasPassword)` on a
    failure and sends the pending action again once confirmed. `deviceLabel()` turns a session's
    user agent into "Chrome · Android".
  - Phone (4.4b): `providers().phone` decides whether the sign-in page's phone tab and adding a
    number show. All of it is also held back by `PHONE_FEATURE`
    (`core/auth/phone-feature.ts`, `false` until the feature is finished: no sign-in tab, no
    Security row, `/account/phone` redirects to Security; specs provide `true`). Numbers travel in E.164 and show the Thai way: `normalizeThaiMobile`,
    `formatThaiMobile` (`081-234-5678`) and `thaiMobileValidator` (`@/core/auth`) on an
    `app-input-field` with `type="tel"`, `inputmode="tel"`, `autocomplete="tel-national"`.
    Sign-in: `startPhone` / `verifyPhone`, on the sign-in page's phone tab
    (`/auth/sign-in?with=phone`, `features/auth/components/phone-sign-in`) then the shared `/auth/code` screen
    (`AuthFlowStore.pending()` holds either `email` or `phone`). Account › Phone
    (`features/account/pages/phone-page`): `changePhone` (recent auth, sends the SMS),
    `confirmPhone(code, lang)`, `removePhone(lang)`; `AuthUser.phone` is the saved number or
    `null`.
- **Auth error codes** the screens switch on: `OTP_INVALID`, `OTP_LOCKED`, `OTP_EXPIRED`,
  `SESSION_EXPIRED`, `SESSION_REVOKED`, `USER_DISABLED`, `RATE_LIMITED` (with `Retry-After`),
  `INVALID_CREDENTIALS`, `CURRENT_PASSWORD_INVALID`, `REAUTH_REQUIRED`, `PASSWORD_TOO_SHORT`,
  `PASSWORD_TOO_LONG`, `PASSWORD_TOO_WEAK`, `PASSWORD_MATCHES_EMAIL`, `PASSWORD_BREACHED`,
  `CURRENT_SESSION`, `IDENTITY_ALREADY_LINKED`, `GOOGLE_IN_USE`, `PHONE_DISABLED`,
  `PHONE_UNCHANGED`, `PHONE_IN_USE`.
  `authErrorMessage` (`core/auth/auth-error.ts`, shared by the auth and account features) maps
  them to translation keys.
- **Testing**: `provideHttpClient(withInterceptors([authInterceptor]))` +
  `provideHttpClientTesting()`; flush envelopes from `HttpTestingController`. A spec that renders
  the shell sets a session on `AuthStore` first and stubs `DeviceStorageService` (see
  `app.spec.ts`). `restore()` sends its request a tick later than `refresh()` does.

## 5. Definition of done

1. Build the screen(s) against the feature doc and [`DESIGN.md`](DESIGN.md).
2. Try it on a phone-sized viewport (375×812), in light and dark and in Thai and English, and go
   through the checklist in `DESIGN.md` §12.
3. Once the developer confirms the behavior, write the tests (§1 Testing).
4. Run:

```bash
npm run fix
npm run typecheck
npm test     # whenever spec files exist for the touched code
npm run build
```

CI (`.github/workflows/web.yml` at the repo root) runs lint, typecheck, test and build on every PR and every push to `main`.

## 6. Commit messages & git

Same as the API (`../api/AGENTS.md` §10–11): Conventional Commits (`feat(<scope>): ...`) with a bullet
body, one logical change per commit. **Do NOT run `git commit` or `git push` unless the user
explicitly asks.** When the user wants to commit themselves, suggest a message instead.
