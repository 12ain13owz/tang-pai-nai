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
npm run setup-env   # creates .env.dev / .env.staging from .env.example
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

## Run in Docker

`docker-compose.yml` at the repo root builds both apps the way they ship (the API compiled, the
web app's production build behind nginx, which forwards `/api/*` like `web/middleware.js` does on
Vercel) and runs them together. No npm and no Node needed on the PC, only Docker. Use it to try
the app as a whole before a deploy.

| Profile   | Opens at                | API settings                    | Database, mail, bot check                       |
| --------- | ----------------------- | ------------------------------- | ----------------------------------------------- |
| `dev`     | `http://localhost:8080` | `api/.env.dev` (development)    | SQLite in a volume, codes in the log, test keys |
| `staging` | `http://localhost:8081` | `api/.env.staging` (production) | staging's Turso, Resend and Turnstile           |

`dev` has its **own SQLite database in a Docker volume** (test users only). `staging` runs this
PC's code against **staging's real services**: `api/.env.staging` is the same file that is
imported into Vercel's Preview environment, so what works here works on staging. Migrations run
every time the API container starts, so starting `staging` migrates the staging database.

First time, the env files must exist (`cd api && npm run setup-env` makes both from
`.env.example`; without Node, copy `api/.env.example` to `api/.env.dev` and `api/.env.staging` and
fill `JWT_SECRET` / `OTP_PEPPER` with any 32+ characters, different in each file).

```bash
docker compose --profile dev up --build -d    # build and start in the background
docker compose --profile dev logs -f api-dev  # follow the API log (sign-in codes show here)
docker compose --profile dev down             # stop (the database stays)
docker compose --profile dev down -v          # stop and delete the database
```

The `staging` profile takes the same commands with `staging` and `api-staging`. Both can run at
once. Rebuild with `--build` after pulling or changing code.

### `api/.env.staging`: staging's keys

Gitignored and never copied into an image. It holds staging's own values (never production's,
which live only in Vercel); the file's header and [`docs/env.md`](docs/env.md) say what goes
where. Fill the `CHANGE-ME` values, try it with the `staging` profile, then import the same file
into Vercel (API project → Environment Variables → Import .env, **Preview**, branch `develop`).

- Production mode refuses the `console` providers: the file sets `EMAIL_PROVIDER="smtp"` and
  `SMS_PROVIDER="disabled"`; the API won't start until `SMTP_URL` is filled
  (`docker compose --profile staging logs api-staging` says what is missing).
- Compose sets `WEB_ORIGIN` and `BASE_URL` to `localhost:8081` itself, so links in the mails open
  the local copy. The staging Turnstile widget needs `localhost` among its hostnames for this.
- Until a domain is verified in Resend, `EMAIL_FROM="onboarding@resend.dev"` sends only to the
  address of your own Resend account.

## Deploy

Both apps run on Vercel (two projects from this repo, Root Directory `api` / `web`), with Turso as
the database and Resend for sign-in emails. Staging is `develop`, production is `main`. The
dashboard steps and every environment variable are in [`docs/deploy.md`](docs/deploy.md).
