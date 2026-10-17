# AGENTS.md

Guidance for AI assistants (and humans) working in `web/`. Read this **before** creating or
modifying a feature.

If anything here conflicts with the actual code, the code wins — update this file in the same change.

> **Project context:** this folder is the web app of **Tang Pai Nai (ตังค์ไปไหน)**, a personal income /
> expense tracker modelled on Money Lover, for the owner and their family. _What_ to build and in what
> order lives in [`ROADMAP.md`](../ROADMAP.md); what each feature does (data, rules, endpoints)
> lives in [`docs/features/`](../docs/features/README.md). Read the feature doc before building its
> screens. This file only covers _how_ to write the code here. Run every npm command from this folder
> (`cd web`).

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
centre the same layout (max width ~480px).

### Testing

Same policy as the API: **do not write tests while building a feature unless the developer asks.**
When asked, put `<name>.spec.ts` beside the file under test (Vitest via `ng test`, globals enabled).

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
  bottom tab bar. Give every routed page a Thai `title`; `PageTitleStrategy` (`core/routing`) shows
  it in the header. Full-screen flows that shouldn't show the bar (sign-in, PIN) go outside it.
- App-wide device state lives in `core/` as signal services: `ThemeService` (`core/theme`),
  `NetworkStatusService` (`core/network`), `KeyboardService` (`core/viewport`),
  `AppUpdateService` + `DeviceStorageService` (`core/pwa`).
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
  `bg-primary`, `text-destructive`, `border-border`, …, defined in `src/styles.css`. Never use raw
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

- **Validation messages**: Angular's built-in `Validators.*` already show a Thai default message
  (`field-error.ts`). For a custom message, wrap the validator:
  `withMessage(Validators.required, 'กรุณาใส่ชื่อกระเป๋าเงิน')`. A custom validator returns its message
  as the error value (`{ sameAsEmail: 'รหัสผ่านต้องไม่ซ้ำกับอีเมล' }`). Errors appear once a field is
  touched, or for all fields on submit.
- **Form component shape:**

  ```ts
  @Component({
    selector: 'app-wallet-form',
    imports: [FORM_IMPORTS, InputField, SelectField, SwitchField, HlmButton],
    template: `
      @let f = form.controls;
      <form [formGroup]="form" class="flex flex-col gap-4" (ngSubmit)="onSubmit()">
        <app-input-field [control]="f.name" label="ชื่อกระเป๋าเงิน" />
        <app-select-field [control]="f.type" label="ประเภท" [options]="typeOptions" />
        <app-switch-field [control]="f.excludeFromTotal" label="ไม่รวมในยอดรวม" />
        <button hlmBtn type="submit" [disabled]="isProcessing()">บันทึก</button>
      </form>
    `,
  })
  export class WalletForm {
    private nnfb = inject(NonNullableFormBuilder)

    wallet = input<Wallet | null>(null)
    isProcessing = input(false)
    submitted = output<WalletFormValue>()

    form: WalletFormGroup = this.nnfb.group({
      name: ['', [Validators.required, Validators.maxLength(50)]],
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
  (locale `th-TH`, the currency's minor-unit digits).
- Dates: the API sends ISO strings. Display them in Thai with `Intl.DateTimeFormat('th-TH')`, or a
  shared pipe once one exists.

### UI text

The UI is in **Thai**. Write strings inline in templates for now. No i18n layer until the roadmap asks
for one.

## 4. API & session contract

- **Offline-first.** Screens read and write the **local database**, not the API. Own data reaches
  the server only through the sync outbox (`/sync/push` and `/sync/pull`). Direct API calls are for
  auth, shared wallets you're a member of (online only), and sync itself. Read
  [`offline-sync.md`](../docs/features/offline-sync.md) before building any data screen.
- All calls go through the core API client and use **relative URLs under `/api`**. In production,
  Vercel rewrites `/api/*` on the web project to the API project, so the browser sees one origin.
  That keeps the refresh-token cookie first-party (`*.vercel.app` is a public suffix, so cross-project
  cookies would be third-party and blocked). In dev, `ng serve` proxies `/api` to `http://localhost:3000` and strips the
  prefix (`proxy.conf.json`), the same mapping as the prod rewrite. So there is **no API base URL in
  an environment file**; never hardcode `http://localhost:3000`.
- The API sees requests coming from the proxy (dev) or Vercel (prod). Anything that needs the real
  client IP (auth rate limits) must configure Express `trust proxy`; that lands with Auth.
- Response envelope: `{ message, timestamp, data? }` — read `data`.
- Access token lives **in memory only** (a signal in the auth store), never in `localStorage`. The
  refresh token is an httpOnly cookie the app can't read. On a 401, the interceptor calls
  `/api/auth/refresh` once, then retries; if refresh fails, it goes to sign-in.
- Details land with the Auth feature (see [`docs/features/auth.md`](../docs/features/auth.md)). Update this
  section then.

## 5. Definition of done

1. Build the screen(s) against the feature doc.
2. Try it on a phone-sized viewport (375×812) and check touch targets, safe areas and the bottom bar.
3. Run:

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
