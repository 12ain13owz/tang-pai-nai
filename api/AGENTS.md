# AGENTS.md

Guidance for AI assistants (and humans) working in this repository. Read this **before** creating or modifying a feature so changes stay consistent without re-reading the whole codebase every time.

If anything here conflicts with the actual code, the code wins — update this file in the same change.

> **Project context:** this folder is the API of **Tang Pai Nai**, a personal income / expense
> tracker. The Angular app is in `../web`. _What_ to build and in what order lives in
> [`ROADMAP.md`](../ROADMAP.md); what each feature does lives in
> [`docs/features/`](../docs/features/README.md). This file only covers _how_ to write the code.
> Run every npm command from this folder (`cd api`).
> Sections below that say "not wired up yet" describe the starter baseline — the roadmap decides when
> each one is built (database in Phase 1, auth in Phase 2).

---

## 1. What this project is

A feature-based REST API **starter**: **Node.js (ESM) + Express 5 + TypeScript 6**. Environment is validated with Zod, logging uses Winston, and errors flow through a single error middleware. It ships as a clean base for new projects to build on top of.

Folders are split **by feature**, and each feature is layered **Clean Architecture style**. Business logic (entity, repository port, service) never depends on Express, the DB, or HTTP status codes, and ESLint enforces this (§2). `src/features/todo/` is the reference implementation. Copy its shape for new features.

Not wired up yet — add inside the existing structure when a consuming project needs it, don't pre-build it speculatively:

- **Database / ORM** — none, and the starter doesn't pick one (SQL or Mongo, Prisma, Sequelize, TypeORM, a raw driver, …). `todo` stores data with an in-memory adapter (`todo.repository.memory.ts`); a real project adds `<feature>.repository.<driver>.ts` and switches to it in the feature's `index.ts` (§2, §6 step 5).
- **Auth** — none (`req.user`, JWT, sessions, etc. don't exist).
- **i18n / structured messages** — `AppError`/`createResponse` take a plain `string` message. Do not introduce a `{ key, message, params }` message shape or an i18n layer speculatively; that's a real requirement of specific downstream products, not a default this starter should carry.

### Testing

Test runner: **Vitest** (`npm test` / `npm run test:watch`, config in `vitest.config.ts`).

**Do not write tests while building or changing a feature. Write tests only when the developer explicitly asks for them** — e.g. "add tests for X". Don't infer this from context (a feature "looking done" is not a request). Writing tests against code the developer hasn't asked to lock down yet means rewriting them on every behavior change, which costs more tokens than writing them once, on request, against settled code.

When tests are requested, follow this standard so output stays consistent across the codebase:

- **Placement & naming** — `<name>.test.ts` beside the file under test (e.g. `error-logger.ts` -> `error-logger.test.ts`), mirroring the production layering. No separate `test/` or `__tests__/` folder.
- **Structure** — one `describe` per exported function/class; one `it` per behavior. Name `it` blocks after the observable outcome ("returns undefined when stack has no frames"), not implementation steps or generic labels ("test 1", "works").
- **Mocking** —
  - Keep `vi.fn()` mocks as local typed variables and assert against those variables directly; don't read a mock back off a property whose declared type comes from an external interface (e.g. Express's `Response`) — that trips `@typescript-eslint/unbound-method` because the rule checks the declared type, not the runtime value.
  - When partially mocking a module, use `vi.mock(path, async (importOriginal) => ({ ...await importOriginal<typeof X>(), overriddenExport: ... }))`, typing `X` via a top-level `import type * as X from 'path'` — never an inline `typeof import('path')` (banned by lint).
  - Don't type a `next` mock as Express's `NextFunction` (`vi.fn<NextFunction>()`) — it's an overloaded call signature (`(err?: any): void` and `(deferToNext: 'router'): void`), and `vi.fn<T>` doesn't handle overloads cleanly. Type it as the single signature you actually use, e.g. `vi.fn<(err?: unknown) => void>()`.
  - **Services:** don't mock. Inject a fresh in-memory repository per test (`createTodoService({ todoRepo: createMemoryTodoRepository(seed) })`). There's no `vi.mock`, and no test depends on how the DB is queried. See `todo.service.test.ts`.
  - **HTTP layer:** don't use the shared `createApp()` for a feature whose `index.ts` holds state (the composition root keeps one repository for the whole process, so data would leak between tests). Build an isolated app per test with `express()` + `express.json()` + the feature router wired to a fresh repo + `errorHandler`. See `buildApp` in `todo.controller.test.ts`.
  - For a module that computes a value once at import time from `env` (e.g. a module-scope constant like `const isProduction = env.NODE_ENV === AppEnv.PRODUCTION`), a normal `vi.mock` on `@/core/config` can't flip that value per test — the constant is already baked in by the time any test runs. Instead, re-import the module fresh per scenario: `vi.resetModules()` + `vi.doMock('@/core/config', () => ({ env: {...} }))` + `await import('./the-module')`, called from a small helper so each test controls the `env` it loads against.
