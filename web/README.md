# Tang Pai Nai — Web

**Tang Pai Nai (เงินไปไหน)** is a personal income / expense tracker inspired by Money Lover. This folder
is the mobile-first Angular PWA; the REST API lives in [`../api`](../api).

- What we build and in what order: [`ROADMAP.md`](../ROADMAP.md)
- What each feature does: [`docs/features/`](../docs/features/README.md)
- How to write the code here: [`AGENTS.md`](./AGENTS.md)

## Tech stack

- Angular 22 (standalone, zoneless, signals) — client-side only, no SSR
- Tailwind CSS v4 (layout) + spartan/ui (components, style `maia`, theme `neutral`)
- Reactive Forms through shared `*-field` components (`src/app/shared/components/form`)
- Vitest (via `ng test`)
- ESLint 10 (angular-eslint + import-x, same baseline as the API) + Prettier

## Getting started

```bash
npm install
npm start          # http://localhost:4200
```

Run the API too (`cd ../api && npm run dev`). `ng serve` proxies `/api/*` to `http://localhost:3000`
and strips `/api` (`proxy.conf.json`), so app code calls relative `/api/...` URLs and never needs an
API base URL. Production does the same with a Vercel rewrite.

## Scripts

| Script               | What it does                                 |
| -------------------- | -------------------------------------------- |
| `npm start`          | Dev server with hot reload                   |
| `npm run build`      | Production build to `dist/tang-pai-nai-web/` |
| `npm test`           | Unit tests once (Vitest)                     |
| `npm run test:watch` | Unit tests in watch mode                     |
| `npm run lint`       | ESLint, no changes (used by CI)              |
| `npm run fix`        | ESLint `--fix` + Prettier                    |
| `npm run typecheck`  | `tsc --noEmit` for app and spec configs      |
