# Tang Pai Nai — Web

**Tang Pai Nai (ตังค์ไปไหน)** is a personal income / expense tracker inspired by Money Lover. This folder
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

**On a phone:** `npm run dev` runs the dev server plus a Cloudflare quick tunnel and prints an
`https://<random>.trycloudflare.com` URL that works from any network (install `cloudflared` once:
`winget install Cloudflare.cloudflared`). HTTPS matters: session cookies are `Secure` and the
service worker needs it. Nothing to configure per run: `angular.json` allows `*.trycloudflare.com`
hosts, and `proxy.conf.json` sends the API `Origin: http://localhost:4200`, so the API's
`WEB_ORIGIN` stays at its default (the API's Origin check is therefore off in dev only). The URL is
public while the tunnel runs, and magic links in dev emails still point at `localhost`: type the
code instead.

For a fixed URL, use a named tunnel on a domain in your Cloudflare account. Once per machine:

```bash
cloudflared tunnel login                                   # pick the domain in the browser
cloudflared tunnel create tpn-dev
cloudflared tunnel route dns tpn-dev tang.dryst-lab.com
cp .env.tunnel.example .env.tunnel                         # TUNNEL_NAME + TUNNEL_HOST
```

`npm run dev` then runs that tunnel instead. Another host also needs adding to `allowedHosts` in
`angular.json` (the `ng serve` flag only takes true / false).

## Scripts

| Script               | What it does                                 |
| -------------------- | -------------------------------------------- |
| `npm start`          | Dev server with hot reload                   |
| `npm run dev`        | `npm start` + a Cloudflare tunnel for phones |
| `npm run build`      | Production build to `dist/tang-pai-nai-web/` |
| `npm test`           | Unit tests once (Vitest)                     |
| `npm run test:watch` | Unit tests in watch mode                     |
| `npm run lint`       | ESLint, no changes (used by CI)              |
| `npm run fix`        | ESLint `--fix` + Prettier                    |
| `npm run typecheck`  | `tsc --noEmit` for app and spec configs      |