- **Assertions** — prefer `toEqual`/`toMatchObject` for object shape, `toBe` for primitives. Avoid loosely-typed matchers like `expect.any(Array)` where they trigger `@typescript-eslint/no-unsafe-assignment`; assert the field(s) individually instead.
- **Coverage priority** — cover branches, edge cases, and any bug uncovered while writing the test (document it with a test rather than silently fixing it, unless asked to fix). Skip near-zero-risk one-liners (trivial wrappers, pure re-exports) unless asked.
- **Lint/type clean** — test files follow the same rules as production code (§3): no `any`, unused params prefixed `_`, etc. `npm run fix` and `npm run typecheck` must both pass.
- **Quiet runs** — `vitest.config.ts` sets `LOG_SILENT=true`, so the logger writes nothing (no console noise, no `logs/` folder). Don't assert on log output via real transports; mock `@/core/logger` if a test needs to check what was logged.
- Run `npm test` before calling a change done whenever test files were touched (see §8).

## 2. Architecture & layering

```
src/
  core/          # Infrastructure, app-wide. Knows nothing about specific features.
    config/      # env loading + Zod validation, runtime options (cors/helmet/rate-limit)
    error/       # AppError, domain errors, error logger, error middleware, wrapUnexpected
    logger/      # Winston setup
    middleware/  # custom Express middleware (validate)
    server/      # bootstrap + graceful shutdown (onShutdown hooks)
  features/      # Business features. One folder per feature. May import core + shared.
  shared/        # Pure building blocks (constants, types, utils). No feature/business logic.
  app.ts         # createApp(): global middleware + routes + errorHandler
  main.ts        # Entry point: startServer (+ onShutdown registrations)
  routes.ts      # Root router: mounts every feature router
```

Dependency direction (never break this):

```
features  ->  core  ->  shared
features  ->  shared
```

- `shared/` must not import from `core/` or `features/`.
- `core/` must not import from `features/`.
- Features must not import from other features. If two features need the same logic, lift it into `core/` or `shared/`.

### Inside a feature (Clean Architecture)

Each feature splits into a **business layer** that knows nothing about the outside world, and **adapters** that connect it to HTTP and storage. Reference: `src/features/todo/`.

```
features/todo/
  todo.entity.ts             # business  — domain types (plain TS)
  todo.repository.ts         # business  — port: interface the service needs from storage
  todo.service.ts            # business  — rules; createTodoService({ todoRepo })
  todo.repository.memory.ts  # adapter   — implements the port (in-memory; later .mysql.ts, .mongo.ts, …)
  todo.schema.ts             # adapter   — Zod input schemas for validate()
  todo.controller.ts         # adapter   — Express handlers; createTodoController(service)
  todo.routes.ts             # adapter   — createTodoRouter(controller)
  index.ts                   # composition root — picks the adapter, wires everything, exports todoRouter
```

| File                                            | May import                                                         | Must NOT import                                                                                   |
| ----------------------------------------------- | ------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------- |
| `*.entity.ts`, `*.repository.ts` (port)         | other business files of the same feature, `@/shared`               | `express`, DB clients, `@/core/middleware`, `HttpStatus`                                          |
| `*.service.ts`                                  | entity, port, `@/core/error` (domain errors), `@/shared/constants` | `express`, DB clients (`@/core/database`, ORM/driver packages), `@/core/middleware`, `HttpStatus` |
| `*.repository.<driver>.ts` (adapter)            | entity, port, DB client, `wrapUnexpected`                          | `express`                                                                                         |
| `*.schema.ts`, `*.controller.ts`, `*.routes.ts` | Express, `HttpStatus`, `validate`, the service type                | DB clients                                                                                        |
| `index.ts`                                      | everything in the feature                                          | —                                                                                                 |

The "Must NOT import" column is **enforced by ESLint** (`no-restricted-imports` overrides in `eslint.config.mjs`): the business layer (`*.{service,entity,repository}.ts`), storage adapters (`*.repository.*.ts`, no Express), and the HTTP layer (`*.{controller,routes,schema}.ts`, no DB client). If lint flags an import, move the code to the right layer. Don't disable the rule. The DB-client list there covers common Node drivers/ORMs; if a project uses one that isn't listed, add it.

Rules of thumb:

