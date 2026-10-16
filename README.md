# Tang Pai Nai (เงินไปไหน)

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

```bash
cd api && npm install && npm run setup-env && npm run dev   # http://localhost:3000
cd web && npm install && npm start                          # http://localhost:4200
```
