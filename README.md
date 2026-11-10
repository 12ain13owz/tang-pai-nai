# Tang Pai Nai (ตังค์ไปไหน)

Personal income / expense tracker for the family, inspired by Money Lover. It's an installable
mobile-first PWA backed by a small REST API.

| Folder                            | What                                                     |
| --------------------------------- | -------------------------------------------------------- |
| [`api/`](api)                     | REST API: Express 5, TypeScript, Drizzle, SQLite / Turso |
| [`web/`](web)                     | PWA: Angular 22, Tailwind v4, spartan/ui                 |
| [`docs/features/`](docs/features) | Feature specs shared by both apps                        |
| [`ROADMAP.md`](ROADMAP.md)        | What's built, what's next, locked decisions              |

Each app is independent. It has its own `package.json`, is deployed as its own Vercel project, and
has its own CI workflow.

## Run locally

Use Node 24 (`.nvmrc`). Run every npm command inside `api/` or `web/` (there is no root
`package.json`).

First time, set up the API and its local database:

```bash
cd api
npm install
npm run setup-env   # creates .env.dev / .env.prod from .env.example
npm run db:migrate  # creates data/local.db and applies every migration in drizzle/
```

`npm run db:migrate` is required: without it the API starts with no tables. The migrations are
committed, so you don't run `npm run db:generate` (only after changing a schema in
`api/src/core/database/schema/`). `npm run db:seed` is optional: the currencies come from a
migration and every other row is made in the app (sign in, create a profile and a wallet).

Then run both apps, each in its own terminal:

```bash
cd api && npm run dev   # http://localhost:3000
cd web && npm install && npm start   # http://localhost:4200
```

Open the web app at `http://localhost:4200`. It reaches the API through the dev proxy at
`/api/*` (`web/proxy.conf.json`), so both must be running. With `EMAIL_PROVIDER="console"` (the
default) the sign-in code is printed in the API's terminal instead of being emailed.

After pulling new commits, run `npm install` and `npm run db:migrate` in `api/` again when
`api/drizzle/` changed.
