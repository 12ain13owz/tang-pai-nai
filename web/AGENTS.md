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
  title from the route's `title`, online/offline pill, update banner), the page, and the fixed
  bottom tab bar. Give every routed page a `title` that is a **translation key** (`title.wallets`);
  `PageTitleStrategy` (`core/routing`) translates it for the header and the document title.
  Full-screen flows that shouldn't show the bar (sign-in, PIN) go outside it.
- The sign-in flow (`features/auth`, under `/auth/*`) is mounted before the shell with its own
  `AuthLayout` (app name + language switch). The shell route carries `authGuard`
  (`canActivate` + `canActivateChild`), so every tab needs a signed-in user.
- App-wide device state lives in `core/` as signal services: `ThemeService` (`core/theme`),
  `LanguageService` (`core/i18n`), `NetworkStatusService` (`core/network`), `KeyboardService`
  (`core/viewport`), `AppUpdateService` + `DeviceStorageService` (`core/pwa`).
- The service worker (`ngsw-config.json`) caches the **app shell only**. Never add `dataGroups`:
  data comes from the local DB ([offline-sync](../docs/features/offline-sync.md) → Layers). It is
  off in `ng serve`, so check PWA behaviour against `npm run build` output served with an SPA
  fallback.

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
- Icons: `@ng-icons/lucide` via `NgIcon` + `provideIcons({ ... })` in the component.

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

  | Field                | Control type           | Use for                                        |
  | -------------------- | ---------------------- | ---------------------------------------------- |
  | `app-input-field`    | `FormControl<string>`  | text / email / tel / url / search              |
  | `app-password-field` | `FormControl<string>`  | password with show/hide                        |
  | `app-textarea-field` | `FormControl<string>`  | multi-line note                                |
  | `app-select-field`   | `FormControl<T \| ''>` | short fixed list (native picker on phones)     |
  | `app-otp-field`      | `FormControl<string>`  | 6-digit email code (`one-time-code` auto-fill) |
  | `app-switch-field`   | `FormControl<boolean>` | on/off setting row                             |

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
  code. Never do float maths on amounts. Format them for display only, with `Intl.NumberFormat`
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
  - App start: `authGuard` / `guestGuard` call `AuthService.restore()`, one silent refresh. A
    reload therefore costs one `/auth/refresh`. When the API is unreachable the status is
    `unreachable` (not signed out), and the sign-in page retries once the network is back.
  - Sign-out: `AuthService.signOut()` then navigate to sign-in. #4a adds wiping the local DB
    ([offline-sync](../docs/features/offline-sync.md) rule 7).
  - Password (4.2): `AuthService.signInWithPassword()`, `setPassword()`, `removePassword()`,
    `startReauth()` / `verifyReauth()`. `AuthUser.hasPassword` says whether one is set. Routes that
    change credentials may answer `403 REAUTH_REQUIRED`: show the confirm step (current password or
    a step-up code, `features/account/components/reauth-step.ts`) and send the same request again.
    `passwordPolicyValidator` (`@/core/auth`) mirrors the API's policy for instant feedback.
- **Auth error codes** the screens switch on: `OTP_INVALID`, `OTP_LOCKED`, `OTP_EXPIRED`,
  `SESSION_EXPIRED`, `SESSION_REVOKED`, `USER_DISABLED`, `RATE_LIMITED` (with `Retry-After`),
  `INVALID_CREDENTIALS`, `CURRENT_PASSWORD_INVALID`, `REAUTH_REQUIRED`, `PASSWORD_TOO_SHORT`,
  `PASSWORD_TOO_LONG`, `PASSWORD_TOO_WEAK`, `PASSWORD_MATCHES_EMAIL`, `PASSWORD_BREACHED`.
  `authErrorMessage` (`core/auth/auth-error.ts`, shared by the auth and account features) maps
  them to translation keys.
- **Testing**: `provideHttpClient(withInterceptors([authInterceptor]))` +
  `provideHttpClientTesting()`; flush envelopes from `HttpTestingController`. A spec that renders
  the shell sets a session on `AuthStore` first (see `app.spec.ts`).

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