- The service receives its dependencies as an object (`createXService({ xRepo })`) and never imports an adapter. Only `index.ts` decides which adapter is used. Swapping storage (memory -> any DB) touches `index.ts` and adds one adapter file, nothing else.
- Repository ports speak domain types (`Todo`, `NewTodo`), never ORM/driver types. The adapter maps rows/documents to entities, so a field like `password` can be dropped there.
- Ports never throw for a missing record. Reads and updates return `null`, deletes return `false`. The adapter translates however its driver signals "not found" (a `null` result, an affected-row count of 0, a driver error code). The **service** is the only place that decides whether that is an error (`NotFoundError`). Keeping it in the port's return type makes the compiler force both sides to handle it.
- Use factory functions with a deps object, not classes, so the style stays consistent with the rest of the codebase.
- Naming: a factory is `create<Feature><Role>` (`createTodoService`, `createTodoController`), the instance it returns is `<feature><Role>` (`todoService`, `todoController`), and CRUD methods are single verbs (`create`, `getById`, `remove`). Factory and instance need different names, so keep the `create` prefix. Factories are only called in `index.ts` and tests. Everywhere else code works with the instance (`todoController.create`), the same way a module-style feature uses `countryController.update`.

### Graceful shutdown

On `SIGTERM`/`SIGINT` or a fatal error, `core/server` closes the HTTP server and runs every registered cleanup at the same time, all under `SHUTDOWN_TIMEOUT_MS`. Anything that holds a connection (DB pool, queue, cache client) registers its own cleanup where it is created. Don't import it into `core/server`, because that would make core depend on a specific driver:

```ts
// main.ts
import { onShutdown, startServer } from '@/core/server'

await connectDatabase()
onShutdown(disconnectDatabase) // () => Promise<void>; rejections are logged, never block exit
startServer(createApp(), env.PORT)
```

## 3. Hard conventions (do not deviate)

### Imports & module system

- ESM only. Use the `@/` path alias for anything under `src/` (configured in `tsconfig.json`). Use relative imports only for files inside the same feature/folder.
- Import groups are enforced by ESLint (`import/order`, alphabetized, **no blank lines between groups**), in this order:
  1. builtin + external (e.g. `node:path`, `express`)
  2. internal `@/...`, including `import type` from `@/...` (the `@/**` path group wins over the type group)
  3. relative `./...`
  4. `type` imports from external packages and relative files (always last)
- When unsure, run `npm run fix` and let `--fix` reorder.
- Type-only imports must use `import type { ... }` (auto-fixed on save / `npm run fix`).

### Formatting (Prettier)

- 2-space indent, single quotes, **no semicolons**, trailing commas `es5`, print width 100, arrow parens always, LF line endings.

### TypeScript

- `strict` is on, plus `noUnusedLocals`, `noUnusedParameters`, `noImplicitReturns`.
- `any` is banned (`@typescript-eslint/no-explicit-any`). Use `unknown` + narrowing.
- Prefix intentionally unused params with `_` (e.g. `_req`, `_next`).
- Every Promise must be awaited or handled (`no-floating-promises`).

#### `null` vs `undefined`

- Prefer `null` for a value _we_ deliberately return to mean "intentionally absent" in our own
  domain logic — e.g. a lookup that found nothing, matching how most DB clients/ORMs already
  return `null` for nullable columns and missing records (`User | null`).
- Keep `undefined` for optional parameters/properties (`foo?: string`) — that's the language's own
  idiom; don't fight it by requiring callers to pass `null` explicitly.
- Keep `undefined` for values sourced from an external dependency/runtime API that already returns
  `undefined` (`process.env.X`, `Array.prototype.find`, etc.) — don't convert at the boundary.
- Keep `undefined` anywhere the logging or response layer treats it as a deliberate **elision**
  sentinel — don't "fix" these. `extractMetadata` (`core/logger/logger.ts`) drops any metadata key
  whose value is `undefined` but logs `null` values as-is, and `JSON.stringify` drops `undefined`
  object fields but serializes `null` explicitly (see `error.middleware.ts`'s dev-only `data`
  field). Swapping one of these to `null` isn't a no-op — a field that was cleanly omitted from a
  log line or response body would start showing up as an explicit `null`. `core/logger/stack.ts`'s
  `getCallerSource` is the concrete example: it looks like a "value we control, prefer null" case,
  but it feeds straight into that elision path, so it stays `undefined`.

### Logging & env

