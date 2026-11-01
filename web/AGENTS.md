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

### App shell & PWA

- `app.routes.ts` mounts `AppShell` (`layout/`) as the layout route for the tab pages: header (page
  title from the route's `title`, sync status pill, update banner), the page, and the fixed
  bottom tab bar. Give every routed page a `title` that is a **translation key** (`title.wallets`);
  `PageTitleStrategy` (`core/routing`) translates it for the header and the document title.
  Full-screen flows that shouldn't show the bar (sign-in, PIN) go outside it.
- The sign-in flow (`features/auth`, under `/auth/*`) is mounted before the shell with its own
  `AuthLayout` (app name + language switch); so are the trusted-device screens `/auth/trust`,
  `/auth/lock` and `/auth/tab` (offline-sync rules 1–3). The shell route carries `shellGuard`
  (`core/offline`, `canActivate` + `canActivateChild`): a signed-in user, or a trusted device
  unlocked with its PIN (even offline or with an expired session). See "Trusted device" below.
- App-wide device state lives in `core/` as signal services: `ThemeService` (`core/theme`),
  `LanguageService` (`core/i18n`), `NetworkStatusService` (`core/network`), `KeyboardService`
  (`core/viewport`), `AppUpdateService` + `DeviceStorageService` (`core/pwa`), `OfflineService`
  and `SyncService` (`core/offline`), `ProfileService` (`core/profile`), `WalletService`
  (`core/wallet`), `CategoryService` (`core/category`).
- The header shows ‹ on a page inside the Account tab (`parentOf` in `layout/profile-routes`):
  the Account tab is grouped rows that each open a page (owner's choice A1 in #7).
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
- The vault (IndexedDB `tpn-vault`, `vault-storage.ts`) holds the clear meta the lock screen needs
  (user id + name, salt, wrapped key, wrong-PIN count) and **one** AES-GCM snapshot of the whole
  database (`vault-crypto.ts`). The data key lives in memory only while unlocked.
- `OfflineService.state()`: `none` (untrusted) / `locked` / `unlocked` / `elsewhere` (another
  tab holds the `tpn-local-db` Web Lock). `enable(pin)`, `unlock(pin)` and `verifyPin(pin)`
  answer `ok` / `wrong` / `wiped` (the 5th wrong PIN wipes and signs out); `changePin`, `lock`,
  `wipe`. It locks by itself after 5 minutes idle or in the background and wipes on a revoked
  session.
- A trusted device keeps working after its session **expires** (`AuthStore.keepsLocalSession`
  stops the interceptor's redirect; `layout/session-banner` offers sign-in). Anything that ends
  a user's time on the device (sign-out, turning offline off) calls `OfflineService.wipe()`.
- An **untrusted** device opens the same database in memory (`openUntrusted()`, called by
  `shellGuard`): it syncs while online and can't write offline (rule 1). `isOpen()` says whether a
  database is open at all; `changes()` is bumped by every `write()`, so a screen's `computed()`
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

### Sync (`core/offline`, #4a.2)

Spec: [offline-sync.md](../docs/features/offline-sync.md) rules 8–12.

- **Every own-data write** goes through `queueWrite(db, table, op, row)` (`outbox.ts`) inside
  `OfflineService.write(...)`: the row lands in its local table and the outbox in one transaction.
  `op` is `upsert` (the whole row, with `createdAt`, `updatedAt: Date.now()`, `deletedAt`) or
  `delete` (the row with `deletedAt` set: a tombstone locally, `{ id, updatedAt }` on the wire).
  Keep the row's `changeSeq` in the object you pass (spread the current row), it becomes the
  op's `baseSeq`. Ids are `uuidv7()`. Screens list rows `WHERE deleted_at IS NULL`.
- **A synced table on the device** = a schema step in `MIGRATIONS` (snake_case columns,
  `change_seq INTEGER` nullable) + an entry in `SYNC_TABLES` (`sync-tables.ts`: key, camelCase
  columns, booleans, `json` columns, `readOnly` for master data). `putRow` / `getRow` / `fromSql`
  map between them. A **JSON column** (an array, e.g. `wallets.hiddenCategoryIds`) is stored as
  text, `'[]'` when the row has none, and parsed by `fromSql`; a typed reader still checks the
  shape (`toWallet` in `core/wallet`). A new column on a shipped table is an `ALTER TABLE` step
  with a default, and specs that rebuild an older snapshot drop it first.
- `SyncService` runs the rounds (push, then pull, `tpn-sync` Web Lock) by itself; screens don't
  call the API for own data. It exposes `status()` (`errors` / `offline` / `syncing` /
  `pending` / `synced`), `pendingCount()`, `rejected()`, `notices()`, `lastSyncedAt()`,
  `serverTables()`, `sync()`, `flush()` (before sign-out: how many ops would be lost),
  `discard(opId)`, `rejectedOp(opId)`, `dismissNotice(id)`.
- **Rejected ops**: the local row already went back to the server's version; the op keeps the
  refused values. A refused profile create carries its refused child rows
  (`ProfileService.rejectedItems()`, read by the sheet and the pill): fixing the profile re-sends
  them in the same write, discarding it drops them (`discardRefused`). "Fix" opens the table's form via `FIX_ROUTES` in `layout/sync-sheet.ts` with
  `?fix=<opId>` (a wallet goes to `/wallets` and calls `WalletService.openFix(opId)` itself,
  because the Wallets tab may be showing the first-wallet step); saving queues a new op and
  deletes the rejected one.
- The header pill is `layout/sync-status.ts`; its sheet (`layout/sync-sheet.ts`, spartan drawer)
  is `@defer`red until first opened.

### Profiles (`core/profile`, #6.1)

Spec: [profile.md](../docs/features/profile.md). Every data screen (wallets, transactions,
reports) shows the **current profile's** data.

- `ProfileService`: `profiles()` (live, in order), `current()` (the device's choice, else the
  first), `ready()` (false only while a new device waits for its first pull), `canWrite()`
  (untrusted = online only), `atLimit()`, `nameTaken()`, `save(id | null, values, fixOpId?)`,
  `remove(id)`, `moveTo(id, index)`, `select(id)`. The current id is `tpn-profile:<userId>` in
  `localStorage` (trusted) or `sessionStorage` (untrusted); `OfflineService.wipe()` removes it.
  `save()` of a new profile writes the default category set in the same write
  (`default-categories.ts`, in `LanguageService`'s language); `switchSheet` opens the switch
  sheet the shell renders (the header and Account › หมวดหมู่ use it).
- The shell owns the profile UI because every tab needs it: `layout/profile-switcher` (header,
  on `isProfileTab()` routes), `layout/profile-sheet` (create / edit / fix / delete, opened by
  `ProfileService.open(state)` from anywhere and `@defer`red), and `layout/profile-create-step`,
  which `AppShell` renders instead of the page on the data tabs while there is no profile. Data
  pages can therefore assume `current()` is set.
- A feature's rows carry `profileId` (from 6.2) and its queries filter by
  `profileService.current()`. Deleting a profile must tombstone its rows in the same
  `OfflineService.write()` (profile rule 8).
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
  `aria-label`.

### Wallets (`core/wallet`, #6.2)

Spec: [wallet.md](../docs/features/wallet.md).

- `WalletService`: `wallets()` (the current profile's live wallets in order, archived too),
  `openWallets()`, `archived()`, `hasWallet()`, `atLimit()` (20 open), `totals()` (per currency),
  `currencies()` / `activeCurrencies()` / `minorUnit(code)` / `defaultCurrency()` (from the
  pulled `currencies`), `balance(wallet)` (= `initialBalance` until #8),
  `canChangeCurrency(id)` (true until #8), `nameTaken()`, `byId()`, `openOf(profileId)`,
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
- **Outbox order matters** when a row points at another: a category put under a parent queued
  after it calls `moveOpLast()` (`core/offline/outbox.ts`) so the parent is pushed first, and
  unarchiving a parent moves its children's ops after its own.
- `layout/category-sheet` (views `form` / `icons` / `parent` / `wallets` / `confirmDelete` /
  `confirmDiscard`; `app-segmented-field` for the type, disabled while it follows a parent or
  the row has children) is `@defer`red by the shell; `features/account/pages/categories-page`
  is Account › หมวดหมู่ with a two-level order mode (an inner `cdkDropList` per parent).
  `layout/wallet-sheet` has a `categories` view (tabs + `app-toggle-list-field`) for the
  wallet's `hiddenCategoryIds`.

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
- Icons: `@ng-icons/lucide` via `NgIcon` + `provideIcons({ ... })` in the component. Brand
  marks that must keep their own colours (Google's "G") live in `shared/components/brand`.
- Toasts: one `<hlm-toaster>` in the app root (`app.ts`), lifted above the tab bar. Show one with
  `toast.success(text)` from `@spartan-ng/brain/sonner`, translating the text when it's shown.

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
  | `app-otp-field`         | `FormControl<string>`   | 6-digit email / SMS code (`one-time-code`)    |
  | `app-switch-field`      | `FormControl<boolean>`  | on/off setting row                            |
  | `app-icon-field`        | `FormControl<string>`   | pick a curated icon (radio grid, groups)      |
  | `app-color-field`       | `FormControl<string>`   | pick a user colour (radio swatches)           |
  | `app-name-icon-field`   | `FormControl<string>`   | compact sheet: icon button + name             |
  | `app-amount-field`      | text + `negative` bool  | money in major units, +/− button, currency    |
  | `app-segmented-field`   | `FormControl<string>`   | two or three short options (รายจ่าย / รายรับ) |
  | `app-toggle-list-field` | `FormControl<string[]>` | rows with a switch each; holds the ids off    |

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
  using `LanguageService.locale()` (`th-TH` / `en-GB`), the currency's minor-unit digits and
  `currencyDisplay: 'narrowSymbol'` (so English shows ฿, not "THB").
- Dates: the API sends ISO strings. Display them with `Intl.DateTimeFormat(locale())`: Thai gets the
  Buddhist era (พ.ศ.), English the Gregorian year. Use a shared pipe once one exists.

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
  auth, shared wallets you're a member of (online only), and sync itself. Read
  [`offline-sync.md`](../docs/features/offline-sync.md) before building any data screen.
- **All calls go through `ApiClient`** (`@/core/api`): `api.get<T>('/wallets')`,
  `api.post<T>('/auth/email/start', body)`, `api.put` / `api.delete` (a body is allowed). Paths are relative to **`/api`**. In production,
  Vercel rewrites `/api/*` on the web project to the API project, so the browser sees one origin.
  That keeps the refresh-token cookie first-party (`*.vercel.app` is a public suffix, so
  cross-project cookies would be third-party and blocked). In dev, `ng serve` proxies `/api` to
  `http://localhost:3000` and strips the prefix (`proxy.conf.json`), the same mapping as the prod
  rewrite. So there is **no API base URL in an environment file**; never hardcode
  `http://localhost:3000`, and never call `HttpClient` directly from a feature.
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
  - `AuthStore.endedBy()` says why a refresh was refused (`revoked`, `expired`, or `null`), and
    `freshSignIn()` marks a sign-in (not a refresh) until the trust step has run. Every sign-in
    path goes through `AuthService` (`verifyCode`, `verifyLink`, `signInWithPassword`,
    `verifyPhone`, `finishGoogleSignIn`), which sets it.
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
  - Phone (4.4b): `providers().phone` decides whether "Sign in with phone number" and adding a
    number show. Numbers travel in E.164 and show the Thai way: `normalizeThaiMobile`,
    `formatThaiMobile` (`081-234-5678`) and `thaiMobileValidator` (`@/core/auth`) on an
    `app-input-field` with `type="tel"`, `inputmode="tel"`, `autocomplete="tel-national"`.
    Sign-in: `startPhone` / `verifyPhone`, on `/auth/phone` then the shared `/auth/code` screen
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
