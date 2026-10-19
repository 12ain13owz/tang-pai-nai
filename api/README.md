# Tang Pai Nai — API

**Tang Pai Nai (ตังค์ไปไหน)** is a personal income / expense tracker inspired by Money Lover. This folder
is its REST API; the Angular PWA lives in [`../web`](../web).

- What we build and in what order: [`ROADMAP.md`](../ROADMAP.md)
- What each feature does: [`docs/features/`](../docs/features/README.md)
- How to write the code: [`AGENTS.md`](./AGENTS.md)

Bootstrapped from `node-express-ts-starter`: Node.js, Express and TypeScript. It ships with a feature-based structure that uses Clean Architecture inside each feature, structured logging, centralized error handling, rate limiting, and ready-to-use OpenAPI documentation.

> Building a new feature with an AI assistant? Read [`AGENTS.md`](./AGENTS.md) first — it documents the conventions and provides a step-by-step recipe for adding features consistently.

## Tech Stack

- Node.js (ESM)
- Express 5
- TypeScript 6
- Zod (environment + request validation)
- Winston + winston-daily-rotate-file (logging)
- ESLint 10 + Prettier
- Scalar API Reference (OpenAPI docs UI)
- Docker / Docker Compose

## Requirements

- Node.js >= 22
- npm >= 10
- Docker (optional)

## Getting Started

1. Install dependencies

```bash
npm install
```

2. Create the environment files

```bash
npm run setup-env
```

3. Start the development server

```bash
npm run dev
```

The server starts at http://localhost:3000

## Environment Variables

Environment files are loaded based on `NODE_ENV`:

- `NODE_ENV=development` -> `.env.dev`
- `NODE_ENV=production` -> `.env.prod`

Values are validated at startup with Zod (see `src/core/config/env/env.schema.ts`); the process exits if any variable is missing or invalid.

Example values from `.env.example`:

```env
PORT="3000"
NODE_ENV="development"
BASE_URL="http://localhost:3000"
CORS_ORIGINS="http://localhost:3000,http://localhost:4000,http://localhost:4200"
LOG_LEVEL_CONSOLE="debug"
LOG_LEVEL_FILE="info"
LOG_LEVEL_ERROR_FILE="error"
LOG_SILENT="false"
SHUTDOWN_TIMEOUT_MS="10000"
```

`LOG_SILENT="true"` turns off every log transport (console and files, so no `logs/` folder is created). It defaults to `false`; `vitest.config.ts` sets it to `true` so test runs stay quiet.

## Available Scripts

- `npm run dev`: run with `tsx --watch` using `.env.dev`
- `npm run build`: clean `dist`, compile TypeScript, then rewrite path aliases (`tsc-alias`)
- `npm start`: run the compiled build using `.env.prod`
- `npm run fix`: auto-fix ESLint issues and format with Prettier
- `npm run lint`: check with ESLint without changing files
- `npm run typecheck`: type-check with `tsc --noEmit`
- `npm run clean`: remove the `dist` directory
- `npm run setup-env`: generate `.env.dev` and `.env.prod` from `.env.example`, with random
  `JWT_SECRET` / `OTP_PEPPER` (also added to existing env files that lack them)
- `npm run auth:cleanup`: delete auth challenges, sessions and rate-limit buckets that ended over
  7 days ago
- `npm test`: run the test suite once (Vitest)
- `npm run test:watch`: run the test suite in watch mode

## API Endpoints

- `GET /health`: health check (liveness probe for load balancers, orchestrators, and uptime monitors)
- `GET /docs`: API documentation page
- `/auth`: email code / magic-link sign-in, refresh, sign-out, `GET /auth/me`
  ([spec](../docs/features/auth.md), shapes in `/docs`)
- `/todos`: reference CRUD feature (in-memory, data resets on restart)

| Method   | Path                | Success | Errors                               |
| -------- | ------------------- | ------- | ------------------------------------ |
| `GET`    | `/todos`            | 200     | —                                    |
| `POST`   | `/todos`            | 201     | 409 duplicate title, 422 blank title |
| `GET`    | `/todos/:id`        | 200     | 404 not found, 422 id is not a UUID  |
| `PATCH`  | `/todos/:id/toggle` | 200     | 404 not found, 422 id is not a UUID  |
| `DELETE` | `/todos/:id`        | 200     | 404 not found, 422 id is not a UUID  |

The standard response envelope is:

```json
{
  "message": "...",
  "timestamp": "ISO-8601",
  "data": {}
}
```

## Architecture

Folders are split by feature (`src/features/<name>/`). Inside a feature, code is layered so business logic never depends on Express, the database, or HTTP status codes:

```text
            HTTP adapter                      business layer                 storage adapter
 routes -> controller -> ------------> service -> repository (port) <------- repository.<driver>
 (validate)  (Express)                 (rules, domain errors)                (memory / mysql / mongo / …)
                                  index.ts wires them together and picks the adapter
```

- **Business layer**: `*.entity.ts`, `*.repository.ts` (interface), `*.service.ts`. Plain TypeScript. Services throw domain errors (`NotFoundError`, `ConflictError`, …) and `core/error` maps them to HTTP status codes.
- **Adapters**: `*.controller.ts` / `*.routes.ts` / `*.schema.ts` for HTTP, `*.repository.<driver>.ts` for storage.
- **Composition root**: the feature's `index.ts` is the only place that chooses an adapter. Switching from in-memory to a real database means adding one adapter file and changing one line there.
- **Enforced by ESLint**: business-layer files can't import `express`, DB clients, `@/core/middleware`, or `HttpStatus` (see `eslint.config.mjs`).