- Never use `console.*` for app logging — use the Winston `logger` from `@/core/logger` (`console.info`/`warn`/`error` are only tolerated inside `core/config/env/env.ts`, for bootstrap messages that run before the logger/env are ready).
- Never read `process.env` directly outside `core/config`. Import the validated `env` from `@/core/config`.
- `LOG_SILENT=true` turns off every transport (console and both file transports; file transports aren't even created). It's for tests and one-off scripts. Never set it in `.env.prod`.
- Log-only strings (bootstrap `console.*` lines and Winston `logger` messages, never sent to a client) live in the `LOG` constant (`@/shared/constants`), grouped by subsystem (`LOG.CONFIG`, `LOG.SERVER`), never in `SUCCESS`/`ERRORS` — those two are API-response message pools only. See §4.

### File naming (kebab-case + role suffix)

| Role               | Pattern                            | Example                       |
| ------------------ | ---------------------------------- | ----------------------------- |
| Routes             | `<feature>.routes.ts`              | `todo.routes.ts`              |
| Controller         | `<feature>.controller.ts`          | `todo.controller.ts`          |
| Service            | `<feature>.service.ts`             | `todo.service.ts`             |
| Entity             | `<feature>.entity.ts`              | `todo.entity.ts`              |
| Repository (port)  | `<feature>.repository.ts`          | `todo.repository.ts`          |
| Repository adapter | `<feature>.repository.<driver>.ts` | `todo.repository.memory.ts`   |
| Validation (Zod)   | `<feature>.schema.ts`              | `todo.schema.ts`              |
| Types              | `<feature>.type.ts`                | `auth.type.ts`                |
| Middleware         | `<name>.ts`                        | `validate.ts`                 |
| Constants          | `<name>.const.ts`                  | `message.const.ts`            |
| Barrel / wiring    | `index.ts`                         | composition root + public API |

Skip files you genuinely don't need. For example, `src/features/health/` only has `health.routes.ts` + `health.controller.ts`: there's no business logic, so no entity/repository/service, and nothing to validate. A feature that has business rules or storage gets the full layering (§2). Keep the naming when you do add a file.

`<feature>.entity.ts` holds domain types the business layer works with. `<feature>.type.ts` is for anything else (e.g. response `data` shapes that differ from an entity, like `LoginData`).

Middleware is the one exception to the role-suffix rule: files under `src/core/middleware/` skip the `.middleware.ts` suffix — the folder itself already says "middleware", so the suffix would be redundant. Feature-local middleware, if a feature ever needs its own, follows the same no-suffix rule.

**Messages:** generic, reusable text (CRUD success/fail wording, HTTP-generic errors) belongs in `SUCCESS`/`ERRORS` in `shared/constants/message.const.ts` — extend it, don't duplicate. Both pools are **flat, two levels**: `UPPER_CASE` keys are fixed text (`ERRORS.UNAUTHORIZED`), `camelCase` keys are builders (`SUCCESS.create('todo')`, `ERRORS.notFound('Todo')`). Don't add a nested group to them. A feature keeps its own `<feature>.const.ts` exporting one `<FEATURE>_MESSAGE` object (e.g. `AUTH_MESSAGE.LOGIN` in `auth.const.ts`) for text specific to that feature's domain (e.g. "Invalid email or password") that wouldn't make sense reused elsewhere. That keeps the shared pools flat and the feature's text deleted along with the feature. Default to the shared pools when in doubt. `LOG` is the exception: it keeps a subsystem group (`LOG.CONFIG.load`) because the group says where the line comes from.

### Config (`src/core/config/`)

| File                | Responsibility                                                             |
| ------------------- | -------------------------------------------------------------------------- |
| `env/env.type.ts`   | `EnvConfig` type — hand-authored, no side effects                          |
| `env/env.schema.ts` | Zod schema typed as `z.ZodType<EnvConfig>`, so schema and type can't drift |
| `env/env.ts`        | Resolves the right `.env.*` file, validates via `envSchema`, exports `env` |
| `env/index.ts`      | Barrel — re-exports `env` + `EnvConfig`                                    |
| `options.ts`        | Env-dependent middleware options (cors/helmet/rate-limit)                  |
| `index.ts`          | Barrel — import `env` and options from here                                |

Import `env` from `@/core/config`, never from `./env/env`. Add env-dependent middleware options to `options.ts`, not `shared/`. Numeric env vars use `z.coerce.number()` (not `.transform(Number)`, which silently lets `NaN` through) with explicit bounds (`.int().positive()`, `.max(...)` where a natural ceiling exists).

## 4. The response & error contract

**Every** success response is built with `createResponse` (`@/shared/utils`) so the envelope stays uniform:

```ts
{ message: string, timestamp: string, data?: T }
```

- Response messages come from `SUCCESS`/`ERRORS` in `@/shared/constants`, or from a feature-local `<feature>.const.ts` for messages specific to that feature's domain (see §3) — never hardcoded inline strings. These are plain strings — no i18n key/message object (see §1).
- Log-only strings (startup/config/server logs, never sent to a client) come from the separate `LOG` constant in the same file. Don't mix the two: if it's only ever written to a log (`console.*` or `logger`), it belongs in `LOG`, not `SUCCESS`/`ERRORS`.
- HTTP codes come from the `HttpStatus` enum, never magic numbers. Only adapters (controller, routes, middleware, `core/`) use it; the business layer can't (§2).
- **In the business layer, throw a domain error** (`@/core/error`). It says _what_ went wrong, and `core/error` decides the HTTP status and severity once for the whole app:

  | Error                                | Use when                                       | Status | Severity |
  | ------------------------------------ | ---------------------------------------------- | ------ | -------- |
  | `NotFoundError(resource, metadata?)` | a referenced record doesn't exist              | 404    | WARN     |
  | `ConflictError(message, metadata?)`  | uniqueness / state conflict (duplicate title…) | 409    | WARN     |
  | `UnauthorizedError(message, meta?)`  | credentials/token invalid                      | 401    | WARN     |
  | `BusinessRuleError(message, meta?)`  | input is well-formed but breaks a domain rule  | 422    | WARN     |

  ```ts
  throw new NotFoundError('Todo', { id }).withOperation('getTodo')
  throw new ConflictError(ERRORS.alreadyExists('Todo title'), { title }).withOperation('createTodo')
  ```

  They extend `AppError`, so builder methods, `errorHandler`, and logging work unchanged. If none fits, add a new class in `core/error/domain-error.ts` rather than reaching for `HttpStatus` in a service.

- Outside the business layer (middleware, `core/`, a controller-only feature like `health`), `throw new AppError(message, status, severity)` directly and chain context. Either way, errors reach `next(error)` and the global `errorHandler` (`core/error/error.middleware.ts`, wired in `app.ts`) formats them (full details in development, message-only in production).
- Wrap every call into an external dependency (DB/ORM, third-party SDK, HTTP client) in `wrapUnexpected` (`@/core/error`). `errorHandler` hides `data` in production but still sends `message`, so a raw driver error (SQL text, hostnames, constraint names) would reach the client. `wrapUnexpected` rethrows any non-`AppError` as a generic `500` `AppError` and keeps the original as `metadata.cause` for the logs. An `AppError` thrown inside passes through unchanged:

  ```ts
  const user = await wrapUnexpected(async () => db.user.findUnique({ where: { email } }), {
    operation: 'login',
    metadata: { email },
  })
  ```

- Malformed JSON request bodies never reach a controller — `express.json()` throws before routing, and the error isn't an `AppError`. `errorHandler` detects this case (`SyntaxError` with `.type === 'entity.parse.failed'`) and normalizes it to a `400` `AppError` (`ERRORS.INVALID_JSON_BODY`) instead of leaking the raw parser message and defaulting to `500`. Follow the same normalize-before-formatting approach for any other non-`AppError` exception that has a well-known client-facing meaning.

`AppError` builder methods:

```ts
throw new AppError(ERRORS.UNAUTHORIZED, HttpStatus.UNAUTHORIZED, ErrorSeverity.WARN)
  .withOperation('login') // logical operation name
  .withEndpoint(req) // method, url, params, query, body
  .withMetadata({ email }) // extra structured context (no secrets/passwords)
```

## 5. Controller pattern (copy this shape)

Controllers are thin: read the already-validated input, call a service, return via `createResponse`. Always `async`, return `Promise<void>`, wrap in `try/catch`, and forward errors with `next(error)`.

Input validation is **not** the controller's job. The route runs the `validate` middleware (§7) first. It parses `params`/`query`/`body` with Zod, replaces them with the parsed (coerced/trimmed) values, and turns failures into a `422` `AppError`. The controller types `req` with the schema's inferred types and uses the values directly.

Reference implementations: `src/features/todo/` (full layering) and `src/features/health/` (controller-only, no business logic).

A controller in a layered feature is a **factory** that receives the service, so tests can wire it to any service instance (§1 Testing). A controller-only feature like `health` may export plain functions instead.

Before calling `createResponse`, assign the payload to a locally-typed `data` constant instead of
passing the service's return value straight through. This makes the response shape visible to
whoever opens the controller — no need to jump into the service or type file to know what's
being sent — and, since the type is a plain assignment (not an object literal), it still won't
catch excess properties on its own; if a field must never leave the service (a token, a hash),
strip it explicitly via destructuring before this assignment, not just via the type. Type it with
the entity when the payload _is_ the entity (`Todo`, `Todo[]`). When the shape differs, name a type
`<Feature><Action>Data` (e.g. `LoginData`) in `<feature>.type.ts`. It describes the `data` field's
shape, not the full response envelope. Keep the local variable named `data` so it matches
`createResponse`'s own parameter name. Likewise, assign `createResponse`'s result to its own
`response` constant before calling `res.json` — don't nest the call inside `.json(...)`. Keeping
each step (`data` -> `response` -> `res.status(...).json(response)`) on its own line reads as a
sequence of named steps instead of one dense expression:

```ts
import { HttpStatus, SUCCESS } from '@/shared/constants'
import { createResponse } from '@/shared/utils'
import type { Todo } from './todo.entity'
import type { CreateTodoInput, TodoIdParams } from './todo.schema'
import type { TodoService } from './todo.service'
import type { NextFunction, Request, Response } from 'express'

export const createTodoController = (todoService: TodoService) => {
  const create = async (
    req: Request<unknown, unknown, CreateTodoInput>,
    res: Response,
    next: NextFunction
  ): Promise<void> => {
    try {
      const data: Todo = await todoService.create(req.body) // already validated by the route
      const response = createResponse(SUCCESS.create('todo'), data)
      res.status(HttpStatus.CREATED).json(response)
    } catch (error) {
      next(error)
    }
  }

  const getById = async (
    req: Request<TodoIdParams>,
    res: Response,
    next: NextFunction
  ): Promise<void> => {
    // same shape: data -> response -> res.status(...).json(response)
  }

  return { create, getById }
}

export type TodoController = ReturnType<typeof createTodoController>
```

Routers are also factories. They take the controller, put `validate(...)` in front of any handler that reads input, and return the `Router`:

```ts
import { Router } from 'express'
import { validate } from '@/core/middleware'
import { todoSchema } from './todo.schema'
import type { TodoController } from './todo.controller'

export const createTodoRouter = (todoController: TodoController): Router => {
  const router = Router()

  router.post('/', validate(todoSchema.create), todoController.create)
  router.get('/:id', validate(todoSchema.byId), todoController.getById)

  return router
}
```

Type handlers with `Request<Params, unknown, Body, Query>` generics from the schema's inferred types; Express accepts them at registration as-is.

## 6. Recipe — add a new feature (reference: `src/features/todo/`)

Follow these steps in order, inside out: business layer first, then adapters, then wiring. The fastest start is to copy `src/features/todo/` and rename. Skip files you genuinely don't need (§3), but keep the naming. Snippets below are abridged; the real files are the source of truth.

1. **Create the folder** `src/features/<feature>/`.

2. **Entity** — `todo.entity.ts`. Plain TS types the business layer works with. No ORM types, no Zod:

```ts
export interface Todo {
  id: string
  title: string
  done: boolean
  createdAt: Date
}

export type NewTodo = Pick<Todo, 'title'>
export type TodoChanges = Partial<Pick<Todo, 'title' | 'done'>>
```

3. **Repository port** — `todo.repository.ts`. Only the operations the service needs, in domain types. Never throws for a missing record: reads/updates return `null`, deletes return `false`:

```ts
import type { NewTodo, Todo, TodoChanges } from './todo.entity'

export interface TodoRepository {
  findById(id: string): Promise<Todo | null>
  findByTitle(title: string): Promise<Todo | null>
  create(data: NewTodo): Promise<Todo>
  update(id: string, changes: TodoChanges): Promise<Todo | null>
  delete(id: string): Promise<boolean>
  // ...
}
```

4. **Service** — `todo.service.ts`. Business rules only. Take dependencies through a deps object, throw domain errors (§4), never import Express, a DB client, or `HttpStatus` (lint-enforced, §2):

```ts
import { ConflictError, NotFoundError } from '@/core/error'
import { ERRORS } from '@/shared/constants'
import type { NewTodo, Todo } from './todo.entity'
import type { TodoRepository } from './todo.repository'

export interface TodoServiceDeps {
  todoRepo: TodoRepository
}

export const createTodoService = ({ todoRepo }: TodoServiceDeps) => {
  const getById = async (id: string): Promise<Todo> => {
    const todo = await todoRepo.findById(id)
    if (!todo) {
      throw new NotFoundError('Todo', { id }).withOperation('getTodo')
    }
    return todo
  }

  const create = async (data: NewTodo): Promise<Todo> => {
    if (await todoRepo.findByTitle(data.title)) {
      throw new ConflictError(ERRORS.alreadyExists('Todo title'), {
        title: data.title,
      }).withOperation('createTodo')
    }
    return todoRepo.create(data)
  }

  const remove = async (id: string): Promise<void> => {
    if (!(await todoRepo.delete(id))) {
      throw new NotFoundError('Todo', { id }).withOperation('removeTodo')
    }
  }

  return { getById, create, remove }
}

export type TodoService = ReturnType<typeof createTodoService>
```

5. **Repository adapter** — `todo.repository.<driver>.ts`. Implements the port. This is the only file that touches storage, and the starter doesn't assume a driver. Every adapter, whatever the DB, does the same three things:
   - wrap each call in `wrapUnexpected` (§4), so driver errors never reach the client;
   - map rows/documents to entities (drop columns the domain doesn't need, convert `_id` -> `id`, …);
   - translate the driver's "not found" signal into the port's `null`/`false`. Don't throw `NotFoundError` here; that's the service's call.

   How common drivers signal "not found" (check your driver's docs for the version you use):

   | Driver                   | Read miss              | Update miss                                         | Delete miss                         |
   | ------------------------ | ---------------------- | --------------------------------------------------- | ----------------------------------- |
   | Raw SQL (`mysql2`, `pg`) | no rows                | `affectedRows` / `rowCount` is `0`                  | same                                |
   | Sequelize                | `findByPk` -> `null`   | `update` -> `[0]`                                   | `destroy` -> `0`                    |
   | TypeORM                  | `findOneBy` -> `null`  | `update` -> `affected === 0`                        | `delete` -> `affected === 0`        |
   | Mongoose                 | `findById` -> `null`   | `findByIdAndUpdate(id, x, { new: true })` -> `null` | `deleteOne` -> `deletedCount === 0` |
   | Prisma                   | `findUnique` -> `null` | `update` throws `P2025` (catch it -> `null`)        | `deleteMany` -> `count === 0`       |

   Abridged example with a raw SQL client (the starter itself ships only `.memory.ts`):

```ts
// todo.repository.mysql.ts (illustrative)
const toTodo = (row: TodoRow): Todo => ({
  id: row.id,
  title: row.title,
  done: Boolean(row.done),
  createdAt: row.created_at,
})

export const createMysqlTodoRepository = (pool: Pool): TodoRepository => ({
  findById: async (id) =>
    wrapUnexpected(
      async () => {
        const [rows] = await pool.execute<TodoRow[]>('SELECT * FROM todos WHERE id = ?', [id])
        return rows[0] ? toTodo(rows[0]) : null
      },
      { operation: 'todoRepository.findById', metadata: { id } }
    ),

  delete: async (id) =>
    wrapUnexpected(
      async () => {
        const [result] = await pool.execute<ResultSetHeader>('DELETE FROM todos WHERE id = ?', [id])
        return result.affectedRows > 0
      },
      { operation: 'todoRepository.delete', metadata: { id } }
    ),
  // ...
})
```

6. **Validation** — `todo.schema.ts` (Zod, the same validator used for env). Keep the individual Zod schemas private. Export one `<feature>Schema` object that groups them per route by request segment (`params`/`query`/`body`, the shape `validate` expects), and export the inferred input types for the controller:

```ts
import { z } from 'zod'
import { ERRORS } from '@/shared/constants'

const createBody = z.object({
  title: z
    .string({ error: ERRORS.requiredField('Title') })
    .trim()
    .min(1, ERRORS.requiredField('Title')),
})

const idParams = z.object({
  id: z.uuid({ error: ERRORS.invalidField('todo id') }),
})

export const todoSchema = {
  create: { body: createBody },
  byId: { params: idParams },
} as const

export type CreateTodoInput = z.infer<typeof createBody>
export type TodoIdParams = z.infer<typeof idParams>
```

7. **Controller** and **routes** — `todo.controller.ts`, `todo.routes.ts` (factories, see §5).

8. **Composition root** — `todo/index.ts`. The only place that picks the adapter and wires the layers. It exports the router (and any types other code may need), never internals:

```ts
import { createTodoController } from './todo.controller'
import { createMemoryTodoRepository } from './todo.repository.memory'
import { createTodoRouter } from './todo.routes'
import { createTodoService } from './todo.service'

const todoRepo = createMemoryTodoRepository() // swap to e.g. createMysqlTodoRepository(pool) later
const todoService = createTodoService({ todoRepo })
const todoController = createTodoController(todoService)

export const todoRouter = createTodoRouter(todoController)
export type { Todo } from './todo.entity'
```

9. **Add messages** instead of inline strings. Reuse `SUCCESS.*` / `ERRORS.*` (`@/shared/constants`) first; add a generic entry there only if other features could reuse it. Text that only makes sense for this feature goes in `<feature>.const.ts` (§3):

```ts
// auth.const.ts
export const AUTH_MESSAGE = {
  LOGIN: 'Logged in successfully',
  INVALID_CREDENTIALS: 'Invalid email or password',
}
```

10. **Register the router** in `src/routes.ts`:

```ts
import { todoRouter } from '@/features/todo'
// ...
router.use('/todos', todoRouter)
```

11. **Document the endpoint** (OpenAPI) — write this once manual testing (§8) confirms the endpoint's behavior, not while first implementing it; land it together with the tests in the same follow-up change. The spec lives in `src/features/docs/spec/` — the `docs` feature reads it from disk at runtime (`SwaggerParser.bundle`) to serve `/docs/openapi.json` and the Scalar UI, so it ships inside the feature folder, not a top-level `docs/` directory. Add a path file under `src/features/docs/spec/paths/<feature>/`, reference it from `src/features/docs/spec/openapi.yaml`, and reuse shared schemas/responses where possible. Because `tsc` only compiles `.ts` files, `npm run build` copies this `spec/` tree into `dist/` via the `copy-assets` script (`package.json`) — if the spec ever moves, keep that copy step pointed at the new path.

12. **Verify** (§8).

## 7. Middleware

Third-party middleware (`cors`, `helmet`, `express-rate-limit`) is configured as plain options in `core/config/options.ts` and applied in `app.ts`. Custom middleware lives in `src/core/middleware/`:

| File                | Export                     | Purpose                                                                                                                                                                                                                                                                                            |
| ------------------- | -------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `validate.ts`       | `validate(ValidatedShape)` | Parses `params` -> `query` -> `body` with the Zod schema given for each (all optional). On success it replaces that segment with the parsed data. On the first failure it calls `next()` with a `422` `AppError` that joins all issue messages, with `metadata.source` set to the failing segment. |
| `request-logger.ts` | `requestLogger`            | `morgan` access log routed through the Winston `logger` at `http` level, so it follows the same transports, levels, and `LOG_SILENT` as every other log line.                                                                                                                                      |

Adding more:

- Cross-feature middleware (auth guard, role check, …) goes in `src/core/middleware/`, one file per concern (`<name>.ts`, no `.middleware.ts` suffix, since the folder already says that), exported from its `index.ts`. Put its types in `<name>.type.ts` beside it.
- Feature-specific middleware can live in the feature folder instead.
- Wire global middleware in `app.ts`; per-route middleware in the feature's `*.routes.ts`.

## 8. Definition of done

A feature moves through these stages, in order:

1. **Implement** the feature per the shapes in §5–6.
2. **Manual test** the endpoint (e.g. via Postman) — happy path + main error paths.
3. Once manual testing confirms the behavior is correct, **write tests** (§1) and the
   **OpenAPI doc** (§6 step 11) together, in the same follow-up change.
4. Run:

```bash
npm run fix        # ESLint --fix + Prettier
npm run typecheck  # tsc --noEmit (must pass with no errors)
npm test           # run whenever test files exist for the touched code (see §1 Testing)
```

CI (`.github/workflows/api.yml` at the repo root) runs `lint`, `typecheck`, and `test` on every PR to `main` and every push to `main`, so a change that skips these locally will fail there.

It's fine to land stage 1 as its own commit before stages 2–3 are finished — just don't
call the feature "done" (or open it for review/PR) until docs + tests land. A feature is
only complete once all four stages pass and the router is mounted in `src/routes.ts`.

## 9. Quick do / don't

- DO keep controllers thin; push logic into services.
- DO keep services framework/DB-agnostic: depend on the repository port, receive deps via `createXService({ ... })`, pick adapters only in the feature's `index.ts`.
- DO throw domain errors (`NotFoundError`, `ConflictError`, …) from the business layer; use `HttpStatus`/`AppError` directly only in adapters and `core/`.
- DO use `createResponse` and the message constants.
- DO validate input with `validate(<feature>Schema.<action>)` in the route, not `schema.parse()` in the controller.
- DO wrap DB/SDK calls in `wrapUnexpected`, and register connection cleanup with `onShutdown`.
- DO put log-only strings in `LOG`, not `SUCCESS`/`ERRORS` (see §4).
- DO add new env vars to the Zod schema (`core/config/env/env.schema.ts`), the `EnvConfig` type (`core/config/env/env.type.ts`), and `.env.example`; use `z.coerce.number()` for numeric ones.
- DON'T import across features, hardcode response strings, throw raw `Error`, use `any`, read `process.env` directly, or use `console.log`.
- DON'T import Express, a DB client, or `HttpStatus` into `*.service.ts` / `*.entity.ts` / `*.repository.ts`, and don't `eslint-disable` the boundary rule to get around it (§2).
- DON'T leak ORM/driver types through a repository port; map rows to entities in the adapter.
- DON'T throw `NotFoundError` from a repository adapter; return `null`/`false` and let the service decide (§2).
- DON'T put secrets (passwords, tokens) into `AppError` metadata or logs.
- DON'T add a database, auth, or i18n message keys speculatively — this is a starter; add them when a real feature needs them (see §1). `todo` is a reference feature. A consuming project may delete it once it has its own layered feature to copy from, and should point the `todo` references in this file at that feature in the same change.

## 10. Commit messages

Use [Conventional Commits](https://www.conventionalcommits.org/) with a bullet-list body.

**Title** (≤72 chars, imperative, English):

```
<type>(<scope>): <summary>
```

| Type       | Use for                         |
| ---------- | ------------------------------- |
| `feat`     | New user-facing behavior        |
| `fix`      | Bug fix                         |
| `refactor` | Code change, no behavior change |
| `test`     | Tests only                      |
| `chore`    | Tooling, deps, config           |
| `docs`     | Documentation only              |

**Scope:** feature or area — `health`, `todo`, `config`, `logger`, `error`, `server`, `shared`, `docs`, …

**Body:** bullet list (`-`), one meaningful change per line. Focus on _why_ and impact, not every file touched. Omit body for trivial one-line fixes.

```
fix(logger): prevent metadata from clobbering reserved log fields

- Filter `rest` metadata against RESERVED_LOG_KEYS before spreading it into the
  winston log call, mirroring the guard already used on read
- Tighten `LogMetadata` type so `message`/`level`/`timestamp` are rejected at
  compile time
```

**Do:** match existing repo style; group related changes in one commit; write title as a command ("add", "fix", "remove").

**Don't:** paste full diffs; list every renamed method; use past tense ("added", "fixed"); commit secrets (`.env`, credentials).

## 11. Git workflow

- Work **one logical change per commit** — small, reviewable slices; do not batch unrelated changes.
- **Do NOT run `git commit` or `git push`** unless the user explicitly asks.
- When the user wants to commit themselves, provide a suggested commit message (§10 format) instead of committing.
