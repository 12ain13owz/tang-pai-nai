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

## Run in Docker

`docker-compose.yml` at the repo root builds both apps the way they ship (the API compiled, the
web app's production build behind nginx, which forwards `/api/*` like `web/middleware.js` does on
Vercel) and runs them together. No npm and no Node needed on the PC, only Docker. Use it to try
the app as a whole before a deploy.

| Profile | Opens at                | API settings                     | Mail                                     |
| ------- | ----------------------- | -------------------------------- | ---------------------------------------- |
| `dev`   | `http://localhost:8080` | `api/.env.dev` (development)     | printed in the API log, no keys          |
| `prod`  | `http://localhost:8081` | `api/.env.prod` (production)     | sent for real (Resend), keys in the file |

Each profile has its **own SQLite database in a Docker volume**, so only the users you make while
testing are in it, never mixed with staging or production. Migrations run every time the API
container starts.

First time, the env files must exist (`cd api && npm run setup-env` makes both from
`.env.example`; without Node, copy `api/.env.example` to `api/.env.dev` and `api/.env.prod` and
fill `JWT_SECRET` / `OTP_PEPPER` with any 32+ characters, different in each file).

```bash
docker compose --profile dev up --build -d    # build and start in the background
docker compose --profile dev logs -f api-dev  # follow the API log (sign-in codes show here)
docker compose --profile dev down             # stop (the database stays)
docker compose --profile dev down -v          # stop and delete the database
```

The `prod` profile takes the same commands with `prod` and `api-prod`. Both can run at once.
Rebuild with `--build` after pulling or changing code.

### Real keys for the `prod` profile

`api/.env.prod` is gitignored and never copied into an image. Add what you want to try for real
(values from [`docs/deploy.md`](docs/deploy.md)):

```bash
NODE_ENV="production"
EMAIL_PROVIDER="smtp"
SMTP_URL="smtps://resend:<Resend API key>@smtp.resend.com:465"
EMAIL_FROM="Tang Pai Nai <no-reply@your-verified-domain>"
SMS_PROVIDER="disabled"
# optional: GOOGLE_CLIENT_ID / GOOGLE_CLIENT_SECRET (add http://localhost:8081/api/auth/google/callback
# as a redirect URI in Google Cloud first)
```

- Production mode refuses the `console` providers, so the API won't start until `EMAIL_PROVIDER`
  and `SMS_PROVIDER` are set as above (`docker compose --profile prod logs api-prod` says which).
- Compose sets `WEB_ORIGIN` and `BASE_URL` to `localhost:8081` itself, so links in the mails open
  the local app.
- Leave `DATABASE_URL` out to use the volume's SQLite file. To try Turso, point it at a **test**
  database of its own (with `DATABASE_AUTH_TOKEN`), never the staging or production one: the
  container runs migrations on it at start.
- Until a domain is verified in Resend, `EMAIL_FROM="onboarding@resend.dev"` sends only to the
  address of your own Resend account.

## Deploy

Both apps run on Vercel (two projects from this repo, Root Directory `api` / `web`), with Turso as
the database and Resend for sign-in emails. Staging is `develop`, production is `main`. The
dashboard steps and every environment variable are in [`docs/deploy.md`](docs/deploy.md).