Because services only depend on an interface, their tests inject an in-memory repository instead of mocking modules.

`src/features/todo/` is the reference implementation. See [`AGENTS.md`](./AGENTS.md) §2 and §6 for the full rules and the step-by-step recipe.

## API Documentation

Served by the `docs` feature (`src/features/docs/`) using [Scalar](https://github.com/scalar/scalar) as the UI, with the OpenAPI spec bundled at runtime (`@apidevtools/swagger-parser`):

- UI: `GET /docs`
- Bundled OpenAPI JSON: `GET /docs/openapi.json`
- Spec entry point: `src/features/docs/spec/openapi.yaml`
- Schemas: `src/features/docs/spec/components/models`
- Responses: `src/features/docs/spec/components/responses`
- Paths: `src/features/docs/spec/paths`

Open the docs in the browser at:

http://localhost:3000/docs

## Logging

- Console and file logging via Winston
- Daily-rotated files organized by year/month
- Log location: `logs/YYYY/MM`
- Separate general (`.log`) and error (`.error.log`) files
- Set `LOG_SILENT="true"` to turn off all logging (used by tests)

## Continuous Integration

`.github/workflows/api.yml` (at the repo root, path-filtered to `api/**`) runs on every pull request to `main` and every push to `main`: `npm ci` -> `npm run lint` -> `npm run typecheck` -> `npm run setup-env` -> `npm test`. Run the same commands locally before opening a PR.

## Testing

Tests run on [Vitest](https://vitest.dev/) and live next to the code they cover as `<name>.test.ts` (e.g. `src/core/error/app-error.test.ts`), mirroring the `src/` layout — no separate `test/` folder.

- Service tests inject a fresh in-memory repository per test, with no `vi.mock` (see `src/features/todo/todo.service.test.ts`).
- HTTP tests use supertest against an isolated app per test (see `src/features/todo/todo.controller.test.ts`).

```bash
npm test          # run once
npm run test:watch  # watch mode
```

## Docker

The app service is behind the `prod` Compose profile, so a plain `docker compose up` won't start it. That leaves room to add dev-only services (database, mail catcher, …) that start without the app. Run it with:

```bash
docker compose --profile prod up -d --build
```

Stop the container:

```bash
docker compose --profile prod down
```

The image is a two-stage build on `node:<version>-slim` (Debian/glibc, so native modules install without compiling):

- **Build stage** installs all dependencies and compiles TypeScript, so the running container never needs extra memory for `tsc` (useful on small/free plans).
- **Runtime stage** contains only `dist/` and production dependencies, runs as the non-root `node` user, and starts with `node dist/main.js` directly (not `npm start`), so `SIGTERM` from `docker stop` or a redeploy reaches the app and graceful shutdown runs.

`NODE_ENV=production` is the default. Run `npm run setup-env` first so `.env.prod` exists — `docker-compose.yml` loads it via `env_file`. It is never copied into the image; on a host like Render, set the variables in the dashboard instead (and point its health check at `/health`).

The service has a `healthcheck` that calls `GET /health` every 30s, so `docker ps` shows `(healthy)` / `(unhealthy)` and other services can wait on it with `depends_on: { nodejs: { condition: service_healthy } }`. Plain Compose only reports the status; it does **not** restart an unhealthy container (Swarm, Kubernetes, or a helper like autoheal does). If you change `PORT` in `.env.prod`, update the URL in the healthcheck too.

## Project Structure

```text
.
|- scripts/
|  |- setup-env.ts
|  \- tsconfig.json
|- src/
|  |- core/                   # App infrastructure (not feature-specific)
|  |  |- config/              # Env loading + Zod validation + runtime options (cors/helmet/rate-limit)
|  |  |  \- env/              # EnvConfig type, Zod schema, loader, barrel
|  |  |- error/               # AppError, domain errors, error logger, error middleware, wrapUnexpected
|  |  |- logger/              # Winston logger setup
|  |  |- middleware/          # Custom middleware (validate: Zod for params/query/body)
|  |  \- server/              # Server bootstrap + graceful shutdown (onShutdown hooks)
|  |- features/               # Feature modules (one folder per feature)
|  |  |- docs/                # OpenAPI spec + Scalar API reference UI
|  |  |- health/              # Health check (liveness probe)
|  |  \- todo/                # Reference feature: entity, repository port + memory adapter, service, schema, controller, routes
|  |- shared/                 # Cross-cutting building blocks
|  |  |- constants/           # HttpStatus, log levels, messages (SUCCESS/ERRORS/LOG)
|  |  |- types/               # Shared types
|  |  \- utils/               # Helpers (createResponse)
|  |- app.ts                  # createApp(): global middleware + routes + error handler
|  |- main.ts                 # App entry point (startServer + onShutdown registrations)
|  \- routes.ts               # Root router (mounts every feature router)
|- docker-compose.yml
|- Dockerfile
|- eslint.config.mjs
|- package.json
\- tsconfig.json
```

## Contributing / Adding Features

This project follows a strict, consistent structure. Before adding or changing a feature, read [`AGENTS.md`](./AGENTS.md) for the conventions and the feature-creation recipe (based on `src/features/todo/`). Always run `npm run fix`, `npm run typecheck`, and `npm test` before committing (CI runs the same checks).

## License

MIT
